import { readFileSync } from 'node:fs';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { QUANTUM_METHODS } from './methods';

function typesets(text: string) {
  expect(text.split('$').length % 2, `unbalanced $ in: ${text}`).toBe(1);
  for (const span of text.split('$').filter((_, i) => i % 2)) {
    expect(() => katex.renderToString(span, { throwOnError: true, strict: 'error' }), span).not.toThrow();
  }
}

describe('quantum Methods table', () => {
  it('names only tests that exist, Python ones included', () => {
    for (const row of QUANTUM_METHODS) {
      expect(row.tests.length, row.quantity).toBeGreaterThan(0);
      for (const ref of row.tests) expect(readFileSync(ref.file, 'utf8').includes(ref.name), `${row.quantity}: "${ref.name}" in ${ref.file}`).toBe(true);
    }
  });

  it('typesets every formula and keeps one row per quantity', () => {
    for (const row of QUANTUM_METHODS) for (const text of [row.quantity, row.model, row.data, row.checked, row.tolerance]) typesets(text);
    expect(new Set(QUANTUM_METHODS.map(row => row.quantity)).size).toBe(QUANTUM_METHODS.length);
  });
});
