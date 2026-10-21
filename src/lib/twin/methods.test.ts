import { readFileSync } from 'node:fs';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { TWIN_ATTRIBUTIONS, TWIN_METHODS } from './methods';

/** Typesets every $...$ span of a prose string and fails on any KaTeX error. */
function typesets(text: string) {
  expect(text.split('$').length % 2, `unbalanced $ in: ${text}`).toBe(1);
  for (const span of text.split('$').filter((_, i) => i % 2)) {
    expect(() => katex.renderToString(span, { throwOnError: true, strict: 'error' }), span).not.toThrow();
  }
}

describe('twin Methods table', () => {
  it('names only tests that exist, so a renamed or deleted test cannot leave a row unbacked', () => {
    for (const row of TWIN_METHODS) {
      expect(row.tests.length, row.quantity).toBeGreaterThan(0);
      for (const ref of row.tests) {
        const source = readFileSync(ref.file, 'utf8');
        expect(source.includes(ref.name), `${row.quantity}: "${ref.name}" in ${ref.file}`).toBe(true);
      }
    }
  });

  it('typesets every formula and keeps one row per quantity', () => {
    for (const row of TWIN_METHODS) for (const text of [row.quantity, row.model, row.data, row.checked, row.tolerance]) typesets(text);
    expect(new Set(TWIN_METHODS.map(row => row.quantity)).size).toBe(TWIN_METHODS.length);
  });

  it('credits the data and code the twin uses, with links', () => {
    for (const a of TWIN_ATTRIBUTIONS) expect(a.url).toMatch(/^https:\/\//);
    expect(TWIN_ATTRIBUTIONS.map(a => a.name).join(' ')).toMatch(/XrayDB.*xraylarch.*FEFF6L/);
  });
});
