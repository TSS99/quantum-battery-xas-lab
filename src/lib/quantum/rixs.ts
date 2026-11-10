/**
 * RIXS from the same problems (step 9 of docs/PLAN-quantum.md; scripts/quantum/qxas/rixs.py and rixs_data.py; Loaiza
 * et al., arXiv 2602.20270). For each incident energy the stored maps hold the inelastic Kramers–Heisenberg intensity
 * Σ_F |⟨F|R|I⟩|² in 0.2 eV bins of energy loss, as phase estimation reads it (each loss spread by a normal distribution
 * of the paper's resolution); the elastic line and the total over all final states are stored apart. The algorithm
 * samples a row: each sample lands in a bin, on the elastic line or outside the window, with the probabilities of the
 * state R|I⟩/|R|, after a block encoding that succeeds with probability P_R (Eq. 31) and K_A rounds of amplitude
 * amplification (Eq. 32).
 */
import { HARTREE_EV } from './packs';
import { binomial } from './spectrum';

type Axis = 'x' | 'y' | 'z';
export type Oriented = `${Axis}${Axis}`;
export type Geometry = Oriented | 'parallel' | 'crossed';
const AXES: Axis[] = ['x', 'y', 'z'];
export const ORIENTED = AXES.flatMap(a => AXES.map(b => `${a}${b}` as Oriented));

export interface RixsData {
  id: string;
  initial_energy_Ha: number;
  settings: { gamma_eV: number; resolution_eV: number; bin_eV: number; levels: number };
  /** Photon energies above the initial state, in eV, the axis of the XAS spectrum. */
  incident_eV: number[];
  loss_eV: number[];
  maps: Record<Geometry, { scale: number; values: number[] }>;
  elastic: Record<Geometry, number[]>;
  totals: Record<Geometry, number[]>;
  dipole_norms: number[];
  /** One-norm of each dipole matrix, the subnormalization of its block encoding. */
  dipole_lambda: number[];
  one_norm_Ha: number;
  green_degree: number;
  polynomial: { row: number; largest_change: number };
  check: { geometry: Geometry; row: number; bin: number; value: number };
}

/** The cost model's RIXS entry for a problem (estimates.json, qxas/resources.py rixs_cost). */
export interface RixsCost { green_degree: number; phase_bits: number; toffoli_walk: number; logical_qubits: number; amplification_rounds: number; toffoli_per_sample: number }

export async function loadRixs(id: string): Promise<RixsData> {
  return (await import(`@/data/quantum/rixs/${id}.json`)).default as RixsData;
}

/** The inelastic intensity of row `i` in each loss bin, in the units of |R|² (atomic units). */
export function rixsRow(d: RixsData, geometry: Geometry, i: number): Float64Array {
  const map = d.maps[geometry], n = d.loss_eV.length;
  return Float64Array.from({ length: n }, (_, k) => map.values[i * n + k] * map.scale / d.settings.levels);
}

/** The whole map, rows of incident energy, scaled so that its strongest bin is 1. */
export function rixsMap(d: RixsData, geometry: Geometry): Float64Array {
  return Float64Array.from(d.maps[geometry].values, v => v / d.settings.levels);
}

/** Probability that the block encoding prepares R|I⟩ (Eq. 31): (Γ |R| / (λ_D |m_a I|))². A powder averages the nine
 * oriented pairs it is sampled from. */
export function successProbability(d: RixsData, geometry: Geometry, i: number): number {
  const gamma = d.settings.gamma_eV / HARTREE_EV;
  const one = (g: Oriented) => {
    const a = AXES.indexOf(g[0] as Axis), b = AXES.indexOf(g[1] as Axis);
    return (gamma / d.dipole_lambda[b]) ** 2 * d.totals[g][i] / d.dipole_norms[a] ** 2;
  };
  if (geometry !== 'parallel' && geometry !== 'crossed') return one(geometry);
  const pairs = ORIENTED.filter(g => d.dipole_norms[AXES.indexOf(g[0] as Axis)] > 0);
  return pairs.reduce((s, g) => s + one(g), 0) / pairs.length;
}

/** Rounds of amplitude amplification for a success probability (Eq. 32): ⌊π / (4 arcsin √P)⌋. */
export const amplificationRounds = (p: number) => Math.floor(Math.PI / (4 * Math.asin(Math.sqrt(p))));

/** Toffolis of one sample (Eq. 38) with K_A rounds: [(2 K_A + 1) 2 K_G + 2^n_ω] T_W. */
export const toffoliPerSample = (c: RixsCost, rounds: number) => ((2 * rounds + 1) * 2 * c.green_degree + 2 ** c.phase_bits) * c.toffoli_walk;

export interface RixsResult {
  loss_eV: number[];
  /** The fraction of samples in each bin, exact and drawn, both scaled so that the exact strongest bin is 1. */
  exact: number[]; measured: number[];
  peak_eV: { exact: number; measured: number };
  difference: number;
  /** Shares of the samples on the elastic line and outside the window. */
  elastic: number; outside: number;
}

/** One row as the algorithm samples it, with `shots` samples. */
export function rixsSpectrum(d: RixsData, geometry: Geometry, i: number, shots: number, random: () => number): RixsResult {
  const row = rixsRow(d, geometry, i), total = d.totals[geometry][i];
  const p = Array.from(row, v => v / total);
  const elastic = d.elastic[geometry][i] / total;
  const outside = Math.max(0, 1 - elastic - p.reduce((s, v) => s + v, 0));
  // A multinomial draw over the bins, the elastic line and the rest, as a chain of binomials.
  const counts = new Float64Array(p.length);
  let left = shots, mass = 1;
  for (const [k, q] of [...p.map((v, j) => [j, v] as const), [-1, elastic] as const]) {
    if (left <= 0 || mass <= 0) break;
    const n = binomial(left, Math.min(1, q / mass), random);
    if (k >= 0) counts[k] = n;
    left -= n; mass -= q;
  }
  const top = Math.max(...p);
  const exact = p.map(v => v / top), measured = Array.from(counts, n => n / shots / top);
  const argmax = (a: readonly number[]) => d.loss_eV[a.indexOf(Math.max(...a))];
  return {
    loss_eV: d.loss_eV, exact, measured, peak_eV: { exact: argmax(exact), measured: argmax(measured) },
    difference: measured.reduce((m, y, k) => Math.max(m, Math.abs(y - exact[k])), 0), elastic, outside,
  };
}
