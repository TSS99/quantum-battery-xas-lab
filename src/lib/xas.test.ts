import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from './scenario';
import { logisticEdge, mn3Fraction, mu, nominalMnOxidation, poisson, sampleCounts, scan, seededRandom, transmission } from './xas';

describe('charge balance and illustrative absorption', () => {
  it('balances Li_xMnO2 and bounds the two-valence mixture', () => {
    for (const x of [0, 0.13, 0.5, 0.97, 1]) {
      expect(x + nominalMnOxidation(x) - 4).toBeCloseTo(0, 12);
      expect(3 * mn3Fraction(x) + 4 * (1 - mn3Fraction(x))).toBeCloseTo(nominalMnOxidation(x), 12);
    }
    expect(() => nominalMnOxidation(1.1)).toThrow();
    expect(() => nominalMnOxidation(NaN)).toThrow();
  });

  it('makes only the feature-free edge monotonic and all full-model coefficients positive', () => {
    const edgeOnly = scan({ ...DEFAULT_STATE, whiteLine: 0, preEdge: 0, oscillation: 0 });
    expect(edgeOnly.energy_eV[0]).toBe(6530);
    expect(edgeOnly.energy_eV.at(-1)).toBe(6580);
    expect(edgeOnly.mu_cm_inv.every((value, i, values) => i === 0 || value >= values[i - 1])).toBe(true);
    const full = scan({ ...DEFAULT_STATE, oscillation: 0.3, whiteLine: 300, preEdge: 100 });
    expect(full.mu_cm_inv.every(value => Number.isFinite(value) && value > 0)).toBe(true);
    expect(logisticEdge(6550, 6550, 1)).toBe(0.5);
    expect(() => logisticEdge(6550, 6550, 0)).toThrow();
    expect(mu(6550, DEFAULT_STATE)).toBeGreaterThan(0);
  });
});

describe('attenuation and independent Poisson monitors', () => {
  it('converts um to cm and obeys Beer–Lambert with exact optical depth recovery', () => {
    const result = transmission(200, 50, 10000);
    expect(result.transmittance).toBeCloseTo(Math.exp(-1), 14);
    expect(Math.log(result.expectedIncident / result.expectedTransmitted)).toBeCloseTo(result.opticalDepth, 14);
    expect(result.absorbedFraction + result.transmittance).toBeCloseTo(1, 14);
    for (const thickness of [0, 1, 10, 1000]) {
      const point = transmission(200, thickness, 10000);
      expect(point.expectedTransmitted).toBeLessThanOrEqual(point.expectedIncident);
      expect(point.expectedTransmitted).toBeGreaterThanOrEqual(0);
    }
    expect(transmission(0, 10, 100).transmittance).toBe(1);
    expect(() => transmission(-1, 10, 100)).toThrow();
  });

  it('reproduces counts, preserves noisy ratios above one and makes zero-count logs undefined', () => {
    expect(sampleCounts(200, 50, 10000, 42)).toEqual(sampleCounts(200, 50, 10000, 42));
    const noisy = Array.from({ length: 100 }, (_, seed) => sampleCounts(0, 1, 10, seed));
    expect(noisy.some(count => (count.apparentTransmittance ?? 0) > 1 && (count.apparentMu ?? 0) < 0)).toBe(true);
    expect(sampleCounts(200, 1, 0, 42)).toMatchObject({ status: 'zero-incident', apparentTransmittance: null, apparentMu: null });
    expect(sampleCounts(1e8, 1000, 100000, 42)).toMatchObject({ transmitted: 0, status: 'zero-transmitted', apparentTransmittance: 0, apparentMu: null });
    expect(sampleCounts(200, 0, 100, 42).apparentMu).toBeNull();
  });

  it.each([3, 1000])('has the Poisson mean and variance for lambda=%i without Gaussian rounding', lambda => {
    const random = seededRandom(1234);
    const samples = Array.from({ length: 30000 }, () => poisson(lambda, random));
    const mean = samples.reduce((sum, count) => sum + count, 0) / samples.length;
    const variance = samples.reduce((sum, count) => sum + (count - mean) ** 2, 0) / (samples.length - 1);
    expect(samples.every(value => Number.isInteger(value) && value >= 0)).toBe(true);
    expect(Math.abs(mean - lambda)).toBeLessThan(5 * Math.sqrt(lambda / samples.length));
    expect(Math.abs(variance - lambda)).toBeLessThan(6 * lambda * Math.sqrt(2 / (samples.length - 1)));
  });
});
