/**
 * Core loss EELS in the dipole limit (step 8 of docs/PLAN-quantum.md; scripts/quantum/qxas/eels.py): S(q, ω) for any
 * direction of q, exactly from the stored spectral measures, and as the quantum algorithm measures it from the
 * diagonal and off-diagonal Hadamard tests. S(q, ω) = Σ_ab q_a q_b I_ab(ω); the exact cross terms come from the
 * measure of (m_a + m_b)|I⟩, I_ab = (I_{a+b} − I_aa − I_bb) / 2.
 */
import { HARTREE_EV, storedSignals, type Pack } from './packs';
import { allocate, lorentzian, measure, rebuild, type Signal } from './spectrum';

type Axis = 'x' | 'y' | 'z';
type Pair = 'xy' | 'xz' | 'yz';
const AXES: Axis[] = ['x', 'y', 'z'];
const PAIRS: [Pair, number, number][] = [['xy', 0, 1], ['xz', 0, 2], ['yz', 1, 2]];

export interface EelsData {
  id: string;
  initial_energy_Ha: number;
  dipole_norms: number[];
  measures: Record<Axis | Pair, { centres_Ha: number[]; weights: number[] }>;
  signals: { factorization: 'exact' | 'cdf'; substeps: number; fragments: number; cross: Record<Pair, number[][] | null> };
  check: { q: number[]; energies_eV: number[]; values: number[] };
}

export async function loadEels(id: string): Promise<EelsData> {
  return (await import(`@/data/quantum/eels/${id}.json`)).default as EelsData;
}

/** Sticks of S(q, ω) (energies in Ha above the initial state); some weights are negative, their broadened sum is not. */
export function directionSticks(d: EelsData, q: readonly number[]): { centres: number[]; weights: number[] } {
  const coefficient: Record<string, number> = {};
  AXES.forEach((a, i) => { coefficient[a] = q[i] ** 2 - [0, 1, 2].filter(j => j !== i).reduce((s, j) => s + q[i] * q[j], 0); });
  for (const [p, i, j] of PAIRS) coefficient[p] = q[i] * q[j];
  const centres: number[] = [], weights: number[] = [];
  for (const [key, c] of Object.entries(coefficient)) {
    if (!c) continue;
    const m = d.measures[key as Axis | Pair];
    m.centres_Ha.forEach((x, k) => { centres.push(x); weights.push(c * m.weights[k]); });
  }
  return { centres, weights };
}

/** G_q(t) = Σ_ab q_a q_b ‖m_a I‖ ‖m_b I‖ G_ab(t) from the diagonal tests (the pack's) and the off-diagonal ones. */
export function directionSignal(diagonal: readonly (Signal | null)[], cross: Record<Pair, Signal | null>, norms: readonly number[], q: readonly number[], jmax: number): Signal {
  const re = new Float64Array(jmax), im = new Float64Array(jmax);
  const add = (g: Signal | null, c: number) => { if (g && c) for (let j = 0; j < jmax; j++) { re[j] += c * g[0][j]; im[j] += c * g[1][j]; } };
  diagonal.forEach((g, a) => add(g, q[a] ** 2 * norms[a] ** 2));
  for (const [p, a, b] of PAIRS) add(cross[p], 2 * q[a] * q[b] * norms[a] * norms[b]);
  return [re, im];
}

export const crossSignals = (d: EelsData): Record<Pair, Signal | null> => Object.fromEntries(Object.entries(d.signals.cross)
  .map(([k, g]) => [k, g ? [Float64Array.from(g[0]), Float64Array.from(g[1])] as Signal : null])) as Record<Pair, Signal | null>;

export interface EelsResult {
  energies_eV: number[];
  /** All three normalized to the peak of the orientation average. */
  exact: number[]; measured: number[]; average: number[];
  peak_eV: { exact: number; measured: number; average: number };
  /** Peak of S(q, ω) along q over the peak of the average. */
  strength: number;
  difference: number;
}

/** S(q, ω) along a unit q: exact, as the algorithm measures it with `shots` per correlation function, and the
 * orientation average, on the grid of the XAS page. */
export function eelsSpectra(d: EelsData, pack: Pack, q: readonly number[], shots: number, alpha: number, random: () => number): EelsResult {
  const { tau_per_Ha: tau, eta_Ha: eta, jmax } = pack.settings;
  const edge = pack.reference.edge_Ha;
  const w = Float64Array.from({ length: 481 }, (_, i) => edge - 0.5 + i * 2.5 / 480);
  const sticks = directionSticks(d, q);
  const exact = lorentzian(w, sticks.centres, sticks.weights, eta);
  const average = new Float64Array(w.length);
  for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const s = directionSticks(d, axis), y = lorentzian(w, s.centres, s.weights, eta);
    y.forEach((v, i) => { average[i] += v / 3; });
  }
  const times = Float64Array.from({ length: jmax }, (_, j) => tau * (j + 1));
  const counts = allocate(shots, times, eta, alpha);
  const draw = (g: Signal | null) => g && measure([g[0].slice(0, jmax), g[1].slice(0, jmax)], counts, random);
  const diagonal = storedSignals(pack, d.signals.factorization).map(draw);
  const cross = Object.fromEntries(Object.entries(crossSignals(d)).map(([k, g]) => [k, draw(g)])) as Record<Pair, Signal | null>;
  const g0 = sticks.weights.reduce((sum, v) => sum + v, 0);
  const measured = rebuild(Float64Array.from(w, x => x + d.initial_energy_Ha), times, directionSignal(diagonal, cross, d.dipole_norms, q, jmax), g0, eta, tau);
  const top = Math.max(...average);
  const argmax = (a: Float64Array) => w[a.indexOf(Math.max(...a))] * HARTREE_EV;
  return {
    energies_eV: Array.from(w, x => x * HARTREE_EV), exact: Array.from(exact, y => y / top), measured: Array.from(measured, y => y / top),
    average: Array.from(average, y => y / top), peak_eV: { exact: argmax(exact), measured: argmax(measured), average: argmax(average) },
    strength: Math.max(...exact) / top, difference: measured.reduce((m, y, i) => Math.max(m, Math.abs(y - exact[i])), 0) / Math.max(...exact),
  };
}
