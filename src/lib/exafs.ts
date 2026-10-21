/**
 * Browser-side EXAFS reduction using xraylarch 2026.3.1 conventions.
 *
 * AUTOBK follows larch/xafs/autobk.py: cubic B-spline background,
 * low-R least-squares objective, and the current high-k endpoint clamp.
 * xftf follows larch/xafs/xafsft.py, including NumPy's forward-FFT sign
 * and the kstep / sqrt(pi) normalization used by that release.
 */

export const EXAFS_KSTEP = 0.05;
export const EXAFS_NFFT = 2048;
export const ETOK = 0.26246842396479836;

export type ExafsWindow = 'hanning' | 'kaiser' | 'parzen' | 'welch' | 'sine' | 'gaussian';

export interface PreEdgeResult {
  e0: number;
  edgeStep: number;
  preEdge: number[];
  postEdge: number[];
}

export interface AutobkOptions {
  e0: number;
  edgeStep: number;
  rbkg?: number;
  kmin?: number;
  kmax?: number;
  kweight?: number;
  dk?: number;
  window?: ExafsWindow;
  nfft?: number;
  kstep?: number;
  nclamp?: number;
  clampLow?: number;
  clampHigh?: number;
}

export interface AutobkResult {
  e0: number;
  edgeStep: number;
  rbkg: number;
  k: number[];
  chi: number[];
  bkg: number[];
  chie: number[];
  nknots: number;
  kmin: number;
  kmax: number;
  iterations: number;
}

export interface XftfOptions {
  kmin?: number;
  kmax?: number;
  kweight?: number;
  dk?: number;
  window?: ExafsWindow;
  rmax?: number;
  nfft?: number;
  kstep?: number;
}

export interface XftfResult {
  r: number[];
  kwin: number[];
  weightedChi: number[];
  magnitude: number[];
  real: number[];
  imaginary: number[];
  deltaR: number;
}

export interface ExafsProcessingOptions {
  rbkg: number;
  kmin: number;
  kmax: number;
  kweight: number;
  dk: number;
  window: ExafsWindow;
}

export interface ExafsProcessingResult {
  preEdge: PreEdgeResult;
  autobk: AutobkResult;
  xftf: XftfResult;
  parameters: ExafsProcessingOptions & { kstep: number; nfft: number };
}

const assertFiniteSeries = (x: number[], y: number[], xName: string, yName: string) => {
  if (x.length !== y.length || x.length < 5) throw new Error(`${xName} and ${yName} need the same length and at least five points.`);
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) throw new Error(`${xName} and ${yName} must contain finite values.`);
    if (i && x[i] <= x[i - 1]) throw new Error(`${xName} must increase strictly.`);
  }
};

const indexAtOrBelow = (array: number[], value: number) => {
  if (value < array[0]) return 0;
  let low = 0, high = array.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (array[middle] <= value) low = middle; else high = middle - 1;
  }
  return low;
};

const indexNearest = (array: number[], value: number) => {
  const low = indexAtOrBelow(array, value);
  if (low >= array.length - 1) return array.length - 1;
  return Math.abs(array[low] - value) <= Math.abs(array[low + 1] - value) ? low : low + 1;
};

const solveLinear = (matrix: number[][], vector: number[]) => {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-14) throw new Error('The EXAFS spline system is singular. Check the energy spacing and k range.');
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const scale = a[column][column];
    for (let j = column; j <= n; j++) a[column][j] /= scale;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = a[row][column];
      if (factor === 0) continue;
      for (let j = column; j <= n; j++) a[row][j] -= factor * a[column][j];
    }
  }
  return a.map(row => row[n]);
};

function polynomialFit(x: number[], y: number[], degree: number) {
  const normal = Array.from({ length: degree + 1 }, () => Array(degree + 1).fill(0));
  const rhs = Array(degree + 1).fill(0);
  for (let row = 0; row <= degree; row++) {
    for (let column = 0; column <= degree; column++) normal[row][column] = x.reduce((sum, value) => sum + value ** (row + column), 0);
    rhs[row] = x.reduce((sum, value, i) => sum + y[i] * value ** row, 0);
  }
  return solveLinear(normal, rhs);
}

/** A guarded maximum-slope E0 estimate for spectra without an explicit reference. */
export function estimateExafsE0(energy: number[], mu: number[]) {
  assertFiniteSeries(energy, mu, 'Energy', 'Absorption');
  const first = Math.max(1, Math.floor(energy.length * 0.05));
  const last = Math.min(energy.length - 2, Math.ceil(energy.length * 0.95));
  let best = first, bestSlope = -Infinity;
  for (let i = first; i <= last; i++) {
    const slope = (mu[i + 1] - mu[i - 1]) / (energy[i + 1] - energy[i - 1]);
    if (slope > bestSlope) { bestSlope = slope; best = i; }
  }
  return energy[best];
}

/**
 * Larch-style pre/post-edge fits used to supply E0 and the constant edge step
 * to AUTOBK. The E0 detector is intentionally reported as an estimate because
 * no reference-foil calibration can be inferred from an imported array.
 */
export function preEdge(energy: number[], mu: number[], suppliedE0?: number): PreEdgeResult {
  assertFiniteSeries(energy, mu, 'Energy', 'Absorption');
  const e0 = suppliedE0 ?? estimateExafsE0(energy, mu);
  if (e0 <= energy[1] || e0 >= energy.at(-2)!) throw new Error('The estimated edge is too close to an endpoint for EXAFS reduction.');
  const ie0 = indexNearest(energy, e0);
  let pre1 = ie0 > 20 ? 5 * Math.round((energy[1] - e0) / 5) : 2 * Math.round((energy[1] - e0) / 2);
  pre1 = Math.max(pre1, energy[0] - e0);
  let pre2 = 0.5 * pre1;
  if (pre1 > pre2) [pre1, pre2] = [pre2, pre1];
  let p1 = indexAtOrBelow(energy, e0 + pre1);
  let p2 = indexNearest(energy, e0 + pre2);
  const preX = energy.slice(p1, Math.max(p1 + 2, p2)).map(value => value - e0);
  const preY = mu.slice(p1, Math.max(p1 + 2, p2));
  const preCoefficients = preX.length >= 3 ? polynomialFit(preX, preY, 1) : [preY.reduce((a, b) => a + b, 0) / preY.length, 0];
  const preCurve = energy.map(value => preCoefficients[0] + preCoefficients[1] * (value - e0));

  let norm2 = Math.min(5 * Math.round((energy.at(-1)! - e0) / 5), energy.at(-1)! - e0);
  let norm1 = Math.min(25, 5 * Math.round(norm2 / 15));
  if (norm1 > norm2) [norm1, norm2] = [norm2, norm1];
  norm1 = Math.min(norm1, norm2 - 2);
  let degree = norm2 - norm1 < 30 ? 0 : norm2 - norm1 < 300 ? 1 : 2;
  p1 = indexAtOrBelow(energy, e0 + norm1);
  p2 = indexNearest(energy, e0 + norm2);
  if (p1 > energy.length - 3) p1 = energy.length - 3;
  if (p2 - p1 < 2) { p1 -= 2; degree = 0; }
  else if (p2 - p1 < 5) degree = Math.min(1, degree);
  const postX = energy.slice(p1, p2).map(value => value - e0);
  const postY = mu.slice(p1, p2).map((value, i) => value - preCurve[p1 + i]);
  const postCoefficients = polynomialFit(postX, postY, degree);
  const postCurve = energy.map((value, i) => preCurve[i] + postCoefficients.reduce((sum, coefficient, power) => sum + coefficient * (value - e0) ** power, 0));
  const edgeStep = Math.max(1e-12, Math.abs(postCurve[ie0] - preCurve[ie0]));
  return { e0, edgeStep, preEdge: preCurve, postEdge: postCurve };
}

function findSpan(knots: number[], basisCount: number, degree: number, value: number) {
  if (value >= knots[basisCount]) return basisCount - 1;
  if (value <= knots[degree]) return degree;
  let low = degree, high = basisCount, middle = Math.floor((low + high) / 2);
  while (value < knots[middle] || value >= knots[middle + 1]) {
    if (value < knots[middle]) high = middle; else low = middle;
    middle = Math.floor((low + high) / 2);
  }
  return middle;
}

function nonzeroBasis(knots: number[], basisCount: number, degree: number, value: number) {
  const span = findSpan(knots, basisCount, degree, value);
  const basis = Array(degree + 1).fill(0), left = Array(degree + 1).fill(0), right = Array(degree + 1).fill(0);
  basis[0] = 1;
  for (let j = 1; j <= degree; j++) {
    left[j] = value - knots[span + 1 - j];
    right[j] = knots[span + j] - value;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denominator = right[r + 1] + left[j - r];
      const term = denominator === 0 ? 0 : basis[r] / denominator;
      basis[r] = saved + right[r + 1] * term;
      saved = left[j - r] * term;
    }
    basis[j] = saved;
  }
  return { first: span - degree, values: basis };
}

function interpolateSplineCoefficients(x: number[], y: number[]) {
  const degree = 3, n = x.length;
  if (n < 5) throw new Error('AUTOBK needs at least five independent spline knots.');
  const knots = [x[0], x[0], x[0], x[0], ...x.slice(2, -2), x.at(-1)!, x.at(-1)!, x.at(-1)!, x.at(-1)!];
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (let row = 0; row < n; row++) {
    const basis = nonzeroBasis(knots, n, degree, x[row]);
    basis.values.forEach((value, offset) => { const column = basis.first + offset; if (column >= 0 && column < n) matrix[row][column] = value; });
  }
  return { knots, coefficients: solveLinear(matrix, y), degree };
}

function evaluateSpline(knots: number[], coefficients: number[], degree: number, value: number) {
  const basis = nonzeroBasis(knots, coefficients.length, degree, value);
  return basis.values.reduce((sum, weight, offset) => {
    const index = basis.first + offset;
    return sum + (index >= 0 && index < coefficients.length ? coefficients[index] * weight : 0);
  }, 0);
}

function notAKnotSecondDerivatives(x: number[], y: number[]) {
  const n = x.length;
  if (n < 4) return Array(n).fill(0);
  const h = Array.from({ length: n - 1 }, (_, i) => x[i + 1] - x[i]);
  const size = n - 2, lower = Array(size).fill(0), diagonal = Array(size).fill(0), upper = Array(size).fill(0), rhs = Array(size).fill(0);
  const h0 = h[0], h1 = h[1];
  diagonal[0] = (h0 + h1) * (h0 + 2 * h1) / h1;
  upper[0] = (h1 * h1 - h0 * h0) / h1;
  rhs[0] = 6 * ((y[2] - y[1]) / h1 - (y[1] - y[0]) / h0);
  for (let source = 2; source <= n - 3; source++) {
    const row = source - 1;
    lower[row] = h[source - 1];
    diagonal[row] = 2 * (h[source - 1] + h[source]);
    upper[row] = h[source];
    rhs[row] = 6 * ((y[source + 1] - y[source]) / h[source] - (y[source] - y[source - 1]) / h[source - 1]);
  }
  const hLeft = h[n - 3], hRight = h[n - 2], last = size - 1;
  lower[last] = (hLeft * hLeft - hRight * hRight) / hLeft;
  diagonal[last] = (hLeft + hRight) * (2 * hLeft + hRight) / hLeft;
  rhs[last] = 6 * ((y[n - 1] - y[n - 2]) / hRight - (y[n - 2] - y[n - 3]) / hLeft);
  for (let i = 1; i < size; i++) {
    const factor = lower[i] / diagonal[i - 1];
    diagonal[i] -= factor * upper[i - 1];
    rhs[i] -= factor * rhs[i - 1];
  }
  const inner = Array(size).fill(0);
  inner[last] = rhs[last] / diagonal[last];
  for (let i = last - 1; i >= 0; i--) inner[i] = (rhs[i] - upper[i] * inner[i + 1]) / diagonal[i];
  const second = Array(n).fill(0);
  for (let i = 0; i < size; i++) second[i + 1] = inner[i];
  second[0] = ((h0 + h1) * second[1] - h0 * second[2]) / h1;
  second[n - 1] = ((hLeft + hRight) * second[n - 2] - hRight * second[n - 3]) / hLeft;
  return second;
}

function cubicInterpolate(x: number[], y: number[], targets: number[]) {
  const second = notAKnotSecondDerivatives(x, y);
  return targets.map(target => {
    if (target <= x[0]) return y[0];
    if (target >= x.at(-1)!) return y.at(-1)!;
    const i = indexAtOrBelow(x, target), h = x[i + 1] - x[i];
    if (Math.abs(target - x[i]) < 1e-10) return y[i];
    const a = (x[i + 1] - target) / h, b = (target - x[i]) / h;
    return a * y[i] + b * y[i + 1] + ((a ** 3 - a) * second[i] + (b ** 3 - b) * second[i + 1]) * h * h / 6;
  });
}

function besselI0(value: number) {
  const x = Math.abs(value);
  if (x < 3.75) {
    const y = (x / 3.75) ** 2;
    return 1 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813)))));
  }
  const y = 3.75 / x;
  return Math.exp(x) / Math.sqrt(x) * (0.39894228 + y * (0.01328592 + y * (0.00225319 + y * (-0.00157565 + y * (0.00916281 + y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377))))))));
}

/** Exact index and taper conventions used by Larch's ftwindow(). */
export function ftWindow(x: number[], options: { xmin?: number; xmax?: number; dx?: number; dx2?: number; window?: ExafsWindow } = {}) {
  if (x.length < 2) throw new Error('A Fourier window needs at least two k points.');
  const xmin = options.xmin ?? x[0], xmax = options.xmax ?? x.at(-1)!, dx1 = options.dx ?? 1, dx2 = options.dx2 ?? dx1;
  const name = options.window ?? 'hanning';
  const step = (x.at(-1)! - x[0]) / (x.length - 1), epsilon = 1e-4 * (step > 0 && Number.isFinite(step) ? step : 1e-3);
  let x1 = Math.max(x[0], xmin - dx1 / 2), x2 = xmin + dx1 / 2 + epsilon;
  let x3 = xmax - dx2 / 2 - epsilon, x4 = Math.min(x.at(-1)!, xmax + dx2 / 2);
  const asIndex = (value: number) => Math.trunc((value + epsilon) / step);
  let i1 = Math.max(0, asIndex(x1)), i2 = Math.max(0, asIndex(x2));
  let i3 = Math.min(x.length - 1, asIndex(x3)), i4 = Math.min(x.length - 1, asIndex(x4));
  if (i2 === i1) i1 = Math.max(0, i2 - 1);
  if (i4 === i3) i3 = Math.max(i2, i4 - 1);
  [x1, x2, x3, x4] = [x[i1], x[i2], x[i3], x[i4]];
  if (x1 === x2) x2 += epsilon;
  if (x3 === x4) x4 += epsilon;
  const window = Array(x.length).fill(0);
  for (let i = i2; i < i3; i++) window[i] = 1;
  if (name === 'hanning') {
    for (let i = i1; i <= i2; i++) window[i] = Math.sin(Math.PI / 2 * (x[i] - x1) / (x2 - x1)) ** 2;
    for (let i = i3; i <= i4; i++) window[i] = Math.cos(Math.PI / 2 * (x[i] - x3) / (x4 - x3)) ** 2;
  } else if (name === 'parzen') {
    for (let i = i1; i <= i2; i++) window[i] = (x[i] - x1) / (x2 - x1);
    for (let i = i3; i <= i4; i++) window[i] = 1 - (x[i] - x3) / (x4 - x3);
  } else if (name === 'welch') {
    for (let i = i1; i <= i2; i++) window[i] = 1 - ((x[i] - x2) / (x2 - x1)) ** 2;
    for (let i = i3; i <= i4; i++) window[i] = 1 - ((x[i] - x3) / (x4 - x3)) ** 2;
  } else if (name === 'kaiser') {
    const center = (x4 + x1) / 2, width = (x4 - x1) / 2, scale = Math.max(1e-10, besselI0(dx1) - 1);
    for (let i = 0; i < x.length; i++) {
      const argument = Math.max(0, 1 - (x[i] - center) ** 2 / width ** 2);
      window[i] = (besselI0(dx1 * Math.sqrt(argument)) - 1) / scale;
    }
  } else if (name === 'sine') {
    for (let i = i1; i <= i4; i++) window[i] = Math.sin(Math.PI * (x4 - x[i]) / (x4 - x1));
  } else if (name === 'gaussian') {
    const center = (x4 + x1) / 2, sigma = Math.max(dx1, epsilon);
    for (let i = 0; i < x.length; i++) window[i] = Math.exp(-((x[i] - center) ** 2) / (2 * sigma * sigma));
  }
  return window;
}

function fftForward(realInput: number[], nfft: number) {
  if (nfft < 2 || (nfft & (nfft - 1)) !== 0) throw new Error('NFFT must be a power of two.');
  const real = new Float64Array(nfft), imaginary = new Float64Array(nfft);
  real.set(realInput.slice(0, nfft));
  for (let i = 1, j = 0; i < nfft; i++) {
    let bit = nfft >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let length = 2; length <= nfft; length <<= 1) {
    const angle = -2 * Math.PI / length, wLengthReal = Math.cos(angle), wLengthImaginary = Math.sin(angle);
    for (let start = 0; start < nfft; start += length) {
      let wr = 1, wi = 0;
      for (let offset = 0; offset < length / 2; offset++) {
        const even = start + offset, odd = even + length / 2;
        const oddReal = real[odd] * wr - imaginary[odd] * wi;
        const oddImaginary = real[odd] * wi + imaginary[odd] * wr;
        real[odd] = real[even] - oddReal; imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal; imaginary[even] += oddImaginary;
        const nextWr = wr * wLengthReal - wi * wLengthImaginary;
        wi = wr * wLengthImaginary + wi * wLengthReal; wr = nextWr;
      }
    }
  }
  return { real, imaginary };
}

function interpolateLinear(x: number[], y: number[], targets: number[]) {
  let cursor = 0;
  return targets.map(target => {
    if (target <= x[0]) return y[0];
    if (target >= x.at(-1)!) return y.at(-1)!;
    while (cursor < x.length - 2 && x[cursor + 1] < target) cursor++;
    const fraction = (target - x[cursor]) / (x[cursor + 1] - x[cursor]);
    return y[cursor] + fraction * (y[cursor + 1] - y[cursor]);
  });
}

/** Larch xftf_fast: already weighted/windowed uniform samples, zero padded, negative FFT sign. */
export function xftfFast(values: number[], nfft: number, kstep: number) {
  const output = fftForward(values, nfft), scale = kstep / Math.sqrt(Math.PI);
  return {
    real: Array.from(output.real.slice(0, nfft / 2), value => value * scale),
    imaginary: Array.from(output.imaginary.slice(0, nfft / 2), value => value * scale),
  };
}

export function xftf(k: number[], chi: number[], options: XftfOptions = {}): XftfResult {
  assertFiniteSeries(k, chi, 'k', 'chi');
  const kstep = options.kstep ?? EXAFS_KSTEP, nfft = options.nfft ?? EXAFS_NFFT;
  const kmin = options.kmin ?? 0, kmax = options.kmax ?? 20, kweight = Math.trunc(options.kweight ?? 2);
  const dk = options.dk ?? 1, windowName = options.window ?? 'kaiser', rmax = options.rmax ?? 10;
  const points = Math.trunc(1.01 + k.at(-1)! / kstep);
  const interpolationMax = Math.max(k.at(-1)!, kmax + dk);
  const grid = Array.from({ length: Math.trunc(1.01 + interpolationMax / kstep) }, (_, i) => i * kstep);
  const interpolated = interpolateLinear(k, chi, grid);
  const weightedChi = interpolated.slice(0, points).map((value, i) => value * grid[i] ** kweight);
  const window = ftWindow(grid, { xmin: kmin, xmax: kmax, dx: dk, dx2: dk, window: windowName }).slice(0, points);
  const transformed = xftfFast(weightedChi.map((value, i) => value * window[i]), nfft, kstep);
  const deltaR = Math.PI / (kstep * nfft), length = Math.trunc(Math.min(nfft / 2, 1.01 + rmax / deltaR));
  const real = transformed.real.slice(0, length), imaginary = transformed.imaginary.slice(0, length);
  return {
    r: Array.from({ length }, (_, i) => i * deltaR),
    kwin: window.slice(0, chi.length),
    weightedChi,
    magnitude: real.map((value, i) => Math.hypot(value, imaginary[i])),
    real,
    imaginary,
    deltaR,
  };
}

function norm(values: number[]) { return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)); }

export function autobk(energy: number[], mu: number[], options: AutobkOptions): AutobkResult {
  assertFiniteSeries(energy, mu, 'Energy', 'Absorption');
  const kstep = options.kstep ?? EXAFS_KSTEP, nfft = options.nfft ?? EXAFS_NFFT;
  if (kstep !== EXAFS_KSTEP || nfft !== EXAFS_NFFT) throw new Error('This Larch-matched browser path uses kstep 0.05 A^-1 and NFFT 2048.');
  const e0 = options.e0, edgeStep = options.edgeStep;
  if (!Number.isFinite(e0) || e0 < energy[0] || e0 > energy.at(-1)!) throw new Error('The edge energy must lie inside the measured energy range.');
  if (!Number.isFinite(edgeStep) || edgeStep <= 0) throw new Error('The edge step must be positive.');
  const ie0 = indexAtOrBelow(energy, e0), energyAbove = energy.slice(ie0).map(value => value - e0);
  const kraw = energyAbove.map(value => Math.sign(value) * Math.sqrt(ETOK * Math.abs(value)));
  const requestedKmax = options.kmax ?? kraw.at(-1)!;
  const kmax = Math.max(0, Math.min(kraw.at(-1)!, requestedKmax));
  const kmin = options.kmin ?? 0;
  if (kmax <= kmin) throw new Error('The selected spectrum does not extend beyond the minimum k value. Import a wider post-edge scan or lower kmin.');
  const kout = Array.from({ length: Math.trunc(1.01 + kmax / kstep) }, (_, i) => i * kstep);
  const iemax = Math.min(energy.length, 2 + indexAtOrBelow(energy, e0 + kmax * kmax / ETOK)) - 1;
  const rawLength = iemax - ie0 + 1, fitK = kraw.slice(0, rawLength), fitMu = mu.slice(ie0, iemax + 1);
  const rgrid = Math.PI / (kstep * nfft), rbkg = Math.max(options.rbkg ?? 1, 2 * rgrid);
  const kweight = options.kweight ?? 1, backgroundDk = options.dk ?? 0.1;
  const backgroundWindow = options.window ?? 'hanning';
  const window = ftWindow(kout, { xmin: kmin, xmax: kmax, dx: backgroundDk, dx2: backgroundDk, window: backgroundWindow });
  const ftwin = kout.map((value, i) => value ** kweight * window[i]);
  let nknots = 1 + Math.trunc(2 * rbkg * (kmax - kmin) / Math.PI);
  const irbkg = Math.trunc(1 + (nknots - 1) * Math.PI / (2 * rgrid * (kmax - kmin)));
  nknots = Math.max(5, Math.min(128, nknots));
  const splineK: number[] = [], splineY: number[] = [];
  for (let i = 0; i < nknots; i++) {
    const target = kmin + i * (kmax - kmin) / (nknots - 1), nearest = indexNearest(kraw, target);
    const upper = Math.min(kraw.length - 1, nearest + 5), lower = Math.max(0, nearest - 5);
    splineK.push(kraw[nearest]);
    splineY.push((2 * mu[nearest + ie0] + mu[upper + ie0] + mu[lower + ie0]) / 4);
  }
  if (splineK.some((value, i) => i > 0 && value <= splineK[i - 1])) throw new Error('The measured energy grid is too sparse for the requested AUTOBK knots.');
  const spline = interpolateSplineCoefficients(splineK, splineY);
  const nclamp = options.nclamp ?? 3, clampLow = Math.abs(options.clampLow ?? 0), clampHigh = Math.abs(options.clampHigh ?? 1);

  const evaluate = (coefficients: number[]) => {
    const background = fitK.map(value => evaluateSpline(spline.knots, coefficients, spline.degree, value));
    const residual = fitMu.map((value, i) => value - background[i]);
    const chi = cubicInterpolate(fitK, residual, kout);
    const transformed = xftfFast(chi.map((value, i) => value * ftwin[i]), nfft, EXAFS_KSTEP);
    const lowR: number[] = [];
    for (let i = 0; i < irbkg; i++) lowR.push(transformed.real[i], transformed.imaginary[i]);
    if (nclamp > 0) {
      const scale = 0.1 + 10 * lowR.reduce((sum, value) => sum + value * value, 0) / lowR.length;
      for (let i = 0; i < nclamp; i++) lowR.push(clampLow * scale * chi[i]);
      for (let i = chi.length - nclamp; i < chi.length; i++) lowR.push(clampHigh * scale * chi[i]);
    }
    return { background, chi, residuals: lowR };
  };

  let coefficients = [...spline.coefficients], state = evaluate(coefficients), cost = state.residuals.reduce((sum, value) => sum + value * value, 0);
  let damping = 1e-3, iterations = 0;
  for (; iterations < 80; iterations++) {
    const columns: number[][] = [];
    for (let parameter = 0; parameter < coefficients.length; parameter++) {
      const step = 1e-3 * Math.max(1, Math.abs(coefficients[parameter]));
      const trial = [...coefficients]; trial[parameter] += step;
      const residuals = evaluate(trial).residuals;
      columns.push(residuals.map((value, i) => (value - state.residuals[i]) / step));
    }
    const count = coefficients.length, normal = Array.from({ length: count }, () => Array(count).fill(0)), gradient = Array(count).fill(0);
    for (let row = 0; row < count; row++) {
      gradient[row] = columns[row].reduce((sum, value, i) => sum + value * state.residuals[i], 0);
      for (let column = 0; column < count; column++) normal[row][column] = columns[row].reduce((sum, value, i) => sum + value * columns[column][i], 0);
      normal[row][row] += damping * Math.max(1, normal[row][row]);
    }
    let delta: number[];
    try { delta = solveLinear(normal, gradient.map(value => -value)); }
    catch { damping *= 10; continue; }
    const trialCoefficients = coefficients.map((value, i) => value + delta[i]), trialState = evaluate(trialCoefficients);
    const trialCost = trialState.residuals.reduce((sum, value) => sum + value * value, 0);
    if (trialCost < cost) {
      const improvement = cost - trialCost;
      coefficients = trialCoefficients; state = trialState; cost = trialCost; damping = Math.max(1e-12, damping / 3);
      if (improvement < 1e-12 * (1 + cost) || norm(delta) < 1e-9 * (1 + norm(coefficients))) break;
    } else damping = Math.min(1e12, damping * 10);
  }
  const bkg = [...mu];
  state.background.forEach((value, i) => { bkg[ie0 + i] = value; });
  const chie = mu.map((value, i) => (value - bkg[i]) / edgeStep);
  return {
    e0, edgeStep, rbkg, k: kout, chi: state.chi.map(value => value / edgeStep), bkg, chie,
    nknots, kmin, kmax, iterations: iterations + 1,
  };
}

export function processExafs(energy: number[], mu: number[], options: ExafsProcessingOptions): ExafsProcessingResult {
  const edge = preEdge(energy, mu);
  const maxK = Math.sqrt(Math.max(0, ETOK * (energy.at(-1)! - edge.e0)));
  if (maxK < options.kmin + 1) throw new Error('EXAFS processing needs a wider post-edge range. Import a scan that extends farther above the edge.');
  const kmax = Math.min(options.kmax, maxK);
  const background = autobk(energy, mu, {
    e0: edge.e0, edgeStep: edge.edgeStep, rbkg: options.rbkg,
    kmin: 0, kmax, kweight: 1, dk: 0.1, window: 'hanning',
    nfft: EXAFS_NFFT, kstep: EXAFS_KSTEP, nclamp: 3, clampLow: 0, clampHigh: 1,
  });
  const transform = xftf(background.k, background.chi, {
    kmin: options.kmin, kmax, kweight: options.kweight, dk: options.dk,
    window: options.window, rmax: 10, nfft: EXAFS_NFFT, kstep: EXAFS_KSTEP,
  });
  return { preEdge: edge, autobk: background, xftf: transform, parameters: { ...options, kmax, kstep: EXAFS_KSTEP, nfft: EXAFS_NFFT } };
}
