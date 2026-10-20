/**
 * Measured XAS data reduction: detector channels to mu(E), reference-foil calibration, merging
 * repeated scans and pre-edge/post-edge normalization.
 *
 * The algorithms are ports of xraylarch 2026.3.1 (larch.xafs.find_e0, larch.xafs.pre_edge,
 * larch.io.merge_groups and the larch.math helpers they call). They follow the Larch source
 * line by line, including its defaults and small-sample rules, so results can be checked
 * against Larch itself: src/lib/xas-reduction.test.ts compares them with
 * src/data/xas-reduction/larch-reference.json, written by scripts/make-xas-reduction-fixtures.py.
 * Energies are in eV; mu is dimensionless (ln(I0/It)) or arbitrary (If/I0).
 */

/** The xraylarch release these ports follow and the fixtures were generated with. */
export const LARCH_PORT_VERSION = '2026.3.1';

/** Larch's TINY_ENERGY (eV): repeated energies are nudged apart by this much. */
export const TINY_ENERGY = 0.0005;

// Python's builtin min/max keep the first argument unless the second compares smaller/larger,
// so min(1.0, nan) is 1.0. Larch relies on this when its energy-step estimate is NaN.
const pyMin = (a: number, b: number) => (b < a ? b : a);
const pyMax = (a: number, b: number) => (b > a ? b : a);
const arrayMin = (values: ArrayLike<number>) => { let m = Infinity; for (let i = 0; i < values.length; i++) if (values[i] < m) m = values[i]; return m; };
const arrayMax = (values: ArrayLike<number>) => { let m = -Infinity; for (let i = 0; i < values.length; i++) if (values[i] > m) m = values[i]; return m; };

/** Python's round(): exact halves go to the even neighbour, so round(-2.5) is -2. */
export function roundHalfEven(x: number): number {
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x);
}

/** larch.math.index_of: last index whose value is at or below `value`; 0 below the minimum. */
export function indexOf(values: ArrayLike<number>, value: number): number {
  if (value < arrayMin(values)) return 0;
  for (let i = values.length - 1; i >= 0; i--) if (values[i] <= value) return i;
  return 0;
}

/** larch.math.index_nearest: first index of the value nearest to `value`. */
export function indexNearest(values: ArrayLike<number>, value: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - value) < Math.abs(values[best] - value)) best = i;
  return best;
}

/** larch.math.remove_dups: a value repeated within `tiny` of its predecessor is raised by `tiny`. */
export function removeDups(values: number[], tiny = 1e-6): number[] {
  if (values.length <= 1) return values.slice();
  let minStep = Infinity;
  for (let i = 1; i < values.length; i++) minStep = Math.min(minStep, values[i] - values[i - 1]);
  if (minStep > 10 * tiny) return values.slice();
  const add = new Array<number>(values.length).fill(0);
  let previousValue = NaN, previousAdd = 0;
  for (let i = 1; i < values.length; i++) {
    if (!Number.isNaN(values[i - 1])) { previousValue = values[i - 1]; previousAdd = add[i - 1]; }
    if (Number.isNaN(values[i]) || Number.isNaN(previousValue)) continue;
    if (Math.abs(values[i] - previousValue) < tiny) add[i] = previousAdd + tiny;
  }
  return values.map((value, i) => value + add[i]);
}

/** numpy.gradient with unit spacing: central differences inside, one-sided at the ends. */
export function gradient(values: ArrayLike<number>): number[] {
  const n = values.length, out = new Array<number>(n);
  if (n < 2) throw new Error('A gradient needs at least two points.');
  out[0] = values[1] - values[0];
  out[n - 1] = values[n - 1] - values[n - 2];
  for (let i = 1; i < n - 1; i++) out[i] = (values[i + 1] - values[i - 1]) / 2;
  return out;
}

/** Stable argsort; equals numpy.argsort for distinct values. */
function argsort(values: ArrayLike<number>): number[] {
  return Array.from({ length: values.length }, (_, i) => i).sort((a, b) => values[a] - values[b] || a - b);
}

/** Indices i with argsort[i + 1] - argsort[i] == 1, as Larch uses to keep "ordered" points. */
function orderedIndices(values: ArrayLike<number>): number[] {
  const order = argsort(values), kept: number[] = [];
  for (let i = 0; i + 1 < order.length; i++) if (order[i + 1] - order[i] === 1) kept.push(i);
  return kept;
}

/** Least squares by Householder QR; `rows` is the m x n design matrix with m >= n. */
function leastSquares(rows: number[][], b: number[]): number[] {
  const m = rows.length, n = rows[0].length;
  const a = rows.map(row => row.slice()), y = b.slice();
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += a[i][k] ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) throw new Error('The fit range does not determine the polynomial.');
    const alpha = a[k][k] > 0 ? -norm : norm;
    const v = Array.from({ length: m - k }, (_, i) => a[k + i][k]);
    v[0] -= alpha;
    const vv = v.reduce((sum, value) => sum + value * value, 0);
    for (let j = k; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += v[i - k] * a[i][j];
      const f = 2 * s / vv;
      for (let i = k; i < m; i++) a[i][j] -= f * v[i - k];
    }
    let s = 0;
    for (let i = k; i < m; i++) s += v[i - k] * y[i];
    for (let i = k; i < m; i++) y[i] -= 2 * s / vv * v[i - k];
  }
  const x = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    let s = y[k];
    for (let j = k + 1; j < n; j++) s -= a[k][j] * x[j];
    x[k] = s / a[k][k];
  }
  return x;
}

export interface Polynomial { degree: number; evaluate: (x: number) => number }

/**
 * Least-squares polynomial of degree `degree`, as numpy.polynomial.Polynomial.fit (used by
 * larch.math.polyfit). The fit runs in the scaled variable t in [-1, 1] over the data range,
 * which keeps quadratic and cubic fits at 7000 eV well conditioned.
 */
export function polyfit(x: ArrayLike<number>, y: ArrayLike<number>, degree: number): Polynomial {
  const m = x.length;
  if (m !== y.length || m === 0) throw new Error('A polynomial fit needs matching, non-empty arrays.');
  if (m < degree + 1) throw new Error(`A degree-${degree} polynomial needs at least ${degree + 1} points in the fit range; this range has ${m}.`);
  const low = arrayMin(x), high = arrayMax(x);
  const offset = -(high + low) / (high - low || 1), scale = 2 / (high - low || 1);
  const t = (value: number) => offset + scale * value;
  const rows = Array.from({ length: m }, (_, i) => Array.from({ length: degree + 1 }, (_, k) => t(x[i]) ** k));
  const coefficients = leastSquares(rows, Array.from(y));
  return { degree, evaluate: value => { const u = t(value); let s = 0; for (let k = degree; k >= 0; k--) s = s * u + coefficients[k]; return s; } };
}

// ---------------------------------------------------------------- interpolation

/** numpy.interp: linear, holding the end values outside the data range. */
function npInterp(xq: number, x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length;
  if (xq <= x[0]) return y[0];
  if (xq >= x[n - 1]) return y[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= xq) lo = mid; else hi = mid; }
  if (xq === x[lo]) return y[lo];
  return (y[hi] - y[lo]) / (x[hi] - x[lo]) * (xq - x[lo]) + y[lo];
}

/** Interval j with x[j] <= xq < x[j + 1], clamped to the first and last intervals. */
function interval(x: ArrayLike<number>, xq: number): number {
  let lo = 0, hi = x.length - 1;
  if (xq <= x[0]) return 0;
  if (xq >= x[hi]) return hi - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= xq) lo = mid; else hi = mid; }
  return lo;
}

/**
 * Interpolating cubic spline with not-a-knot ends: the spline of scipy's make_interp_spline(k=3)
 * (used by interp1d kind='cubic') and, on five points, of InterpolatedUnivariateSpline.
 * Outside the data the end pieces are extended.
 */
export function notAKnotSpline(x: ArrayLike<number>, y: ArrayLike<number>): (xq: number) => number {
  const n = x.length;
  if (n < 4) throw new Error('A cubic spline needs at least four points.');
  const h = Array.from({ length: n - 1 }, (_, i) => x[i + 1] - x[i]);
  const slope = h.map((step, i) => (y[i + 1] - y[i]) / step);
  // Second derivatives M[1..n-2] from a tridiagonal system; M[0] and M[n-1] follow from the
  // not-a-knot conditions (continuous third derivative at x[1] and x[n-2]).
  const size = n - 2, lower = new Array<number>(size).fill(0), diag = new Array<number>(size), upper = new Array<number>(size).fill(0), rhs = new Array<number>(size);
  for (let r = 0; r < size; r++) {
    const i = r + 1;
    lower[r] = h[i - 1]; diag[r] = 2 * (h[i - 1] + h[i]); upper[r] = h[i]; rhs[r] = 6 * (slope[i] - slope[i - 1]);
  }
  // Substitute M0 = ((h0 + h1) M1 - h0 M2) / h1 into the first row.
  diag[0] += h[0] * (h[0] + h[1]) / h[1];
  upper[0] -= h[0] * h[0] / h[1];
  // Substitute M[n-1] = ((h[n-3] + h[n-2]) M[n-2] - h[n-2] M[n-3]) / h[n-3] into the last row.
  const a = h[n - 3], b = h[n - 2];
  diag[size - 1] += b * (a + b) / a;
  lower[size - 1] -= b * b / a;
  for (let r = 1; r < size; r++) {
    const f = lower[r] / diag[r - 1];
    diag[r] -= f * upper[r - 1];
    rhs[r] -= f * rhs[r - 1];
  }
  const M = new Array<number>(n);
  M[size] = rhs[size - 1] / diag[size - 1];
  for (let r = size - 2; r >= 0; r--) M[r + 1] = (rhs[r] - upper[r] * M[r + 2]) / diag[r];
  M[0] = ((h[0] + h[1]) * M[1] - h[0] * M[2]) / h[1];
  M[n - 1] = ((a + b) * M[n - 2] - b * M[n - 3]) / a;
  return xq => {
    const j = interval(x, xq), step = h[j], left = x[j + 1] - xq, right = xq - x[j];
    return (M[j] * left ** 3 + M[j + 1] * right ** 3) / (6 * step) + (y[j] / step - M[j] * step / 6) * left + (y[j + 1] / step - M[j + 1] * step / 6) * right;
  };
}

/**
 * larch.math.interp: linear or not-a-knot cubic interpolation inside the data; outside it, a line
 * through the two end points (linear) or a spline through the five end points (cubic).
 */
export function interpolate(x: number[], y: number[], xNew: number[], kind: 'linear' | 'cubic' = 'linear'): number[] {
  const n = x.length;
  if (n < (kind === 'cubic' ? 5 : 2)) throw new Error(`Interpolation needs at least ${kind === 'cubic' ? 5 : 2} points.`);
  const inside = kind === 'cubic' ? notAKnotSpline(x, y) : (xq: number) => {
    const j = interval(x, xq);
    return (y[j + 1] - y[j]) / (x[j + 1] - x[j]) * (xq - x[j]) + y[j];
  };
  const extrapolate = (sel: number[]) => kind === 'cubic'
    ? notAKnotSpline(sel.map(i => x[i]), sel.map(i => y[i]))
    : (xq: number) => y[sel[0]] + (y[sel[1]] - y[sel[0]]) / (x[sel[1]] - x[sel[0]]) * (xq - x[sel[0]]);
  const count = kind === 'cubic' ? 5 : 2;
  let below: ((xq: number) => number) | null = null, above: ((xq: number) => number) | null = null;
  return xNew.map(xq => {
    if (xq < x[0]) return (below ??= extrapolate(Array.from({ length: count }, (_, i) => i)))(xq);
    if (xq > x[n - 1]) return (above ??= extrapolate(Array.from({ length: count }, (_, i) => n - count + i)))(xq);
    return inside(xq);
  });
}

/**
 * larch.math.smooth with its defaults (Lorentzian, npad 5): resample onto a uniform grid of step
 * `xstep`, mirror the ends, convolve with a unit-area Lorentzian of half width `sigma`, and
 * interpolate back onto x.
 */
export function smooth(x: number[], y: number[], xstep: number, sigma: number): number[] {
  if (!(xstep >= 1e-12)) throw new Error('Cannot smooth data: the energy step must be positive.');
  const npad = 5;
  const xmin = xstep * Math.trunc((arrayMin(x) - npad * xstep) / xstep);
  const xmax = xstep * Math.trunc((arrayMax(x) + npad * xstep) / xstep);
  const npts = Math.min(1 + Math.trunc(Math.abs(xmax - xmin + xstep * 0.1) / xstep), 50 * x.length);
  const step = (xmax - xmin) / (npts - 1);
  const x0 = Array.from({ length: npts }, (_, i) => i === npts - 1 ? xmax : i * step + xmin);
  const y0 = x0.map(value => npInterp(value, x, y));
  const width = sigma / xstep;
  const window = Array.from({ length: 2 * npts }, (_, i) => 1 / (1 + ((i - npts) / width) ** 2) / (Math.PI * width));
  const total = window.reduce((sum, value) => sum + value, 0);
  // y1 = concat(y0[npts-1..1], y0, y0[npts-1..0]); its "valid" convolution with the window has npts points.
  const y1 = [...y0.slice(1).reverse(), ...y0, ...y0.slice().reverse()];
  const y2 = new Array<number>(npts);
  for (let k = 0; k < npts; k++) {
    let s = 0;
    for (let j = 0; j < 2 * npts; j++) s += window[j] / total * y1[k + 2 * npts - 1 - j];
    y2[k] = s;
  }
  return interpolate(x0, y2, x, 'linear');
}

// ---------------------------------------------------------------- E0

/** larch.xafs.pre_edge.find_energy_step: a robust typical energy step (NaN for short scans, as in Larch). */
export function findEnergyStep(energy: number[], fracIgnore = 0.01, nave = 10): number {
  const nskip = Math.trunc(fracIgnore * energy.length);
  const ordered = orderedIndices(energy).map(i => energy[i]);
  const kept = nskip > 0 ? ordered.slice(nskip, ordered.length - nskip) : [];
  const steps = kept.slice(1).map((value, i) => value - kept[i]).sort((a, b) => a - b).slice(nskip, nskip + nave);
  return steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : NaN;
}

function finde0(energyIn: number[], muIn: number[], estepIn: number | null, useSmooth: boolean) {
  const deduped = removeDups(energyIn, TINY_ENERGY);
  const ordered = orderedIndices(deduped);
  const en = ordered.map(i => deduped[i]), mu = ordered.map(i => muIn[i]);
  const estep = estepIn ?? findEnergyStep(en);
  const nmin = Math.max(3, Math.trunc(en.length * 0.02));
  const gmu = gradient(mu), gen = gradient(en);
  const raw = gmu.map((value, i) => value / gen[i]);
  let dmu = (useSmooth ? smooth(en, raw, estep, estep) : raw).map(value => Number.isFinite(value) ? value : -1);
  const inner = dmu.slice(nmin, dmu.length - nmin);
  const low = arrayMin(inner), range = Math.max(1e-10, arrayMax(inner) - low);
  dmu = dmu.map(value => (value - low) / range);
  const above = (threshold: number) => dmu.flatMap((value, i) => value > threshold ? [i] : []);
  let dhigh = en.length > 20 ? 0.6 : 0.3, high = above(dhigh);
  if (high.length < 3) for (let pass = 0; pass < 2; pass++) { if (high.length > 3) break; dhigh *= 0.5; high = above(dhigh); }
  if (high.length < 3) high = dmu.map((_, i) => i);
  const set = new Set(high);
  let imax = 0, dmax = 0;
  for (const i of high) {
    if (i < nmin || i > en.length - nmin) continue;
    if (dmu[i] > dmax && set.has(i + 1) && set.has(i - 1)) { imax = i; dmax = dmu[i]; }
  }
  return { e0: en[imax], index: imax, estep };
}

const MIN_E0_POINTS = 16;

function requireFinite(energy: number[], mu: number[]) {
  if (energy.length !== mu.length) throw new Error('Energy and absorption arrays must have equal lengths.');
  if (energy.some(value => !Number.isFinite(value)) || mu.some(value => !Number.isFinite(value))) throw new Error('Energy and absorption must be finite numbers.');
}

/**
 * larch.xafs.find_e0: E0 as the energy of the largest dmu/dE, first on the raw derivative, then on
 * a Lorentzian-smoothed derivative within 75 points of the first estimate. Points in the first 2 %
 * and last 2 % of the scan are ignored, and an isolated one-point spike cannot win.
 */
export function findE0(energy: number[], mu: number[]): number {
  requireFinite(energy, mu);
  const n = energy.length;
  if (n < MIN_E0_POINTS) throw new Error(`Finding E0 needs at least ${MIN_E0_POINTS} points.`);
  const first = finde0(energy, mu, null, false);
  let e1 = first.e0, istart = Math.max(3, first.index - 75), istop = Math.min(first.index + 75, n - 3);
  if (first.index < 0.05 * n) {
    e1 = energy.reduce((a, b) => a + b, 0) / n;
    istart = Math.max(3, first.index - 20);
    istop = n - 3;
  }
  const estep = 0.5 * (pyMax(0.01, pyMin(1.0, first.estep)) + pyMax(0.01, pyMin(1.0, e1 / 25000)));
  const second = finde0(energy.slice(istart, istop), mu.slice(istart, istop), estep, true);
  return second.index < 1 ? energy[istart + 2] : second.e0;
}

// ---------------------------------------------------------------- pre-edge normalization

export interface PreEdgeParams {
  /** Edge energy in eV; omitted or outside the scan: found with findE0. */
  e0?: number;
  /** Edge step; omitted: post-edge minus pre-edge curve at E0. */
  step?: number;
  /** Pre-edge fit range relative to E0, eV (negative). */
  pre1?: number;
  pre2?: number;
  /** Post-edge fit range relative to E0, eV. */
  norm1?: number;
  norm2?: number;
  /** Post-edge polynomial degree, 0 to 5. */
  nnorm?: number;
  /** Energy exponent of the pre-edge fit: the line is fitted to mu(E) E^nvict. */
  nvict?: number;
}

export interface PreEdgeResult {
  energy: number[];
  e0: number;
  /** Index of the grid point nearest E0, where the edge step is evaluated. */
  ie0: number;
  edgeStep: number;
  pre1: number; pre2: number; norm1: number; norm2: number;
  nnorm: number; nvict: number;
  /** 1: fitted pre-edge line; 0: constant mean (fewer than three points in the pre-edge range). */
  npre: 0 | 1;
  preEdge: number[];
  postEdge: number[];
  norm: number[];
  flat: number[];
}

const MAX_NNORM = 5;

/**
 * larch.xafs.pre_edge (with larch.xafs.pre_edge.preedge inside it) for npre = 1.
 *
 * Defaults, as in Larch: pre1 = (second energy) - E0 rounded to 5 eV (2 eV when E0 is within the
 * first 21 points), pre2 = pre1 / 2, norm2 = (last energy) - E0 rounded to 5 eV and capped at the
 * data, norm1 = min(25, norm2 / 15 rounded to 5 eV), nnorm = 2, or 1 when norm2 - norm1 < 300 eV,
 * or 0 when < 30 eV. The pre-edge line is fitted to mu E^nvict over points [e0+pre1, e0+pre2)
 * and the polynomial to mu - pre-edge line over [e0+norm1, e0+norm2). edge_step is the polynomial
 * at the grid point nearest E0, norm = (mu - pre-edge line) / edge_step, and flat removes the
 * post-edge polynomial's shape above E0 (Larch's `flat`; its quadratic `flat_alt` is not computed).
 */
export function preEdge(energyIn: number[], muIn: number[], params: PreEdgeParams = {}): PreEdgeResult {
  requireFinite(energyIn, muIn);
  let energy = energyIn.slice(), mu = muIn.slice();
  if (energy.some((value, i) => i > 0 && value < energy[i - 1])) {
    const order = argsort(energy);
    energy = order.map(i => energyIn[i]); mu = order.map(i => muIn[i]);
  }
  energy = removeDups(removeDups(energy, TINY_ENERGY), TINY_ENERGY);
  const n = energy.length;
  if (n < MIN_E0_POINTS) throw new Error(`Normalization needs at least ${MIN_E0_POINTS} points.`);
  const finiteOr = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? value : undefined;
  let e0 = finiteOr(params.e0);
  if (e0 === undefined || e0 < energy[1] || e0 > energy[n - 2]) e0 = findE0(energy, mu);
  const ie0 = indexNearest(energy, e0);
  const emin = energy[0], emax = arrayMax(energy);

  let pre1 = finiteOr(params.pre1) ?? (ie0 > 20 ? 5 * roundHalfEven((energy[1] - e0) / 5) : 2 * roundHalfEven((energy[1] - e0) / 2));
  pre1 = Math.max(pre1, emin - e0);
  let pre2 = finiteOr(params.pre2) ?? 0.5 * pre1;
  if (pre1 > pre2) [pre1, pre2] = [pre2, pre1];
  const relative = energy.map(value => value - e0);
  let nvict = finiteOr(params.nvict) ?? 0, npre: 0 | 1 = 1;
  if (indexOf(relative, pre2) - indexOf(relative, pre1) < 3) { nvict = 0; npre = 0; }

  let norm2 = finiteOr(params.norm2) ?? 5 * roundHalfEven((emax - e0) / 5);
  if (norm2 < 0) norm2 = emax - e0 - norm2;
  norm2 = Math.min(norm2, emax - e0);
  let norm1 = finiteOr(params.norm1) ?? Math.min(25, 5 * roundHalfEven(norm2 / 15));
  if (norm1 > norm2) [norm1, norm2] = [norm2, norm1];
  norm1 = Math.min(norm1, norm2 - 2);
  let nnorm = finiteOr(params.nnorm) ?? (norm2 - norm1 < 30 ? 0 : norm2 - norm1 < 300 ? 1 : 2);
  nnorm = Math.max(Math.min(Math.trunc(nnorm), MAX_NNORM), 0);

  let p1 = indexOf(energy, pre1 + e0), p2 = indexNearest(energy, pre2 + e0);
  let preEdgeLine: number[];
  if (npre === 0) {
    if (p2 === p1) p2 += 1;
    const window = mu.slice(p1, p2);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    preEdgeLine = energy.map(() => mean);
  } else {
    if (p2 - p1 < 2) p2 = Math.min(n, p1 + 2);
    const line = polyfit(energy.slice(p1, p2), mu.slice(p1, p2).map((value, i) => value * energy[p1 + i] ** nvict), 1);
    preEdgeLine = energy.map(value => line.evaluate(value) * value ** -nvict);
  }

  p1 = indexOf(energy, norm1 + e0); p2 = indexNearest(energy, norm2 + e0);
  if (p1 > n - 3) p1 = n - 3;
  if (p2 - p1 < 2) { p1 -= 2; nnorm = 0; } else if (p2 - p1 < 5) nnorm = Math.min(1, nnorm);
  if (p1 < 0) throw new Error('The post-edge range is too close to the start of the scan.');
  const post = polyfit(energy.slice(p1, p2), mu.slice(p1, p2).map((value, i) => value - preEdgeLine[p1 + i]), nnorm);
  const postEdge = energy.map((value, i) => preEdgeLine[i] + post.evaluate(value));
  const given = finiteOr(params.step);
  const edgeStep = Math.max(1e-12, Math.abs(given ?? postEdge[ie0] - preEdgeLine[ie0]));
  const norm = mu.map((value, i) => (value - preEdgeLine[i]) / edgeStep);
  const residue = postEdge.map((value, i) => (value - preEdgeLine[i]) / edgeStep);
  const flat = norm.map((value, i) => i < ie0 ? value : value - residue[i] + residue[ie0]);
  return { energy, e0, ie0, edgeStep, pre1, pre2, norm1, norm2, nnorm, nvict, npre, preEdge: preEdgeLine, postEdge, norm, flat };
}

// ---------------------------------------------------------------- merging

function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b), position = p / 100 * (sorted.length - 1);
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

export interface Scan { energy: number[]; mu: number[] }
export interface MergeResult {
  energy: number[];
  mu: number[];
  /** Standard deviation across scans at each energy, dividing by N (numpy std, as in Larch). */
  std: number[];
  /** Each scan interpolated onto the merged grid. */
  scans: number[][];
  kind: 'linear' | 'cubic';
}

/**
 * larch.io.merge_groups: interpolate every scan onto the first scan's energy grid and average.
 * The grid ends one point below the end of the shortest scan. As in Larch, the low end is not
 * trimmed, so a scan that starts above the first scan is extrapolated there. With cubic
 * interpolation, Larch falls back to linear when the merged curve has a step 50 times larger
 * than any in the first scan.
 */
export function mergeScans(scans: Scan[], kind: 'linear' | 'cubic' = 'cubic'): MergeResult {
  if (scans.length === 0) throw new Error('Choose at least one scan to merge.');
  for (const scan of scans) requireFinite(scan.energy, scan.mu);
  const master = scans[0];
  const steps = master.energy.slice(1).map((value, i) => Math.abs(value - master.energy[i]));
  const dxmin = Math.min(0.01 * percentile(steps, 2), 1e-4 * percentile(steps, 25));
  const xout = removeDups(master.energy, dxmin);
  const xmins = [arrayMin(xout)], xmaxs = [arrayMax(xout)];
  const values = scans.map(scan => {
    const x = removeDups(scan.energy, dxmin);
    xmins.push(arrayMin(x)); xmaxs.push(arrayMax(x));
    return interpolate(x, scan.mu, xout, kind);
  });
  const count = values.length;
  let mean = xout.map((_, i) => { let s = 0; for (const row of values) s += row[i]; return s / count; });
  let std = xout.map((_, i) => { let s = 0; for (const row of values) s += Math.abs(row[i] - mean[i]) ** 2; return Math.sqrt(s / count); });
  let energy = xout, rows = values;
  if (xout.every((value, i) => i === 0 || value > xout[i - 1])) {
    const ixmin = indexOf(xout, Math.min(...xmins)), ixmax = indexOf(xout, Math.min(...xmaxs));
    energy = xout.slice(ixmin, ixmax); mean = mean.slice(ixmin, ixmax); std = std.slice(ixmin, ixmax);
    rows = values.map(row => row.slice(ixmin, ixmax));
    if (kind === 'cubic') {
      const maxStep = (y: number[]) => y.slice(1).reduce((m, value, i) => Math.max(m, value - y[i]), -Infinity);
      if (maxStep(mean) > 50 * maxStep(master.mu)) return mergeScans(scans, 'linear');
    }
  }
  return { energy, mu: mean, std, scans: rows, kind };
}
