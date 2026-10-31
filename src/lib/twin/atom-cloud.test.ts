import { describe, expect, it } from 'vitest';
import { atomCloud, ionSubshells, shellCounts, slaterZeff, subshells } from './atom-cloud';

describe('the 3D atom of the story', () => {
  it('fills the shells as the ground states do, with the usual exceptions', () => {
    expect(shellCounts(8)).toEqual([2, 6]);
    expect(shellCounts(26)).toEqual([2, 8, 14, 2]);
    // Cu 3d10 4s1, Cr 3d5 4s1, Pd 4d10, Pt 5d9 6s1, Ce 4f1 5d1 6s2.
    expect(shellCounts(29)).toEqual([2, 8, 18, 1]);
    expect(shellCounts(24)).toEqual([2, 8, 13, 1]);
    expect(shellCounts(46)).toEqual([2, 8, 18, 18]);
    expect(shellCounts(78)).toEqual([2, 8, 18, 32, 17, 1]);
    expect(shellCounts(58)).toEqual([2, 8, 18, 19, 9, 2]);
    for (const Z of [3, 16, 22, 33, 42, 74, 82, 92]) expect(shellCounts(Z).reduce((a, b) => a + b, 0)).toBe(Z);
  });

  it('takes electrons from the outermost layer first when the atom gives them away', () => {
    const name = (Z: number, q: number) => ionSubshells(Z, q).map(s => `${s.n}${'spdf'[s.l]}${s.electrons}`).join(' ');
    // Cu+ 3d10, Cu2+ 3d9, Co3+ 3d6, Mn4+ 3d3: the 4s electrons go first.
    expect(name(29, 1)).toMatch(/3p6 3d10$/);
    expect(name(29, 2)).toMatch(/3p6 3d9$/);
    expect(name(27, 3)).toMatch(/3p6 3d6$/);
    expect(name(25, 4)).toMatch(/3p6 3d3$/);
    // The ion is smaller: the outer haze of copper metal (4s) is gone in Cu+.
    const outer = (q: number) => Math.max(...atomCloud(29, 1, 7, q).map(s => s.meanR_A));
    expect(outer(1)).toBeLessThan(0.6 * outer(0));
  });

  it('gives the textbook Slater charges', () => {
    // Zinc 4s: 30 - (0.35 + 18 x 0.85 + 10) = 4.35; zinc 3d: 30 - (9 x 0.35 + 18) = 8.85; copper 1s: 29 - 0.30.
    expect(slaterZeff(30, { n: 4, l: 0 })).toBeCloseTo(4.35, 6);
    expect(slaterZeff(30, { n: 3, l: 2 })).toBeCloseTo(8.85, 6);
    expect(slaterZeff(29, { n: 1, l: 0 })).toBeCloseTo(28.7, 6);
    expect(subshells(29).map(s => `${s.n}${'spdf'[s.l]}${s.electrons}`)).toEqual(['1s2', '2s2', '2p6', '3s2', '3p6', '4s1', '3d10']);
  });

  it('draws the innermost layer tens of times smaller than the atom, and the same cloud every time', () => {
    const cu = atomCloud(29, 40);
    const inner = cu.find(s => s.n === 1)!, outer = cu.find(s => s.n === 4)!;
    expect(inner.meanR_A).toBeCloseTo(0.028, 3);
    expect(outer.meanR_A / inner.meanR_A).toBeGreaterThan(50);
    expect(outer.meanR_A / inner.meanR_A).toBeLessThan(120);
    // The drawn electrons spread as the density says: their mean radius within 5 % of the Slater mean.
    const mean = (p: Float32Array) => { let s = 0; for (let i = 0; i < p.length; i += 3) s += Math.hypot(p[i], p[i + 1], p[i + 2]); return s / (p.length / 3); };
    expect(mean(inner.points) / inner.meanR_A).toBeGreaterThan(0.95);
    expect(mean(inner.points) / inner.meanR_A).toBeLessThan(1.05);
    expect(inner.points.length).toBe(2 * 40 * 3);
    expect(atomCloud(29, 40)[0].points).toEqual(inner.points);
  });
});
