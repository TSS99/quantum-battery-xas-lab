import { describe, expect, it } from 'vitest';
import { seededRandom } from './xas';

describe('seeded random numbers', () => {
  it('repeats for the same seed, stays in [0, 1) and differs between seeds', () => {
    const a = seededRandom(1234), b = seededRandom(1234), c = seededRandom(1235);
    const first = Array.from({ length: 1000 }, () => a());
    expect(first).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(first.every(x => x >= 0 && x < 1)).toBe(true);
    expect(Array.from({ length: 10 }, () => c())).not.toEqual(first.slice(0, 10));
    const mean = first.reduce((s, x) => s + x, 0) / first.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
  });

  it('accepts only unsigned 32-bit seeds', () => {
    expect(() => seededRandom(4294967295)).not.toThrow();
    for (const seed of [-1, 1.5, 4294967296, Number.NaN]) expect(() => seededRandom(seed)).toThrow();
  });
});
