import type { LabState } from './scenario';

export type XASParams = Pick<LabState, 'x' | 'edge' | 'shift' | 'width' | 'whiteLine' | 'preEdge' | 'oscillation'>;
export const SYNTHETIC_DISCLOSURE = 'Synthetic educational model. Shifts with lithium content are illustrative and are NOT quantitatively predictive data.';

function requireRange(value: number, low: number, high: number, name: string) {
  if (!Number.isFinite(value) || value < low || value > high) throw new Error(`${name} must be between ${low} and ${high}.`);
}

export function nominalMnOxidation(x: number): number {
  requireRange(x, 0, 1, 'Lithium content');
  return 4 - x;
}

export function mn3Fraction(x: number): number {
  requireRange(x, 0, 1, 'Lithium content');
  return x;
}

export function edgeEnergy(params: XASParams): number { return params.edge - params.shift * params.x; }

/** Pure monotonic edge. Full synthetic spectra also contain nonmonotonic features. */
export function logisticEdge(energy: number, edge: number, width: number): number {
  if (!Number.isFinite(energy) || !Number.isFinite(edge) || !Number.isFinite(width) || width <= 0) throw new Error('Invalid logistic edge parameters.');
  return 1 / (1 + Math.exp(-(energy - edge) / width));
}

/** Illustrative linear absorption coefficient in cm^-1; no structural inference. */
export function mu(energy: number, params: XASParams): number {
  requireRange(params.x, 0, 1, 'Lithium content');
  requireRange(params.oscillation, 0, 0.3, 'Oscillation');
  requireRange(params.whiteLine, 0, 300, 'White line');
  requireRange(params.preEdge, 0, 100, 'Pre-edge');
  const e0 = edgeEnergy(params);
  const post = Math.max(0, energy - e0);
  const modulation = 1 + params.oscillation * Math.sin(post * 0.8) * Math.exp(-post / 18);
  const preEdge = params.preEdge * Math.exp(-0.5 * ((energy - (e0 - 7)) / 0.8) ** 2);
  const whiteLine = params.whiteLine * Math.exp(-0.5 * ((energy - (e0 + 4)) / 1.8) ** 2);
  return 18 + 110 * logisticEdge(energy, e0, params.width) * modulation + preEdge + whiteLine;
}

export function scan(params: XASParams, step = 0.25): { energy_eV: number[]; mu_cm_inv: number[] } {
  requireRange(step, 0.01, 10, 'Scan step');
  const count = Math.ceil(50 / step);
  const energy_eV = Array.from({ length: count + 1 }, (_, i) => 6530 + Math.min(50, i * step));
  return { energy_eV, mu_cm_inv: energy_eV.map(energy => mu(energy, params)) };
}

export interface TransmissionResult {
  transmittance: number;
  absorbedFraction: number;
  expectedIncident: number;
  expectedTransmitted: number;
  opticalDepth: number;
}

export function transmission(muCmInv: number, thicknessUm: number, photons: number): TransmissionResult {
  requireRange(muCmInv, 0, 100000000, 'Absorption coefficient');
  requireRange(thicknessUm, 0, 1000000, 'Thickness');
  requireRange(photons, 0, 10000000, 'Incident photons');
  const opticalDepth = muCmInv * thicknessUm * 1e-4;
  const transmittance = Math.exp(-opticalDepth);
  return { transmittance, absorbedFraction: -Math.expm1(-opticalDepth), expectedIncident: photons, expectedTransmitted: photons * transmittance, opticalDepth };
}

/** Mulberry32. A fixed unsigned 32-bit seed reproduces simulated detector counts. */
export function seededRandom(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Seed must be an unsigned 32-bit integer.');
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function logFactorial(k: number): number {
  if (k < 32) {
    let result = 0;
    for (let i = 2; i <= k; i++) result += Math.log(i);
    return result;
  }
  // Stirling expansion: error below 2e-14 for the branch k >= 32.
  return (k + 0.5) * Math.log(k) - k + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * k) - 1 / (360 * k ** 3) + 1 / (1260 * k ** 5);
}

/** Poisson draws, not rounded Gaussian counts: Knuth + transformed rejection (PTRS). */
export function poisson(lambda: number, random: () => number): number {
  requireRange(lambda, 0, 10000000, 'Poisson mean');
  if (lambda === 0) return 0;
  if (lambda < 30) {
    const threshold = Math.exp(-lambda);
    let count = 0, product = 1;
    do { count++; product *= random(); } while (product > threshold);
    return count - 1;
  }
  const root = Math.sqrt(lambda);
  const b = 0.931 + 2.53 * root;
  const a = -0.059 + 0.02483 * b;
  const inverseAlpha = 1.1239 + 1.1328 / (b - 3.4);
  const vr = 0.9277 - 3.6224 / (b - 2);
  for (;;) {
    const u = random() - 0.5, v = random();
    const us = 0.5 - Math.abs(u);
    if (us === 0) continue;
    const k = Math.floor((2 * a / us + b) * u + lambda + 0.43);
    if (k < 0) continue;
    if (us >= 0.07 && v <= vr) return k;
    if (us < 0.013 && v > us) continue;
    if (Math.log(v * inverseAlpha / (a / (us * us) + b)) <= -lambda + k * Math.log(lambda) - logFactorial(k)) return k;
  }
}

export interface CountResult extends TransmissionResult {
  incident: number;
  transmitted: number;
  apparentTransmittance: number | null;
  apparentMu: number | null;
  status: 'ok' | 'zero-incident' | 'zero-transmitted';
}

/** Independent Poisson monitors may give It/I0 > 1. Such noisy ratios are not clipped. */
export function sampleCounts(muCmInv: number, thicknessUm: number, photons: number, seed: number): CountResult {
  const expected = transmission(muCmInv, thicknessUm, photons);
  const random = seededRandom(seed);
  const incident = poisson(photons, random);
  const transmitted = poisson(expected.expectedTransmitted, random);
  const status = incident === 0 ? 'zero-incident' : transmitted === 0 ? 'zero-transmitted' : 'ok';
  const apparentTransmittance = incident === 0 ? null : transmitted / incident;
  const apparentMu = status === 'ok' && thicknessUm > 0 ? Math.log(incident / transmitted) / (thicknessUm * 1e-4) : null;
  return { ...expected, incident, transmitted, apparentTransmittance, apparentMu, status };
}
