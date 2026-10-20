import { describe, expect, it } from 'vitest';
import fixtures from '@/data/exafs-larch-fixtures.json';
import { EXAFS_KSTEP, EXAFS_NFFT, autobk, ftWindow, preEdge, processExafs, xftf } from './exafs';

type FixtureCase = (typeof fixtures.cases)[number];

const maxAbsDifference = (actual: number[], expected: number[]) => actual.reduce((largest, value, i) => Math.max(largest, Math.abs(value - expected[i])), 0);
const rmse = (actual: number[], expected: number[]) => Math.sqrt(actual.reduce((sum, value, i) => sum + (value - expected[i]) ** 2, 0) / actual.length);

describe('Larch-compatible EXAFS Fourier transform', () => {
  it.each(fixtures.cases)('matches xraylarch 2026.3.1 xftf for $name', fixture => {
    const reference = fixture as FixtureCase;
    const result = xftf(reference.autobk.k, reference.autobk.chi, {
      kmin: 2,
      kmax: 14,
      kweight: 2,
      dk: 1,
      window: 'hanning',
      rmax: 10,
      nfft: EXAFS_NFFT,
      kstep: EXAFS_KSTEP,
    });
    expect(result.deltaR).toBeCloseTo(Math.PI / (2048 * 0.05), 14);
    expect(maxAbsDifference(result.kwin, reference.xftf.kwin)).toBeLessThan(2e-13);
    expect(maxAbsDifference(result.real, reference.xftf.chir_re)).toBeLessThan(2e-12);
    expect(maxAbsDifference(result.imaginary, reference.xftf.chir_im)).toBeLessThan(2e-12);
    expect(maxAbsDifference(result.magnitude, reference.xftf.chir_mag)).toBeLessThan(2e-12);
  });

  it('implements every exposed Larch window without non-finite values', () => {
    const k = Array.from({ length: 321 }, (_, i) => i * 0.05);
    for (const window of ['hanning', 'kaiser', 'parzen', 'welch', 'sine', 'gaussian'] as const) {
      const values = ftWindow(k, { xmin: 2, xmax: 14, dx: 1, window });
      expect(values).toHaveLength(k.length);
      expect(values.every(Number.isFinite)).toBe(true);
      expect(Math.max(...values)).toBeLessThanOrEqual(1 + 1e-12);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(-1e-12);
    }
  });
});

describe('Larch-compatible AUTOBK', () => {
  it.each(fixtures.cases)('matches the stored xraylarch output for $name', fixture => {
    const reference = fixture as FixtureCase;
    const result = autobk(reference.input.energy_eV, reference.input.mu, {
      e0: reference.input.e0_eV,
      edgeStep: reference.input.edge_step,
      rbkg: 1,
      kmin: 0,
      kmax: 14,
      kweight: 1,
      dk: 0.1,
      window: 'hanning',
      nfft: 2048,
      kstep: 0.05,
      nclamp: 3,
      clampLow: 0,
      clampHigh: 1,
    });
    const chiMax = maxAbsDifference(result.chi, reference.autobk.chi);
    const chiRmse = rmse(result.chi, reference.autobk.chi);
    const backgroundMax = maxAbsDifference(result.bkg, reference.autobk.bkg);
    console.info(`${reference.name}: AUTOBK max |dchi|=${chiMax}, chi RMSE=${chiRmse}, max |dbkg|=${backgroundMax}, iterations=${result.iterations}`);
    expect(result.nknots).toBe(reference.autobk.nknots);
    expect(result.k).toEqual(reference.autobk.k);
    // Observed on both fixtures: <= 4.8e-10 RMSE and <= 2.92e-9 maximum.
    // The 5e-9 absolute limit leaves room for JavaScript-engine rounding while
    // remaining far below experimental EXAFS noise or display resolution.
    expect(chiRmse).toBeLessThan(1e-9);
    expect(chiMax).toBeLessThan(5e-9);
    expect(backgroundMax / reference.input.edge_step).toBeLessThan(5e-9);
  });

  it('rejects a deliberately broken amplitude at the fixture tolerance', () => {
    const reference = fixtures.cases[0] as FixtureCase;
    const broken = reference.autobk.chi.map(value => value * 1.1);
    expect(rmse(broken, reference.autobk.chi)).toBeGreaterThan(1e-9);
  });

  it('derives a finite positive edge step without changing the input arrays', () => {
    const reference = fixtures.cases[1] as FixtureCase;
    const energy = [...reference.input.energy_eV], mu = [...reference.input.mu];
    const automatic = preEdge(energy, mu);
    const result = preEdge(energy, mu, reference.input.e0_eV);
    expect(automatic.e0).toBeCloseTo(reference.input.e0_eV, 0);
    expect(result.e0).toBe(reference.input.e0_eV);
    expect(result.edgeStep).toBeGreaterThan(0);
    expect(result.preEdge).toHaveLength(energy.length);
    expect(result.postEdge).toHaveLength(energy.length);
    expect(energy).toEqual(reference.input.energy_eV);
    expect(mu).toEqual(reference.input.mu);
  });

  it('runs the worker-facing automatic reduction path end to end', () => {
    const reference = fixtures.cases[0] as FixtureCase;
    const result = processExafs(reference.input.energy_eV, reference.input.mu, {
      rbkg: 1,
      kmin: 2,
      kmax: 14,
      kweight: 2,
      dk: 1,
      window: 'hanning',
    });
    expect(result.preEdge.e0).toBeCloseTo(reference.input.e0_eV, 0);
    expect(result.autobk.chi.length).toBeGreaterThan(200);
    expect(result.xftf.r.length).toBeGreaterThan(100);
    expect(result.xftf.magnitude.every(Number.isFinite)).toBe(true);
    expect(result.parameters).toMatchObject({ kstep: 0.05, nfft: 2048 });
  });
});
