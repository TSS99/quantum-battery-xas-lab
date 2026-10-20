/**
 * The twin's one entry point for the page, the worker, the CLI and agents: the current readouts
 * (`status`), a small typed command set (`applyCommand`), range checks (`validateState`), scans
 * (`simulatePoint`, `runScan`) and the `xaslab-twin-session/1` file.
 *
 * Everything here needs `loadXrayData()` and `loadOptics()` first, except the plain state edits.
 */
import { edgeEnergy, emissionScale, foilTransmission, runScan, simulatePoint } from './acquire';
import { beamAtSample } from './beam';
import { chamberReadout, type ChamberReadout } from './chambers';
import { sampleDoseRate } from './damage';
import { harmonicRejectionAngle } from './mirrors';
import { backscatterEnergy_eV, detuneFactor, monoTrueEnergy_eV } from './mono';
import { PROFILE_PRESETS, profilePreset, referenceFor, resolveSamplePreset, samplePreset } from './presets';
import { planPoints } from './scan';
import { massFractions } from '../xraydata';
import { fluorescence, fluorescenceLine, muComponents, transmission } from './sample';
import { efficiency, filterTransmission, mcaSpectrum, solidAngle, type McaSpectrum } from './sdd';
import { TWIN_MODES, type Acquisition, type ChamberConfig, type Crystal, type EnvironmentConfig, type SampleConfig, type ScanPlan, type SddConfig, type TwinMode, type TwinState } from './types';

export { runScan, simulatePoint };

/** The default state: the bending magnet profile and a 7 um Cu foil just above the Cu K edge (8979.0 eV in xraydb). */
export const DEFAULT_STATE: TwinState = {
  mode: 'transmission',
  realistic: false,
  energy_eV: 9000,
  profile: PROFILE_PRESETS[0].profile,
  // Edge step about 1.5: mu x of 0.25 below and 1.72 above the edge (xraydb, 8.96 g/cm3).
  sample: { formula: 'Cu', density: 8.96, thickness_um: 7, absorber: 'Cu', edge: 'K', form: 'foil', pinholeFraction: 0, thicknessSpread: 0, particle_um: 0, incidence_deg: 45 },
  environment: { kind: 'ambient', temperature_K: 295, windows: [] },
  reference: { formula: 'Cu', density: 8.96, thickness_um: 7 },
  // Pre-edge, edge and EXAFS regions relative to the edge; k = 2.8 per angstrom is 30 eV above it.
  scan: {
    kind: 'step', repeats: 1, settle_s: 0.2,
    regions: [
      { space: 'E', start: -150, end: -20, step: 5, dwell_s: 1 },
      { space: 'E', start: -20, end: 30, step: 0.5, dwell_s: 1 },
      { space: 'k', start: 2.8, end: 14, step: 0.05, dwell_s: 1, kWeight: 1 },
    ],
  },
  seed: 1,
};

// ---------------------------------------------------------------- status

export interface TwinStatus {
  /** Mono reading, eV. */
  energy_eV: number;
  /** Photon energy actually passed, reading plus the mono offset, eV. */
  trueEnergy_eV: number;
  /** True Bragg angle of the fundamental, degrees; null when the crystal cannot reach the energy. */
  theta_deg: number | null;
  /** Energy resolution of the fundamental, eV. */
  deltaE_eV: number | null;
  /** Photons per second arriving at the I0 chamber. */
  flux: number | null;
  harmonicFraction: number | null;
  i0: ChamberReadout | null;
  /** Photons per second on the sample, after the I0 chamber. */
  sampleFlux: number | null;
  /** Fraction of the beam through the sample and its environment windows. */
  sampleTransmission: number | null;
  /** Total mu x of the sample at this energy, and its edge step 50 eV above the edge. */
  muX: number | null;
  edgeStep: number | null;
  it: ChamberReadout | null;
  /** Fraction of the beam through the reference foil; null without a foil. */
  foilTransmission: number | null;
  iref: ChamberReadout | null;
  /** Line photons per second reaching the fluorescence detector, before dead time. */
  fluorescence_per_s: number | null;
  /** Input count rate of the fluorescence detector and the share it loses to dead time. */
  icr: number | null;
  deadFraction: number | null;
  /** Surface dose rate on the sample, Gy/s. */
  doseRate_Gy_per_s: number | null;
  /** Fraction of the photons at I0 still in the beam after each element, for the drawn glow. */
  afterI0: number;
  afterSample: number;
  afterIt: number;
  afterFoil: number;
  /** Why a number is missing, in plain words. */
  notes: string[];
}

const chamberOf = (state: TwinState, id: ChamberConfig['id']) => state.profile.chambers.find(c => c.id === id);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Every readout the page shows for the current state: expected values at the fundamental, no noise. */
export function status(state: TwinState): TwinStatus {
  const { energy_eV, profile, sample, environment } = state;
  const notes: string[] = [];
  const trueEnergy_eV = monoTrueEnergy_eV(energy_eV, profile.mono.offset_eV);
  const out: TwinStatus = {
    energy_eV, trueEnergy_eV, theta_deg: null, deltaE_eV: null, flux: null, harmonicFraction: null, i0: null, sampleFlux: null,
    sampleTransmission: null, muX: null, edgeStep: null, it: null, foilTransmission: null, iref: null, fluorescence_per_s: null,
    icr: null, deadFraction: null, doseRate_Gy_per_s: null, afterI0: 1, afterSample: 1, afterIt: 1, afterFoil: 1, notes,
  };
  let beam;
  try { beam = beamAtSample(profile, trueEnergy_eV); } catch (error) { notes.push(message(error)); return out; }
  out.theta_deg = beam.thetaB_rad * 180 / Math.PI;
  out.deltaE_eV = beam.deltaE_eV;
  out.flux = beam.flux;
  out.harmonicFraction = beam.harmonicFraction;

  const i0Config = chamberOf(state, 'I0'), itConfig = chamberOf(state, 'It'), irefConfig = chamberOf(state, 'Iref');
  out.i0 = i0Config ? chamberReadout(i0Config, beam.flux, trueEnergy_eV) : null;
  const sampleFlux = out.i0 ? out.i0.transmittedFlux : beam.flux;
  out.sampleFlux = sampleFlux;
  out.afterI0 = beam.flux > 0 ? sampleFlux / beam.flux : 0;

  const through = transmission(sample, environment, trueEnergy_eV);
  out.sampleTransmission = through.transmission;
  out.muX = through.muX;
  out.edgeStep = muComponents(sample, edgeEnergy(sample) + 50).sharpStep_cm_inv * sample.thickness_um * 1e-4;
  out.afterSample = out.afterI0 * through.transmission;
  out.it = itConfig ? chamberReadout(itConfig, sampleFlux * through.transmission, trueEnergy_eV) : null;
  out.afterIt = out.it && beam.flux > 0 ? out.it.transmittedFlux / beam.flux : out.afterSample;
  const foil = state.reference ? foilTransmission(state.reference, sample, trueEnergy_eV) : 1;
  out.foilTransmission = state.reference ? foil : null;
  out.afterFoil = out.afterIt * foil;
  out.iref = irefConfig ? chamberReadout(irefConfig, beam.flux * out.afterFoil, trueEnergy_eV) : null;

  try {
    const line = fluorescenceLine(sample.absorber, sample.edge);
    const detected = efficiency(line.energy_eV).total * filterTransmission(profile.sdd, line.energy_eV);
    const result = fluorescence(sample, environment, trueEnergy_eV, {
      solidAngleFraction: solidAngle(profile.sdd).fraction, efficiency: detected, exit_deg: profile.sdd.exitAngle_deg,
    });
    out.fluorescence_per_s = sampleFlux * result.ratio;
    const point = simulatePoint({ ...state, realistic: false }, energy_eV, () => 0.5);
    out.icr = point.icr;
    out.deadFraction = point.deadFraction;
  } catch (error) { notes.push(message(error)); }

  out.doseRate_Gy_per_s = sampleDoseRate(sample, sampleFlux, trueEnergy_eV, profile.beam_um).surfaceRate_Gy_per_s;
  return out;
}

/**
 * The fluorescence detector's energy spectrum at the current energy over one dwell, from the
 * sample's emission lines (sdd.ts). Elastic and Compton scatter are left out: separating them
 * needs coherent and incoherent cross sections the shipped tables do not carry.
 */
export function xrfSpectrum(state: TwinState, dwell_s = 1): McaSpectrum | null {
  const s = status(state);
  if (s.sampleFlux === null) return null;
  const { sample, environment, profile } = state;
  let fl;
  try {
    const line = fluorescenceLine(sample.absorber, sample.edge);
    fl = fluorescence(sample, environment, s.trueEnergy_eV, {
      solidAngleFraction: solidAngle(profile.sdd).fraction, efficiency: efficiency(line.energy_eV).total, exit_deg: profile.sdd.exitAngle_deg,
    });
  } catch { return null; }
  return mcaSpectrum({ sdd: profile.sdd, sample, energy_eV: s.trueEnergy_eV, fluorescenceScale: emissionScale(sample, profile.sdd, s.sampleFlux, fl), dwell_s });
}

/**
 * The rocking curve: throughput of the second crystal against its detune (in fundamental
 * rocking-curve widths), for the fundamental and the third harmonic, from the tabulated Darwin curves.
 */
export function rockingCurve(state: TwinState, points = 121): { detune: number[]; fundamental: number[]; third: number[] } {
  const { crystal } = state.profile.mono, E = monoTrueEnergy_eV(state.energy_eV, state.profile.mono.offset_eV);
  const detune = Array.from({ length: points }, (_, i) => -1.5 + 3 * i / (points - 1));
  return {
    detune,
    fundamental: detune.map(d => detuneFactor(crystal, 1, E, Math.abs(d))),
    third: detune.map(d => detuneFactor(crystal, 3, E, Math.abs(d))),
  };
}

// ---------------------------------------------------------------- commands

export type TwinCommand =
  | { type: 'energy'; energy_eV: number }
  | { type: 'mode'; mode: TwinMode }
  | { type: 'realistic'; value: boolean }
  | { type: 'detune'; detune: number }
  | { type: 'crystal'; crystal: Crystal }
  | { type: 'mirror'; id: string; inserted: boolean }
  | { type: 'gas'; chamber: ChamberConfig['id']; gas: ChamberConfig['gas'] }
  | { type: 'gain'; chamber: ChamberConfig['id']; gain_V_per_A: number }
  | { type: 'autoGain' }
  | { type: 'profile'; id: string }
  | { type: 'samplePreset'; id: string }
  | { type: 'thickness'; thickness_um: number }
  | { type: 'temperature'; temperature_K: number }
  /** Any formula: a new material, absorber or edge also moves the energy, the window and the reference foil. */
  | { type: 'sample'; patch: Partial<Omit<SampleConfig, 'libraryId'>> }
  | { type: 'environment'; kind: EnvironmentConfig['kind'] }
  | { type: 'sdd'; patch: Partial<Pick<SddConfig, 'distance_mm' | 'peaking_us' | 'soller' | 'elements'>> }
  | { type: 'scan'; plan: ScanPlan }
  | { type: 'source'; current_mA: number };

/** What a command changed, for the "what just changed" line and the explanations. */
export type ChangeKey = TwinCommand['type'];

export interface CommandResult {
  state: TwinState;
  change: ChangeKey;
  /** Plain-language line describing the change, with $...$ around LaTeX. */
  note: string;
}

/** The output the auto-gain setting aims for, V: well inside the 10 V full scale with room for the edge. */
export const AUTO_GAIN_TARGET_V = 5;
const GAIN_RANGE: [number, number] = [1e3, 1e11];
const clamp = (value: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, value));
/** Formula as upright LaTeX with numeric subscripts, as `formulaTex` in components/tex.tsx (which lib code must not import). */
const formulaTex = (formula: string) => '\\mathrm{' + formula.replace(/(?<=[A-Za-z)\]])(\d+(?:\.\d+)?)/g, '_{$1}') + '}';
const fmt = (value: number, digits = 1) => value.toFixed(digits);

/** Energy range the current profile and crystal can reach, eV. */
export function energyRange(state: TwinState): [number, number] {
  const preset = profilePreset(state.profile.preset) ?? PROFILE_PRESETS[0];
  // Bragg angles near 90 degrees are out of reach of a real goniometer; stay 1 % above backscattering.
  return [Math.max(preset.range_eV[0], backscatterEnergy_eV(state.profile.mono.crystal) * 1.01), preset.range_eV[1]];
}

/** Temperature range of each sample environment, K (plan 3.4); ambient cells are kept near room temperature. */
export const TEMPERATURE_RANGE: Record<TwinState['environment']['kind'], [number, number]> = {
  ambient: [273, 353], cryostat: [10, 300], furnace: [300, 1100], 'operando-cell': [253, 333], 'liquid-cell': [278, 353],
};

const setChamber = (state: TwinState, id: ChamberConfig['id'], patch: Partial<ChamberConfig>): TwinState => ({
  ...state, profile: { ...state.profile, chambers: state.profile.chambers.map(c => c.id === id ? { ...c, ...patch } : c) },
});

/** Put the fluorescence window on the absorber's line, 300 eV wide. */
function centredRoi(state: TwinState): TwinState {
  try {
    const line = fluorescenceLine(state.sample.absorber, state.sample.edge).energy_eV;
    return { ...state, profile: { ...state.profile, sdd: { ...state.profile.sdd, roi_eV: [Math.round(line - 150), Math.round(line + 150)] } } };
  } catch { return state; }
}

/** The state after one command, clamped to the allowed ranges. */
export function applyCommand(state: TwinState, command: TwinCommand): CommandResult {
  const done = (next: TwinState, note: string): CommandResult => ({ state: validateState(next).state, change: command.type, note });
  switch (command.type) {
    case 'energy': {
      const energy_eV = clamp(command.energy_eV, energyRange(state));
      return done({ ...state, energy_eV }, String.raw`Energy set to $E = ${fmt(energy_eV)}\ \mathrm{eV}$.`);
    }
    case 'mode': return done({ ...state, mode: command.mode }, `Mode: ${command.mode.replace('-', ' ')}.`);
    case 'realistic': return done({ ...state, realistic: command.value }, command.value ? 'Realistic detectors: counting noise, drift, glitches and dead time.' : 'Educational view: expected values, without detector noise.');
    case 'detune': {
      const detune = clamp(command.detune, [0, 1]);
      return done({ ...state, profile: { ...state.profile, mono: { ...state.profile.mono, detune } } }, `Second crystal detuned by ${Math.round(detune * 100)} % of the rocking curve width.`);
    }
    case 'crystal': return done({ ...state, profile: { ...state.profile, mono: { ...state.profile.mono, crystal: command.crystal } } }, `Monochromator crystals: ${command.crystal.replace(/^Si(\d+)$/, 'Si($1)')}.`);
    case 'mirror': {
      const mirror = state.profile.mirrors.find(m => m.id === command.id);
      if (!mirror) throw new Error(`No mirror ${command.id} in this profile.`);
      let angle_mrad = mirror.angle_mrad, extra = '';
      if (command.inserted && mirror.role === 'harmonic-rejection') {
        try {
          const angle = harmonicRejectionAngle(mirror.coating, state.energy_eV);
          if (angle !== null) { angle_mrad = angle; extra = ` at ${fmt(angle)} mrad, which reflects $E$ but not $3E$`; }
        } catch { /* outside the tabulated range: keep the angle */ }
      }
      const mirrors = state.profile.mirrors.map(m => m.id === command.id ? { ...m, inserted: command.inserted, angle_mrad } : m);
      return done({ ...state, profile: { ...state.profile, mirrors } }, `${mirror.id} ${mirror.role.replace('-', ' ')} mirror ${command.inserted ? 'inserted' + extra : 'retracted'}.`);
    }
    case 'gas': {
      const total = Object.values(command.gas).reduce((sum, f) => sum + (f ?? 0), 0);
      if (!(total > 0)) throw new Error('A chamber fill needs at least one gas.');
      const gas = Object.fromEntries(Object.entries(command.gas).map(([g, f]) => [g, (f ?? 0) / total]));
      return done(setChamber(state, command.chamber, { gas }), `${command.chamber} chamber refilled.`);
    }
    case 'gain': {
      const gain_V_per_A = 10 ** Math.round(Math.log10(clamp(command.gain_V_per_A, GAIN_RANGE)));
      return done(setChamber(state, command.chamber, { gain_V_per_A }), String.raw`${command.chamber} amplifier gain $10^{${Math.log10(gain_V_per_A)}}\ \mathrm{V/A}$.`);
    }
    case 'autoGain': {
      const now = status(state);
      let next = state;
      for (const [id, readout] of [['I0', now.i0], ['It', now.it], ['Iref', now.iref]] as const) {
        if (!readout || !(readout.current_A > 0)) continue;
        const decade = Math.floor(Math.log10(AUTO_GAIN_TARGET_V / readout.current_A));
        next = setChamber(next, id, { gain_V_per_A: 10 ** clamp(decade, [3, 11]) });
      }
      return done(next, `Amplifier gains set so each chamber reads below ${AUTO_GAIN_TARGET_V} V at this energy.`);
    }
    case 'profile': {
      const preset = profilePreset(command.id);
      if (!preset) throw new Error(`Unknown profile ${command.id}.`);
      let next: TwinState = { ...state, profile: preset.profile };
      const e0 = edgeEnergy(state.sample);
      const [lo, hi] = energyRange(next);
      if (e0 < lo || e0 > hi) next = applyCommand(next, { type: 'samplePreset', id: preset.sample }).state;
      return done(next, `Beamline profile: ${preset.name}.`);
    }
    case 'samplePreset': {
      const preset = samplePreset(command.id);
      if (!preset) throw new Error(`Unknown sample preset ${command.id}.`);
      const resolved = resolveSamplePreset(preset);
      const next: TwinState = { ...state, ...resolved, reference: resolved.reference };
      const energy_eV = clamp(edgeEnergy(resolved.sample) + 20, energyRange(next));
      return done(centredRoi({ ...next, energy_eV }), `Sample: ${preset.name}. ${preset.story}`);
    }
    case 'thickness': {
      const thickness_um = clamp(command.thickness_um, [0.01, 1e5]);
      return done({ ...state, sample: { ...state.sample, thickness_um } }, String.raw`Sample thickness $${+thickness_um.toPrecision(3)}\ \mu\mathrm{m}$.`);
    }
    case 'sample': {
      const sample = { ...state.sample, ...command.patch };
      if (!(sample.absorber in massFractions(sample.formula))) throw new Error(`${sample.absorber} is not in ${sample.formula}.`);
      const e0 = edgeEnergy(sample);
      const moved = sample.formula !== state.sample.formula || sample.absorber !== state.sample.absorber || sample.edge !== state.sample.edge;
      let next: TwinState = { ...state, sample };
      if (sample.absorber !== state.sample.absorber || sample.edge !== state.sample.edge) {
        next = centredRoi({ ...next, reference: referenceFor(sample), energy_eV: clamp(e0 + 20, energyRange(next)) });
      }
      const changed = Object.keys(command.patch).join(', ');
      return done(next, moved ? String.raw`Sample: $${formulaTex(sample.formula)}$, ${sample.absorber} ${sample.edge} edge at $${fmt(e0)}\ \mathrm{eV}$.` : `Sample ${changed} changed.`);
    }
    case 'environment': {
      // Teaching windows: 25 um Kapton on each side of a cryostat, an operando cell or a liquid cell.
      const kapton = { formula: 'C22H10N2O5', density: 1.42, thickness_um: 25 };
      const windows = ['cryostat', 'operando-cell', 'liquid-cell'].includes(command.kind) ? [kapton, kapton] : [];
      const temperature_K = clamp(state.environment.temperature_K, TEMPERATURE_RANGE[command.kind]);
      return done({ ...state, environment: { kind: command.kind, temperature_K, windows } }, `Sample environment: ${command.kind.replace('-', ' ')}.`);
    }
    case 'sdd': {
      const p = command.patch, sdd = state.profile.sdd;
      const next = {
        ...sdd, ...p,
        distance_mm: clamp(p.distance_mm ?? sdd.distance_mm, [5, 5000]),
        peaking_us: clamp(p.peaking_us ?? sdd.peaking_us, [0.05, 32]),
        elements: Math.round(clamp(p.elements ?? sdd.elements, [1, 7])),
      };
      return done({ ...state, profile: { ...state.profile, sdd: next } }, 'Fluorescence detector changed.');
    }
    case 'scan': {
      const plan = { ...command.plan, repeats: Math.round(clamp(command.plan.repeats, [1, 50])) };
      planPoints(plan, edgeEnergy(state.sample));  // throws on an impossible plan
      return done({ ...state, scan: plan }, 'Scan plan changed.');
    }
    case 'source': {
      const current_mA = clamp(command.current_mA, [1, 500]);
      return done({ ...state, profile: { ...state.profile, source: { ...state.profile.source, current_mA } } }, String.raw`Ring current $${Math.round(current_mA)}\ \mathrm{mA}$.`);
    }
    case 'temperature': {
      const temperature_K = clamp(command.temperature_K, TEMPERATURE_RANGE[state.environment.kind]);
      return done({ ...state, environment: { ...state.environment, temperature_K } }, String.raw`Sample temperature $${Math.round(temperature_K)}\ \mathrm{K}$.`);
    }
  }
}

/** Clamps every adjustable number into its range; `issues` lists what had to move. */
export function validateState(state: TwinState): { state: TwinState; issues: string[] } {
  const issues: string[] = [];
  const fix = (label: string, value: number, range: readonly [number, number]) => {
    const fixed = Number.isFinite(value) ? clamp(value, range) : range[0];
    if (fixed !== value) issues.push(`${label} ${value} moved to ${fixed}.`);
    return fixed;
  };
  const { profile, sample, environment } = state;
  const next: TwinState = {
    ...state,
    energy_eV: fix('Energy', state.energy_eV, energyRange(state)),
    profile: {
      ...profile,
      mono: { ...profile.mono, detune: fix('Detune', profile.mono.detune, [0, 1]) },
      chambers: profile.chambers.map(c => ({ ...c, gain_V_per_A: fix(`${c.id} gain`, c.gain_V_per_A, GAIN_RANGE), length_cm: fix(`${c.id} length`, c.length_cm, [1, 100]) })),
    },
    sample: {
      ...sample,
      thickness_um: fix('Thickness', sample.thickness_um, [0.01, 1e5]),
      pinholeFraction: fix('Pinhole fraction', sample.pinholeFraction, [0, 1]),
      thicknessSpread: fix('Thickness spread', sample.thicknessSpread, [0, 0.5]),
      particle_um: fix('Particle size', sample.particle_um, [0, 1000]),
      incidence_deg: fix('Incidence angle', sample.incidence_deg, [1, 90]),
    },
    environment: { ...environment, temperature_K: fix('Temperature', environment.temperature_K, TEMPERATURE_RANGE[environment.kind]) },
  };
  return { state: next, issues };
}

// ---------------------------------------------------------------- session

export const SESSION_FORMAT = 'xaslab-twin-session/1';

export interface TwinSession {
  format: typeof SESSION_FORMAT;
  state: TwinState;
  acquisitions: Acquisition[];
}

export function toSession(state: TwinState, acquisitions: Acquisition[] = []): string {
  return JSON.stringify({ format: SESSION_FORMAT, state, acquisitions } satisfies TwinSession);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/** Reads a session file. Throws with a plain message on anything malformed; clamps values into range. */
export function fromSession(text: string): TwinSession {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('The session file is not valid JSON.'); }
  if (!isObject(raw) || raw.format !== SESSION_FORMAT) throw new Error(`Not a ${SESSION_FORMAT} file.`);
  const state = raw.state;
  if (!isObject(state)) throw new Error('The session has no state.');
  if (!TWIN_MODES.includes(state.mode as TwinMode)) throw new Error(`Unknown mode "${String(state.mode)}".`);
  if (!finite(state.energy_eV) || !finite(state.seed)) throw new Error('The session state needs a numeric energy and seed.');
  const profile = state.profile, sample = state.sample, environment = state.environment;
  if (!isObject(profile) || profile.format !== 'xaslab-twin-profile/1') throw new Error('The session profile is not xaslab-twin-profile/1.');
  if (!isObject(sample) || typeof sample.formula !== 'string' || typeof sample.absorber !== 'string' || !finite(sample.density) || !finite(sample.thickness_um)) {
    throw new Error('The session sample needs a formula, absorber, density and thickness.');
  }
  if (!isObject(environment) || !(environment.kind as string in TEMPERATURE_RANGE)) throw new Error('The session environment is not recognised.');
  if (!isObject(state.scan) || !Array.isArray(state.scan.regions)) throw new Error('The session scan has no regions.');
  const acquisitions = raw.acquisitions ?? [];
  if (!Array.isArray(acquisitions)) throw new Error('Acquisitions must be a list.');
  for (const acquisition of acquisitions) {
    if (!isObject(acquisition) || !isObject(acquisition.columns) || !Array.isArray(acquisition.columns.energy)) {
      throw new Error('Every acquisition needs columns with an energy column.');
    }
    const rows = (acquisition.columns.energy as unknown[]).length;
    for (const [name, column] of Object.entries(acquisition.columns)) {
      if (!Array.isArray(column) || column.length !== rows || column.some(v => typeof v !== 'number' && v !== null)) {
        throw new Error(`Acquisition column ${name} is not a list of ${rows} numbers.`);
      }
    }
  }
  return { format: SESSION_FORMAT, state: validateState(state as unknown as TwinState).state, acquisitions: acquisitions as Acquisition[] };
}
