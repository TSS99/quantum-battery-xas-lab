/**
 * Compton scattering for the 3D hutch's photons.
 *
 * `src/lib/xraydata.ts` ships photoabsorption and the total, so the scattering it implies (total minus photo) is
 * coherent and incoherent together. The incoherent (Compton) share of it comes from the same Elam tables through
 * scripts/twin/make-compton-share.py (src/data/twin/compton-share.json); a compound's share weights each element by its
 * own scattering. A Compton photon leaves along the polarised Klein-Nishina cross section and loses energy with angle,
 * E' = E / (1 + (E / m_e c^2)(1 - cos theta)).
 */
import table from '@/data/twin/compton-share.json';
import { massFractions, muOverRho } from '../xraydata';

/** A direction in the drawing's frame: X along the beam, Y up, Z towards the fluorescence detector. */
export type V3 = [number, number, number];

const ELECTRON_REST_ENERGY_eV = 510998.95;
const LOG_E = table.energies_eV.map(Math.log);
const SHARE = table.share as Record<string, number[]>;

/** Compton share of one element's scattering at an energy, linear in ln E on the table (clamped at its ends). */
export function elementComptonShare(symbol: string, energy_eV: number): number {
  const row = SHARE[symbol];
  if (!row) throw new RangeError(`No Compton share is tabulated for ${symbol}.`);
  const x = Math.log(energy_eV), n = LOG_E.length;
  if (!(x > LOG_E[0])) return row[0];
  if (x >= LOG_E[n - 1]) return row[n - 1];
  let i = 0;
  while (LOG_E[i + 1] < x) i++;
  const t = (x - LOG_E[i]) / (LOG_E[i + 1] - LOG_E[i]);
  return row[i] + (row[i + 1] - row[i]) * t;
}

/** Compton share of a compound's scattering: each element's share weighted by its mass fraction times its scattering. */
export function comptonShare(formula: string, energy_eV: number): number {
  let compton = 0, scatter = 0;
  for (const [symbol, w] of Object.entries(massFractions(formula))) {
    const { photo, total } = muOverRho(symbol, energy_eV), s = w * Math.max(0, total - photo);
    compton += s * elementComptonShare(symbol, energy_eV); scatter += s;
  }
  return scatter > 0 ? compton / scatter : 0;
}

/** Energy after Compton scattering through the angle whose cosine is cosTheta. */
export const comptonShifted = (energy_eV: number, cosTheta: number) => energy_eV / (1 + energy_eV / ELECTRON_REST_ENERGY_eV * (1 - cosTheta));

/**
 * A Compton direction for a beam along X polarised along Z: the Klein-Nishina cross section
 * (E'/E)^2 (E'/E + E/E' - 2 (e.k')^2), drawn by rejection from an isotropic direction (the bracket never exceeds 2).
 * At low energy it becomes the dipole pattern of Thomson scattering; at higher energy it leans forward.
 */
export function kleinNishinaDirection(random: () => number, energy_eV: number): V3 {
  for (;;) {
    const z = 2 * random() - 1, phi = 2 * Math.PI * random(), r = Math.sqrt(1 - z * z);
    const d: V3 = [r * Math.cos(phi), r * Math.sin(phi), z];
    const p = comptonShifted(energy_eV, d[0]) / energy_eV;
    if (2 * random() <= p * p * (p + 1 / p - 2 * d[2] * d[2])) return d;
  }
}
