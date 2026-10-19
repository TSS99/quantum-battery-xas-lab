import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { hamiltonianTex } from './quantum-panel';

describe('displayed Hamiltonian coefficients', () => {
  it('keeps small coefficients and their signs instead of rounding them to zero', () => {
    const formula = hamiltonianTex([
      { label: 'ZI', coefficient: 0.00001 },
      { label: 'IX', coefficient: -1.25e-8 },
      { label: 'II', coefficient: 0 },
    ]);
    expect(formula).toBe(String.raw`H = 0.00001\,Z_{0} - 1.25\times10^{-8}\,X_{1} + 0\,I`);
    expect(() => katex.renderToString(formula, { throwOnError: true, strict: 'error' })).not.toThrow();
  });

  it('preserves supplied precision and the most-significant-qubit ordering', () => {
    const formula = hamiltonianTex([
      { label: 'YIIIXZ', coefficient: -0.123456789 },
      { label: 'IIIIII', coefficient: 100 },
    ]);
    expect(formula).toBe(String.raw`H = - 0.123456789\,Y_{0}X_{4}Z_{5} + 100\,I`);
    expect(() => katex.renderToString(formula, { throwOnError: true, strict: 'error' })).not.toThrow();
  });
});
