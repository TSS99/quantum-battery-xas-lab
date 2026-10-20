/**
 * Training scenarios (plan 3.10): a seeded hidden configuration, a task, the user's own judgement,
 * then the reveal of the true metrics and a score out of 100. Pure and deterministic: the same
 * seed gives the same hidden truth and starting state.
 */
import { edgeEnergy, type Random } from './acquire';
import { applyCommand, DEFAULT_STATE } from './twin';
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

export const SCENARIOS: readonly Scenario[] = [FIND_THE_EDGE, CALIBRATE];
export const scenarioOf = (id: string) => SCENARIOS.find(s => s.id === id);
