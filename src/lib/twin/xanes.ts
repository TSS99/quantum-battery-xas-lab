/**
 * Computed near edge spectra of the FEFF library: FEFF10 with full multiple scattering and self consistent potentials,
 * on the same atoms as the EXAFS paths (scripts/twin/make-xanes-library.py). Each file holds normalized mu on a fixed
 * grid around E0, the energy of steepest rise, for the material's absorber sites averaged by their weights.
 */
export interface XanesFile {
  schema_version: 1;
  id: string;
  formula: string;
  absorber: string;
  edge: string;
  method: { code: string; commit: string; cards: string[]; broadening: string };
  sites: { id: string; weight: number }[];
  /** FEFF10's own E0 on its absolute energy scale, eV; the stored grid is relative to it. */
  feff_e0_eV: number;
  energy: { from_eV: number; step_eV: number };
  mu: number[];
}

/** Normalized mu at d = E - E0 (eV), linear between grid points and held at the ends. */
export function xanesAt(x: XanesFile, d: number): number {
  const s = (d - x.energy.from_eV) / x.energy.step_eV;
  if (s <= 0) return x.mu[0];
  if (s >= x.mu.length - 1) return x.mu[x.mu.length - 1];
  const i = Math.floor(s), f = s - i;
  return x.mu[i] * (1 - f) + x.mu[i + 1] * f;
}
