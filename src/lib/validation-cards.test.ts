import { describe, expect, it } from 'vitest';
import { buildValidationCards, matchingDigits } from './validation-cards';

describe('validation cards', () => {
  it('counts matching digits and caps them', () => {
    expect(matchingDigits(1e-3, 8)).toBeCloseTo(3);
    expect(matchingDigits(0, 8)).toBe(8);
    expect(matchingDigits(1e-20, 8)).toBe(8);
    expect(matchingDigits(2, 8)).toBe(0);
  });
  it('builds three cards from real data with bars inside 0..1', async () => {
    const cards = await buildValidationCards();
    expect(cards.map(c => c.id)).toEqual(['xraydb', 'coverage', 'solver']);
    for (const card of cards) for (const row of card.rows) {
      expect(row.bar).toBeGreaterThanOrEqual(0);
      expect(row.bar).toBeLessThanOrEqual(1);
      expect(row.value).not.toMatch(/NaN|undefined/);
      expect(row.value).toMatch(/^(0|\d\.\d\\times10\^\{-?\d+\}|\d+)$/);
    }
    const coverage = cards[1].rows;
    expect(Number(coverage[0].value)).toBe(98);
  }, 30000);
});
