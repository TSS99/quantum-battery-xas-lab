/**
 * FEFF path sums following xraylarch 2026.3.1 `FeffPathGroup._calc_chi`.
 *
 * The serialized FEFF columns remain on their native nonuniform k grid. Larch combines
 * `real_phc + pha_feff` and `mag_feff * red_fact`, then evaluates four interpolating cubic
 * splines. Its `UnivariateSpline(..., s=0)` is the not-a-knot cubic reproduced here.
 */

import type {
  ExafsEnergyPoint, ExafsEnergyResult, ExafsParameters, ExafsPathContribution,
  ExafsPathParameters, ExafsResult, ExafsSumOptions, FeffMaterial, FeffPath,
} from './types';

/** 2 m_e / hbar^2 in eV^-1 A^-2, computed by scipy.constants in Larch 2026.3.1. */
export const ETOK = 0.26246842396479836;
/** hbar^2 / (2 k_B amu), in A^2 K amu, computed by scipy.constants in Larch 2026.3.1. */
export const EINS_FACTOR_A2_K_AMU = 24.254367056580552;

const SMALL_ENERGY = 1e-6;

type JsonModule = { default: unknown };
const pathLoaders: Record<string, () => Promise<JsonModule>> = {
  ceo2: () => import('../../data/twin/feff/ceo2.json'),
  cu: () => import('../../data/twin/feff/cu.json'),
  'fe-bcc': () => import('../../data/twin/feff/fe-bcc.json'),
  fe3o4: () => import('../../data/twin/feff/fe3o4.json'),
  licoo2: () => import('../../data/twin/feff/licoo2.json'),
  lifepo4: () => import('../../data/twin/feff/lifepo4.json'),
  limn2o4: () => import('../../data/twin/feff/limn2o4.json'),
  ni: () => import('../../data/twin/feff/ni.json'),
  nio: () => import('../../data/twin/feff/nio.json'),
  pt: () => import('../../data/twin/feff/pt.json'),
  zno: () => import('../../data/twin/feff/zno.json'),
};
const loadedPaths = new Map<string, Promise<FeffMaterial>>();

/** Load and cache one FEFF material as its own dynamic-import chunk. */
export function loadPaths(id: string): Promise<FeffMaterial> {
  const key = id.trim().toLowerCase();
  const loader = pathLoaders[key];
  if (!loader) {
    return Promise.reject(new Error(`Unknown FEFF path set "${id}". Available sets: ${Object.keys(pathLoaders).join(', ')}.`));
  }
  let pending = loadedPaths.get(key);
  if (!pending) {
    pending = loader().then(module => module.default as FeffMaterial).catch(error => {
      loadedPaths.delete(key);
      throw error;
    });
    loadedPaths.set(key, pending);
  }
  return pending;
}

interface CubicSpline {
  x: readonly number[];
  a: Float64Array;
  b: Float64Array;
  c: Float64Array;
  d: Float64Array;
}

interface PreparedPath {
  phase: CubicSpline;
  amplitude: CubicSpline;
  rep: CubicSpline;
  lambda: CubicSpline;
  interpolated: WeakMap<object, Map<number, InterpolatedPath>>;
}

interface InterpolatedPath {
  phase: Float64Array;
  amplitude: Float64Array;
  rep: Float64Array;
  invLambda: Float64Array;
}

const preparedPaths = new WeakMap<FeffPath, PreparedPath>();
const shiftedKCache = new WeakMap<object, Map<number, Float64Array>>();

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
  return value;
}

/** Solve a tridiagonal system without allocating a dense n by n matrix. */
function solveTridiagonal(lower: Float64Array, diagonal: Float64Array,
                          upper: Float64Array, rhs: Float64Array): Float64Array {
  const n = diagonal.length;
  const c = new Float64Array(upper);
  const d = new Float64Array(rhs);
  const b = new Float64Array(diagonal);
  for (let i = 1; i < n; i++) {
    const scale = lower[i] / b[i - 1];
    b[i] -= scale * c[i - 1];
    d[i] -= scale * d[i - 1];
  }
  const result = new Float64Array(n);
  result[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) result[i] = (d[i] - c[i] * result[i + 1]) / b[i];
  return result;
}

/** Coefficients of the scipy CubicSpline default, `bc_type="not-a-knot"`. */
function notAKnotSpline(x: readonly number[], y: readonly number[]): CubicSpline {
  const n = x.length;
  if (n < 4 || y.length !== n) throw new Error('A FEFF spline needs at least four matching knots.');
  const h = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = x[i + 1] - x[i];
    if (!(h[i] > 0) || !Number.isFinite(y[i])) throw new Error('FEFF spline knots must be finite and strictly increasing.');
  }
  if (!Number.isFinite(y[n - 1])) throw new Error('FEFF spline values must be finite.');

  // Eliminate the endpoint second derivatives from the two not-a-knot equations.
  // The remaining unknowns are M[1] ... M[n-2] and form a tridiagonal system.
  const count = n - 2;
  const lower = new Float64Array(count);
  const diagonal = new Float64Array(count);
  const upper = new Float64Array(count);
  const rhs = new Float64Array(count);
  for (let row = 0; row < count; row++) {
    const i = row + 1;
    const left = h[i - 1], right = h[i];
    rhs[row] = 6 * ((y[i + 1] - y[i]) / right - (y[i] - y[i - 1]) / left);
    lower[row] = left;
    diagonal[row] = 2 * (left + right);
    upper[row] = right;
  }
  const h0 = h[0], h1 = h[1];
  lower[0] = 0;
  diagonal[0] = (h0 + h1) * (h0 + 2 * h1) / h1;
  upper[0] = (h1 * h1 - h0 * h0) / h1;
  const hp = h[n - 3], hl = h[n - 2];
  lower[count - 1] = (hp * hp - hl * hl) / hp;
  diagonal[count - 1] = (hp + hl) * (2 * hp + hl) / hp;
  upper[count - 1] = 0;

  const interior = solveTridiagonal(lower, diagonal, upper, rhs);
  const second = new Float64Array(n);
  second.set(interior, 1);
  second[0] = ((h0 + h1) * second[1] - h0 * second[2]) / h1;
  second[n - 1] = (-hl * second[n - 3] + (hp + hl) * second[n - 2]) / hp;

  const a = new Float64Array(n - 1), b = new Float64Array(n - 1);
  const c = new Float64Array(n - 1), d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    a[i] = y[i];
    b[i] = (y[i + 1] - y[i]) / h[i] - h[i] * (2 * second[i] + second[i + 1]) / 6;
    c[i] = second[i] / 2;
    d[i] = (second[i + 1] - second[i]) / (6 * h[i]);
  }
  return { x, a, b, c, d };
}

function preparePath(path: FeffPath): PreparedPath {
  let prepared = preparedPaths.get(path);
  if (prepared) return prepared;
  const phase = path.real_phc.map((value, i) => value + path.pha_feff[i]);
  const amplitude = path.mag_feff.map((value, i) => value * path.red_fact[i]);
  prepared = {
    phase: notAKnotSpline(path.k, phase),
    amplitude: notAKnotSpline(path.k, amplitude),
    rep: notAKnotSpline(path.k, path.rep),
    lambda: notAKnotSpline(path.k, path.lam),
    interpolated: new WeakMap(),
  };
  preparedPaths.set(path, prepared);
  return prepared;
}

function splineInterval(spline: CubicSpline, value: number): number {
  const x = spline.x;
  if (value <= x[0]) return 0;
  if (value >= x[x.length - 1]) return x.length - 2;
  let low = 0, high = x.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (x[middle] < value) low = middle;
    else high = middle;
  }
  return low;
}

function splineValue(spline: CubicSpline, interval: number, value: number): number {
  const dx = value - spline.x[interval];
  return spline.a[interval] + dx * (spline.b[interval] + dx * (spline.c[interval] + dx * spline.d[interval]));
}

function shiftedK(k: readonly number[], e0_eV: number): Float64Array {
  const energy = new Float64Array(k.length);
  let smallest = Infinity;
  for (let i = 0; i < k.length; i++) {
    requireFinite(k[i], `k[${i}]`);
    energy[i] = k[i] * k[i] - e0_eV * ETOK;
    smallest = Math.min(smallest, Math.abs(energy[i]));
  }
  // This two-stage condition deliberately follows Larch: the 1.5e-6 window is only
  // changed when at least one grid point is closer than 1e-6 to the singularity.
  if (smallest < SMALL_ENERGY) {
    for (let i = 0; i < energy.length; i++) if (Math.abs(energy[i]) < 1.5 * SMALL_ENERGY) energy[i] = SMALL_ENERGY;
  }
  for (let i = 0; i < energy.length; i++) energy[i] = Math.sign(energy[i]) * Math.sqrt(Math.abs(energy[i]));
  return energy;
}

function cachedShiftedK(k: readonly number[], e0_eV: number): Float64Array {
  const key = k as object;
  let byE0 = shiftedKCache.get(key);
  if (!byE0) { byE0 = new Map(); shiftedKCache.set(key, byE0); }
  let q = byE0.get(e0_eV);
  if (!q) { q = shiftedK(k, e0_eV); byE0.set(e0_eV, q); }
  return q;
}

const PARAMETER_DEFAULTS: Required<ExafsPathParameters> = {
  s02: 1,
  e0_eV: 0,
  deltar_A: 0,
  sigma2_A2: 0,
  c3_A3: 0,
  c4_A4: 0,
  ei_eV: 0,
  degen: 1,
};

function completeParameters(path: FeffPath, ...levels: (ExafsPathParameters | undefined)[]): Required<ExafsPathParameters> {
  const out = { ...PARAMETER_DEFAULTS, degen: path.degen };
  for (const level of levels) {
    if (!level) continue;
    for (const name of Object.keys(PARAMETER_DEFAULTS) as (keyof ExafsPathParameters)[]) {
      const value = level[name];
      if (value !== undefined) out[name] = requireFinite(value, name);
    }
  }
  if (Math.abs(path.reff + out.deltar_A) < 1e-15) throw new RangeError('reff + deltar_A must not be zero.');
  return out;
}

/** Principal square root of x + iy. */
function complexSqrt(real: number, imaginary: number): [number, number] {
  const magnitude = Math.sqrt(real * real + imaginary * imaginary);
  const rootReal = Math.sqrt(Math.max(0, (magnitude + real) / 2));
  const rootImaginary = Math.sqrt(Math.max(0, (magnitude - real) / 2));
  return [rootReal, imaginary < 0 ? -rootImaginary : rootImaginary];
}

function interpolatePath(prepared: PreparedPath, path: FeffPath, gridKey: object,
                         e0_eV: number, q: Float64Array): InterpolatedPath {
  let byE0 = prepared.interpolated.get(gridKey);
  if (!byE0) { byE0 = new Map(); prepared.interpolated.set(gridKey, byE0); }
  let values = byE0.get(e0_eV);
  if (values) return values;

  const phase = new Float64Array(q.length), amplitude = new Float64Array(q.length);
  const rep = new Float64Array(q.length), invLambda = new Float64Array(q.length);
  let interval = 0;
  let ascending = true;
  for (let i = 1; i < q.length; i++) if (q[i] < q[i - 1]) { ascending = false; break; }
  for (let i = 0; i < q.length; i++) {
    const qi = q[i];
    if (ascending) {
      while (interval < path.k.length - 2 && qi > path.k[interval + 1]) interval++;
      if (qi <= path.k[0]) interval = 0;
    } else interval = splineInterval(prepared.phase, qi);
    phase[i] = splineValue(prepared.phase, interval, qi);
    amplitude[i] = splineValue(prepared.amplitude, interval, qi);
    rep[i] = splineValue(prepared.rep, interval, qi);
    invLambda[i] = 1 / splineValue(prepared.lambda, interval, qi);
  }
  values = { phase, amplitude, rep, invLambda };
  byE0.set(e0_eV, values);
  return values;
}

function calculatePath(path: FeffPath, params: Required<ExafsPathParameters>, gridKey: object,
                       q: Float64Array, extrapolateFirst: boolean,
                       contributionWeight = 1, total?: number[]): number[] {
  const prepared = preparePath(path);
  const interpolated = interpolatePath(prepared, path, gridKey, params.e0_eV, q);
  const result = new Array<number>(q.length);
  const reff = path.reff;
  const radius = reff + params.deltar_A;
  const prefactor = contributionWeight * params.degen * params.s02 / (radius * radius);
  const sigma2 = params.sigma2_A2, deltar = params.deltar_A;
  const third = params.c3_A3, fourth = params.c4_A4, ei = params.ei_eV;
  const noCumulants = third === 0 && fourth === 0;
  const twiceReff = 2 * reff, twiceSigma2 = 2 * sigma2;
  const simpleDistance = deltar - twiceSigma2 / reff;
  const twiceSimpleDistance = 2 * simpleDistance;

  for (let i = 0; i < q.length; i++) {
    const qi = q[i];
    const phase = interpolated.phase[i], amplitude = interpolated.amplitude[i];
    const rep = interpolated.rep[i], invLambda = interpolated.invLambda[i];
    const ppReal = rep * rep - invLambda * invLambda;
    const ppImaginary = 2 * rep * invLambda + ei * ETOK;
    let pReal = rep, pImaginary = invLambda;
    if (ei !== 0 || rep < 0) [pReal, pImaginary] = complexSqrt(ppReal, ppImaginary);

    let exponentReal: number, exponentImaginary: number;
    if (noCumulants) {
      exponentReal = -(twiceReff + twiceSimpleDistance) * pImaginary - twiceSigma2 * ppReal;
      exponentImaginary = -twiceSigma2 * ppImaginary + twiceReff * qi + phase + twiceSimpleDistance * pReal;
    } else {
      // -2 pp (sigma2 - pp*c4/3)
      const disorderReal = sigma2 - ppReal * fourth / 3;
      const disorderImaginary = -ppImaginary * fourth / 3;
      const ppDisorderReal = ppReal * disorderReal - ppImaginary * disorderImaginary;
      const ppDisorderImaginary = ppReal * disorderImaginary + ppImaginary * disorderReal;

      // 2 p (deltar - 2*sigma2/reff - 2*pp*c3/3)
      const distanceReal = deltar - 2 * sigma2 / reff - 2 * ppReal * third / 3;
      const distanceImaginary = -2 * ppImaginary * third / 3;
      const pDistanceReal = pReal * distanceReal - pImaginary * distanceImaginary;
      const pDistanceImaginary = pReal * distanceImaginary + pImaginary * distanceReal;
      exponentReal = -2 * reff * pImaginary - 2 * ppDisorderReal - 2 * pDistanceImaginary;
      exponentImaginary = -2 * ppDisorderImaginary + 2 * qi * reff + phase + 2 * pDistanceReal;
    }
    const magnitude = prefactor * amplitude * Math.exp(exponentReal) / qi;
    result[i] = magnitude * Math.sin(exponentImaginary);
    if (total) total[i] += result[i];
  }
  if (extrapolateFirst && result.length >= 3) {
    const previous = result[0];
    result[0] = 2 * result[1] - result[2];
    if (total) total[0] += result[0] - previous;
  }
  return result;
}

/**
 * Calculate one FEFF path on an explicit k grid. A grid that starts at k = 0, like Larch's own, gets
 * Larch's first-point extrapolation there; a grid that starts above zero is evaluated at every point.
 */
export function chiPath(path: FeffPath, params: ExafsPathParameters = {}, k: readonly number[]): number[] {
  if (k.length === 0) return [];
  const complete = completeParameters(path, params);
  return calculatePath(path, complete, k as object, cachedShiftedK(k, complete.e0_eV), k[0] === 0);
}

function siteWeights(set: FeffMaterial, overrides?: Record<string, number>): Map<string, number> {
  const known = new Set(set.sites.map(site => site.id));
  for (const id of Object.keys(overrides ?? {})) if (!known.has(id)) throw new Error(`Unknown absorber site "${id}" in ${set.id}.`);
  const values = set.sites.map(site => {
    const value = overrides?.[site.id] ?? site.weight;
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Site weight for ${site.id} must be finite and nonnegative.`);
    return value;
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new RangeError('At least one absorber-site weight must be greater than zero.');
  return new Map(set.sites.map((site, i) => [site.id, values[i] / total]));
}

function pathOverrides(params: ExafsParameters, siteId: string, pathId: string): [ExafsPathParameters?, ExafsPathParameters?] {
  return [params.paths?.[pathId], params.paths?.[`${siteId}/${pathId}`]];
}

function chiSumInternal(set: FeffMaterial, params: ExafsParameters, kGrid: readonly number[],
                        options: ExafsSumOptions, extrapolateFirst: boolean): ExafsResult {
  const k = Array.isArray(kGrid) ? kGrid as number[] : Array.from(kGrid);
  const chi = new Array<number>(k.length).fill(0);
  const contributions: ExafsPathContribution[] = [];
  const weights = siteWeights(set, options.siteWeights ?? params.siteWeights);
  const global: ExafsPathParameters = {
    s02: params.s02, e0_eV: params.e0_eV, deltar_A: params.deltar_A,
    sigma2_A2: params.sigma2_A2, c3_A3: params.c3_A3, c4_A4: params.c4_A4,
    ei_eV: params.ei_eV, degen: params.degen,
  };
  const shifted = new Map<number, Float64Array>();

  for (const site of set.sites) {
    const weight = weights.get(site.id)!;
    if (weight === 0) continue;
    for (const path of site.paths) {
      const [commonOverride, siteOverride] = pathOverrides(params, site.id, path.id);
      const complete = completeParameters(path, global, commonOverride, siteOverride);
      let q = shifted.get(complete.e0_eV);
      if (!q) { q = cachedShiftedK(k, complete.e0_eV); shifted.set(complete.e0_eV, q); }
      const pathChi = calculatePath(path, complete, k as object, q, extrapolateFirst, weight, chi);
      contributions.push({
        key: `${site.id}/${path.id}`, siteId: site.id, pathId: path.id,
        siteWeight: weight, parameters: complete, chi: pathChi,
      });
    }
  }
  return { k_A_inv: k, chi, contributions, provenance: 'computed' };
}

/**
 * Sum every retained path, using crystallographic or caller-supplied absorber-site weights. As in
 * `chiPath`, only a grid that starts at k = 0 gets Larch's first-point extrapolation.
 */
export function chiSum(set: FeffMaterial, params: ExafsParameters = {}, kGrid: readonly number[],
                       options: ExafsSumOptions = {}): ExafsResult {
  return chiSumInternal(set, params, kGrid, options, kGrid.length > 0 && kGrid[0] === 0);
}

/** Larch's Einstein mean-square displacement, including every vertex in the path geometry. */
export function sigma2Einstein(path: FeffPath, thetaE_K: number, T_K: number): number {
  const theta = Math.max(requireFinite(thetaE_K, 'Einstein temperature'), 1e-5);
  const temperature = Math.max(requireFinite(T_K, 'Sample temperature'), 1e-5);
  let inverseMass = 0;
  for (const atom of path.geometry) inverseMass += 1 / Math.max(0.1, atom.mass_amu);
  const reducedMass = 1 / Math.max(1e-12, inverseMass);
  return EINS_FACTOR_A2_K_AMU / (theta * reducedMass * Math.tanh(theta / (2 * temperature)));
}

function energyArray(set: FeffMaterial, params: ExafsParameters, energies: readonly number[], edgeEnergy: number): ExafsEnergyResult {
  requireFinite(edgeEnergy, 'E0');
  const energy_eV = Array.from(energies);
  const k_A_inv = new Array<number>(energy_eV.length).fill(0);
  const chi = new Array<number>(energy_eV.length).fill(0);
  const factor = new Array<number>(energy_eV.length).fill(0);
  const above: number[] = [], indices: number[] = [];
  for (let i = 0; i < energy_eV.length; i++) {
    requireFinite(energy_eV[i], `E_eV[${i}]`);
    if (energy_eV[i] >= edgeEnergy) {
      k_A_inv[i] = Math.sqrt(ETOK * (energy_eV[i] - edgeEnergy));
      above.push(k_A_inv[i]);
      indices.push(i);
    }
  }
  if (above.length > 0) {
    // Larch's first-point replacement belongs to a grid beginning at k=0. An energy slice
    // that starts above the edge is evaluated directly instead of replacing a physical point.
    const startsAtEdge = above[0] === 0;
    const summed = chiSumInternal(set, params, above, {}, startsAtEdge);
    for (let j = 0; j < indices.length; j++) {
      const i = indices[j];
      chi[i] = summed.chi[j];
      factor[i] = 1 + summed.chi[j];
    }
  }
  return { energy_eV, k_A_inv, chi, factor, provenance: 'computed' };
}

export function chiOfEnergy(set: FeffMaterial, params: ExafsParameters, E_eV: number, E0_eV: number): ExafsEnergyPoint;
export function chiOfEnergy(set: FeffMaterial, params: ExafsParameters, E_eV: readonly number[], E0_eV: number): ExafsEnergyResult;
/** Convert energy above E0 to k and return the fine-structure multiplier used by sample.ts. */
export function chiOfEnergy(set: FeffMaterial, params: ExafsParameters, E_eV: number | readonly number[],
                            E0_eV: number): ExafsEnergyPoint | ExafsEnergyResult {
  const scalar = typeof E_eV === 'number';
  const result = energyArray(set, params, scalar ? [E_eV] : E_eV, E0_eV);
  if (!scalar) return result;
  return {
    energy_eV: result.energy_eV[0], k_A_inv: result.k_A_inv[0], chi: result.chi[0],
    factor: result.factor[0], provenance: 'computed',
  };
}
