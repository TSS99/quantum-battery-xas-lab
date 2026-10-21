/**
 * Training scenarios (plan 3.10): a seeded hidden configuration, a task, the user's own judgement,
 * then the reveal of the true metrics and a score out of 100. Pure and deterministic: the same
 * seed gives the same hidden truth and starting state.
 */
import { edgeEnergy, glitchResidual, simulatePoint, type Random } from './acquire';
import { beamAtSample } from './beam';
import { CHAMBER_FILLS, FILL_TARGETS, absorbedFraction, chamberReadout } from './chambers';
import { TEACHING_CRITICAL_DOSE_Gy, cryoFactor } from './damage';
import { glitchList, glitchThroughput } from './mono';
import { defaultPlan, energyOfK, kOf, planDuration, planPoints, xanesPlan } from './scan';
import { fluorescence, muComponents, sampleElectronYield, transmission } from './sample';
import { applyCommand, DEFAULT_STATE, status } from './twin';
import type { Acquisition, ChamberConfig, ScanPlan, TwinState } from './types';

/** Parts of the controls a scenario can lock so the task stays the task. */
export type LockKey = 'profile' | 'sample' | 'mono';

export interface ScenarioSetup {
  state: TwinState;
  /** Hidden values the metrics compare against; never shown before the reveal. */
  truth: Record<string, number>;
}

export interface ScenarioMetrics {
  /** 0 to 100. */
  score: number;
  success: boolean;
  /** The true values next to what the user reached, plain text with $...$ around LaTeX. */
  details: { label: string; value: string }[];
}

export interface Scenario {
  id: string;
  title: string;
  /** The task card, with $...$ around LaTeX. */
  brief: string;
  /** Cues the user can say they relied on, in the judgement step. */
  cues: string[];
  /** A number the user types as their answer, when the task asks for one. */
  answer?: { label: string; unit: string };
  locked: LockKey[];
  setup(base: TwinState, random: Random): ScenarioSetup;
  metrics(input: { state: TwinState; truth: Record<string, number>; acquisitions: Acquisition[]; answer?: number }): ScenarioMetrics;
  /** What was hidden and why it showed the way it did, with $...$ around LaTeX. */
  reveal(truth: Record<string, number>): string;
}

const clampScore = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
const eV = (value: number, digits = 2) => String.raw`$${value.toFixed(digits)}\ \mathrm{eV}$`;

/** S0: put the monochromator on the Cu K edge. Exercises the framework without hidden faults. */
const FIND_THE_EDGE: Scenario = {
  id: 's0-find-the-edge',
  title: 'Find the edge',
  brief: String.raw`The Cu foil is in the beam, but the monochromator is parked somewhere else. Scan, find the first inflection point of $\mu(E)$ (the first peak of $d\mu/dE$) and set the energy there, within $1\ \mathrm{eV}$.`,
  cues: [String.raw`The jump in $\mu(E)$`, String.raw`The first peak of $d\mu/dE$`, 'The tabulated edge energy', 'The fluorescence count rate'],
  locked: ['profile', 'sample'],
  setup(base, random) {
    const start = applyCommand({ ...DEFAULT_STATE, seed: base.seed }, { type: 'samplePreset', id: 'cu-foil' }).state;
    const e0 = edgeEnergy(start.sample);
    // Park 150 to 300 eV away from the edge, on either side.
    const away = (150 + 150 * random()) * (random() < 0.5 ? -1 : 1);
    return { state: { ...start, energy_eV: Math.round(e0 + away), mode: 'transmission' }, truth: { edge_eV: e0 + start.profile.mono.offset_eV } };
  },
  metrics({ state, truth }) {
    const error = Math.abs(state.energy_eV - truth.edge_eV);
    return {
      score: clampScore(100 * (1 - error / 10)),
      success: error <= 1,
      details: [
        { label: 'Edge (first inflection point)', value: eV(truth.edge_eV, 1) },
        { label: 'Your energy', value: eV(state.energy_eV, 1) },
        { label: 'Off by', value: eV(error) },
      ],
    };
  },
  reveal: truth => String.raw`The Cu K edge of the foil is at ${eV(truth.edge_eV, 1)} (xraydb). The first inflection point of $\mu(E)$, the first maximum of $d\mu/dE$, marks it; full marks within $1\ \mathrm{eV}$, nothing beyond $10\ \mathrm{eV}$.`,
};

/** S1 (plan 3.10): find a hidden mono offset from the Cu reference foil. */
const CALIBRATE: Scenario = {
  id: 's1-calibrate',
  title: 'Calibrate the energy with a Cu foil',
  brief: String.raw`The monochromator reading is off by an unknown amount. Measure the Cu foil, find its first inflection point and compare it with the tabulated Cu K edge, $8979.0\ \mathrm{eV}$. Enter the offset $\Delta E = E_\mathrm{true} - E_\mathrm{reading}$.`,
  cues: [String.raw`The first peak of $d\mu/dE$`, String.raw`The reference channel $\ln(I_t/I_\mathrm{ref})$`, 'The tabulated edge energy', 'A second scan to check'],
  answer: { label: 'Your offset ΔE in eV', unit: 'eV' },
  locked: ['profile', 'sample', 'mono'],
  setup(base, random) {
    // An offset of 1 to 6 eV either way: big enough to matter for oxidation states (plan 3.10, -6 to +6 eV).
    const offset_eV = Math.round((1 + 5 * random()) * (random() < 0.5 ? -1 : 1) * 10) / 10;
    let state = applyCommand({ ...DEFAULT_STATE, seed: base.seed }, { type: 'samplePreset', id: 'cu-foil' }).state;
    state = { ...state, mode: 'calibration', profile: { ...state.profile, mono: { ...state.profile.mono, offset_eV } } };
    return { state, truth: { offset_eV, edge_eV: edgeEnergy(state.sample) } };
  },
  metrics({ truth, answer }) {
    const residual = answer === undefined || !Number.isFinite(answer) ? Infinity : Math.abs(answer - truth.offset_eV);
    return {
      score: Number.isFinite(residual) ? clampScore(100 * (1 - residual / 3)) : 0,
      success: residual <= 0.5,
      details: [
        { label: 'True offset', value: eV(truth.offset_eV, 1) },
        { label: 'Your offset', value: answer === undefined || !Number.isFinite(answer) ? 'none given' : eV(answer, 2) },
        { label: 'Residual', value: Number.isFinite(residual) ? eV(residual) : 'not scored' },
      ],
    };
  },
  reveal: truth => String.raw`The mono reading was ${eV(Math.abs(truth.offset_eV), 1)} ${truth.offset_eV > 0 ? 'below' : 'above'} the true energy, so the foil's inflection point appeared at $${(truth.edge_eV - truth.offset_eV).toFixed(1)}\ \mathrm{eV}$ on the reading scale instead of $${truth.edge_eV.toFixed(1)}\ \mathrm{eV}$. Full marks within $0.5\ \mathrm{eV}$, nothing beyond $3\ \mathrm{eV}$; edge shifts between oxidation states are only a few electronvolts.`,
};

// ---------------------------------------------------------------- measures the scenarios score with

/** Energies that bracket the edge for edge-step and normalization measures: below, and in the EXAFS. */
const BELOW_eV = -50, ABOVE_eV = 150;

/**
 * ln(I0/It) from the chamber currents at a true photon energy, summing every order the
 * monochromator passes (or the fundamental only). Currents, not amplifier outputs, so a clipped
 * gain does not change the measure; the per-order chamber absorption is the same as in a scan.
 */
export function chamberMuX(state: TwinState, energy_eV: number, harmonics = true): number {
  const { profile, sample, environment } = state;
  const i0 = profile.chambers.find(c => c.id === 'I0'), it = profile.chambers.find(c => c.id === 'It');
  const orders = harmonics ? beamAtSample(profile, energy_eV).orders : [{ order: 1, energy_eV, flux: 1e10 }];
  let before = 0, after = 0;
  for (const order of orders) {
    if (!(order.flux > 0)) continue;
    const r0 = i0 ? chamberReadout(i0, order.flux, order.energy_eV) : null;
    const onSample = r0 ? r0.transmittedFlux : order.flux;
    const through = onSample * transmission(sample, environment, order.energy_eV).transmission;
    before += r0 ? r0.current_A : order.flux;
    after += it ? chamberReadout(it, through, order.energy_eV).current_A : through;
  }
  return Math.log(before / after);
}

/**
 * Measured edge step in transmission over the true one: 1 for a perfect measurement, below 1 when
 * pinholes, an uneven sample or harmonics let through photons the absorber never sees. Harmonics,
 * pinholes and uneven thickness shrink the EXAFS amplitude by about the same factor.
 */
export function amplitudeRatio(state: TwinState): number {
  const e0 = edgeEnergy(state.sample);
  const ideal = { ...state, sample: { ...state.sample, pinholeFraction: 0, thicknessSpread: 0 } };
  const measured = chamberMuX(state, e0 + ABOVE_eV) - chamberMuX(state, e0 + BELOW_eV);
  const truth = chamberMuX(ideal, e0 + ABOVE_eV, false) - chamberMuX(ideal, e0 + BELOW_eV, false);
  const ratio = measured / truth;
  return Number.isFinite(ratio) ? ratio : 0;
}

/** Energy of the white-line maximum of the true mu_a(E), within 40 eV above the edge. */
export function whiteLineEnergy(state: TwinState): number {
  const e0 = edgeEnergy(state.sample);
  let best = e0, peak = -Infinity;
  for (let e = e0 - 5; e <= e0 + 40; e += 0.25) {
    const value = muComponents(state.sample, e, { temperature_K: state.environment.temperature_K }).absorber_cm_inv;
    if (value > peak) { peak = value; best = e; }
  }
  return best;
}

/**
 * How much of the white line the current mode loses: 0 when the normalized measurement shows the
 * full white line above the edge step, 1 when it is flat. Each mode is compared with what it would
 * record from a perfect sample: mu_a for fluorescence and electron yield, the total mu x for
 * transmission. Modes that record no spectrum of the sample (Monochromator) count as 1.
 */
export function whiteLineError(state: TwinState, whiteLine_eV: number): number {
  const { sample, environment, profile, mode } = state;
  const e0 = edgeEnergy(sample);
  const transmitted = mode === 'transmission' || mode === 'calibration' || mode === 'time-resolved' || mode === 'damage';
  const measure = (e: number): number => {
    if (mode === 'fluorescence' || mode === 'xrf') return fluorescence(sample, environment, e, { solidAngleFraction: 0.01, efficiency: 1, exit_deg: profile.sdd.exitAngle_deg }).ratio;
    if (mode === 'electron-yield') return sampleElectronYield(sample, e, { temperature_K: environment.temperature_K }).yield;
    if (transmitted) return chamberMuX(state, e);
    return NaN;
  };
  const reference = (e: number) => { const c = muComponents(sample, e, { temperature_K: environment.temperature_K }); return transmitted ? c.total_cm_inv : c.absorber_cm_inv; };
  const normalized = (f: (e: number) => number) => { const lo = f(e0 + BELOW_eV), hi = f(e0 + ABOVE_eV); return (f(whiteLine_eV) - lo) / (hi - lo); };
  const lost = 1 - (normalized(measure) - 1) / (normalized(reference) - 1);
  return Number.isFinite(lost) ? Math.min(1, Math.max(0, lost)) : 1;
}

/**
 * Relative noise floor that counting longer does not lower: beam motion over an uneven sample,
 * amplifier and converter linearity. A teaching value of the order good transmission data reach;
 * each mode carries it on the quantity it measures (ln(I0/It) in transmission, the window counts in
 * fluorescence), which is why a tiny edge step on a large total absorption is hard to measure.
 */
export const NOISE_FLOOR = 1e-4;

/** Edge-step signal to noise of one energy point counted for one second, in the current mode and settings. */
export function edgeSignalToNoise(state: TwinState): { sn: number; dead: number } {
  const e0 = edgeEnergy(state.sample);
  if (state.mode === 'transmission') {
    const s = status({ ...state, energy_eV: e0 + 50 });
    if (!s.i0 || !s.it || s.flux === null || s.sampleFlux === null || s.sampleTransmission === null || s.edgeStep === null || s.muX === null) return { sn: 0, dead: 0 };
    // Photons absorbed in each chamber in a second: counting noise of ln(I0/It) is sqrt(1/N0 + 1/Nt).
    const n0 = s.i0.absorbedFraction * s.flux, nt = s.it.absorbedFraction * s.sampleFlux * s.sampleTransmission;
    return { sn: s.edgeStep / Math.sqrt(1 / n0 + 1 / nt + (NOISE_FLOOR * s.muX) ** 2), dead: 0 };
  }
  if (state.mode === 'fluorescence' || state.mode === 'xrf') {
    const at = (e: number) => simulatePoint({ ...state, realistic: false }, e, () => 0.5, { dwell_s: 1 });
    const above = at(e0 + 50), below = at(e0 + BELOW_eV);
    // Counts in the window above the edge minus below it, against the counting noise of both and the floor.
    const noise = Math.sqrt(above.ifluor + below.ifluor + (NOISE_FLOOR * above.ifluor) ** 2);
    return { sn: noise > 0 ? (above.ifluor - below.ifluor) / noise : 0, dead: above.deadFraction };
  }
  return { sn: 0, dead: 0 };
}

/** Peaking times the controls offer, microseconds. */
export const PEAKING_TIMES_US = [0.25, 0.5, 1, 2, 4, 8] as const;
/** The dilute-sample task allows at most this dead time. */
export const MAX_DEAD_FRACTION = 0.25;

/**
 * The best fluorescence setting for the dilute task: for each peaking time, the closest detector
 * distance that keeps dead time at or under the limit (closer only adds counts until then), found by
 * bisection, then the best of those.
 */
function bestFluorescence(state: TwinState): { sn: number; distance_mm: number; peaking_us: number } {
  let best = { sn: 0, distance_mm: 0, peaking_us: 0 };
  const at = (distance_mm: number, peaking_us: number) => edgeSignalToNoise({ ...state, mode: 'fluorescence', profile: { ...state.profile, sdd: { ...state.profile.sdd, distance_mm, peaking_us } } });
  for (const peaking_us of PEAKING_TIMES_US) {
    // The distance control runs from 5 to 500 mm.
    let near = 5, far = 500;
    if (at(far, peaking_us).dead > MAX_DEAD_FRACTION) continue;
    if (at(near, peaking_us).dead > MAX_DEAD_FRACTION) {
      for (let i = 0; i < 30; i++) { const mid = Math.sqrt(near * far); if (at(mid, peaking_us).dead > MAX_DEAD_FRACTION) near = mid; else far = mid; }
    } else far = near;
    // The controls move in whole millimetres.
    const distance_mm = Math.ceil(far), { sn } = at(distance_mm, peaking_us);
    if (sn > best.sn) best = { sn, distance_mm, peaking_us };
  }
  return best;
}

const pct = (fraction: number, digits = 0) => String.raw`$${(fraction * 100).toFixed(digits)}\,\%$`;
const FAULTS = ['pinholes in the sample', 'an uneven sample that is too thick'] as const;

/** S2 (plan 3.10): a seeded fault shrinks the transmission EXAFS amplitude; find it and fix it. */
const AMPLITUDE: Scenario = {
  id: 's2-amplitude',
  title: 'Why is my EXAFS amplitude small?',
  brief: String.raw`The edge step and the EXAFS in transmission come out smaller than they should: some photons reach $I_t$ without passing through the absorber. Find the cause and fix it with the controls, until the measured edge step is within $2\,\%$ of the true one.`,
  cues: ['The edge step against the expected one', 'Harmonic content at the sample', 'Pinholes and thickness spread', String.raw`The total $\mu x$ above the edge`],
  locked: ['profile', 'sample'],
  setup(base, random) {
    // Harmonics, the third usual cause, stay small here: the twin's ion chambers absorb 3E weakly, so even
    // with every mirror out they shift the measured step by under 1 %. The two faults left are the sample's.
    const fault = random() < 0.5 ? 0 : 1, size = random();
    let state = applyCommand({ ...DEFAULT_STATE, seed: base.seed }, { type: 'samplePreset', id: 'limn2o4-pellet' }).state;
    const s = state.sample;
    state = { ...state, mode: 'transmission', energy_eV: Math.round(edgeEnergy(s) + 50), sample: fault === 0
      ? { ...s, pinholeFraction: Math.round((0.03 + 0.07 * size) * 100) / 100 }
      : { ...s, thickness_um: Math.round(s.thickness_um * (2.5 + size)), thicknessSpread: Math.round((0.25 + 0.1 * size) * 100) / 100 } };
    return { state, truth: { fault, amplitude: amplitudeRatio(state) } };
  },
  metrics({ state, truth }) {
    const amplitude = amplitudeRatio(state), error = Math.abs(1 - amplitude);
    return {
      score: clampScore(100 * (1 - error / 0.15)),
      success: error <= 0.02,
      details: [
        { label: 'Hidden cause', value: FAULTS[truth.fault] },
        { label: 'Measured over true edge step at the start', value: pct(truth.amplitude, 1) },
        { label: 'Measured over true edge step now', value: pct(amplitude, 1) },
      ],
    };
  },
  reveal: truth => [
    String.raw`Pinholes let a fraction $p$ of the beam pass untouched, so $I_t/I_0 = (1-p)\,e^{-\mu x} + p$: where $\mu x$ is large, the leak dominates and caps the measured $\mu x$. The fix is a sample without gaps (pinholes $0\,\%$).`,
    String.raw`An uneven sample is a mix of thick and thin patches; the thin ones pass far more light, so the average $\ln(I_0/I_t)$ falls short of the true $\mu x$, and more so the thicker the sample. The fix is an even sample (low thickness spread) and a total $\mu x$ of about 2 to 3.`,
  ][truth.fault] + String.raw` Harmonics were not the cause: the mirrors reject most of $3E$, and the ion chambers absorb what is left only weakly. Full marks within $2\,\%$ of the true edge step, nothing beyond $15\,\%$.`,
};

/** S3 (plan 3.10): a dilute Fe solution; choose the mode and detector settings for the best signal to noise. */
const DILUTE: Scenario = {
  id: 's3-dilute',
  title: 'Dilute sample: choose the mode and detector',
  brief: String.raw`$2\ \mathrm{mM}$ Fe in water gives an edge step of only a few thousandths in transmission. Choose the mode and the detector settings that give the best edge-step signal to noise for each second of counting, with dead time at most $25\,\%$.`,
  cues: ['The edge step in transmission', 'The fluorescence count rate', 'The dead time', 'The detector distance and peaking time'],
  locked: ['profile', 'sample'],
  setup(base, random) {
    let state = applyCommand({ ...DEFAULT_STATE, seed: base.seed }, { type: 'samplePreset', id: 'fe-2mm-water' }).state;
    // The detector starts somewhere between 20 and 60 mm, close enough to swamp it.
    state = applyCommand({ ...state, mode: 'transmission' }, { type: 'sdd', patch: { distance_mm: 20 + Math.round(40 * random()) } }).state;
    const best = bestFluorescence(state), plain = edgeSignalToNoise(state).sn;
    return { state, truth: { best: Math.max(best.sn, plain), distance_mm: best.distance_mm, peaking_us: best.peaking_us, transmission: plain } };
  },
  metrics({ state, truth }) {
    const { sn, dead } = edgeSignalToNoise(state), allowed = dead <= MAX_DEAD_FRACTION;
    const share = truth.best > 0 ? sn / truth.best : 0;
    return {
      score: allowed ? clampScore(100 * share) : 0,
      success: allowed && share >= 0.8,
      details: [
        { label: 'Your edge-step S/N per second', value: `$${sn.toFixed(0)}$` + (state.mode === 'fluorescence' || state.mode === 'xrf' ? `, dead time ${pct(dead, 1)}` : '') },
        { label: 'Best reachable', value: String.raw`$${truth.best.toFixed(0)}$ in fluorescence at $${truth.distance_mm}\ \mathrm{mm}$ and $${truth.peaking_us}\ \mu\mathrm{s}$ peaking` },
        { label: 'Transmission for comparison', value: `$${truth.transmission.toFixed(0)}$` },
      ],
    };
  },
  reveal: truth => String.raw`In transmission the edge step is a few thousandths of a total $\mu x$ near 1.5, and a noise floor of about $10^{-4}$ of $\ln(I_0/I_t)$, which counting longer does not lower (beam motion over an uneven sample, amplifier linearity; a teaching value here), caps the S/N at $${truth.transmission.toFixed(0)}$. In fluorescence the window around Fe $\mathrm{K}\alpha$ counts only photons the iron emits, so the signal grows with the counts until dead time takes over: moving the detector closer adds counts, a shorter peaking time raises the rate it can process. The best setting keeps dead time at $25\,\%$ and reaches an S/N of $${truth.best.toFixed(0)}$ per second. Scatter from the water, which a real detector also counts, is not modelled here, so real limits come sooner.`,
};

/** S4 (plan 3.10): a thick NiO pellet in fluorescence flattens the white line; get it back. */
const SELF_ABSORPTION: Scenario = {
  id: 's4-self-absorption',
  title: 'Self absorption',
  brief: String.raw`This thick NiO pellet, measured in fluorescence, shows a white line far weaker than NiO really has. Find out why and change the measurement until the white line comes back within $5\,\%$: the sample thickness, the detector's exit angle, or the mode.`,
  cues: ['The white line height after normalization', String.raw`The total $\mu x$ of the pellet`, 'The exit angle', 'Electron yield or transmission instead'],
  locked: ['profile', 'sample'],
  setup(base, random) {
    let state = applyCommand({ ...DEFAULT_STATE, seed: base.seed }, { type: 'samplePreset', id: 'nio-pellet' }).state;
    // A pellet 100 to 300 um thick: every one of them is many absorption lengths.
    state = { ...state, mode: 'fluorescence', sample: { ...state.sample, thickness_um: 100 + 10 * Math.round(20 * random()) } };
    const whiteLine_eV = whiteLineEnergy(state);
    return { state, truth: { whiteLine_eV, start: whiteLineError(state, whiteLine_eV) } };
  },
  metrics({ state, truth }) {
    const error = whiteLineError(state, truth.whiteLine_eV);
    return {
      score: clampScore(100 * (1 - error / 0.5)),
      success: error <= 0.05,
      details: [
        { label: 'White line lost at the start', value: pct(truth.start) },
        { label: 'White line lost now', value: pct(error, 1) },
        { label: 'Mode, thickness, exit angle', value: String.raw`${state.mode.replace('-', ' ')}, $${state.sample.thickness_um}\ \mu\mathrm{m}$, $${state.profile.sdd.exitAngle_deg}^\circ$` },
      ],
    };
  },
  reveal: truth => String.raw`In a thick, concentrated sample the fluorescence comes from about one absorption length, and that depth shrinks where $\mu(E)$ is largest, exactly at the white line, so the peaks flatten (here by ${pct(truth.start)}). Three cures: a sample much thinner than an absorption length, a grazing exit angle that shortens the escape path, or a mode without the effect: electron yield, which samples only the surface, or transmission through a thin sample. A self-absorption correction on the data is the fourth. Full marks within $5\,\%$, nothing beyond $50\,\%$.`,
};

// ---------------------------------------------------------------- S5: plan the beamtime

/** The k the beamtime task asks for, the budget, and the plan shape the optimum uses (the "EXAFS to k = 15" preset). */
export const PLAN_K = 14, PLAN_BUDGET_S = 8 * 3600;
const longPlan = (e0: number): ScanPlan => ({ ...defaultPlan(e0), regions: defaultPlan(e0).regions.map(r => r.space === 'k' ? { ...r, end: 15 } : r) });

/**
 * Counting statistics of one point at a true energy, as chi noise = sqrt(a/t + b)/c for a counting time t:
 * a from the counts, b from the noise floor, c the edge jump, in the current mode. Null where the mode
 * records no spectrum of the sample.
 */
function chiNoiseTerms(state: TwinState, energy_eV: number): { a: number; b: number; c: number } | null {
  const e0 = edgeEnergy(state.sample);
  if (state.mode === 'transmission') {
    const s = status({ ...state, energy_eV }), edge = status({ ...state, energy_eV: e0 + 50 });
    if (!s.i0 || !s.it || s.flux === null || s.sampleFlux === null || s.sampleTransmission === null || s.muX === null || edge.edgeStep === null) return null;
    const n0 = s.i0.absorbedFraction * s.flux, nt = s.it.absorbedFraction * s.sampleFlux * s.sampleTransmission;
    return { a: 1 / n0 + 1 / nt, b: (NOISE_FLOOR * s.muX) ** 2, c: edge.edgeStep };
  }
  if (state.mode === 'fluorescence' || state.mode === 'xrf') {
    const at = (e: number) => simulatePoint({ ...state, realistic: false }, e, () => 0.5, { dwell_s: 1 }).ifluor;
    const rate = at(energy_eV), jump = at(e0 + 50) - at(e0 + BELOW_eV);
    return jump > 0 ? { a: rate, b: (NOISE_FLOOR * rate) ** 2, c: jump } : null;
  }
  return null;
}

/** Noise in k^2 chi(k) at one k after the whole plan (all repeats); Infinity when the plan does not reach that k. */
export function chiNoiseAt(state: TwinState, k: number): number {
  const e0 = edgeEnergy(state.sample), points = planPoints(state.scan, e0);
  let index = -1, gap = Infinity;
  points.energy_eV.forEach((e, i) => { const d = Math.abs(kOf(e, e0) - k); if (d < gap) { gap = d; index = i; } });
  const terms = gap <= 0.1 ? chiNoiseTerms(state, energyOfK(k, e0)) : null;
  if (!terms) return Infinity;
  const t = points.dwell_s[index] * Math.max(1, state.scan.repeats);
  return k * k * Math.sqrt(terms.a / t + terms.b) / terms.c;
}

/** S5 (plan 3.10): reach k = 14 at a target noise inside an 8 hour budget, in as little beamtime as possible. */
const BEAMTIME: Scenario = {
  id: 's5-beamtime',
  title: 'Plan the beamtime',
  brief: String.raw`The dilute Fe solution is set up in fluorescence. Plan the scan so that the noise in $k^2\chi(k)$ at $k = 14\ \mathring{\mathrm{A}}^{-1}$ falls below the target shown at the start, using as little beamtime as you can and never more than $8\ \mathrm{h}$. Choose the plan, the dwell, the repeats and step or continuous scanning.`,
  cues: [String.raw`How far in $k$ the plan reaches`, 'The beamline time of the plan', String.raw`How noise falls as $1/\sqrt{t}$`, 'Step settling against continuous scanning'],
  locked: ['profile', 'sample'],
  setup(base, random) {
    let state = applyCommand({ ...DEFAULT_STATE, seed: base.seed }, { type: 'samplePreset', id: 'fe-2mm-water' }).state;
    state = { ...state, mode: 'fluorescence' };
    const best = bestFluorescence(state);
    state = applyCommand(state, { type: 'sdd', patch: { distance_mm: best.distance_mm, peaking_us: best.peaking_us } }).state;
    const e0 = edgeEnergy(state.sample), shape = planPoints(longPlan(e0), e0);
    const total = shape.dwell_s.reduce((sum, w) => sum + w, 0);
    let w14 = 0, gap = Infinity;
    shape.energy_eV.forEach((e, i) => { const d = Math.abs(kOf(e, e0) - PLAN_K); if (d < gap) { gap = d; w14 = shape.dwell_s[i]; } });
    // The target is what the best plan reaches in 2 to 5 hours of counting, so it fits the budget with room to spare.
    const optimum_s = Math.round((2 + 3 * random()) * 3600), terms = chiNoiseTerms(state, energyOfK(PLAN_K, e0))!;
    const target = PLAN_K ** 2 * Math.sqrt(terms.a / (optimum_s / total * w14) + terms.b) / terms.c;
    return { state: { ...state, scan: { ...defaultPlan(e0), repeats: 1 } }, truth: { target, optimum_s } };
  },
  metrics({ state, truth }) {
    const e0 = edgeEnergy(state.sample), noise = chiNoiseAt(state, PLAN_K), time = planDuration(state.scan, e0).total_s;
    const met = noise <= truth.target * 1.0001, within = time <= PLAN_BUDGET_S;
    const score = !Number.isFinite(noise) || !within ? 0 : met ? clampScore(100 * Math.min(1, truth.optimum_s / time)) : clampScore(40 * truth.target / noise);
    const hours = (t: number) => String.raw`$${(t / 3600).toFixed(2)}\ \mathrm{h}$`;
    return {
      score,
      success: met && within && time <= 1.25 * truth.optimum_s,
      details: [
        { label: String.raw`Target noise in $k^2\chi$ at $k = 14\ \mathring{\mathrm{A}}^{-1}$`, value: `$${truth.target.toFixed(3)}$` },
        { label: 'Your noise there', value: Number.isFinite(noise) ? `$${noise.toFixed(3)}$` : String.raw`the plan stops before $k = 14\ \mathring{\mathrm{A}}^{-1}$` },
        { label: 'Your beamtime', value: hours(time) + (within ? '' : ', over the 8 h budget') },
        { label: 'The fewest hours that reach the target', value: hours(truth.optimum_s) },
      ],
    };
  },
  reveal: truth => String.raw`Counting noise falls as $1/\sqrt{t}$, and $k^2$ weighting multiplies it by $196$ at $k = 14\ \mathring{\mathrm{A}}^{-1}$, so the far end of the scan sets the time. The plan has to reach past $k = 14$ (the $k = 15$ preset), then the dwell times repeats only needs to be just enough: the shortest plan counts ${(truth.optimum_s / 3600).toFixed(2)} hours, with dwell growing as $k$ and no time lost to settling, which continuous scanning avoids. A noise floor of $10^{-4}$ of the signal (a teaching value) means no amount of time goes below about $196 \times 10^{-4}$ of the jump. Full marks at the optimum time; the score falls as the time grows.`,
};

// ---------------------------------------------------------------- S6: ion chamber gases

const S6_SAMPLES = ['cu-foil', 'nio-pellet', 'limn2o4-pellet', 'pt-alumina'] as const;
const S6_FAULTS = ['It filled with He', 'I0 filled with Ar', 'I0 filled with He'] as const;
const gasOf = (id: string) => CHAMBER_FILLS.find(f => f.id === id)!.gas;

/** How far an absorbed fraction is outside a chamber's target band; 0 inside it. */
function bandGap(role: 'I0' | 'It', absorbed: number): number {
  const band = FILL_TARGETS[role];
  return absorbed < band.min ? band.min - absorbed : absorbed > band.max ? absorbed - band.max : 0;
}

/** Fraction of the beam each chamber absorbs at a true energy, and how close the best fill on offer gets to the target. */
export function chamberFill(state: TwinState, energy_eV: number) {
  return (['I0', 'It'] as const).map(role => {
    const c = state.profile.chambers.find(x => x.id === role)!;
    const absorbed = absorbedFraction(c.gas as ChamberConfig['gas'], c.length_cm, energy_eV).absorbed;
    const bestGap = Math.min(...CHAMBER_FILLS.map(f => bandGap(role, absorbedFraction(f.gas, c.length_cm, energy_eV).absorbed)));
    return { role, absorbed, gap: bandGap(role, absorbed), bestGap };
  });
}

/** S6 (plan 3.10): a wrong chamber fill gives a tiny I_t current or an I0 that eats the beam; choose the gases. */
const GASES: Scenario = {
  id: 's6-gases',
  title: 'Ion chamber gases',
  brief: String.raw`One ion chamber has the wrong gas for this edge: either $I_t$ catches almost nothing, or $I_0$ swallows the beam before the sample. Choose the fills so that $I_0$ absorbs $10$ to $20\,\%$ of the beam and $I_t$ absorbs $50$ to $90\,\%$ of what reaches it.`,
  cues: ['The chamber currents', 'The absorbed fraction of each chamber', 'The photon energy', 'Auto gain'],
  locked: ['profile', 'sample'],
  setup(base, random) {
    const preset = S6_SAMPLES[Math.floor(random() * S6_SAMPLES.length)], fault = Math.floor(random() * S6_FAULTS.length);
    let state = applyCommand({ ...DEFAULT_STATE, seed: base.seed }, { type: 'samplePreset', id: preset }).state;
    const e0 = edgeEnergy(state.sample);
    // Start from good fills, then spoil one.
    for (const role of ['I0', 'It'] as const) {
      const c = state.profile.chambers.find(x => x.id === role)!;
      const best = CHAMBER_FILLS.reduce((a, f) => bandGap(role, absorbedFraction(f.gas, c.length_cm, e0 + 50).absorbed) < bandGap(role, absorbedFraction(a.gas, c.length_cm, e0 + 50).absorbed) ? f : a);
      state = applyCommand(state, { type: 'gas', chamber: role, gas: best.gas }).state;
    }
    const [chamber, gas] = ([['It', 'He'], ['I0', 'Ar'], ['I0', 'He']] as const)[fault];
    state = applyCommand(state, { type: 'gas', chamber, gas: gasOf(gas) }).state;
    state = applyCommand({ ...state, mode: 'transmission', energy_eV: Math.round(e0 + 50) }, { type: 'autoGain' }).state;
    return { state, truth: { fault, energy_eV: e0 + 50 } };
  },
  metrics({ state, truth }) {
    const fills = chamberFill(state, truth.energy_eV);
    // Each chamber scores full marks at the best fill on offer and nothing 10 points outside its band.
    const part = (f: (typeof fills)[number]) => Math.max(0, Math.min(1, 1 - (f.gap - f.bestGap) / 0.1));
    return {
      score: clampScore(50 * part(fills[0]) + 50 * part(fills[1])),
      success: fills.every(f => f.gap <= f.bestGap + 0.02),
      details: [
        { label: 'Hidden fault', value: S6_FAULTS[truth.fault].replace('I0', '$I_0$').replace('It', '$I_t$') },
        ...fills.map(f => ({ label: f.role === 'I0' ? String.raw`$I_0$ absorbs (aim $10$ to $20\,\%$)` : String.raw`$I_t$ absorbs (aim $50$ to $90\,\%$)`, value: pct(f.absorbed, 1) })),
      ],
    };
  },
  reveal: truth => String.raw`The fault was: ${S6_FAULTS[truth.fault].replace('I0', '$I_0$').replace('It', '$I_t$')}. A chamber's current is the photons it absorbs, $1 - e^{-\mu L}$, times $E/W$. Too light a gas in $I_t$ absorbs a few percent and gives a tiny current, close to the dark current and amplifier noise. Too heavy a gas in $I_0$ absorbs most of the beam, so the sample gets little and the monitor no longer samples the beam lightly, which makes the ratio $I_0/I_t$ sensitive to how the chamber behaves at high current. The usual rule is $10$ to $20\,\%$ in $I_0$ and most of the rest in $I_t$; heavier gases (N$_2$, then Ar, then Kr) are needed as the energy rises.`,
};

// ---------------------------------------------------------------- S7: beam damage

/** Edge-step signal to noise of the whole plan at the edge point, in the current mode. */
function scanSignalToNoise(state: TwinState): number {
  const xanes = state.scan.regions.find(r => r.space === 'E' && r.start < 0 && r.end > 0) ?? state.scan.regions[0];
  return edgeSignalToNoise(state).sn * Math.sqrt(xanes.dwell_s * Math.max(1, state.scan.repeats));
}

/** Dose each spot receives over the whole plan, and the photoreduced fraction it leaves, for a critical dose before cryo protection. */
export function scanDamage(state: TwinState, criticalDose_Gy: number) {
  const e0 = edgeEnergy(state.sample), rate = status({ ...state, energy_eV: e0 + 50 }).doseRate_Gy_per_s ?? 0;
  const dose_Gy = rate * planDuration(state.scan, e0).total_s / (state.scan.spots ?? 1);
  const critical = criticalDose_Gy * cryoFactor(state.environment.temperature_K);
  return { dose_Gy, criticalDose_Gy: critical, reduced: -Math.expm1(-dose_Gy / critical) };
}

/** S7 (plan 3.10): Cu(II) in water photoreduces above a critical dose; keep it intact without losing signal. */
const DAMAGE: Scenario = {
  id: 's7-damage',
  title: 'Beam damage',
  brief: String.raw`The focused beam reduces this Cu(II) solution during the XANES scan, so the edge drifts to lower energy from one scan to the next. Change how the sample is measured until less than $10\,\%$ of the copper is reduced by the end of the scan, without losing more than $10\,\%$ of the edge signal to noise.`,
  cues: ['The dose rate', 'The beam size', 'Moving to fresh spots', 'Cooling the sample'],
  locked: ['profile', 'sample'],
  setup(base, random) {
    let state = applyCommand({ ...DEFAULT_STATE, seed: base.seed }, { type: 'samplePreset', id: 'cu-solution' }).state;
    const e0 = edgeEnergy(state.sample);
    state = applyCommand({ ...state, mode: 'fluorescence', energy_eV: Math.round(e0 + 50), scan: xanesPlan(e0) }, { type: 'beam', beam_um: [100, 50] }).state;
    // A detector that is not swamped, so the signal to noise means something from the start.
    const best = bestFluorescence(state);
    state = applyCommand(state, { type: 'sdd', patch: { distance_mm: best.distance_mm, peaking_us: best.peaking_us } }).state;
    // The teaching critical dose of a metal ion in water, varied by up to a factor of 1.4 either way.
    const criticalDose_Gy = Math.round(TEACHING_CRITICAL_DOSE_Gy.solution * 2 ** (random() - 0.5));
    return { state, truth: { criticalDose_Gy, sn: scanSignalToNoise(state), reduced: scanDamage(state, criticalDose_Gy).reduced } };
  },
  metrics({ state, truth }) {
    const damage = scanDamage(state, truth.criticalDose_Gy), sn = scanSignalToNoise(state), share = truth.sn > 0 ? sn / truth.sn : 0;
    return {
      score: clampScore(100 * Math.min(1, Math.max(0, 1 - (damage.reduced - 0.1) / 0.4)) * Math.min(1, share / 0.9)),
      success: damage.reduced <= 0.1 && share >= 0.9,
      details: [
        { label: 'Reduced by the end of the scan, at the start', value: pct(truth.reduced, 1) },
        { label: 'Reduced by the end of the scan, now', value: pct(damage.reduced, 1) },
        { label: 'Dose per spot', value: String.raw`$${damage.dose_Gy.toExponential(1).replace(/e\+?(-?\d+)/, '\\times 10^{$1}')}\ \mathrm{Gy}$, critical dose $${damage.criticalDose_Gy.toExponential(1).replace(/e\+?(-?\d+)/, '\\times 10^{$1}')}\ \mathrm{Gy}$` },
        { label: 'Edge signal to noise against the start', value: pct(share) },
      ],
    };
  },
  reveal: truth => String.raw`Metal ions in water are reduced by the electrons and radicals the beam makes in the water, here with a critical dose of $${truth.criticalDose_Gy.toExponential(1).replace(/e\+?(-?\d+)/, '\\times 10^{$1}')}\ \mathrm{Gy}$ (a teaching value): the reduced fraction after a dose $D$ is $1 - e^{-D/D_c}$ and grows with every scan. The dose rate is the absorbed power per mass, so a beam spread over a larger area gives the same signal at a lower dose rate; spreading the scan over fresh spots divides the dose each spot gets; and a frozen sample in a cryostat raises the critical dose. Fewer photons (attenuation, shorter scans) also lowers the dose, but costs signal to noise. Here only all three together are enough. Full marks below $10\,\%$ reduced with at least $90\,\%$ of the starting signal to noise, nothing at $50\,\%$.`,
};

// ---------------------------------------------------------------- S8: glitch hunt

const S8_FAULTS = ['pinholes in the foil', 'an uneven, wrinkled foil'] as const;

/** The largest glitch spike left in ln(I0/It) inside the plan's energy range (teaching model in acquire.ts). */
export function glitchSpike(state: TwinState): number {
  const e0 = edgeEnergy(state.sample), points = planPoints(state.scan, e0);
  const lo = points.energy_eV[0], hi = points.energy_eV[points.energy_eV.length - 1];
  const glitches = glitchList(state.profile.mono.crystal, state.profile.mono.glitchSeed);
  let worst = 0;
  for (const g of glitches) {
    if (g.energy_eV < lo || g.energy_eV > hi) continue;
    const dip = 1 - glitchThroughput(glitches, g.energy_eV);
    worst = Math.max(worst, glitchResidual(dip, transmission(state.sample, state.environment, g.energy_eV)));
  }
  return worst;
}

/** S8 (plan 3.10): glitches that do not normalize out, because the foil is not uniform. */
const GLITCHES: Scenario = {
  id: 's8-glitches',
  title: 'Glitch hunt',
  brief: String.raw`Sharp spikes appear in $\mu(E)$ of the Cu foil at the same energies in every scan. Glitches dip $I_0$ and $I_t$ together and should cancel in $\ln(I_0/I_t)$, so something stops them cancelling. Find it and fix the sample until the largest spike is under a tenth of its starting size.`,
  cues: [String.raw`Dips in $I_0$ in the live channels`, 'The same energies in every scan', 'Pinholes and thickness spread', 'A change of crystal'],
  locked: ['profile', 'sample', 'mono'],
  setup(base, random) {
    const fault = random() < 0.5 ? 0 : 1, size = random();
    let state = applyCommand({ ...DEFAULT_STATE, seed: base.seed }, { type: 'samplePreset', id: 'cu-foil' }).state;
    const s = state.sample;
    state = { ...state, mode: 'transmission', realistic: true, energy_eV: Math.round(edgeEnergy(s) + 50), sample: fault === 0
      ? { ...s, pinholeFraction: Math.round((0.03 + 0.05 * size) * 100) / 100 }
      : { ...s, thicknessSpread: Math.round((0.3 + 0.2 * size) * 100) / 100 } };
    // A glitch map with clear glitches in the scan range, picked deterministically from the seed.
    let glitchSeed = Math.floor(random() * 1e6);
    for (let i = 0; i < 500 && glitchSpike({ ...state, profile: { ...state.profile, mono: { ...state.profile.mono, glitchSeed } } }) < 0.02; i++) glitchSeed++;
    state = { ...state, profile: { ...state.profile, mono: { ...state.profile.mono, glitchSeed } } };
    return { state, truth: { fault, spike: glitchSpike(state) } };
  },
  metrics({ state, truth }) {
    const spike = glitchSpike(state), left = truth.spike > 0 ? spike / truth.spike : 0;
    return {
      score: clampScore(100 * (1 - left)),
      success: left <= 0.1,
      details: [
        { label: 'Hidden cause', value: S8_FAULTS[truth.fault] },
        { label: String.raw`Largest spike in $\mu x$ at the start`, value: `$${truth.spike.toFixed(3)}$` },
        { label: String.raw`Largest spike in $\mu x$ now`, value: `$${spike.toFixed(4)}$` },
      ],
    };
  },
  reveal: truth => String.raw`The cause was ${S8_FAULTS[truth.fault]}. A glitch takes photons from part of the beam. On a uniform foil every part of the beam sees the same $\mu x$, so the dip scales $I_0$ and $I_t$ alike and cancels in the ratio. On ${truth.fault === 0 ? 'a foil with pinholes' : 'an uneven foil'} the affected part sees a different transmission, so the ratio jumps at each glitch; the twin models this as the dip times the gap between the true and the apparent $\mu x$ (a teaching model). Making the sample uniform removes the spikes; changing the crystal would only move them. Full marks when no spike is left.`,
};

export const SCENARIOS: readonly Scenario[] = [FIND_THE_EDGE, CALIBRATE, AMPLITUDE, DILUTE, SELF_ABSORPTION, BEAMTIME, GASES, DAMAGE, GLITCHES];
export const scenarioOf = (id: string) => SCENARIOS.find(s => s.id === id);
