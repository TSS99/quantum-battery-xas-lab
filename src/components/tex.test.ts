import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { formulaTex, texNum, unitTex } from './tex';

const parses = (source: string) => katex.renderToString(source, { throwOnError: true, strict: 'error' });

describe('number, unit and formula helpers', () => {
  it('writes exponents and thousands separators as LaTeX', () => {
    expect(texNum('1.000e-9')).toBe('1.000\\times10^{-9}');
    expect(texNum('2.5e+7')).toBe('2.5\\times10^{7}');
    expect(texNum('100,000')).toBe('100{,}000');
    expect(texNum('0.002000')).toBe('0.002000');
  });
  it('turns unit text into upright LaTeX units', () => {
    expect(unitTex('cm⁻¹')).toBe('\\mathrm{cm}^{-1}');
    expect(unitTex(' cm⁻¹ eV⁻¹')).toBe('\\mathrm{cm}^{-1}\\ \\mathrm{eV}^{-1}');
    expect(unitTex('g/cm³')).toBe('\\mathrm{g/cm}^{3}');
    expect(unitTex('μm')).toBe('\\mu\\mathrm{m}');
    expect(unitTex('%')).toBe('\\%');
    expect(unitTex('eV HWHM')).toBe('\\mathrm{eV}\\ \\mathrm{HWHM}');
    for (const u of ['cm⁻¹', 'eV⁻¹', 'photons', 'x', 'cm²', 'g/cm³', 'μm', '%', 'eV HWHM', 'cm⁻¹ eV⁻¹']) expect(() => parses(unitTex(u))).not.toThrow();
  });
  it('subscripts the counts in chemical formulas but not hydrate coefficients', () => {
    expect(formulaTex('Li0.5MnO2')).toBe('\\mathrm{Li_{0.5}MnO_{2}}');
    expect(formulaTex('Ca3(PO4)2')).toBe('\\mathrm{Ca_{3}(PO_{4})_{2}}');
    expect(formulaTex('CuSO4·5H2O')).toBe('\\mathrm{CuSO_{4}\\cdot 5H_{2}O}');
    for (const f of ['H2O', 'Fe2O3', 'CuSO4·5H2O', 'Li0.5MnO2']) expect(() => parses(formulaTex(f))).not.toThrow();
  });
});

// Every LaTeX string in the components must parse, and must keep its backslashes once JavaScript reads it.
const dir = join(process.cwd(), 'src/components');
const sources = readdirSync(dir).filter(f => f.endsWith('.tsx') && f !== 'tex.tsx').map(f => [f, readFileSync(join(dir, f), 'utf8')] as const);
const COMMAND = /(^|[^\\])\\(mu|mathrm|text|Delta|langle|rangle|hbar|eta|sigma|chi|pi|theta|omega|psi|sum|int|frac|le|ge|neq|pm|cdot|times|to|log|max|dagger|ldots|circ|quad)(?![a-zA-Z])/;
const literals = sources.flatMap(([file, text]) => [
  ...[...text.matchAll(/String\.raw`([^`]*)`/g)].map(m => ({ file, raw: true, body: m[1] })),
  // A JavaScript string (right after `{ ( ? : = ,`) that contains a double-escaped LaTeX command.
  ...[...text.replace(/String\.raw`[^`]*`/g, '').matchAll(/(?<=[{(?:=,]\s*)(['`])((?:(?!\1)[^\n\\]|\\.)*)\1/g)]
    .filter(m => /\\\\(?:[a-zA-Z]+|[{%,;! ])/.test(m[2]) && !/\\\\u[0-9a-f]{4}/i.test(m[2]))
    .map(m => ({ file, raw: false, body: m[2] })),
]);

describe('LaTeX in components', () => {
  it('finds the equations', () => expect(literals.length).toBeGreaterThan(80));
  it('has no LaTeX command that JavaScript would strip of its backslash', () => {
    for (const [file, text] of sources) {
      const plain = text.replace(/String\.raw`[^`]*`/g, '');
      for (const literal of plain.matchAll(/(['`])((?:(?!\1)[^\n\\]|\\.)*)\1/g)) expect(literal[2], file).not.toMatch(COMMAND);
    }
  });
  it.each(literals.map(l => [l.file, l.body, l]))('%s: %s', (_file, _body, l) => {
    const { raw, body } = l as (typeof literals)[number];
    const source = (raw ? body : body.replace(/\\\\/g, '\\')).replace(/\$\{[^}]*\}/g, '1');
    expect(() => parses(source)).not.toThrow();
  });
});
