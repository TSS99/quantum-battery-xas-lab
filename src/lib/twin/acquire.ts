/**
 * Acquisition: what every detector records at one mono setting, and a whole scan as XDI columns.
 *
 * Each harmonic order the monochromator passes is followed through the chain at its own energy:
 * the I0 chamber absorbs part of it, the sample and its windows transmit part, then the It
 * chamber, the reference foil and the Iref chamber. The chambers add up the currents of all
 * orders, which is why harmonics shrink the measured edge step. The fluorescence detector
 * counts the absorber's line in its window; every other line the sample emits adds to the
 * input rate that sets the dead time.
 *
 * Educational mode returns expected values. Realistic mode adds, per point: one beam intensity
 * fluctuation shared by every detector in the dwell (so it cancels in ln(I0/It) but not in
 * If/I0), Poisson statistics of the photons each chamber absorbs, amplifier noise, Poisson
 * counting in the fluorescence window, glitches from mono.ts, and a slow drift of the mono
 * offset. Amplifier clipping and dead time act in both modes, because they are not noise.
 *
 * Reference: project physics dossier sections 4, 6, 8 and 9.
 */
import { elementInfo, mu } from '../xraydata';
import { beamAtSample } from './beam';
import { AMPLIFIER_NOISE_V, ELEMENTARY_CHARGE, READOUT_DEFAULTS, chamberReadout } from './chambers';
import { sampleDoseRate } from './damage';
import { dSpacing_A, monoTrueEnergy_eV } from './mono';
import { fluorescence, fluorescenceLine, muComponents, transmission, type FluorescenceLine, type SampleFluorescence } from './sample';
import { planPoints } from './scan';
import { deadTime, deadTimeLoss, efficiency, filterTransmission, productionLines, solidAngle } from './sdd';
import type { Acquisition, ChamberConfig, EnvironmentConfig, PointResult, Provenance, ReferenceFoil, SampleConfig, ScanPlan, TwinState } from './types';

/** A uniform random number generator on [0, 1), such as `seededRandom` from xas.ts. */
export type Random = () => number;

/** Standard normal deviate (Box-Muller). */
export function gaussian(random: Random): number {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Poisson deviate: exact (Knuth) for small means, the normal approximation above 50. */
export function poisson(mean: number, random: Random): number {
  if (!(mean > 0)) return 0;
  if (mean > 50) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian(random)));
  const limit = Math.exp(-mean);
  let k = 0, product = random();
  while (product > limit) { k++; product *= random(); }
  return k;
}

const AMBIENT: EnvironmentConfig = { kind: 'ambient', temperature_K: 295, windows: [] };

/** Edge energy of the sample's absorber, eV: the tabulated (elemental) edge plus the sample's chemical shift. */
export function edgeEnergy(sample: Pick<SampleConfig, 'absorber' | 'edge' | 'edgeShift_eV'>): number {
  const edge = elementInfo(sample.absorber).edges.find(e => e.edge === sample.edge);
  if (!edge) throw new Error(`${sample.absorber} has no tabulated ${sample.edge} edge.`);
  return edge.energy_eV + (sample.edgeShift_eV ?? 0);
}

/** Transmission of the reference foil; it uses the sample's edge model when it contains the absorber. */
export function foilTransmission(foil: ReferenceFoil, sample: SampleConfig, energy_eV: number): number {
  const asSample: SampleConfig = {
    formula: foil.formula, density: foil.density, thickness_um: foil.thickness_um, absorber: sample.absorber, edge: sample.edge,
    form: 'foil', pinholeFraction: 0, thicknessSpread: 0, particle_um: 0, incidence_deg: 90,
  };
  try { return transmission(asSample, AMBIENT, energy_eV).transmission; } catch { /* the foil is another element */ }
  return Math.exp(-mu(foil.formula, foil.density, energy_eV).total * foil.thickness_um * 1e-4);
}

interface ChamberSum { signal_A: number; absorbedRate: number }

export interface ChamberRecord {
  /** V2F counts in the dwell. */
  counts: number;
  voltage_V: number;
  saturated: boolean;
}

/** Amplifier and V2F reading of one chamber over a dwell; with a random source it adds the noise. */
function record(config: ChamberConfig, sum: ChamberSum, dwell_s: number, random: Random | null): ChamberRecord {
  let signal_A = sum.signal_A;
  let voltage_V: number;
  if (random) {
    const photons = sum.absorbedRate * dwell_s;
    if (photons > 0) signal_A *= poisson(photons, random) / photons;
    const dark_V = config.gain_V_per_A * Math.sqrt(ELEMENTARY_CHARGE * Math.abs(config.dark_A) / dwell_s);
    voltage_V = (signal_A + config.dark_A) * config.gain_V_per_A + Math.hypot(dark_V, AMPLIFIER_NOISE_V / Math.sqrt(dwell_s)) * gaussian(random);
  } else {
    voltage_V = (signal_A + config.dark_A) * config.gain_V_per_A;
  }
  const { fullScale_V, v2fFullScale_Hz, v2fOffset_Hz } = READOUT_DEFAULTS;
  const clipped = Math.min(Math.max(voltage_V, 0), fullScale_V);
  return { counts: (v2fFullScale_Hz * clipped / fullScale_V + v2fOffset_Hz) * dwell_s, voltage_V: clipped, saturated: voltage_V > fullScale_V };
}

export interface PointOptions {
  /** Counting time, s. Default 1. */
  dwell_s?: number;
  /** Time since the scan started, for the mono drift. Default 0. */
  elapsed_s?: number;
  /** Dose already delivered to the illuminated spot, Gy. Default 0. */
  priorDose_Gy?: number;
  /**
   * Use these orders (photons per second into the I0 chamber at each energy) instead of the beam
   * model's: for an ideal monochromator, or to set a harmonic content directly.
   */
  orders?: readonly { order: number; energy_eV: number; flux: number }[];
}

export interface SimulatedPoint extends PointResult {
  /** The mono reading this point was taken at; `energy_eV` is the same reading. */
  trueEnergy_eV: number;
  /** Chambers whose amplifier clipped. */
  saturated: ChamberConfig['id'][];
}

const chamberOf = (state: TwinState, id: ChamberConfig['id']) => {
  const config = state.profile.chambers.find(c => c.id === id);
  if (!config) throw new Error(`The profile has no ${id} chamber.`);
  return config;
};

/**
 * The `fluorescenceScale` of sdd.ts `mcaSpectrum`: photons on the sample times the incoming
 * window transmission, the solid-angle fraction and rho d / sin(phi), reduced by the
 * self-absorption factor of the detected line, which every other line shares here (a teaching
 * simplification).
 */
export function emissionScale(sample: SampleConfig, sdd: TwinState['profile']['sdd'], onSample: number,
                              fl: Pick<SampleFluorescence, 'components' | 'muTotalOut_cm_inv' | 'windowTransmissionIn'>): number {
  const sinIn = Math.sin(sample.incidence_deg * Math.PI / 180), sinOut = Math.sin(sdd.exitAngle_deg * Math.PI / 180);
  const thickness_cm = sample.thickness_um * 1e-4;
  const depth = (fl.components.total_cm_inv / sinIn + fl.muTotalOut_cm_inv / sinOut) * thickness_cm;
  const selfAbsorption = depth > 1e-12 ? -Math.expm1(-depth) / depth : 1;
  return onSample * fl.windowTransmissionIn * solidAngle(sdd).fraction * sample.density * thickness_cm / sinIn * selfAbsorption;
}

function detectedLine(sample: SampleConfig): FluorescenceLine | null {
  try { return fluorescenceLine(sample.absorber, sample.edge); } catch { return null; }
}

/**
 * Everything the detectors record at one mono reading. `random` is only used in realistic mode
 * (`state.realistic`); the same generator state gives the same point.
 */
export function simulatePoint(state: TwinState, reading_eV: number, random: Random, options: PointOptions = {}): SimulatedPoint {
  const { profile, sample, environment, realistic } = state;
  const dwell_s = options.dwell_s ?? 1, elapsed_s = options.elapsed_s ?? 0;
  if (!(dwell_s > 0)) throw new RangeError('Dwell time must be greater than zero seconds.');
  const noise = realistic ? random : null;

  // The offset is a property of the instrument, so it applies in both modes; drift is part of the realistic noise.
  const offset_eV = profile.mono.offset_eV + (realistic ? profile.stability.drift_eV_per_h * elapsed_s / 3600 : 0);
  const trueEnergy_eV = monoTrueEnergy_eV(reading_eV, offset_eV);
  const beam = options.orders ? null : beamAtSample(profile, trueEnergy_eV, { includeGlitches: realistic });
  const orders = options.orders ?? beam!.orders;
  const totalFlux = orders.reduce((sum, o) => sum + o.flux, 0);
  const harmonicFraction = beam ? beam.harmonicFraction : totalFlux > 0 ? orders.reduce((sum, o) => sum + (o.order === 1 ? 0 : o.flux), 0) / totalFlux : 0;
  const intensity = noise ? Math.max(0, 1 + profile.stability.i0Noise * gaussian(noise)) : 1;

  const i0Config = chamberOf(state, 'I0'), itConfig = chamberOf(state, 'It'), irefConfig = chamberOf(state, 'Iref');
  const sums = { I0: { signal_A: 0, absorbedRate: 0 }, It: { signal_A: 0, absorbedRate: 0 }, Iref: { signal_A: 0, absorbedRate: 0 } };
  const add = (sum: ChamberSum, config: ChamberConfig, flux: number, energy_eV: number) => {
    const readout = chamberReadout({ ...config, dark_A: 0 }, flux, energy_eV);
    sum.signal_A += readout.signalCurrent_A;
    sum.absorbedRate += readout.absorbedRate;
    return readout.transmittedFlux;
  };

  const sdd = profile.sdd, line = detectedLine(sample);
  const fraction = solidAngle(sdd).fraction;
  const lineEfficiency = line ? efficiency(line.energy_eV).total * filterTransmission(sdd, line.energy_eV) : 0;
  let roiRate = 0, otherRate = 0, dose_Gy_per_s = 0, sampleFlux = 0, muTrue = 0;

  for (const order of orders) {
    if (!(order.flux > 0)) continue;
    const energy_eV = order.energy_eV;
    const onSample = add(sums.I0, i0Config, order.flux * intensity, energy_eV);
    const through = transmission(sample, environment, energy_eV);
    // A glitch takes photons from part of the beam; on an uneven sample that part does not see the average
    // thickness, so the dip no longer cancels in ln(I0/It) (teaching model, see glitchResidual).
    const glitch = order.order === 1 && beam ? glitchResidual(1 - beam.glitchThroughput, through) : 0;
    const afterIt = add(sums.It, itConfig, onSample * through.transmission * Math.exp(-glitch), energy_eV);
    // Harmonics sit far above the edge, where the foil is just its tabulated attenuation.
    const foil = !state.reference ? 1 : order.order === 1 ? foilTransmission(state.reference, sample, energy_eV)
      : Math.exp(-mu(state.reference.formula, state.reference.density, energy_eV).total * state.reference.thickness_um * 1e-4);
    add(sums.Iref, irefConfig, afterIt * foil, energy_eV);
    dose_Gy_per_s += sampleDoseRate(sample, onSample, energy_eV, profile.beam_um).surfaceRate_Gy_per_s;
    if (order.order === 1) { sampleFlux = onSample; muTrue = through.components.total_cm_inv; }

    if (!line) continue;
    const fl = fluorescence(sample, environment, energy_eV, { solidAngleFraction: fraction, efficiency: lineEfficiency, exit_deg: sdd.exitAngle_deg });
    roiRate += onSample * fl.ratio;
    // Harmonics add to the window (they excite the absorber below its edge) but next to nothing to the input rate.
    if (order.order !== 1) continue;
    const scale = emissionScale(sample, sdd, onSample, fl);
    for (const emitted of productionLines(sample.formula, energy_eV)) {
      if (emitted.element === line.element && emitted.edge === line.edge && emitted.line.startsWith(line.group)) continue;
      otherRate += scale * emitted.crossSection_cm2_g * filterTransmission(sdd, emitted.energy_eV) * efficiency(emitted.energy_eV).total;
    }
  }

  const i0 = record(i0Config, sums.I0, dwell_s, noise);
  const it = record(itConfig, sums.It, dwell_s, noise);
  const iref = record(irefConfig, sums.Iref, dwell_s, noise);
  // icr is summed over the elements; each element has its own pulse processor, so dead time acts
  // on one element's share of the rate (the elements see nearly the same rate) and the outputs add up.
  const icr = roiRate + otherRate;
  const loss = deadTimeLoss(icr / sdd.elements, deadTime(sdd.peaking_us));
  const ocr = loss.ocr * sdd.elements;
  const live = icr > 0 ? ocr / icr : 1;
  const expectedFluor = roiRate * live * dwell_s;
  const saturated = ([['I0', i0], ['It', it], ['Iref', iref]] as const).filter(([, r]) => r.saturated).map(([id]) => id);

  return {
    energy_eV: reading_eV,
    trueEnergy_eV,
    flux: sampleFlux,
    harmonicFraction,
    i0: i0.counts,
    it: it.counts,
    iref: iref.counts,
    ifluor: noise ? poisson(expectedFluor, noise) : expectedFluor,
    icr,
    ocr,
    deadFraction: loss.deadFraction,
    muTrue,
    // Spreading the scan over fresh spots divides the dose each spot receives.
    dose_Gy: (options.priorDose_Gy ?? 0) + dose_Gy_per_s * dwell_s / (state.scan.spots ?? 1),
    saturated,
  };
}

/**
 * Extra apparent mu x a glitch adds on an uneven sample (teaching model). The glitch removes the fraction
 * `dip` of the beam from one part of the footprint; on a sample with pinholes or uneven thickness that part
 * transmits differently from the average, so ln(I0/It) shifts by about dip times the gap between the
 * true mu x and the apparent one. A uniform sample has no gap, and the glitch cancels in the ratio.
 */
export function glitchResidual(dip: number, through: { muX: number; apparentMuX: number }): number {
  return dip > 0 ? dip * Math.max(0, through.muX - through.apparentMuX) : 0;
}

/** Column names in XDI dictionary order; icr and ocr are rates per second, the others counts. */
export const XDI_COLUMNS = ['energy', 'i0', 'itrans', 'irefer', 'ifluor', 'icr', 'ocr', 'mutrans', 'murefer', 'mufluor'] as const;

const ln = (a: number, b: number) => a > 0 && b > 0 ? Math.log(a / b) : NaN;

/**
 * A whole scan. Repeats are merged by averaging each detector before the ratios are taken.
 * The same state, plan and generator seed give identical columns.
 */
export function runScan(state: TwinState, plan: ScanPlan, random: Random,
                        onPoint?: (point: SimulatedPoint, index: number, repeat: number) => void): Acquisition {
  const e0_eV = edgeEnergy(state.sample);
  const { energy_eV, dwell_s } = planPoints(plan, e0_eV);
  const n = energy_eV.length, repeats = Math.max(1, Math.floor(plan.repeats));
  const sums = { i0: new Float64Array(n), itrans: new Float64Array(n), irefer: new Float64Array(n), ifluor: new Float64Array(n), icr: new Float64Array(n), ocr: new Float64Array(n) };
  let elapsed_s = 0, dose_Gy = 0, harmonic = 0, saturated = false;
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (let i = 0; i < n; i++) {
      const point = simulatePoint(state, energy_eV[i], random, { dwell_s: dwell_s[i], elapsed_s, priorDose_Gy: dose_Gy });
      sums.i0[i] += point.i0; sums.itrans[i] += point.it; sums.irefer[i] += point.iref; sums.ifluor[i] += point.ifluor;
      sums.icr[i] += point.icr; sums.ocr[i] += point.ocr;
      dose_Gy = point.dose_Gy;
      harmonic += point.harmonicFraction;
      saturated ||= point.saturated.length > 0;
      elapsed_s += dwell_s[i] + (plan.kind === 'step' ? plan.settle_s : 0);
      onPoint?.(point, i, repeat);
    }
  }
  const mean = (values: Float64Array) => Array.from(values, v => v / repeats);
  const i0 = mean(sums.i0), itrans = mean(sums.itrans), irefer = mean(sums.irefer), ifluor = mean(sums.ifluor);
  const columns: Record<string, number[]> = {
    energy: Array.from(energy_eV), i0, itrans, irefer, ifluor, icr: mean(sums.icr), ocr: mean(sums.ocr),
    mutrans: i0.map((v, i) => ln(v, itrans[i])),
    murefer: itrans.map((v, i) => ln(v, irefer[i])),
    mufluor: ifluor.map((v, i) => i0[i] > 0 ? v / i0[i] : NaN),
  };

  const { profile, sample } = state;
  const metadata: Record<string, string> = {
    'Element.symbol': sample.absorber,
    'Element.edge': sample.edge,
    'Mono.name': profile.mono.crystal.replace(/^Si(\d+)$/, 'Si($1)'),
    'Mono.d_spacing': dSpacing_A(profile.mono.crystal).toFixed(6),
    'Facility.name': 'XAS Lab beamline twin (simulated)',
    'Beamline.name': profile.name,
    'Beamline.xray_source': profile.source.kind.replace('-', ' '),
    'Scan.edge_energy': e0_eV.toFixed(2),
    'Scan.mode': plan.kind,
    'XASLab.measurement_mode': state.mode,
    'Sample.name': sample.formula,
    'Sample.thickness': sample.thickness_um + ' um',
    'Sample.temperature': state.environment.temperature_K + ' K',
    'Sample.fine_structure': muComponents(sample, e0_eV + 100, { temperature_K: state.environment.temperature_K }).fineStructureLabel,
    'Detector.I0': chamberGas(chamberOf(state, 'I0')),
    'Detector.I1': chamberGas(chamberOf(state, 'It')),
    'Detector.I2': chamberGas(chamberOf(state, 'Iref')),
  };
  if (state.reference) { metadata['Element.reference'] = state.reference.formula; metadata['Element.ref_edge'] = sample.edge; }
  const provenance: Provenance[] = ['tabulated', 'computed', 'teaching-model'];
  const drift_eV = state.realistic ? profile.stability.drift_eV_per_h * elapsed_s / 3600 : 0;
  return {
    id: `${state.mode}-seed${state.seed}`,
    kind: state.mode,
    columns,
    metadata,
    provenance,
    truth: { offset_eV: profile.mono.offset_eV, drift_eV, harmonicFraction: harmonic / (n * repeats), dose_Gy, saturated: saturated ? 1 : 0 },
  };
}

function chamberGas(config: ChamberConfig): string {
  const gases = Object.entries(config.gas).filter(([, f]) => f && f > 0).map(([g, f]) => `${Math.round((f ?? 0) * 100)}% ${g}`).join(', ');
  return `${config.length_cm} cm ion chamber, ${gases}`;
}
