/**
 * The story's distance chart: each shell's chi(k) transformed with that shell's own phase taken out, so its bump sits at
 * the true distance instead of 0.3 to 0.5 Å short. chi = A(k) sin(2kR + phi(k)), phi = FEFF's central plus
 * backscattering phase (real_phc + pha); multiplying by exp(-i phi) turns the positive frequency part into exp(2ikR),
 * which a transform with exp(-2ikR') picks out at R' = R. The window is the twin's Hanning window, k^2 weighted.
 */
import { pathCurves } from './shells';
import type { FeffPath } from './types';

export interface Bump { r: number[]; re: number[]; im: number[] }

/** The Hanning window of the twin's transform: sin^2 ramps of width dk centred on kmin and kmax. */
function hanning(k: number, kmin: number, kmax: number, dk: number) {
  if (k <= kmin - dk / 2 || k >= kmax + dk / 2) return 0;
  if (k < kmin + dk / 2) return Math.sin(Math.PI / 2 * (k - kmin + dk / 2) / dk) ** 2;
  if (k > kmax - dk / 2) return Math.cos(Math.PI / 2 * (k - kmax + dk / 2) / dk) ** 2;
  return 1;
}

/** The phase corrected transform of one shell's chi(k) (on an even k grid), from 0 to rmax in steps of dr. */
export function correctedTransform(k: readonly number[], chi: readonly number[], path: FeffPath, window: { kmin: number; kmax: number; dk: number },
  kweight = 2, rmax = 6.5, dr = 0.02): Bump {
  const step = k[1] - k[0], terms: [number, number, number][] = [];
  k.forEach((kk, i) => {
    const w = hanning(kk, window.kmin, window.kmax, window.dk);
    if (w === 0) return;
    const a = w * kk ** kweight * chi[i], phase = pathCurves(path, kk).phase;
    terms.push([kk, a * Math.cos(phase), -a * Math.sin(phase)]);
  });
  const r: number[] = [], re: number[] = [], im: number[] = [], norm = step / Math.sqrt(Math.PI);
  for (let R = 0; R <= rmax + 1e-9; R += dr) {
    let sr = 0, si = 0;
    for (const [kk, ar, ai] of terms) {
      const c = Math.cos(2 * kk * R), s = -Math.sin(2 * kk * R);
      sr += ar * c - ai * s; si += ar * s + ai * c;
    }
    r.push(R); re.push(sr * norm); im.push(si * norm);
  }
  return { r, re, im };
}

/** The magnitude of a sum of bumps on the same grid. */
export function bumpMagnitude(bumps: Bump[]): number[] {
  if (!bumps.length) return [];
  return bumps[0].r.map((_, i) => Math.hypot(bumps.reduce((s, b) => s + b.re[i], 0), bumps.reduce((s, b) => s + b.im[i], 0)));
}
