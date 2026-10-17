import { describe, expect, it } from 'vitest';
import { compareSpectra, ranks, similarityMetrics } from './comparison';
import type { Spectrum } from './spectra';
const curve = (energy_eV: number[], mu_cm_inv: number[]): Spectrum => ({ id: 'test', name: 'test', provenance: 'imported', energy_eV, mu_cm_inv });
describe('explicit-window spectral scores', () => {
  it('scores identical and scaled shapes and handles constant arrays', () => {
    expect(similarityMetrics([1, 2, 3], [1, 2, 3])).toEqual({ cosine: 1, pearson: 1, spearman: 1 });
    expect(similarityMetrics([1, 2, 3], [2, 4, 6]).cosine).toBeCloseTo(1, 12);
    expect(similarityMetrics([1, 2, 3], [3, 2, 1]).pearson).toBe(-1);
    expect(similarityMetrics([1, 1, 1], [1, 2, 3]).pearson).toBeNull();
    expect(similarityMetrics([0, 0, 0], [1, 2, 3]).cosine).toBeNull();
  });
  it('uses average ranks for ties', () => {
    expect(ranks([8, 2, 2, 4])).toEqual([4, 1.5, 1.5, 3]);
    expect(similarityMetrics([1, 1, 2, 3], [4, 4, 7, 9]).spearman).toBeCloseTo(1, 12);
  });
  it('aligns one energy shift without changing raw arrays', () => {
    const r = curve([0, 1, 2, 3, 4, 5], [1, 2, 4, 3, 8, 7]);
    const t = curve([2, 3, 4, 5, 6, 7], [1, 2, 4, 3, 8, 7]);
    const before = JSON.stringify(t), score = compareSpectra(r, t, -2, [0, 5]);
    expect(score.rmse).toBe(0); expect(score.relativeL1).toBe(0); expect(score.cosine).toBe(1);
    expect(JSON.stringify(t)).toBe(before); expect(score.window).toEqual([0, 5]);
  });
  it('interpolates only within the shared range and reports the actual window', () => {
    const r = curve([0, 2, 4, 6, 8], [0, 4, 8, 12, 16]), t = curve([1, 2, 3, 4, 5, 6, 7], [2, 4, 6, 8, 10, 12, 14]);
    expect(compareSpectra(r, t, 0, [1, 6]).rmse).toBe(0);
    expect(compareSpectra(r, t, 0, [1, 6]).energies).toHaveLength(6);
    expect(() => compareSpectra(r, t, 100, [0, 40])).toThrow('overlapping');
    expect(() => compareSpectra(r, t, NaN, [0, 40])).toThrow('Shift');
  });
});
