import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import katex from 'katex';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { COMPOUND_PRESETS } from '../data/compound-presets';
import { describe, expect, it } from 'vitest';
import { Num, ScienceText, Tex, formulaTex, texNum, unitTex } from './tex';

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
    expect(unitTex('g/cm³')).toBe('\\mathrm{g}/\\mathrm{cm}^{3}');
    expect(unitTex('μm')).toBe('\\mu\\mathrm{m}');
    expect(unitTex('µm')).toBe(unitTex('μm'));
    expect(unitTex('Å⁻¹')).toBe('\\mathring{\\mathrm{A}}^{-1}');
    expect(unitTex('cm^-1')).toBe(unitTex('cm⁻¹'));
    expect(unitTex('eV^-1')).toBe(unitTex('eV⁻¹'));
    expect(unitTex('%')).toBe('\\%');
    expect(unitTex('eV HWHM')).toBe('\\mathrm{eV}\\ \\mathrm{HWHM}');
    for (const u of ['°C', 'Å', 'Å⁻¹', 'µm', 'cm^-1', 'eV^-1', 'cm⁻¹', 'eV⁻¹', 'photons', 'x', 'cm²', 'g/cm³', 'μm', '%', 'eV HWHM', 'cm⁻¹ eV⁻¹']) expect(() => parses(unitTex(u))).not.toThrow();
  });
  it('subscripts the counts in chemical formulas but not hydrate coefficients', () => {
    expect(formulaTex('Li0.5MnO2')).toBe('\\mathrm{Li_{0.5}MnO_{2}}');
    expect(formulaTex('Ca3(PO4)2')).toBe('\\mathrm{Ca_{3}(PO_{4})_{2}}');
    expect(formulaTex('CuSO4·5H2O')).toBe('\\mathrm{CuSO_{4}\\cdot 5H_{2}O}');
    for (const f of ['H2O', 'Fe2O3', 'CuSO4·5H2O', 'Li0.5MnO2']) expect(() => parses(formulaTex(f))).not.toThrow();
  });
});

describe('rendered scientific text', () => {
  it('keeps plain math readable without a hidden duplicate', () => {
    const plain = renderToStaticMarkup(createElement(Tex, { children: '\\mu', plain: true }));
    expect(plain).toContain('μ');
    expect(plain).not.toContain('aria-hidden');
    expect(plain).not.toContain('<math');
    expect(renderToStaticMarkup(createElement(Tex, { children: 'E_g' }))).toContain('<math');
  });
  it('renders small percentages and negative values without raw exponent notation', () => {
    const html = renderToStaticMarkup(createElement(Num, { children: '-1.2e-5%' }));
    expect(html).not.toContain('katex-error');
    expect(html).not.toContain('1.2e-5');
    expect(html).toContain('msupsub');
    expect(html).toContain('−');
    expect(html).toContain('%');
  });
  it('typesets density sources, fit caveats and numeric notes without parse errors', () => {
    const samples = [...COMPOUND_PRESETS.map(p => p.densitySource),
      'Reduced χ² assumes 1σ errors; ±10 eV / 0.1 eV. Thickness 1.5e-5 µm.',
      'Pt L3 tabulated edge: 11564 eV; residual −0.2.',
    ];
    for (const children of samples) {
      const html = renderToStaticMarkup(createElement(ScienceText, { children }));
      expect(html, children).toContain('class="katex"');
      expect(html, children).not.toContain('katex-error');
      expect(html, children).not.toMatch(/g\/cm³|χ²|1σ|1\.5e-5|µm/);
    }
  });
  it('leaves identifiers and ordinary text intact', () => {
    const children = 'CSV headers must be energy_eV,mu_cm_inv. Recorded 2026-10-18.';
    expect(renderToStaticMarkup(createElement(ScienceText, { children }))).toBe(children);
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
