/**
 * Instrument-profile files, fits of measured calibration data, and the seeded mystery
 * instrument. Numerical results report one-standard-deviation fit uncertainties only. They do
 * not include the tabulated edge convention, sample thickness, composition, or model error.
 */
import { parseBeamlineFile, metadataField, type BeamlineTable } from '../beamline-files';
import { findE0, gradient, interpolate } from '../xas-reduction';
import { seededRandom } from '../xas';
import { elementInfo } from '../xraydata';
import { gaussian, simulatePoint } from './acquire';
import { muComponents } from './sample';
import { outputRate, type DeadTimeModel } from './sdd';
import type {
  ChamberConfig, ChamberGas, Crystal, EnvironmentConfig, MirrorCoating, MirrorConfig,
  SampleConfig, SourceConfig, SddConfig, TwinProfile, TwinState,
} from './types';
import { writeXdi } from './xdi';

export const TWIN_PROFILE_FORMAT = 'xaslab-twin-profile/1' as const;

export interface CalibrationResult {
  kind: 'energy-offset' | 'harmonic-fraction' | 'dead-time' | 'effective-resolution';
  label: string;
  value: number;
  /** One-standard-deviation fit uncertainty, in `unit`. */
  uncertainty: number;
  unit: 'eV' | '%' | 'us';
  verdict: string;
  method: string;
}

export interface EnergyOffsetResult extends CalibrationResult {
  kind: 'energy-offset';
  measuredInflection_eV: number;
  tabulatedEdge_eV: number;
  /** Add this number to the recorded energy axis. Equal to `value`. */
  correction_eV: number;
}

export interface DeadTimeFit {
  model: DeadTimeModel;
  value_us: number;
  uncertainty_us: number;
  rmse_per_s: number;
}

export interface DeadTimeResult extends CalibrationResult {
  kind: 'dead-time';
  preferredModel: DeadTimeModel;
  elements: number;
  fits: Record<DeadTimeModel, DeadTimeFit>;
}

export interface MysteryTruth {
  energyOffset_eV: number;
  harmonicFraction: number;
  deadTime_us: number;
  deadTimeModel: DeadTimeModel;
  elements: number;
}

export interface MysteryInstrument {
  seed: number;
  filename: string;
  text: string;
  truth: MysteryTruth;
}

export interface CalibrationOverrides {
  tabulatedEdge_eV?: number;
  formula?: string;
  density_g_cm3?: number;
  thickness_um?: number;
  elements?: number;
}

export interface CalibrationReport {
  table: BeamlineTable;
  results: CalibrationResult[];
  warnings: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function text(value: unknown, path: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${path} must be a non-empty string of at most ${max} characters.`);
  return value;
}

function numberIn(value: unknown, path: string, low: number, high: number, integer = false): number {
  if (!finite(value) || value < low || value > high || integer && !Number.isInteger(value)) {
    throw new Error(`${path} must be ${integer ? 'an integer ' : ''}from ${low} to ${high}.`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be true or false.`);
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${path} must be one of ${allowed.join(', ')}.`);
  return value as T;
}

const CRYSTALS: readonly Crystal[] = ['Si111', 'Si311', 'Si220'];
const COATINGS: readonly MirrorCoating[] = ['Si', 'Rh', 'Pt', 'Ni'];
const ROLES: readonly MirrorConfig['role'][] = ['collimating', 'focusing', 'harmonic-rejection'];
const GASES: readonly ChamberGas[] = ['N2', 'He', 'Ar', 'Kr'];
const SOURCE_KINDS: readonly SourceConfig['kind'][] = ['bending-magnet', 'undulator'];

function validateSource(value: unknown): SourceConfig {
  const v = object(value, 'source');
  const kind = oneOf(v.kind, 'source.kind', SOURCE_KINDS);
  let undulator: SourceConfig['undulator'];
  if (kind === 'undulator') {
    const u = object(v.undulator, 'source.undulator');
    undulator = {
      period_mm: numberIn(u.period_mm, 'source.undulator.period_mm', 5, 100),
      periods: numberIn(u.periods, 'source.undulator.periods', 1, 500, true),
      K: numberIn(u.K, 'source.undulator.K', 0, 5),
    };
  }
  return {
    kind,
    ring_GeV: numberIn(v.ring_GeV, 'source.ring_GeV', 0.1, 10),
    current_mA: numberIn(v.current_mA, 'source.current_mA', 1, 500),
    ...(v.field_T === undefined ? {} : { field_T: numberIn(v.field_T, 'source.field_T', 0.01, 3) }),
    ...(undulator ? { undulator } : {}),
    hAccept_mrad: numberIn(v.hAccept_mrad, 'source.hAccept_mrad', 0.001, 10),
    vDiv_urad: numberIn(v.vDiv_urad, 'source.vDiv_urad', 0.1, 1000),
  };
}

function validateFilter(value: unknown): NonNullable<SddConfig['filter']> {
  const v = object(value, 'sdd.filter');
  return {
    formula: text(v.formula, 'sdd.filter.formula', 120),
    density: numberIn(v.density, 'sdd.filter.density', 1e-6, 30),
    thickness_um: numberIn(v.thickness_um, 'sdd.filter.thickness_um', 0.001, 1e5),
  };
}

/** Strict validation of every TwinProfile field. Invalid files are rejected, never clamped silently. */
export function validateTwinProfile(value: unknown): TwinProfile {
  const v = object(value, 'profile');
  if (v.format !== TWIN_PROFILE_FORMAT) throw new Error(`Profile format must be ${TWIN_PROFILE_FORMAT}.`);
  const mirrorsRaw = v.mirrors;
  if (!Array.isArray(mirrorsRaw) || mirrorsRaw.length < 1 || mirrorsRaw.length > 8) throw new Error('mirrors must contain 1 to 8 mirrors.');
  const mirrors = mirrorsRaw.map((item, i): MirrorConfig => {
    const m = object(item, `mirrors[${i}]`);
    return {
      id: text(m.id, `mirrors[${i}].id`, 24),
      role: oneOf(m.role, `mirrors[${i}].role`, ROLES),
      coating: oneOf(m.coating, `mirrors[${i}].coating`, COATINGS),
      angle_mrad: numberIn(m.angle_mrad, `mirrors[${i}].angle_mrad`, 0.1, 20),
      inserted: boolean(m.inserted, `mirrors[${i}].inserted`),
    };
  });
  if (new Set(mirrors.map(m => m.id)).size !== mirrors.length) throw new Error('Mirror ids must be unique.');

  const monoRaw = object(v.mono, 'mono');
  const chambersRaw = v.chambers;
  if (!Array.isArray(chambersRaw) || chambersRaw.length !== 3) throw new Error('chambers must contain I0, It and Iref exactly once.');
  const chambers = chambersRaw.map((item, i): ChamberConfig => {
    const c = object(item, `chambers[${i}]`), gasRaw = object(c.gas, `chambers[${i}].gas`);
    const gas: ChamberConfig['gas'] = {};
    let sum = 0;
    for (const key of Object.keys(gasRaw)) {
      const name = oneOf(key, `chambers[${i}].gas name`, GASES);
      const fraction = numberIn(gasRaw[key], `chambers[${i}].gas.${key}`, 0, 1);
      if (fraction > 0) gas[name] = fraction;
      sum += fraction;
    }
    if (Math.abs(sum - 1) > 1e-6) throw new Error(`chambers[${i}].gas fractions must sum to 1.`);
    return {
      id: oneOf(c.id, `chambers[${i}].id`, ['I0', 'It', 'Iref'] as const),
      length_cm: numberIn(c.length_cm, `chambers[${i}].length_cm`, 1, 100),
      gas,
      gain_V_per_A: numberIn(c.gain_V_per_A, `chambers[${i}].gain_V_per_A`, 1e3, 1e11),
      dark_A: numberIn(c.dark_A, `chambers[${i}].dark_A`, -1e-6, 1e-6),
    };
  });
  if (new Set(chambers.map(c => c.id)).size !== 3) throw new Error('chambers must contain I0, It and Iref exactly once.');

  const sddRaw = object(v.sdd, 'sdd'), roi = sddRaw.roi_eV;
  if (!Array.isArray(roi) || roi.length !== 2) throw new Error('sdd.roi_eV must contain a lower and upper energy.');
  const roi_eV: [number, number] = [numberIn(roi[0], 'sdd.roi_eV[0]', 0, 100000), numberIn(roi[1], 'sdd.roi_eV[1]', 0, 100000)];
  if (roi_eV[1] <= roi_eV[0]) throw new Error('sdd.roi_eV upper energy must exceed the lower energy.');
  const beam = v.beam_um;
  if (!Array.isArray(beam) || beam.length !== 2) throw new Error('beam_um must contain horizontal and vertical FWHM.');
  const stability = object(v.stability, 'stability');
  return {
    format: TWIN_PROFILE_FORMAT,
    name: text(v.name, 'name'),
    preset: text(v.preset, 'preset', 80),
    source: validateSource(v.source),
    mirrors,
    mono: {
      crystal: oneOf(monoRaw.crystal, 'mono.crystal', CRYSTALS),
      offset_eV: numberIn(monoRaw.offset_eV, 'mono.offset_eV', -100, 100),
      detune: numberIn(monoRaw.detune, 'mono.detune', 0, 1),
      glitchSeed: numberIn(monoRaw.glitchSeed, 'mono.glitchSeed', 0, 4294967295, true),
    },
    chambers,
    sdd: {
      elements: numberIn(sddRaw.elements, 'sdd.elements', 1, 128, true),
      distance_mm: numberIn(sddRaw.distance_mm, 'sdd.distance_mm', 5, 5000),
      area_mm2: numberIn(sddRaw.area_mm2, 'sdd.area_mm2', 0.01, 10000),
      peaking_us: numberIn(sddRaw.peaking_us, 'sdd.peaking_us', 0.05, 32),
      roi_eV,
      ...(sddRaw.filter === undefined ? {} : { filter: validateFilter(sddRaw.filter) }),
      soller: boolean(sddRaw.soller, 'sdd.soller'),
      exitAngle_deg: numberIn(sddRaw.exitAngle_deg, 'sdd.exitAngle_deg', 1, 90),
    },
    beam_um: [numberIn(beam[0], 'beam_um[0]', 1, 10000), numberIn(beam[1], 'beam_um[1]', 1, 10000)],
    stability: {
      i0Noise: numberIn(stability.i0Noise, 'stability.i0Noise', 0, 0.2),
      drift_eV_per_h: numberIn(stability.drift_eV_per_h, 'stability.drift_eV_per_h', -20, 20),
    },
  };
}

export function profileFromJson(value: string): TwinProfile {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('The profile is not valid JSON.'); }
  return validateTwinProfile(parsed);
}

export function profileToJson(profile: TwinProfile): string {
  return JSON.stringify(validateTwinProfile(profile), null, 2) + '\n';
}

function cleanPairs(x: number[], y: number[], label: string): { x: number[]; y: number[] } {
  if (x.length !== y.length) throw new Error(`${label} arrays must have the same length.`);
  const rows = x.flatMap((value, i) => Number.isFinite(value) && Number.isFinite(y[i]) ? [{ x: value, y: y[i], i }] : [])
    .sort((a, b) => a.x - b.x || a.i - b.i)
    .filter((row, i, all) => i === 0 || row.x !== all[i - 1].x);
  if (rows.length < 16) throw new Error(`${label} needs at least 16 finite points with distinct energies.`);
  return { x: rows.map(row => row.x), y: rows.map(row => row.y) };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Reference-foil correction. Convention: correction = tabulated edge minus the measured first
 * inflection; add it to every recorded energy from the same scan. The E0 estimator is the shipped
 * xraylarch find_e0 port. The standard uncertainty is the uniform-grid quantisation component.
 */
export function fitEnergyOffset(energy_eV: number[], muReference: number[], tabulatedEdge_eV: number): EnergyOffsetResult {
  if (!(tabulatedEdge_eV > 0)) throw new Error('The tabulated edge energy must be greater than zero eV.');
  const clean = cleanPairs(energy_eV, muReference, 'Energy-offset fit');
  const measuredInflection_eV = findE0(clean.x, clean.y);
  const steps = clean.x.slice(1).map((value, i) => value - clean.x[i]).filter(value => value > 0);
  const uncertainty = median(steps) / Math.sqrt(12);
  const correction_eV = tabulatedEdge_eV - measuredInflection_eV;
  const size = Math.abs(correction_eV);
  const verdict = size <= 0.25
    ? 'The recorded energy scale is close to the tabulated reference convention.'
    : size <= 10
      ? String.raw`Apply $${correction_eV >= 0 ? '+' : ''}${correction_eV.toFixed(3)}\ \mathrm{eV}$ to the recorded energy axis.`
      : 'The offset is large. Check the reference element, edge and detector columns before applying it.';
  return {
    kind: 'energy-offset', label: 'Energy correction', value: correction_eV, uncertainty, unit: 'eV', verdict,
    measuredInflection_eV, tabulatedEdge_eV, correction_eV,
    method: String.raw`First inflection from the xraylarch find_e0 convention; $\Delta E = E_{\mathrm{tabulated}} - E_{\mathrm{inflection}}$. Uncertainty is the standard grid-quantisation component only.`,
  };
}

interface HarmonicInput {
  energy_eV: number[];
  apparentMu: number[];
  state: TwinState;
  energyOffset_eV?: number;
}

const noRandom = () => { throw new Error('An educational calibration model must not draw random numbers.'); };

function harmonicEndpoints(state: TwinState, energy_eV: number[], offset_eV: number) {
  const modelState: TwinState = {
    ...state, realistic: false,
    profile: { ...state.profile, mono: { ...state.profile.mono, offset_eV } },
  };
  const flux = 1e9;
  return energy_eV.map(E => {
    const fundamental = simulatePoint(modelState, E, noRandom, { orders: [{ order: 1, energy_eV: E + offset_eV, flux }] });
    const third = simulatePoint(modelState, E, noRandom, { orders: [{ order: 3, energy_eV: 3 * (E + offset_eV), flux }] });
    if (fundamental.saturated.length || third.saturated.length) throw new Error('The chamber amplifiers clip in the harmonic model. Lower their gains before fitting.');
    return { fundamental, third };
  });
}

/** Fit the fraction of photons in the third harmonic by inverting acquire.ts detector mixing. */
export function fitHarmonicFraction(input: HarmonicInput): CalibrationResult {
  const clean = cleanPairs(input.energy_eV, input.apparentMu, 'Harmonic fit');
  const endpoints = harmonicEndpoints(input.state, clean.x, input.energyOffset_eV ?? 0);
  const prediction = (fraction: number, i: number) => {
    const { fundamental: a, third: b } = endpoints[i];
    const i0 = (1 - fraction) * a.i0 + fraction * b.i0;
    const it = (1 - fraction) * a.it + fraction * b.it;
    return Math.log(i0 / it);
  };
  // A free constant removes fixed amplifier/chamber baselines without changing the edge amplitude.
  const score = (fraction: number) => {
    const residual = clean.y.map((value, i) => value - prediction(fraction, i));
    const centre = residual.reduce((sum, value) => sum + value, 0) / residual.length;
    return residual.reduce((sum, value) => sum + (value - centre) ** 2, 0);
  };
  let lo = 0, hi = 0.5;
  for (let step = 0; step < 70; step++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (score(a) <= score(b)) hi = b; else lo = a;
  }
  const fraction = (lo + hi) / 2, sse = score(fraction), n = clean.x.length;
  const delta = 1e-4;
  const sensitivities = clean.x.map((_, i) => (prediction(clamp(fraction + delta, 0, .5), i) - prediction(clamp(fraction - delta, 0, .5), i)) / (2 * delta));
  const meanSensitivity = sensitivities.reduce((sum, value) => sum + value, 0) / n;
  const information = sensitivities.reduce((sum, value) => sum + (value - meanSensitivity) ** 2, 0);
  const uncertaintyFraction = information > 0 ? Math.sqrt(sse / Math.max(1, n - 2) / information) : NaN;
  const verdict = fraction < 0.01 ? 'No material third-harmonic leakage is resolved.'
    : fraction < 0.05 ? 'A small harmonic contribution is present. Detuning or a rejection mirror may reduce it.'
      : 'Harmonic leakage is high enough to suppress edge and EXAFS amplitudes.';
  return {
    kind: 'harmonic-fraction', label: 'Third-harmonic fraction', value: 100 * fraction,
    uncertainty: 100 * uncertaintyFraction, unit: '%', verdict,
    method: String.raw`Nonlinear least squares of $\ln(I_0/I_t)$, using the per-energy $E$ and $3E$ chamber and sample responses from acquire.ts. A constant detector baseline is fitted out. Uncertainty is fit-statistical only.`,
  };
}

function fitOneDeadTime(icr: number[], ocr: number[], elements: number, model: DeadTimeModel): DeadTimeFit {
  const r = icr.map(value => value / elements);
  const y = icr.map((value, i) => model === 'paralyzable' ? -Math.log(ocr[i] / value) : value / ocr[i] - 1);
  const xx = r.reduce((sum, value) => sum + value * value, 0);
  const tau = r.reduce((sum, value, i) => sum + value * y[i], 0) / xx;
  const transformedSse = y.reduce((sum, value, i) => sum + (value - r[i] * tau) ** 2, 0);
  const uncertainty_s = Math.sqrt(transformedSse / Math.max(1, r.length - 1) / xx);
  const predicted = icr.map(value => outputRate(value / elements, tau, model) * elements);
  const rmse = Math.sqrt(predicted.reduce((sum, value, i) => sum + (value - ocr[i]) ** 2, 0) / predicted.length);
  return { model, value_us: tau * 1e6, uncertainty_us: uncertainty_s * 1e6, rmse_per_s: rmse };
}

/** Fit the summed ICR/OCR columns, with one independent pulse processor per SDD element. */
export function fitDeadTime(icrIn: number[], ocrIn: number[], elements: number): DeadTimeResult {
  if (!Number.isInteger(elements) || elements < 1) throw new Error('The number of detector elements must be a positive integer.');
  if (icrIn.length !== ocrIn.length) throw new Error('ICR and OCR arrays must have the same length.');
  const pairs = icrIn.flatMap((icr, i) => Number.isFinite(icr) && Number.isFinite(ocrIn[i]) && icr > 0 && ocrIn[i] > 0 && ocrIn[i] <= icr ? [{ icr, ocr: ocrIn[i] }] : []);
  if (pairs.length < 6) throw new Error('Dead-time fitting needs at least 6 finite rows with 0 < OCR <= ICR.');
  if (Math.max(...pairs.map(p => p.icr)) / Math.min(...pairs.map(p => p.icr)) < 1.5) throw new Error('ICR must span at least a factor of 1.5 to separate dead time from scale error.');
  const icr = pairs.map(p => p.icr), ocr = pairs.map(p => p.ocr);
  const paralyzable = fitOneDeadTime(icr, ocr, elements, 'paralyzable');
  const nonParalyzable = fitOneDeadTime(icr, ocr, elements, 'non-paralyzable');
  const fits = { paralyzable, 'non-paralyzable': nonParalyzable };
  const preferred = paralyzable.rmse_per_s <= nonParalyzable.rmse_per_s ? paralyzable : nonParalyzable;
  if (!(preferred.value_us > 0) || !Number.isFinite(preferred.value_us)) throw new Error('The ICR/OCR relation does not give a positive finite dead time.');
  const other = preferred.model === 'paralyzable' ? nonParalyzable : paralyzable;
  const decisive = other.rmse_per_s > 1.2 * preferred.rmse_per_s;
  return {
    kind: 'dead-time', label: 'Processor dead time', value: preferred.value_us,
    uncertainty: preferred.uncertainty_us, unit: 'us', preferredModel: preferred.model, elements, fits,
    verdict: String.raw`${preferred.model === 'paralyzable' ? 'Paralyzable' : 'Non-paralyzable'} response ${decisive ? 'fits better' : 'fits slightly better'} by $\mathrm{OCR}$ residual. The $\mathrm{ICR}$ and $\mathrm{OCR}$ columns are totals over ${elements} elements; the fit uses $\mathrm{ICR}/${elements}$ for each processor.`,
    method: String.raw`Both $\mathrm{OCR}=\mathrm{ICR}\exp[-(\mathrm{ICR}/n)\tau]$ and $\mathrm{OCR}=\mathrm{ICR}/[1+(\mathrm{ICR}/n)\tau]$ are fitted through the physical zero-loss intercept and compared by $\mathrm{OCR}$ RMSE. Uncertainty is the transformed-regression standard uncertainty.`,
  };
}

export interface ResolutionInput { energy_eV: number[]; observed: number[]; referenceEnergy_eV: number[]; reference: number[] }

function derivativeWidth(energy: number[], mu: number[]): { centre: number; sigma: number } | null {
  const energyGradient = gradient(energy);
  const d = gradient(mu).map((value, i) => value / energyGradient[i]);
  const positive = d.map(value => Math.max(0, value));
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  const centre = energy.reduce((sum, value, i) => sum + value * positive[i], 0) / total;
  const variance = energy.reduce((sum, value, i) => sum + (value - centre) ** 2 * positive[i], 0) / total;
  return { centre, sigma: Math.sqrt(variance) };
}

/** Width in excess of a supplied sharp reference. Returns null when the subtraction is unreliable. */
export function fitEffectiveResolution(input: ResolutionInput): CalibrationResult | null {
  const observed = cleanPairs(input.energy_eV, input.observed, 'Resolution fit');
  const reference = cleanPairs(input.referenceEnergy_eV, input.reference, 'Resolution reference');
  const refOnGrid = interpolate(reference.x, reference.y, observed.x, 'linear');
  const a = derivativeWidth(observed.x, observed.y), b = derivativeWidth(observed.x, refOnGrid);
  if (!a || !b || a.sigma <= b.sigma * 1.02) return null;
  const sigma = Math.sqrt(a.sigma ** 2 - b.sigma ** 2), fwhm = 2 * Math.sqrt(2 * Math.log(2)) * sigma;
  const step = median(observed.x.slice(1).map((value, i) => value - observed.x[i]));
  if (!Number.isFinite(fwhm) || fwhm < 2 * step || fwhm > (observed.x.at(-1)! - observed.x[0]) / 3) return null;
  return {
    kind: 'effective-resolution', label: 'Effective Gaussian resolution', value: fwhm,
    uncertainty: step / Math.sqrt(12), unit: 'eV',
    verdict: 'The feature is measurably broader than the supplied reference curve.',
    method: String.raw`Quadrature subtraction of derivative-weighted Gaussian widths. This is skipped when the excess width is not resolved or is dominated by the scan bounds.`,
  };
}

const columnKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]/g, '');

function findColumn(table: BeamlineTable, names: readonly string[]): number[] | null {
  const wanted = new Set(names.map(columnKey));
  const index = table.labels.findIndex(label => wanted.has(columnKey(label)));
  return index < 0 ? null : table.columns[index];
}

function energyColumn(table: BeamlineTable): number[] | null {
  const wanted = new Set(['energy', 'energy_eV', 'energy_keV', 'e'].map(columnKey));
  const index = table.labels.findIndex(label => wanted.has(columnKey(label)));
  if (index < 0) return null;
  const declaredUnit = table.units[index]?.trim().toLowerCase();
  const labelSaysKeV = /kev/i.test(table.labels[index]);
  const scale = declaredUnit === 'kev' || labelSaysKeV ? 1000 : 1;
  return scale === 1 ? table.columns[index] : table.columns[index].map(value => value * scale);
}

function metadataNumber(table: BeamlineTable, name: string): number | undefined {
  const raw = metadataField(table, name);
  if (raw === undefined) return undefined;
  const value = Number(raw.trim().split(/\s+/)[0]);
  return Number.isFinite(value) ? value : undefined;
}

function edgeFromTable(table: BeamlineTable): number | undefined {
  const explicit = metadataNumber(table, 'Calibration.edge_energy') ?? metadataNumber(table, 'Scan.edge_energy');
  if (explicit) return explicit;
  const symbol = metadataField(table, 'Element.reference') ?? metadataField(table, 'Element.symbol');
  const edge = metadataField(table, 'Element.ref_edge') ?? metadataField(table, 'Element.edge');
  if (!symbol || !edge) return undefined;
  return elementInfo(symbol.trim()).edges.find(item => item.edge === edge.trim())?.energy_eV;
}

function sampleFromTable(table: BeamlineTable, current: TwinState, overrides: CalibrationOverrides): SampleConfig {
  return {
    ...current.sample,
    formula: overrides.formula ?? metadataField(table, 'Sample.formula') ?? metadataField(table, 'Sample.name') ?? current.sample.formula,
    density: overrides.density_g_cm3 ?? metadataNumber(table, 'Sample.density') ?? current.sample.density,
    thickness_um: overrides.thickness_um ?? metadataNumber(table, 'Sample.thickness_um') ?? current.sample.thickness_um,
    absorber: metadataField(table, 'Element.symbol')?.trim() ?? current.sample.absorber,
    edge: metadataField(table, 'Element.edge')?.trim() ?? current.sample.edge,
  };
}

/** Parse XDI or plain named columns and run every reliable fit the file supports. */
export function calibrateText(textValue: string, state: TwinState, overrides: CalibrationOverrides = {}, name = 'calibration data'): CalibrationReport {
  const table = parseBeamlineFile(textValue, name), warnings: string[] = [], results: CalibrationResult[] = [];
  const energy = energyColumn(table);
  if (!energy) throw new Error('Choose or name an energy column (energy, energy_eV or energy_keV).');
  const tabulatedEdge = overrides.tabulatedEdge_eV ?? edgeFromTable(table);
  const directRef = findColumn(table, ['murefer', 'muref', 'mu_ref', 'reference_mu', 'foil_mu']);
  const it = findColumn(table, ['itrans', 'it', 'i1']), iref = findColumn(table, ['irefer', 'iref', 'i2']);
  const muRef = directRef ?? (it && iref ? it.map((value, i) => value > 0 && iref[i] > 0 ? Math.log(value / iref[i]) : NaN) : null);
  let offset = 0;
  if (muRef && tabulatedEdge) {
    const result = fitEnergyOffset(energy, muRef, tabulatedEdge);
    results.push(result); offset = result.value;
  } else warnings.push('Energy offset skipped: the file needs a reference-mu column or It and Iref, plus a declared reference edge.');

  const directMu = findColumn(table, ['mutrans', 'mu', 'muapp', 'apparentmu']);
  const i0 = findColumn(table, ['i0', 'io', 'monitor']);
  const apparentMu = directMu ?? (i0 && it ? i0.map((value, i) => value > 0 && it[i] > 0 ? Math.log(value / it[i]) : NaN) : null);
  if (apparentMu) {
    const sample = sampleFromTable(table, state, overrides);
    const fitState = { ...state, sample };
    try { results.push(fitHarmonicFraction({ energy_eV: energy, apparentMu, state: fitState, energyOffset_eV: offset })); }
    catch (error) { warnings.push(`Harmonic fraction skipped: ${error instanceof Error ? error.message : String(error)}`); }
  } else warnings.push('Harmonic fraction skipped: the file needs mu or I0 and It columns.');

  const icr = findColumn(table, ['icr', 'inputcountrate']), ocr = findColumn(table, ['ocr', 'outputcountrate']);
  const elements = Math.round(overrides.elements ?? metadataNumber(table, 'Detector.elements') ?? state.profile.sdd.elements);
  if (icr && ocr) {
    try { results.push(fitDeadTime(icr, ocr, elements)); }
    catch (error) { warnings.push(`Dead time skipped: ${error instanceof Error ? error.message : String(error)}`); }
  } else warnings.push('Dead time skipped: the file needs ICR and OCR columns.');

  const observedFeature = findColumn(table, ['resolution_observed', 'feature_observed', 'sharp_observed']);
  const referenceFeature = findColumn(table, ['resolution_reference', 'feature_reference', 'sharp_reference']);
  if (observedFeature && referenceFeature) {
    const result = fitEffectiveResolution({ energy_eV: energy, observed: observedFeature, referenceEnergy_eV: energy, reference: referenceFeature });
    if (result) results.push(result);
    else warnings.push('Effective resolution skipped: the excess width is not resolved reliably on this energy grid.');
  } else warnings.push('Effective resolution was not estimated because no independent sharp reference curve was supplied.');
  return { table, results, warnings };
}

function tabulatedEdge(state: TwinState): number {
  const edge = elementInfo(state.sample.absorber).edges.find(item => item.edge === state.sample.edge);
  if (!edge) throw new Error(`${state.sample.absorber} has no tabulated ${state.sample.edge} edge.`);
  return edge.energy_eV;
}

/**
 * Seeded XDI challenge. The sample curve uses simulatePoint, and therefore the same muComponents
 * fine structure (including a loaded FEFF path sum) as an ordinary twin acquisition.
 */
export function generateMysteryInstrument(state: TwinState, seed: number): MysteryInstrument {
  const random = seededRandom(seed >>> 0), e0 = tabulatedEdge(state);
  const step_eV = 0.05;
  // Encoder-like offsets are quantised to the challenge scan's readback grid.
  const requestedOffset_eV = Math.round((-4.5 + 9 * random()) / step_eV) * step_eV;
  const harmonicFraction = 0.025 + 0.15 * random();
  const deadTime_us = 0.4 + 1.8 * random();
  const elements = state.profile.sdd.elements;
  const energy = Array.from({ length: Math.round(90 / step_eV) + 1 }, (_, i) => e0 - 30 + i * step_eV);

  // Align the model foil's own find_e0 to the tabulated convention, without replacing its fine structure.
  const template = energy.map(E => muComponents(state.sample, E, { temperature_K: state.environment.temperature_K }).total_cm_inv * state.sample.thickness_um * 1e-4);
  const intrinsic = findE0(energy, template) - e0;
  // The reference channel is an expected-value scan. Keeping its derivative noise-free makes the
  // challenge grade the energy convention, rather than whether a random derivative spike wins.
  // Shift the sampled template by whole readback bins so Larch's grid-point E0 convention is
  // translation invariant down to the last bit; re-evaluating the model on translated floats can
  // otherwise move a tied derivative peak by one bin.
  const shiftPoints = Math.round((requestedOffset_eV + intrinsic) / step_eV);
  const murefer = energy.map((_, i) => template[clamp(i + shiftPoints, 0, template.length - 1)]);
  // The recoverable calibration is the tabulated edge minus this sampled foil's first
  // inflection. It can differ from the requested encoder shift by one tied derivative bin.
  const energyOffset_eV = e0 - findE0(energy, murefer);
  const truth: MysteryTruth = { energyOffset_eV, harmonicFraction, deadTime_us, deadTimeModel: 'paralyzable', elements };

  const endpoints = harmonicEndpoints(state, energy, energyOffset_eV);
  const i0: number[] = [], itrans: number[] = [], mutrans: number[] = [], icr: number[] = [], ocr: number[] = [];
  for (let i = 0; i < energy.length; i++) {
    const { fundamental: a, third: b } = endpoints[i];
    const monitor = (1 - harmonicFraction) * a.i0 + harmonicFraction * b.i0;
    const transmitted = (1 - harmonicFraction) * a.it + harmonicFraction * b.it;
    const noisyMu = Math.log(monitor / transmitted) + gaussian(random) * 2e-5;
    i0.push(monitor); itrans.push(monitor / Math.exp(noisyMu)); mutrans.push(noisyMu);
    const progress = i / (energy.length - 1), perElement = (0.03 + 0.77 * progress) / (deadTime_us * 1e-6);
    const input = perElement * elements;
    const output = outputRate(perElement, deadTime_us * 1e-6, 'paralyzable') * elements * (1 + gaussian(random) * 2e-4);
    icr.push(input); ocr.push(Math.min(input, Math.max(Number.MIN_VALUE, output)));
  }
  const metadata = {
    'Element.symbol': state.sample.absorber,
    'Element.edge': state.sample.edge,
    'Element.reference': state.sample.absorber,
    'Element.ref_edge': state.sample.edge,
    'Mono.d_spacing': '3.135601',
    'Calibration.edge_energy': e0.toString(),
    'Calibration.seed': String(seed >>> 0),
    'Sample.formula': state.sample.formula,
    'Sample.density': state.sample.density.toString(),
    'Sample.thickness_um': state.sample.thickness_um.toString(),
    'Detector.elements': String(elements),
    'Facility.name': 'XAS Lab mystery instrument (simulated)',
  };
  const textValue = writeXdi({ columns: { energy, i0, itrans, murefer, mutrans, icr, ocr }, metadata }, [
    'Synthetic calibration challenge generated locally by XAS Lab.',
    'The hidden settings are determined by the seed and are not stored in this file.',
  ]);
  return { seed: seed >>> 0, filename: `xaslab-mystery-${seed >>> 0}.xdi`, text: textValue, truth };
}
