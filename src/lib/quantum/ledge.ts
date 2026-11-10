/**
 * Mn L edges with spin orbit coupling (step 10 of docs/PLAN-quantum.md; scripts/quantum/qxas/spinor.py and
 * ledge_data.py): three oxidation states in octahedral crystal fields, each with and without spin orbit coupling. The
 * exact spectrum is the stored stick spectrum broadened by a Lorentzian; the measured one is rebuilt, as for the
 * oxygen K edge, from shots on the stored Hadamard test signal G(t_j), which the Python side computed with product
 * formula steps of the complex spin orbital Hamiltonian.
 */
import { HARTREE_EV } from './packs';
import { allocate, lorentzian, measure, rebuild, type Signal } from './spectrum';

interface Edge {
  centres_eV: number[]; weights: number[]; signal: number[][]; trotter_error: number; levels_eV: number[];
  strongest_eV: number; l3_eV?: number; l2_eV?: number; l3_share?: number; centroid_eV?: number;
}

export interface LedgeData {
  id: string; title: string; why: string; d_electrons: number; spin_orbitals: number; electrons: number;
  settings: { eta_eV: number; tau_per_Ha: number; jmax: number; trotter_steps: number; kelvin: number; offset_eV: number };
  spin_orbit: Edge; spin_free: Edge;
  cost: { logical_qubits: number; toffoli_whole_spectrum: number; seconds_active_volume_1MHz: number };
  check: { energies_eV: number[]; values: number[] };
}

export async function loadLedge(id: string): Promise<LedgeData> {
  return (await import(`@/data/quantum/ledge/${id}.json`)).default as LedgeData;
}

export interface LedgeResult {
  energies_eV: number[];
  /** Both scaled so that the exact spectrum's peak is 1. */
  exact: number[]; measured: number[];
  peak_eV: { exact: number; measured: number };
  difference: number;
}

/** The L edge on a grid from 15 eV below to 25 eV above the L3 centroid, exact and as the algorithm measures it with
 * `shots` spread over the evolution times. */
export function ledgeSpectra(d: LedgeData, spinOrbit: boolean, shots: number, alpha: number, random: () => number): LedgeResult {
  const edge = spinOrbit ? d.spin_orbit : d.spin_free, { eta_eV, tau_per_Ha: tau, jmax, offset_eV } = d.settings;
  const e = Float64Array.from({ length: 401 }, (_, i) => offset_eV - 15 + i * 0.1);
  const exact = lorentzian(e, edge.centres_eV, edge.weights, eta_eV);
  const g0 = edge.weights.reduce((s, w) => s + w, 0);
  const times = Float64Array.from({ length: jmax }, (_, j) => tau * (j + 1));
  // The signal is a weighted mix of Hadamard tests, so G / G(0) is what the auxiliary qubit's averages measure.
  const unit: Signal = [Float64Array.from(edge.signal[0], v => v / g0), Float64Array.from(edge.signal[1], v => v / g0)];
  const drawn = measure(unit, allocate(shots, times, eta_eV / HARTREE_EV, alpha), random);
  const scaled: Signal = [drawn[0].map(v => v * g0), drawn[1].map(v => v * g0)];
  const w = Float64Array.from(e, x => (x - offset_eV) / HARTREE_EV);
  const measured = rebuild(w, times, scaled, g0, eta_eV / HARTREE_EV, tau).map(v => v / HARTREE_EV);  // per Ha to per eV
  const top = Math.max(...exact);
  const argmax = (a: Float64Array) => e[a.indexOf(Math.max(...a))];
  return {
    energies_eV: Array.from(e), exact: Array.from(exact, y => y / top), measured: Array.from(measured, y => y / top),
    peak_eV: { exact: argmax(exact), measured: argmax(measured) },
    difference: measured.reduce((m, y, i) => Math.max(m, Math.abs(y - exact[i])), 0) / top,
  };
}
