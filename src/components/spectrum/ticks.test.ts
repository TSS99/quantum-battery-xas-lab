import { describe, expect, it } from 'vitest';
import { niceTicks, tickLabel } from './ticks';

describe('plot ticks', () => {
  it('fall on round values: 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceTicks(-2.148, 2.3, 5)).toEqual({ values: [-2, -1, 0, 1, 2], step: 1 });
    expect(niceTicks(0, 13, 7).values).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(niceTicks(0, 2.1, 5).step).toBe(0.5);
    expect(niceTicks(0, 1, 5).step).toBe(0.25);
  });

  it('are labelled with the decimals the step needs and a real minus sign', () => {
    expect(tickLabel(-1, 1)).toBe('−1');
    expect(tickLabel(0.5, 0.5)).toBe('0.5');
    expect(tickLabel(0.25, 0.25)).toBe('0.25');
    expect(tickLabel(2.5, 2.5)).toBe('2.5');
    expect(tickLabel(25, 25)).toBe('25');
  });
});
