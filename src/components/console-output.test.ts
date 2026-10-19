import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsoleOutput, ConsoleText } from './console-output';

describe('console rendering', () => {
  it.each(['Δμ·d = 1; μ·d above the edge', 'μ/ρ total: 1.234×10⁻⁵ cm²/g', 'Fe2O3 · 5.26 g/cm³ · 7,112 eV', 'mass per area: 4.033 mg/cm²', '1/μ: 45.06 μm', 'CuSO4·5H2O'])('typesets scientific output: %s', text => {
    const html = renderToStaticMarkup(createElement(ConsoleText, { text }));
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('katex-error');
    expect(html).not.toContain('undefined');
  });

  it('escapes untrusted text and leaves Python syntax copyable', () => {
    const html = renderToStaticMarkup(createElement(ConsoleOutput, { line: { kind: 'error', text: '<script>alert("x")</script>' } }));
    expect(html).not.toContain('<script>');
    const code = renderToStaticMarkup(createElement(ConsoleOutput, { line: { kind: 'code', filename: 'xas_fe.py', text: 'd_cm = 3 / mu_above\n' } }));
    expect(code).toContain('d_cm = 3 / mu_above\n');
    expect(code).toContain('Copy xas_fe.py');
    expect(code).toContain('Download xas_fe.py');
    expect(code).not.toContain('class="katex"');
  });
});
