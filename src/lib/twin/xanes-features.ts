/**
 * Reading a computed near edge: its named features, the rule that places E0 (shared with the generator), and where
 * the calculation is known to miss. Kept apart from xanes.ts, which the twin and the page load first.
 */
import type { XanesFile } from './xanes';

export interface NearEdgeMark { at_eV: number; height: number }

/**
 * Named points of a computed near edge, relative to E0: the main peak (highest point within 30 eV above E0) and the
 * pre-edge peak, the most prominent local maximum between 15 and 1 eV below E0 that stands at least 0.008 above the
 * lowest point within 4 eV on each side, or null where the spectrum has none (a full d shell, for one).
 */
export function nearEdgeMarks(x: XanesFile): { preEdge: NearEdgeMark | null; peak: NearEdgeMark } {
  const at = (i: number) => x.energy.from_eV + i * x.energy.step_eV;
  const span = Math.round(4 / x.energy.step_eV);
  let peak = -1, pre = -1, preProminence = 0.008;
  x.mu.forEach((v, i) => {
    const d = at(i);
    if (d >= 0 && d <= 30 && (peak < 0 || v > x.mu[peak])) peak = i;
    if (d < -15 || d > -1 || i < span || i + span >= x.mu.length || !(v > x.mu[i - 1] && v >= x.mu[i + 1])) return;
    const prominence = v - Math.max(Math.min(...x.mu.slice(i - span, i)), Math.min(...x.mu.slice(i + 1, i + span + 1)));
    if (prominence > preProminence) { pre = i; preProminence = prominence; }
  });
  return { preEdge: pre < 0 ? null : { at_eV: at(pre), height: x.mu[pre] }, peak: { at_eV: at(peak), height: x.mu[peak] } };
}

/** Where the calculation is known to miss a measured feature, by material. */
export const XANES_LIMITS: Record<string, string> = {
  ceo2: 'Measured CeO₂ shows two white line peaks (mixed 4f states); FEFF, a one electron calculation, gives one.',
};

/**
 * E0 of a normalized near edge, the rule of scripts/twin/edge_e0.py (the stored grids start from it): on a 0.05 eV grid
 * smoothed by a Gaussian of 0.5 eV, the local maxima of d mu / dE after which mu stays at or above 0.3 from 2 to 8 eV
 * on; E0 is the first of them that reaches 40 % of the steepest of them. A metal's E0 stays on its first inflection,
 * and an intense pre-edge peak that falls back (K2CrO4's) is skipped, where the steepest rise alone would land on it.
 */
export function edgeE0(energy: readonly number[], mu: readonly number[]): number {
  const STEP = 0.05, n = Math.ceil((energy[energy.length - 1] - energy[0]) / STEP - 1e-9);
  const grid = Array.from({ length: n }, (_, i) => energy[0] + i * STEP);
  let j = 0;
  const y = grid.map(e => {
    while (j < energy.length - 2 && energy[j + 1] < e) j++;
    const f = (e - energy[j]) / (energy[j + 1] - energy[j]);
    return mu[j] + Math.min(1, Math.max(0, f)) * (mu[j + 1] - mu[j]);
  });
  const sigma = 0.5 / STEP, half = Math.floor(4 * sigma);
  const kernel = Array.from({ length: 2 * half + 1 }, (_, i) => Math.exp(-0.5 * ((i - half) / sigma) ** 2));
  const total = kernel.reduce((s, v) => s + v, 0);
  const smooth = y.map((_, i) => kernel.reduce((s, w, m) => s + w * y[Math.min(n - 1, Math.max(0, i + m - half))], 0) / total);
  const slope = smooth.map((_, i) => i === 0 ? (smooth[1] - smooth[0]) / STEP : i === n - 1 ? (smooth[n - 1] - smooth[n - 2]) / STEP : (smooth[i + 1] - smooth[i - 1]) / (2 * STEP));
  const stays = (i: number) => {
    let low = Infinity, any = false;
    for (let m = i; m < n && grid[m] <= grid[i] + 8; m++) if (grid[m] >= grid[i] + 2) { any = true; low = Math.min(low, smooth[m]); }
    return any && low >= 0.3;
  };
  const rises: number[] = [];
  for (let i = 1; i < n - 1; i++) if (slope[i] >= slope[i - 1] && slope[i] > slope[i + 1] && stays(i)) rises.push(i);
  if (!rises.length) return grid[slope.indexOf(Math.max(...slope))];
  const steepest = Math.max(...rises.map(i => slope[i]));
  return grid[rises.find(i => slope[i] >= 0.4 * steepest)!];
}
