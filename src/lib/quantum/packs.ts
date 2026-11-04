/**
 * The browser packs of the quantum XAS library (written by scripts/quantum/packs.py): what the Quantum XAS page shows
 * and reruns. Each pack holds the exact reference spectrum, the noiseless Hadamard test signals the Python emulator
 * computed for both factorizations, and, for problems small enough, everything the browser emulator needs to run the
 * circuits itself.
 */
import type { Fragments, LiveProblem } from './emulate';
import { allocate, lorentzian, measure, rebuild, type Signal } from './spectrum';

export const HARTREE_EV = 27.211386245988;
export type Factorization = 'exact' | 'cdf';

export interface PackEntry { id: string; title: string; live: boolean; qubits: number; determinants: number; edge_eV: number; kilobytes: number }

export interface Pack {
  id: string;
  title: string;
  why: string;
  instance_hash: string;
  meta: { active_orbitals: number; active_electrons: number; qubits: number; ci_dimension: number; core_index: number; basis_functions: number; composition: [string, number][][] };
  atoms: [string, number[]][];
  reference: { initial_energy_Ha: number; edge_Ha: number; edge_eV: number; centres_Ha: number[]; weights: number[] };
  settings: { eta_Ha: number; h_norm_Ha: number; tau_per_Ha: number; jmax: number; substeps: number; trotter_step_per_Ha: number };
  initial_energy_Ha: number;
  dipole_norms: number[];
  /** Both factorizations for small problems; only the compressed one for the Mn clusters. */
  signals: Partial<Record<Factorization, { fragments: number; factor_max_error_Ha: number; substeps: number; by_direction: (number[][] | null)[] }>>;
  live?: LiveProblem & { states: number[][][]; fragments: Record<Factorization, Fragments> };
}

export async function loadIndex(): Promise<PackEntry[]> {
  return (await import('@/data/quantum/packs/index.json')).packs as PackEntry[];
}

export async function loadPack(id: string): Promise<Pack> {
  return (await import(`@/data/quantum/packs/${id}.json`)).default as Pack;
}

/** The signal summed over dipole directions, each weighted by ||m_rho|I>||^2, up to j_max. */
export function combined(pack: Pack, perDirection: (Signal | null)[], jmax: number): Signal {
  const re = new Float64Array(jmax), im = new Float64Array(jmax);
  perDirection.forEach((g, k) => {
    if (!g) return;
    const w = pack.dipole_norms[k] ** 2;
    for (let j = 0; j < jmax; j++) { re[j] += w * g[0][j]; im[j] += w * g[1][j]; }
  });
  return [re, im];
}

/** The stored Python signals of one factorization, as typed arrays. */
export function storedSignals(pack: Pack, method: Factorization): (Signal | null)[] {
  return (pack.signals[method]?.by_direction ?? []).map(g => g ? [Float64Array.from(g[0]), Float64Array.from(g[1])] as Signal : null);
}

export interface Result {
  energies_eV: number[];
  exact: number[];
  perfect: number[];
  measured: number[];
  times: number[];
  /** The Hadamard test averages over dipole directions (weighted by ||m_rho|I>||^2), between -1 and 1. */
  signalPerfect: Signal;
  signalMeasured: Signal;
  peak_eV: { exact: number; measured: number };
  difference: number;
  shots: number;
}

/** Shots on each direction's signal, then the spectrum: exact reference, perfect machine and measured, on one grid. */
export function spectra(pack: Pack, perDirection: (Signal | null)[], jmax: number, totalShots: number, alpha: number, random: () => number): Result {
  const { tau_per_Ha: tau, eta_Ha: eta } = pack.settings;
  const times = Float64Array.from({ length: jmax }, (_, j) => tau * (j + 1));
  const shots = allocate(totalShots, times, eta, alpha);
  const measuredDirections = perDirection.map(g => g ? measure([g[0].slice(0, jmax), g[1].slice(0, jmax)], shots, random) : null);
  const perfect = combined(pack, perDirection, jmax), measured = combined(pack, measuredDirections, jmax);
  const edge = pack.reference.edge_Ha;
  const w = Float64Array.from({ length: 481 }, (_, i) => edge - 0.5 + i * 2.5 / 480);  // from 14 eV below the edge to 54 eV above
  const absolute = Float64Array.from(w, x => x + pack.initial_energy_Ha);
  const g0 = pack.dipole_norms.reduce((s, n) => s + n * n, 0);
  const exact = lorentzian(w, pack.reference.centres_Ha, pack.reference.weights, eta);
  const fPerfect = rebuild(absolute, times, perfect, g0, eta, tau), fMeasured = rebuild(absolute, times, measured, g0, eta, tau);
  const top = Math.max(...exact);
  const argmax = (a: Float64Array) => a.indexOf(Math.max(...a));
  const difference = fMeasured.reduce((m, f, i) => Math.max(m, Math.abs(f - exact[i])), 0) / top;
  const usedShots = 2 * shots.reduce((s, x) => s + x, 0) * perDirection.filter(Boolean).length;
  const unit = (s: Signal): Signal => [s[0].map(x => x / g0), s[1].map(x => x / g0)];
  return {
    energies_eV: Array.from(w, x => x * HARTREE_EV), exact: Array.from(exact, y => y / top), perfect: Array.from(fPerfect, y => y / top),
    measured: Array.from(fMeasured, y => y / top), times: Array.from(times), signalPerfect: unit(perfect), signalMeasured: unit(measured),
    peak_eV: { exact: w[argmax(exact)] * HARTREE_EV, measured: w[argmax(fMeasured)] * HARTREE_EV }, difference, shots: usedShots,
  };
}
