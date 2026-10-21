/**
 * Training scenarios (plan 3.10): a seeded hidden configuration, a task, the user's own judgement,
 * then the reveal of the true metrics and a score out of 100. Pure and deterministic: the same
 * seed gives the same hidden truth and starting state.
 */
import { edgeEnergy, simulatePoint, type Random } from './acquire';
import { beamAtSample } from './beam';
import { chamberReadout } from './chambers';
import { fluorescence, muComponents, sampleElectronYield, transmission } from './sample';
import { applyCommand, DEFAULT_STATE, status } from './twin';
import type { Acquisition, TwinState } from './types';

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

export const SCENARIOS: readonly Scenario[] = [FIND_THE_EDGE, CALIBRATE, AMPLITUDE, DILUTE, SELF_ABSORPTION];
export const scenarioOf = (id: string) => SCENARIOS.find(s => s.id === id);
