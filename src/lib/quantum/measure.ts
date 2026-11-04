/**
 * A soft X-ray beamline measuring a computed oxygen K edge, and the fit that reads a measurement back (step 5 of
 * docs/PLAN-quantum.md; docs/QUANTUM_MEASURE.md).
 *
 * The sample's absorption is a library problem's exact stick spectrum, or a mixture of several, with the O 1s
 * lifetime width. A grating monochromator blurs it (Gaussian, FWHM = E / resolving power). The beamline records it in
 * total electron yield or in fluorescence yield, each point divided by the I0 mesh current, with Poisson counts and a
 * normalization noise; fluorescence from a concentrated oxide saturates. The dose is the surface dose of the scan.
 *
 * The fit finds the non-negative mixture of candidate spectra, a common energy shift and an extra Gaussian broadening
 * that match a measurement best (weighted least squares, NNLS at each shift and broadening), with the uncertainty of
 * each fraction. Fitting each candidate alone ranks them. Every number of the beamline is a model, not a facility's.
 */

import { guessColumns, parseBeamlineFile } from '../beamline-files';

export interface Sticks { centres_eV: readonly number[]; weights: readonly number[] }

/** Half width of the O 1s core hole lifetime broadening (a full width of about 0.15 eV). */
export const LIFETIME_HWHM_EV = 0.075;

/**
 * Li2MnO3 at the oxygen K edge, from the tabulated cross sections of xraydb (Elam, Ravel and Sieber 2002) at
 * 3.9 g/cm³: the mass attenuation coefficient above the edge, the share of it that is O 1s absorption, the ratio of
 * O 1s absorption to all other absorption (the edge jump, taken for the top of the spectrum), and the O K
 * fluorescence yield. The attenuation length above the edge is then about 280 nm.
 */
export const OXIDE = { muOverRho_cm2_g: 9180, oxygenShare: 0.77, jump: 3.3, fluorescenceYield: 0.0058 };

/** 1/e length of 530 eV X-rays in air at one atmosphere (xraydb): why the beam path and sample are in vacuum. */
export const AIR_LENGTH_MM = 0.66;

export type Detection = 'tey' | 'fy';

export interface Beamline {
  /** E / ΔE of the grating monochromator. */
  resolvingPower: number;
  /** Photons per second on the sample. */
  flux: number;
  dwell_s: number;
  detection: Detection;
  spot_um: readonly [number, number];
}

export const BEAMLINE: Beamline = { resolvingPower: 5000, flux: 1e11, dwell_s: 1, detection: 'tey', spot_um: [100, 50] };

/** Electrons per incident photon from the sample at the top of the edge (total electron yield), and from the I0 mesh. */
const TEY_YIELD = 0.01, MESH_YIELD = 0.01;
/** Fluorescence detector: solid angle over 4π, and efficiency at O Kα (525 eV). */
const SOLID_ANGLE = 0.01, DETECTOR_EFFICIENCY = 0.5;
/** Relative normalization noise of one point at 1 s dwell (beam motion, I0 normalization), falling as 1/√dwell. */
const NORMALIZATION_NOISE = 2e-3;
/**
 * Signal under the O 1s absorption, relative to its top, subtracted as a pre-edge line would be: in electron yield,
 * everything else that absorbs (1 / edge jump); in fluorescence, scatter and other lines in the detector window.
 */
const BACKGROUND: Record<Detection, number> = { tey: 1 / OXIDE.jump, fy: 0.05 };
const FINE_STEP = 0.02;

/** A spectrum on a fine uniform grid, to be read at any energy. */
export interface Profile { start: number; step: number; y: Float64Array }

/** Sticks broadened by a Lorentzian of half width `halfWidth` and a Gaussian of full width `fwhm`, from `from` to `to` eV. */
export function profile(s: Sticks, from: number, to: number, halfWidth: number, fwhm: number): Profile {
  return blur(lorentzian(s, from, to, halfWidth), fwhm);
}

function lorentzian(s: Sticks, from: number, to: number, halfWidth: number): Profile {
  const n = Math.round((to - from) / FINE_STEP) + 1;
  const y = new Float64Array(n), g2 = halfWidth * halfWidth;
  for (let k = 0; k < s.centres_eV.length; k++) {
    const w = s.weights[k] * halfWidth / Math.PI, c = s.centres_eV[k];
    if (w) for (let i = 0; i < n; i++) { const d = from + i * FINE_STEP - c; y[i] += w / (d * d + g2); }
  }
  return { start: from, step: FINE_STEP, y };
}

const blur = (p: Profile, fwhm: number): Profile => ({ ...p, y: gaussian(p.y, p.step, fwhm) });

/** Gaussian convolution of uniformly spaced values (the kernel renormalized at the ends). */
function gaussian(y: Float64Array, step: number, fwhm: number): Float64Array {
  if (fwhm <= 0) return y;
  const sigma = fwhm / 2.3548200450309493, half = Math.ceil(4 * sigma / step);
  const kernel = Float64Array.from({ length: 2 * half + 1 }, (_, i) => Math.exp(-0.5 * ((i - half) * step / sigma) ** 2));
  return Float64Array.from(y, (_, i) => {
    let sum = 0, norm = 0;
    for (let j = Math.max(-half, -i); j <= Math.min(half, y.length - 1 - i); j++) { sum += kernel[j + half] * y[i + j]; norm += kernel[j + half]; }
    return sum / norm;
  });
}

/** The profile at each energy, shifted by `shift` eV (linear interpolation, zero outside). */
export function at(p: Profile, energies: ArrayLike<number>, shift = 0): Float64Array {
  return Float64Array.from(energies, e => {
    const x = (e - shift - p.start) / p.step, i = Math.floor(x);
    if (i < 0 || i >= p.y.length - 1) return 0;
    return p.y[i] + (x - i) * (p.y[i + 1] - p.y[i]);
  });
}

/** Scan points every 0.1 eV, from 3 eV below the lowest edge to 17 eV above the highest. */
export function scanEnergies(edges_eV: readonly number[]): Float64Array {
  const from = Math.min(...edges_eV) - 3, to = Math.max(...edges_eV) + 17;
  return Float64Array.from({ length: Math.round((to - from) / 0.1) + 1 }, (_, i) => from + 0.1 * i);
}

/** Several spectra mixed by fraction of the oxygen atoms (their sticks are absorption per oxygen). */
export function mixture(parts: readonly { sticks: Sticks; fraction: number }[]): Sticks {
  return {
    centres_eV: parts.flatMap(p => [...p.sticks.centres_eV]),
    weights: parts.flatMap(p => p.sticks.weights.map(w => w * p.fraction)),
  };
}

/** Fluorescence yield of a thick sample, incidence and exit at 45°: absorption t (1 at the top) as the detector sees it, 1 at the top. */
export function saturate(t: number, jump = OXIDE.jump): number {
  return jump * t / (jump * t + 2) * (jump + 2) / jump;
}

/** Surface dose in MGy: photons × energy × mass attenuation / beam area. */
export function surfaceDose(photons: number, energy_eV: number, spot_um: readonly [number, number], muOverRho_cm2_g = OXIDE.muOverRho_cm2_g): number {
  const joules = photons * energy_eV * 1.602176634e-19, area_m2 = spot_um[0] * spot_um[1] * 1e-12;
  return joules * muOverRho_cm2_g * 0.1 / area_m2 / 1e6;
}

const normal = (random: () => number) => {
  let u = 0; while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
};
const poisson = (mean: number, random: () => number) => {
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(random)));
  let k = 0, p = Math.exp(-mean), sum = p;
  const u = random();
  while (u > sum) { k++; p *= mean / k; sum += p; }
  return k;
};

export interface Scan {
  energies: Float64Array;
  /** The sample's absorption as the monochromator passes it, 1 at the top. */
  truth: Float64Array;
  /** What the beamline records, normalized by I0, background subtracted, about 1 at the top. */
  measured: Float64Array;
  sigma: Float64Array;
  seconds: number;
  dose_MGy: number;
  /** Detected electrons or photons per point from the O 1s absorption at the top of the edge. */
  countsAtTop: number;
}

/** A scan of the sample over `energies` (eV); `sampleFwhm_eV` is broadening in the sample itself (vibrations, bands). */
export function measure(sample: Sticks, energies: Float64Array, beam: Beamline, random: () => number, sampleFwhm_eV = 0): Scan {
  const mid = energies[energies.length >> 1];
  const p = profile(sample, energies[0] - 5, energies[energies.length - 1] + 5, LIFETIME_HWHM_EV, Math.hypot(mid / beam.resolvingPower, sampleFwhm_eV));
  const absorbed = at(p, energies), top = Math.max(...absorbed);
  const truth = Float64Array.from(absorbed, y => y / top);
  const shape = beam.detection === 'tey' ? truth : Float64Array.from(truth, t => saturate(t));
  const photons = beam.flux * beam.dwell_s;
  const countsAtTop = photons * (beam.detection === 'tey' ? TEY_YIELD : OXIDE.oxygenShare * OXIDE.fluorescenceYield * SOLID_ANGLE * DETECTOR_EFFICIENCY);
  const mesh = photons * MESH_YIELD, norm = NORMALIZATION_NOISE / Math.sqrt(beam.dwell_s), background = BACKGROUND[beam.detection];
  const measured = new Float64Array(energies.length), sigma = new Float64Array(energies.length);
  for (let i = 0; i < energies.length; i++) {
    const total = background + shape[i], n = poisson(countsAtTop * total, random), n0 = poisson(mesh, random);
    measured[i] = n / countsAtTop / (n0 / mesh) * (1 + norm * normal(random)) - background;
    sigma[i] = Math.sqrt(total / countsAtTop + total ** 2 * (1 / mesh + norm * norm));
  }
  const seconds = energies.length * beam.dwell_s;
  return { energies, truth, measured, sigma, seconds, dose_MGy: surfaceDose(beam.flux * seconds, mid, beam.spot_um), countsAtTop };
}

/** Non-negative least squares, min ||Ax − b|| for x ≥ 0, over a few columns (Lawson and Hanson's active set method). */
export function nnls(a: readonly Float64Array[], b: Float64Array): Float64Array {
  const n = a.length, m = b.length, x = new Float64Array(n), passive: number[] = [];
  const dot = (u: Float64Array, v: Float64Array) => { let s = 0; for (let i = 0; i < m; i++) s += u[i] * v[i]; return s; };
  const gram = a.map(u => a.map(v => dot(u, v))), atb = a.map(u => dot(u, b));
  const solve = (set: number[]) => solveLinear(set.map(p => set.map(q => gram[p][q])), set.map(p => atb[p]));
  for (let iter = 0; iter < 3 * n + 10; iter++) {
    // The gradient of the residual, Aᵀ(b − Ax) = Aᵀb − AᵀA x.
    const w = atb.map((v, j) => v - gram[j].reduce((s, g, k) => s + g * x[k], 0));
    let best = -1;
    for (let j = 0; j < n; j++) if (!passive.includes(j) && w[j] > 1e-10 * Math.max(1, Math.abs(atb[j])) && (best < 0 || w[j] > w[best])) best = j;
    if (best < 0) break;
    passive.push(best);
    for (;;) {
      const z = solve(passive);
      if (z.every(v => v > 0)) { passive.forEach((j, p) => { x[j] = z[p]; }); break; }
      let alpha = 1;
      passive.forEach((j, p) => { if (z[p] <= 0) alpha = Math.min(alpha, x[j] / (x[j] - z[p])); });
      passive.forEach((j, p) => { x[j] += alpha * (z[p] - x[j]); });
      for (let p = passive.length - 1; p >= 0; p--) if (x[passive[p]] <= 1e-14) { x[passive[p]] = 0; passive.splice(p, 1); }
      if (!passive.length) break;
    }
  }
  return x;
}

/** Gauss Jordan elimination with partial pivoting. */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const k = rhs.length, a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = a[r][c] / a[c][c]; for (let q = c; q <= k; q++) a[r][q] -= f * a[c][q]; }
  }
  return a.map((row, i) => row[k] / row[i]);
}
const inverse = (matrix: number[][]) => matrix.map((_, j) => solveLinear(matrix, matrix.map((__, i) => +(i === j))));

export interface Measured { energies: ArrayLike<number>; measured: ArrayLike<number>; sigma?: ArrayLike<number> }

export interface FitOptions {
  /** Range of shifts applied to the candidates, in eV: searched at 0.5 eV, then at 0.05 eV around the best. */
  shifts: readonly [number, number];
  /** Extra Gaussian broadenings to try (full widths, eV). */
  broadenings: readonly number[];
  resolvingPower: number;
  /** Lorentzian half width of the candidates: the O 1s lifetime, or the quantum run's resolution η. */
  halfWidth_eV: number;
  /** Add a free constant and slope, for measured data. */
  background?: boolean;
}

export interface Fit {
  /** Fraction of the oxygen atoms in each candidate's environment, and its standard uncertainty. */
  fractions: number[];
  errors: number[];
  shift_eV: number;
  extraFwhm_eV: number;
  /** χ² per degree of freedom (with σ = 1 when the data carry none), and Σ(data − fit)² / Σ data². */
  chi2: number;
  rFactor: number;
  model: Float64Array;
}

/** The best non-negative mixture of the candidates for a measured spectrum, over shifts and extra broadenings. */
export function fit(data: Measured, candidates: readonly Sticks[], o: FitOptions): Fit {
  return fitProfiles(data, lorentzians(data, candidates, o), o);
}

/** Each candidate fitted alone, best first. */
export function rank(data: Measured, candidates: readonly Sticks[], o: FitOptions): { index: number; fit: Fit }[] {
  return lorentzians(data, candidates, o).map((p, index) => ({ index, fit: fitProfiles(data, [p], o) })).sort((a, b) => a.fit.chi2 - b.fit.chi2);
}

/** The candidates' Lorentzian spectra over every energy the shifts and broadenings can reach. */
function lorentzians(data: Measured, candidates: readonly Sticks[], o: FitOptions): Profile[] {
  const e = data.energies, widest = Math.max(...o.broadenings);
  const from = e[0] - o.shifts[1] - 5 - 2 * widest, to = e[e.length - 1] - o.shifts[0] + 5 + 2 * widest;
  return candidates.map(c => lorentzian(c, from, to, o.halfWidth_eV));
}

function fitProfiles(data: Measured, bases: readonly Profile[], o: FitOptions): Fit {
  const e = Float64Array.from(data.energies), y = Float64Array.from(data.measured), m = e.length;
  const sigma = data.sigma ? Float64Array.from(data.sigma) : new Float64Array(m).fill(1);
  const mid = e[m >> 1], span = (e[m - 1] - e[0]) || 1;
  const weighted = Float64Array.from(y, (v, i) => v / sigma[i]);
  const extra = o.background ? [1, -1].flatMap(sign => [Float64Array.from(e, () => sign), Float64Array.from(e, x => sign * (x - mid) / span)]) : [];
  const n = bases.length;
  let best = null as { chi2: number; shift: number; broadening: number; x: Float64Array; columns: Float64Array[] } | null;
  for (const broadening of o.broadenings) {
    const profiles = bases.map(p => blur(p, Math.hypot(mid / o.resolvingPower, broadening)));
    const scale = 1 / Math.max(...profiles.map(p => Math.max(...p.y)));
    const tryShift = (shift: number) => {
      const columns = [...profiles.map(p => at(p, e, shift).map(v => v * scale)), ...extra];
      const x = nnls(columns.map(col => Float64Array.from(col, (v, i) => v / sigma[i])), weighted);
      let chi2 = 0;
      for (let i = 0; i < m; i++) { let f = 0; for (let k = 0; k < columns.length; k++) f += x[k] * columns[k][i]; chi2 += ((y[i] - f) / sigma[i]) ** 2; }
      if (!best || chi2 < best.chi2) best = { chi2, shift, broadening, x, columns };
      return chi2;
    };
    let coarse = o.shifts[0], low = Infinity;
    for (let s = o.shifts[0]; s <= o.shifts[1] + 1e-9; s += 0.5) { const c = tryShift(s); if (c < low) { low = c; coarse = s; } }
    for (let s = Math.max(o.shifts[0], coarse - 0.5); s <= Math.min(o.shifts[1], coarse + 0.5) + 1e-9; s += 0.05) tryShift(Math.round(s * 100) / 100);
  }
  const { chi2, shift, broadening, x, columns } = best!;
  const dof = Math.max(1, m - columns.length - 2), reduced = chi2 / dof;
  const model = Float64Array.from(e, (_, i) => columns.reduce((s, col, k) => s + x[k] * col[i], 0));
  let rNum = 0, rDen = 0;
  for (let i = 0; i < m; i++) { rNum += (y[i] - model[i]) ** 2; rDen += y[i] ** 2; }
  // Covariance of the non-zero weights, (AᵀA)⁻¹ χ²_ν on the weighted columns, carried to the fractions.
  const active = [...x.keys()].filter(k => x[k] > 0);
  const weightedColumns = active.map(k => Float64Array.from(columns[k], (v, i) => v / sigma[i]));
  const cov = active.length ? inverse(weightedColumns.map(u => weightedColumns.map(v => u.reduce((s, ui, i) => s + ui * v[i], 0)))) : [];
  const total = x.slice(0, n).reduce((s, v) => s + v, 0) || 1;
  const fractions = Array.from(x.slice(0, n), v => v / total), errors = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let variance = 0;
    active.forEach((p, a) => active.forEach((q, b) => {
      if (p >= n || q >= n) return;
      const jp = ((p === i ? total : 0) - x[i]) / total ** 2, jq = ((q === i ? total : 0) - x[i]) / total ** 2;
      variance += jp * cov[a][b] * jq;
    }));
    errors[i] = Math.sqrt(Math.max(0, variance * reduced));
  }
  return { fractions, errors, shift_eV: shift, extraFwhm_eV: broadening, chi2: reduced, rFactor: rNum / rDen, model };
}

/** A scan as CSV, to save and load again. */
export function toCsv(scan: Scan, title: string): string {
  return [`# ${title}, simulated soft X-ray scan (XAS Lab quantum page)`, '# energy_eV,measured,sigma,truth',
    ...Array.from(scan.energies, (e, i) => `${e.toFixed(3)},${scan.measured[i].toPrecision(7)},${scan.sigma[i].toPrecision(4)},${scan.truth[i].toPrecision(7)}`)].join('\n') + '\n';
}

const SIGNAL = /^(measured|mu|norm|normalized|flat|tey|tfy|pfy|fy|absorption|xas|intensity|signal)$/;

/**
 * A measured spectrum from a text or XDI file: energy, and the column named like an absorption signal (else the first
 * other one), with a sigma column if there is one. Rows are sorted by energy and kept from 5 eV below the point where
 * the signal first reaches half its maximum to 20 eV above it, where the computed spectra hold their absorption.
 */
export function readSpectrum(text: string, name: string): Measured & { column: string } {
  const table = parseBeamlineFile(text, name), guess = guessColumns(table);
  const keys = table.labels.map(l => l.toLowerCase().replace(/[^a-z]/g, ''));
  const named = keys.findIndex((k, i) => i !== guess.energy && SIGNAL.test(k));
  const column = named >= 0 ? named : keys.findIndex((_, i) => i !== guess.energy);
  const sigmaColumn = keys.findIndex(k => k === 'sigma' || k === 'error' || k === 'stderr');
  if (column < 0) throw new Error('The file needs an energy column and a signal column.');
  const rows = table.columns[guess.energy].map((value, row) => ({
    e: guess.energyUnit === 'keV' ? value * 1000 : value, y: table.columns[column][row], s: sigmaColumn >= 0 ? table.columns[sigmaColumn][row] : 1,
  })).filter(r => Number.isFinite(r.e) && Number.isFinite(r.y) && r.s > 0).sort((a, b) => a.e - b.e);
  const top = Math.max(...rows.map(r => r.y)), low = Math.min(...rows.map(r => r.y));
  const rise = rows.find(r => r.y - low >= (top - low) / 2)?.e ?? rows[0]?.e;
  const kept = rows.filter(r => r.e >= rise - 5 && r.e <= rise + 20);
  if (kept.length < 16) throw new Error('The spectrum needs at least 16 points within 5 eV below and 20 eV above its edge.');
  return { energies: kept.map(r => r.e), measured: kept.map(r => r.y), sigma: sigmaColumn >= 0 ? kept.map(r => r.s) : undefined, column: table.labels[column] };
}
