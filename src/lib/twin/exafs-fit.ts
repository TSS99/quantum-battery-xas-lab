/**
 * Single-dataset EXAFS fits, following larch/xafs/feffit.py (2026.3.1).
 * See EXAFS_FITTING.md for the parameter scheme and statistical conventions.
 */
import { Matrix, solve, SingularValueDecomposition } from 'ml-matrix';
import { EXAFS_KSTEP, EXAFS_NFFT, ftWindow, xftfFast } from '../exafs';
import { chiPath, sigma2Einstein } from './exafs';
import type {
  ExafsFitComplexCurve, ExafsFitModel, ExafsFitOptions, ExafsFitParameter,
  ExafsFitRequest, ExafsFitResult, ExafsFitValue,
} from './types';

type Settings = ExafsFitResult['settings'];
type Values = Record<string, number>;
const squaredNorm = (x: readonly number[]) => x.reduce((sum, v) => sum + v * v, 0);
const finite = (x: number, name: string) => {
  if (!Number.isFinite(x)) throw new RangeError(`${name} must be finite.`);
  return x;
};
const positive = (x: number, name: string) => {
  if (!(finite(x, name) > 0)) throw new RangeError(`${name} must be positive.`);
  return x;
};

function settingsFor(options: ExafsFitOptions): Settings {
  const settings: Settings = {
    space: options.space ?? 'r', kmin_A_inv: options.kmin_A_inv, kmax_A_inv: options.kmax_A_inv,
    rmin_A: options.rmin_A, rmax_A: options.rmax_A, kweight: options.kweight ?? 2,
    dk_A_inv: options.dk_A_inv ?? 1, dk2_A_inv: options.dk2_A_inv ?? options.dk_A_inv ?? 1,
    kstep_A_inv: options.kstep_A_inv ?? EXAFS_KSTEP, nfft: options.nfft ?? EXAFS_NFFT,
    independentPoints: options.independentPoints ?? 'nyquist',
    maxIterations: options.maxIterations ?? 200, tolerance: options.tolerance ?? 1e-9,
  };
  const s = settings;
  for (const [key, value] of Object.entries(s)) if (typeof value === 'number') finite(value, key);
  if (!['k', 'r'].includes(s.space)) throw new RangeError('Fit space must be k or r.');
  if (!['nyquist', 'larch'].includes(s.independentPoints)) throw new RangeError('Unknown independent-points convention.');
  if (![0, 1, 2, 3].includes(s.kweight)) throw new RangeError('kweight must be 0, 1, 2 or 3.');
  positive(s.kstep_A_inv, 'kstep_A_inv');
  if (s.kmin_A_inv < 0 || s.kmax_A_inv <= s.kmin_A_inv || s.rmin_A < 0 || s.rmax_A <= s.rmin_A) {
    throw new RangeError('Fit ranges must be increasing and nonnegative.');
  }
  if (s.dk_A_inv < 0 || s.dk2_A_inv < 0 || (s.dk_A_inv + s.dk2_A_inv) / 2 > s.kmax_A_inv - s.kmin_A_inv) {
    throw new RangeError('Hanning tapers must be nonnegative and must not overlap.');
  }
  if (!Number.isInteger(s.nfft) || s.nfft < 32 || s.nfft > 32768 || (s.nfft & (s.nfft - 1)) !== 0) {
    throw new RangeError('nfft must be a power of two from 32 to 32768.');
  }
  if (s.rmax_A >= Math.PI / (2 * s.kstep_A_inv)) throw new RangeError('Rmax must be below the transform Nyquist limit.');
  if (s.kmax_A_inv >= s.nfft * s.kstep_A_inv / 2) throw new RangeError('nfft is too small for the k fit range.');
  if (!Number.isInteger(s.maxIterations) || s.maxIterations < 1 || s.maxIterations > 2000) {
    throw new RangeError('maxIterations must be an integer from 1 to 2000.');
  }
  if (s.tolerance < 1e-12 || s.tolerance > 1e-3) throw new RangeError('tolerance must be between 1e-12 and 1e-3.');
  return settings;
}

function compileParameters(parameters: Record<string, ExafsFitParameter>, model: ExafsFitModel) {
  const names = Object.keys(parameters), ordered: string[] = [], visiting = new Set<string>();
  const visit = (name: string) => {
    if (!Object.hasOwn(parameters, name)) throw new Error(`Unknown parameter "${name}".`);
    if (visiting.has(name)) throw new Error(`Cyclic parameter link at "${name}".`);
    if (ordered.includes(name)) return;
    visiting.add(name);
    const p = parameters[name];
    if (p.expr) {
      if (p.value !== undefined || p.vary === true || p.min !== undefined || p.max !== undefined) {
        throw new Error(`Linked parameter "${name}" cannot have a value, bounds or vary: true.`);
      }
      finite(p.expr.scale ?? 1, `${name}.scale`);
      finite(p.expr.offset ?? 0, `${name}.offset`);
      visit(p.expr.parameter);
    } else {
      finite(p.value!, `${name}.value`);
      if (p.min !== undefined) finite(p.min, `${name}.min`);
      if (p.max !== undefined) finite(p.max, `${name}.max`);
      if ((p.min ?? -Infinity) >= (p.max ?? Infinity)) throw new RangeError(`Invalid bounds for "${name}"; use vary: false to fix it.`);
      if (p.value! < (p.min ?? -Infinity) || p.value! > (p.max ?? Infinity)) throw new RangeError(`Initial "${name}" is outside its bounds.`);
    }
    visiting.delete(name);
    ordered.push(name);
  };
  names.forEach(visit);
  const variableNames = names.filter(name => !parameters[name].expr && parameters[name].vary !== false);
  const used = new Set<string>();
  const use = (value: ExafsFitValue | undefined) => {
    if (value === undefined) return;
    if (typeof value === 'number') { finite(value, 'Model constant'); return; }
    if (!Object.hasOwn(parameters, value)) throw new Error(`Unknown parameter "${value}".`);
    if (used.has(value)) return;
    used.add(value);
    const expr = parameters[value].expr;
    if (expr && (expr.scale ?? 1) !== 0) use(expr.parameter);
  };
  use(model.s02); use(model.e0_eV);
  if (!model.shells.length) throw new Error('At least one shell is required.');
  const ids = new Set<string>();
  for (const shell of model.shells) {
    if (!shell.id || ids.has(shell.id)) throw new Error('Shell ids must be nonempty and unique.');
    ids.add(shell.id);
    if (!shell.paths.length) throw new Error(`Shell "${shell.id}" has no paths.`);
    positive(shell.weight ?? 1, 'Shell weight');
    if (shell.deltar_A !== undefined && shell.alpha !== undefined) throw new Error('Choose deltar_A or alpha, not both.');
    if (shell.sigma2_A2 !== undefined && shell.thetaE_K !== undefined) throw new Error('Choose sigma2_A2 or thetaE_K, not both.');
    if (shell.thetaE_K !== undefined) {
      if (finite(shell.temperature_K!, 'temperature_K') < 0) throw new RangeError('temperature_K must be nonnegative.');
    } else if (shell.temperature_K !== undefined) throw new Error('temperature_K requires thetaE_K.');
    use(shell.deltar_A); use(shell.alpha); use(shell.sigma2_A2); use(shell.thetaE_K);
  }
  for (const name of variableNames) if (!used.has(name)) throw new Error(`Variable "${name}" is unused by the model.`);
  const lower = variableNames.map(name => parameters[name].min ?? -Infinity);
  const upper = variableNames.map(name => parameters[name].max ?? Infinity);
  const initial = variableNames.map(name => parameters[name].value!);
  const resolve = (x: number[]) => {
    const values: Values = Object.create(null);
    for (const name of ordered) {
      const p = parameters[name], index = variableNames.indexOf(name);
      values[name] = p.expr ? (p.expr.offset ?? 0) + (p.expr.scale ?? 1) * values[p.expr.parameter]
        : index < 0 ? p.value! : x[index];
      finite(values[name], name);
    }
    return values;
  };
  // Exact sensitivities for chained affine links, used with the full covariance.
  const sensitivities: Record<string, number[]> = Object.create(null);
  for (const name of ordered) {
    const expr = parameters[name].expr;
    sensitivities[name] = expr ? sensitivities[expr.parameter].map(v => v * (expr.scale ?? 1))
      : variableNames.map(variable => Number(variable === name));
  }
  return { names, variableNames, lower, upper, initial, resolve, sensitivities };
}

function resolvePaths(model: ExafsFitModel, values: Values): ExafsFitResult['paths'] {
  const value = (term: ExafsFitValue | undefined, fallback = 0) => typeof term === 'string' ? values[term] : term ?? fallback;
  const s02 = value(model.s02), e0_eV = value(model.e0_eV);
  if (s02 < 0) throw new RangeError('s02 must be nonnegative.');
  return model.shells.flatMap(shell => shell.paths.map(path => {
    const deltar_A = shell.alpha === undefined ? value(shell.deltar_A) : value(shell.alpha) * path.reff;
    const sigma2_A2 = shell.thetaE_K === undefined ? value(shell.sigma2_A2)
      : sigma2Einstein(path, positive(value(shell.thetaE_K), 'thetaE_K'), shell.temperature_K!);
    positive(path.reff + deltar_A, 'Path length');
    if (sigma2_A2 < 0) throw new RangeError('sigma2_A2 must be nonnegative.');
    return { shellId: shell.id, pathId: path.id, weight: shell.weight ?? 1, parameters: { s02, e0_eV, deltar_A, sigma2_A2 } };
  }));
}

function interpolate(x: readonly number[], y: readonly number[], grid: number[]): number[] {
  let cursor = 0;
  return grid.map(k => {
    if (k <= x[0]) return y[0];
    if (k >= x[x.length - 1]) return y[y.length - 1];
    while (cursor < x.length - 2 && x[cursor + 1] < k) cursor++;
    if (k === x[cursor + 1]) return y[cursor + 1];
    if (k === x[cursor]) return y[cursor];
    return y[cursor] + (y[cursor + 1] - y[cursor]) * (k - x[cursor]) / (x[cursor + 1] - x[cursor]);
  });
}

function prepareData(request: ExafsFitRequest, s: Settings) {
  const { k_A_inv: k, chi } = request;
  if (k.length < 3 || k.length !== chi.length) throw new RangeError('k and chi need matching arrays of at least three points.');
  for (let i = 0; i < k.length; i++) {
    finite(k[i], `k[${i}]`); finite(chi[i], `chi[${i}]`);
    if (k[i] < 0 || (i > 0 && k[i] <= k[i - 1])) throw new RangeError('k must be nonnegative and strictly increasing.');
  }
  const step = s.kstep_A_inv, rstep = Math.PI / (s.nfft * step);
  const length = Math.trunc(1.01 + k[k.length - 1] / step);
  if (length > s.nfft) throw new RangeError('Input extends beyond nfft; increase nfft or trim the input.');
  const fullGrid = Array.from({ length: s.nfft }, (_, i) => i * step);
  const grid = fullGrid.slice(0, length), data = interpolate(k, chi, grid);
  const fullWindow = ftWindow(fullGrid, { xmin: s.kmin_A_inv, xmax: s.kmax_A_inv, dx: s.dk_A_inv, dx2: s.dk2_A_inv, window: 'hanning' });
  const window = fullWindow.slice(0, length);
  // No invented samples in the active window, including the tails. Ignore roundoff at zero-valued endpoints.
  const needed = s.space === 'r' ? fullGrid.filter((_, i) => fullWindow[i] > 1e-15)
    : fullGrid.slice(Math.trunc(0.01 + s.kmin_A_inv / step), Math.trunc(0.01 + s.kmax_A_inv / step));
  if (!needed.length || k[0] > needed[0] + 1e-10 || k[k.length - 1] < needed[needed.length - 1] - 1e-10) {
    throw new RangeError('Input k data must cover the fit range and, for R fits, both Hanning tails.');
  }
  const transform = (values: number[]) => xftfFast(values.map((v, i) => v * window[i] * grid[i] ** s.kweight), s.nfft, step);
  const dataR = transform(data);
  const exponent = 2 * s.kweight + 1;
  const noiseScale = Math.PI * exponent / (step * (s.kmax_A_inv ** exponent - s.kmin_A_inv ** exponent));
  let epsilonK: number[], epsilonR: number;
  const supplied = request.options.epsilonK;
  if (supplied !== undefined) {
    if (typeof supplied === 'number') epsilonK = grid.map(() => positive(supplied, 'epsilonK'));
    else {
      if (supplied.length !== k.length) throw new RangeError('epsilonK must have the same length as the input k grid.');
      supplied.forEach(v => positive(v, 'epsilonK'));
      epsilonK = interpolate(k, supplied, grid);
    }
    // This arithmetic mean, including points outside the fit interval, is Larch's convention.
    epsilonR = epsilonK.reduce((sum, v) => sum + v, 0) / epsilonK.length / (2 * Math.sqrt(noiseScale));
  } else {
    if (s.rmax_A >= 15) throw new RangeError('Supply epsilonK when the fit overlaps the high-R noise interval.');
    const lo = Math.trunc(0.01 + 15 / rstep), hi = Math.min(s.nfft / 2, Math.trunc(1.01 + 30 / rstep));
    if (hi <= lo) throw new RangeError('The transform cannot resolve the high-R noise interval; supply epsilonK.');
    const windowMean = fullWindow.reduce((sum, v) => sum + v, 0) * step / (s.kmax_A_inv - s.kmin_A_inv);
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += dataR.real[i] ** 2 + dataR.imaginary[i] ** 2;
    epsilonR = Math.sqrt(sum / (2 * (hi - lo))) / windowMean;
    positive(epsilonR, 'Estimated noise; supply epsilonK for noiseless data');
    epsilonK = grid.map(() => epsilonR * Math.sqrt(2 * noiseScale));
  }
  const lo = Math.trunc(0.01 + (s.space === 'k' ? s.kmin_A_inv / step : s.rmin_A / rstep));
  const hi = Math.trunc(0.01 + (s.space === 'k' ? s.kmax_A_inv / step : s.rmax_A / rstep));
  const residual = (difference: number[]) => {
    if (s.space === 'k') return difference.slice(lo, hi).map((v, j) => v * grid[lo + j] ** s.kweight / epsilonK[lo + j]);
    const ft = transform(difference), out: number[] = [];
    for (let i = lo; i < hi; i++) out.push(ft.real[i] / epsilonR, ft.imaginary[i] / epsilonR);
    return out;
  };
  return { grid, data, dataR, window, rstep, epsilonK, epsilonR, transform, residual };
}

/** Bound-aware finite differences, in physical parameter coordinates. */
function jacobian(x: number[], base: number[], lower: number[], upper: number[], evaluate: (x: number[]) => number[]): Matrix {
  const jac = Matrix.zeros(base.length, x.length);
  for (let j = 0; j < x.length; j++) {
    const h = Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(x[j]));
    let plus = Math.min(x[j] + h, upper[j]), minus = Math.max(x[j] - h, lower[j]);
    const sample = (v: number) => {
      if (v === x[j]) return base;
      const trial = x.slice(); trial[j] = v;
      try { return evaluate(trial); } catch (error) { if (!(error instanceof RangeError)) throw error; return null; }
    };
    let high = sample(plus), low = sample(minus);
    if (!high) { high = base; plus = x[j]; }
    if (!low) { low = base; minus = x[j]; }
    if (plus === minus) throw new RangeError('Cannot evaluate a derivative within parameter bounds and the physical model domain.');
    for (let i = 0; i < base.length; i++) jac.set(i, j, (high[i] - low[i]) / (plus - minus));
  }
  return jac;
}

function normalizeJacobian(jac: Matrix) {
  const norms = Array.from({ length: jac.columns }, (_, j) => Math.sqrt(jac.getColumn(j).reduce((sum, v) => sum + v * v, 0)));
  const normalized = jac.clone();
  norms.forEach((norm, j) => { for (let i = 0; i < jac.rows; i++) normalized.set(i, j, jac.get(i, j) / (norm || 1)); });
  return { normalized, norms };
}

function minimize(initial: number[], lower: number[], upper: number[], evaluate: (x: number[]) => number[], settings: Settings) {
  let x = initial.slice(), residual = evaluate(x), cost = squaredNorm(residual), damping = 1e-3;
  let success = x.length === 0, message = success ? 'All parameters are fixed.' : 'Maximum iterations reached.', iterations = 0;
  for (; iterations < settings.maxIterations && !success; iterations++) {
    const jac = jacobian(x, residual, lower, upper, evaluate);
    const { normalized, norms } = normalizeJacobian(jac);
    const gradient = normalized.transpose().mmul(Matrix.columnVector(residual)).getColumn(0);
    // Active bounds satisfy the one-sided optimality condition. Other parameters can still move.
    for (let j = 0; j < x.length; j++) {
      if ((x[j] === lower[j] && gradient[j] > 0) || (x[j] === upper[j] && gradient[j] < 0)) {
        gradient[j] = 0;
        for (let i = 0; i < normalized.rows; i++) normalized.set(i, j, 0);
      }
    }
    if (Math.max(...gradient.map(Math.abs)) <= settings.tolerance * Math.max(1, Math.sqrt(cost))) {
      success = true; message = 'Projected gradient converged.'; break;
    }
    const curvature = normalized.transpose().mmul(normalized);
    let accepted = false, predicted = Infinity;
    for (let attempt = 0; attempt < 24; attempt++) {
      const damped = curvature.clone();
      for (let j = 0; j < x.length; j++) damped.set(j, j, damped.get(j, j) + damping);
      const step = solve(damped, Matrix.columnVector(gradient.map(v => -v))).getColumn(0);
      if (attempt === 0) {
        const curved = curvature.mmul(Matrix.columnVector(step)).getColumn(0);
        predicted = -step.reduce((sum, s, j) => sum + 2 * s * gradient[j] + s * curved[j], 0);
      }
      const trial = x.map((v, j) => Math.max(lower[j], Math.min(upper[j], v + step[j] / (norms[j] || 1))));
      let next: number[] | null = null;
      try { next = evaluate(trial); } catch (error) { if (!(error instanceof RangeError)) throw error; }
      const nextCost = next ? squaredNorm(next) : Infinity;
      if (next && nextCost < cost) {
        const improvement = cost - nextCost;
        const smallStep = trial.every((v, j) => Math.abs(v - x[j]) <= settings.tolerance * (1 + Math.abs(x[j])));
        x = trial; residual = next; cost = nextCost; accepted = true;
        damping = Math.max(1e-15, damping / 3);
        if (improvement <= settings.tolerance * Math.max(cost, 1e-30) || smallStep) {
          success = true; message = 'Levenberg-Marquardt converged.';
        }
        break;
      }
      damping *= 10;
    }
    // MINPACK's ftol test: a model reduction below the tolerance is already at the minimum to rounding.
    if (!accepted && predicted <= settings.tolerance * cost) {
      success = true; message = 'Levenberg-Marquardt converged (no further reduction possible).'; break;
    }
    if (!accepted) { message = 'No improving step found; inspect the start values, bounds and model.'; break; }
  }
  return { x, residual, cost, success, message, iterations };
}

function complexCurve(ft: { real: number[]; imaginary: number[] }, length: number): ExafsFitComplexCurve {
  const real = ft.real.slice(0, length), imaginary = ft.imaginary.slice(0, length);
  return { real, imaginary, magnitude: real.map((v, i) => Math.hypot(v, imaginary[i])) };
}

/** Fit a sum of explicit FEFF shells. Pure and deterministic; suitable for a Worker or Node. */
export function fitExafs(request: ExafsFitRequest): ExafsFitResult {
  const settings = settingsFor(request.options);
  const compiled = compileParameters(request.parameters, request.model);
  const { variableNames, lower, upper } = compiled, nVarys = variableNames.length;
  const nIdp = 2 * (settings.kmax_A_inv - settings.kmin_A_inv) * (settings.rmax_A - settings.rmin_A) / Math.PI
    + (settings.independentPoints === 'larch' ? 1 : 0);
  const degreesOfFreedom = nIdp - nVarys;
  if (degreesOfFreedom <= 0) throw new RangeError('The number of variables must be smaller than the number of independent points.');
  const data = prepareData(request, settings), paths = request.model.shells.flatMap(shell => shell.paths);
  const modelChi = (values: Values) => {
    const resolved = resolvePaths(request.model, values), sum = data.grid.map(() => 0);
    paths.forEach((path, j) => {
      const curve = chiPath(path, resolved[j].parameters, data.grid);
      curve.forEach((v, i) => { sum[i] += v * resolved[j].weight; });
    });
    if (!sum.every(Number.isFinite)) throw new RangeError('The model produced nonfinite chi; narrow the parameter bounds.');
    return sum;
  };
  let evaluations = 0;
  const evaluate = (x: number[]) => {
    evaluations++;
    const curve = modelChi(compiled.resolve(x));
    const residual = data.residual(data.data.map((v, i) => v - curve[i]));
    if (!residual.every(Number.isFinite) || !Number.isFinite(squaredNorm(residual))) throw new RangeError('Nonfinite fit residual.');
    return residual;
  };
  const transformedData = data.residual(data.data), nResiduals = transformedData.length;
  if (nResiduals <= nVarys) throw new RangeError('Too few residual samples for the requested variables and ranges.');
  const fit = minimize(compiled.initial, lower, upper, evaluate, settings);
  const values = compiled.resolve(fit.x);
  const resolvedPaths = resolvePaths(request.model, values);
  const atBounds = fit.x.map((v, j) => Math.min(Math.abs(v - lower[j]), Math.abs(v - upper[j])) <= 1e-7 * Math.max(1, Math.abs(v)));
  // Domain limits still constrain errors when the caller omitted an explicit bound.
  // Fixed zero disorder must not suppress errors on other, independent parameters.
  const physicalBoundary = (term: ExafsFitValue | undefined, distance: number) => {
    if (typeof term === 'string' && distance <= 1e-7) {
      compiled.sensitivities[term].forEach((v, j) => { if (v !== 0) atBounds[j] = true; });
    }
  };
  physicalBoundary(request.model.s02, resolvedPaths[0].parameters.s02);
  let pathIndex = 0;
  for (const shell of request.model.shells) {
    for (const path of shell.paths) {
      const resolved = resolvedPaths[pathIndex++].parameters;
      physicalBoundary(shell.sigma2_A2, resolved.sigma2_A2);
      physicalBoundary(shell.alpha ?? shell.deltar_A, path.reff + resolved.deltar_A);
    }
    if (typeof shell.thetaE_K === 'string') physicalBoundary(shell.thetaE_K, values[shell.thetaE_K]);
  }
  let covariance: number[][] | null = nVarys === 0 ? [] : null;
  let correlations: number[][] | null = nVarys === 0 ? [] : null;
  let uncertaintyStatus: ExafsFitResult['uncertaintyStatus'] = nVarys === 0 ? 'fixed' : 'estimated';
  const warnings: string[] = [];
  if (!fit.success) {
    uncertaintyStatus = 'not-converged'; warnings.push('The optimizer did not converge; standard errors are unavailable.');
  } else if (atBounds.some(Boolean)) {
    uncertaintyStatus = 'at-bound'; warnings.push('A variable is at a bound; symmetric standard errors are unavailable.');
  } else if (nVarys > 0) {
    const { normalized, norms } = normalizeJacobian(jacobian(fit.x, fit.residual, lower, upper, evaluate));
    const svd = new SingularValueDecomposition(normalized, { autoTranspose: true });
    const singular = svd.diagonal;
    if (norms.some(v => v === 0) || singular[singular.length - 1] <= singular[0] * 1e-9) {
      uncertaintyStatus = 'rank-deficient'; warnings.push('The Jacobian is rank deficient; some variables cannot be identified independently.');
    } else {
      // Larch propagate_uncertainties: raw (J^T J)^-1 * redchi_raw * nfree/(Nidp-P).
      // Since redchi_raw = SSE/nfree, the multiplier is SSE/(Nidp-P), NOT reducedChiSquare.
      const scale = fit.cost / degreesOfFreedom, vectors = svd.rightSingularVectors;
      const unscaled = norms.map((ni, i) => norms.map((nj, j) => {
        let sum = 0;
        for (let a = 0; a < nVarys; a++) sum += vectors.get(i, a) * vectors.get(j, a) / singular[a] ** 2;
        return sum / (ni * nj);
      }));
      covariance = unscaled.map(row => row.map(v => scale * v));
      // Correlation describes local sensitivity even when an exact synthetic fit has zero SSE.
      correlations = unscaled.map((row, i) => row.map((v, j) => {
        const denominator = Math.sqrt(unscaled[i][i] * unscaled[j][j]);
        return i === j ? 1 : Math.max(-1, Math.min(1, v / denominator));
      }));
    }
  }
  const parameters: ExafsFitResult['parameters'] = Object.fromEntries(compiled.names.map(name => {
    const derivative = compiled.sensitivities[name], varying = variableNames.includes(name);
    let stderr: number | null = derivative.every(v => v === 0) ? 0 : null;
    if (covariance && stderr !== 0) {
      let variance = 0;
      derivative.forEach((a, i) => derivative.forEach((b, j) => { variance += a * covariance![i][j] * b; }));
      stderr = Math.sqrt(Math.max(0, variance));
    }
    return [name, { value: values[name], stderr, varying, atBound: varying && atBounds[variableNames.indexOf(name)] }];
  }));
  const bestChi = modelChi(values), bestR = data.transform(bestChi);
  const outLength = Math.min(settings.nfft / 2, Math.trunc(1.01 + Math.max(10, settings.rmax_A) / data.rstep));
  const dataNorm = squaredNorm(transformedData), chiSquare = fit.cost * nIdp / nResiduals;
  return {
    success: fit.success, message: fit.message, iterations: fit.iterations, evaluations, parameters, variableNames,
    covariance, correlations, uncertaintyStatus, warnings, nIdp, nVarys, nResiduals, degreesOfFreedom,
    residualSumSquares: fit.cost, chiSquare, reducedChiSquare: chiSquare / degreesOfFreedom,
    rFactor: dataNorm > 0 ? fit.cost / dataNorm : null,
    epsilonK: data.epsilonK, epsilonR: data.epsilonR, noiseSource: request.options.epsilonK === undefined ? 'high-r' : 'supplied',
    settings, paths: resolvedPaths,
    curves: {
      // Copy the grid so cached trial-E0 interpolations in exafs.ts can be collected after this fit.
      k_A_inv: data.grid.slice(), dataChi: data.data, modelChi: bestChi,
      residualChi: data.data.map((v, i) => v - bestChi[i]), window: data.window,
      r_A: Array.from({ length: outLength }, (_, i) => i * data.rstep),
      dataR: complexCurve(data.dataR, outLength), modelR: complexCurve(bestR, outLength),
    },
    provenance: 'computed',
  };
}
