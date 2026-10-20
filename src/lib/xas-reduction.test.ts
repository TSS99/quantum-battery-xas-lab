import { describe, expect, it } from 'vitest';
import examples from '../data/xas-reduction/examples.json';
import larch from '../data/xas-reduction/larch-reference.json';
import { parseBeamlineFile } from './beamline-files';
import { LARCH_PORT_VERSION, findE0, gradient, indexNearest, indexOf, interpolate, mergeScans, polyfit, preEdge, removeDups, roundHalfEven, type PreEdgeParams } from './xas-reduction';

/**
 * Reference values come from xraylarch itself (scripts/make-xas-reduction-fixtures.py, versions in
 * larch-reference.json). Tolerances are set a little above the agreement observed with the fixtures
 * and xraylarch 2026.3.1 (stated per test); the fixtures store numbers with 12 significant digits.
 */
const fe = larch.feScans.map((scan, i) => {
  const table = parseBeamlineFile(examples.files[i].text, examples.files[i].name);
  return { ...scan, energy: table.columns[0] };
});
const cuTable = parseBeamlineFile(examples.files[3].text, examples.files[3].name);
const maxAbs = (a: number[], b: number[]) => { expect(a.length).toBe(b.length); return Math.max(...a.map((value, i) => Math.abs(value - b[i]))); };

describe('Larch helpers', () => {
  it('names the Larch release the fixtures came from', () => {
    expect(LARCH_PORT_VERSION).toBe(larch.versions.xraylarch);
  });
  it('rounds exact halves to even like Python round()', () => {
    expect([0.5, 1.5, 2.5, -2.5, -0.5, 2.4, -2.6].map(roundHalfEven)).toEqual([0, 2, 2, -2, -0, 2, -3]);
  });
  it('index_of returns the last index at or below the value; index_nearest the first nearest', () => {
    const x = [1, 2, 3, 4];
    expect([0.5, 1, 2.5, 4, 9].map(value => indexOf(x, value))).toEqual([0, 0, 1, 3, 3]);
    expect([0.5, 2.5, 2.6, 9].map(value => indexNearest(x, value))).toEqual([0, 1, 2, 3]);
  });
  it('remove_dups raises a repeated value by tiny and leaves distinct values alone', () => {
    expect(removeDups([1, 2, 2, 2, 3], 0.01)).toEqual([1, 2, 2.01, 2.02, 3]);
    expect(removeDups([1, 2, 3], 0.01)).toEqual([1, 2, 3]);
  });
  it('gradient matches numpy.gradient with unit spacing', () => {
    expect(gradient([1, 4, 9, 16])).toEqual([3, 4, 6, 7]);
  });
  it('polyfit reproduces an exact cubic at 7 keV', () => {
    const x = Array.from({ length: 40 }, (_, i) => 7000 + 10 * i), cubic = (e: number) => 2 - 1e-3 * (e - 7100) + 3e-6 * (e - 7100) ** 2 - 4e-9 * (e - 7100) ** 3;
    const fit = polyfit(x, x.map(cubic), 3);
    for (const e of [6990, 7123.4, 7400]) expect(fit.evaluate(e)).toBeCloseTo(cubic(e), 10);
  });
  it('not-a-knot cubic interpolation is exact for a cubic, linear for a line', () => {
    const x = [0, 1, 2.5, 3, 4.2, 6], f = (v: number) => v ** 3 - 2 * v;
    const values = interpolate(x, x.map(f), [0.3, 2.7, 5.9, 6.5, -0.4], 'cubic');
    [0.3, 2.7, 5.9, 6.5, -0.4].forEach((v, i) => expect(values[i]).toBeCloseTo(f(v), 10));
    expect(interpolate([0, 2, 4], [1, 5, 9], [1, 3, 5, -1])).toEqual([3, 7, 11, -1]);
  });
});

describe('find_e0 against Larch', () => {
  // Observed: identical to Larch (E0 is one of the energy grid points) for the foil and sample
  // curves of the three Fe scans, the Cu scan and the merged Fe curve.
  it('finds the reference-foil and sample E0 of every Fe scan', () => {
    for (const scan of fe) {
      expect(findE0(scan.energy, scan.mu_ref)).toBeCloseTo(scan.e0_ref, 6);
      expect(findE0(scan.energy, scan.mu)).toBeCloseTo(scan.e0_sample, 6);
    }
  });
  it('finds the Cu foil and fluorescence E0', () => {
    const energy = cuTable.columns[0];
    expect(findE0(energy, larch.cu.mu_ref)).toBeCloseTo(larch.cu.e0_ref, 6);
    expect(findE0(energy, larch.cu.mu)).toBeCloseTo(larch.cu.e0_sample, 6);
  });
  it('rejects curves that are too short or not finite', () => {
    expect(() => findE0([1, 2, 3], [1, 2, 3])).toThrow(/at least 16/);
    expect(() => findE0(Array.from({ length: 20 }, (_, i) => i), Array.from({ length: 20 }, (_, i) => i === 5 ? NaN : i))).toThrow(/finite/);
  });
});

describe('merge_groups against Larch', () => {
  const groups = fe.map(scan => ({ energy: scan.energy.map(value => value + scan.shift_eV), mu: scan.mu }));
  // Observed max |difference| (xraylarch 2026.3.1): energy 9e-13 eV, mu 8e-12 (cubic) and 7e-12
  // (linear), std 4e-12: the 12-digit rounding of the stored inputs and outputs.
  it('merges the three calibrated Fe scans with cubic interpolation', () => {
    const merged = mergeScans(groups);
    expect(merged.kind).toBe('cubic');
    expect(maxAbs(merged.energy, larch.merge.energy)).toBeLessThan(1e-9);
    expect(maxAbs(merged.mu, larch.merge.mu)).toBeLessThan(1e-10);
    expect(maxAbs(merged.std, larch.merge.mu_std)).toBeLessThan(1e-10);
    expect(findE0(merged.energy, merged.mu)).toBeCloseTo(larch.merge.e0, 6);
  });
  it('merges with linear interpolation', () => {
    const merged = mergeScans(groups, 'linear');
    expect(maxAbs(merged.energy, larch.merge.linear.energy)).toBeLessThan(1e-9);
    expect(maxAbs(merged.mu, larch.merge.linear.mu)).toBeLessThan(1e-10);
    expect(maxAbs(merged.std, larch.merge.linear.mu_std)).toBeLessThan(1e-10);
  });
});

describe('pre_edge against Larch', () => {
  const inputs: Record<string, { energy: number[]; mu: number[] }> = {
    'merged-defaults': { energy: larch.merge.energy, mu: larch.merge.mu },
    'merged-custom': { energy: larch.merge.energy, mu: larch.merge.mu },
    'merged-step': { energy: larch.merge.energy, mu: larch.merge.mu },
    'merged-constant-pre': { energy: larch.merge.energy, mu: larch.merge.mu },
    'merged-norm2-340': { energy: larch.merge.energy, mu: larch.merge.mu },
    'merged-norm2-40': { energy: larch.merge.energy, mu: larch.merge.mu },
    'ref-scan1-defaults': { energy: fe[0].energy, mu: fe[0].mu_ref },
    'cu-calibrated-defaults': { energy: cuTable.columns[0].map(value => value + larch.cu.shift_eV), mu: larch.cu.mu },
  };
  for (const [name, expected] of Object.entries(larch.preEdge)) {
    // Observed over all eight cases: e0 and the ranges equal to 1e-12 eV, edge_step within 1.3e-12
    // relative, pre_edge 9e-13, post_edge 7e-12, norm and flat 1.2e-11 (12-digit fixture rounding).
    it(`matches ${name}: ${expected.call}`, () => {
      const { energy, mu } = inputs[name];
      const result = preEdge(energy, mu, expected.params as PreEdgeParams);
      expect(result.e0).toBeCloseTo(expected.e0, 9);
      expect(Math.abs(result.edgeStep / expected.edge_step - 1)).toBeLessThan(1e-9);
      for (const key of ['pre1', 'pre2', 'norm1', 'norm2'] as const) expect(result[key]).toBeCloseTo(expected[key], 9);
      expect(result.nnorm).toBe(expected.nnorm);
      expect(result.nvict).toBe(expected.nvict);
      expect(maxAbs(result.preEdge, expected.pre_edge)).toBeLessThan(1e-9);
      expect(maxAbs(result.postEdge, expected.post_edge)).toBeLessThan(1e-9);
      expect(maxAbs(result.norm, expected.norm)).toBeLessThan(1e-9);
      expect(maxAbs(result.flat, expected.flat)).toBeLessThan(1e-9);
    });
  }
  it('uses a constant pre-edge when fewer than three points fall in the pre-edge range', () => {
    const result = preEdge(larch.merge.energy, larch.merge.mu, { pre1: -60, pre2: -45, nvict: 1 });
    expect(result.npre).toBe(0);
    expect(new Set(result.preEdge).size).toBe(1);
  });
  it('explains a post-edge range that cannot be fitted', () => {
    expect(() => preEdge([1, 2, 3], [1, 2, 3])).toThrow(/at least 16/);
  });
});
