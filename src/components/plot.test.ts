import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Plot } from './plot';

const series = [{ name: 'Signal', color: '#c4ccd6', x: [1, 2], y: [.5, 1] }];
function legendValue(yLabel: string, yUnit?: string) {
  const html = renderToStaticMarkup(createElement(Plot, { series, yLabel, yUnit }));
  const legend = html.slice(html.indexOf('class="plot-legend"'));
  expect(html).not.toContain('katex-error');
  return legend.match(/<b>([\s\S]*?)<\/b>/)![1].replace(/<[^>]+>/g, '').replace(/[\s\u200b]/g, '');
}

describe('plot readout units', () => {
  it.each(['C(t)', 'S(ω)', 'C(t), toy dipole strength', '|〈ψ exact(t)|ψ Trotter(t)〉|²'])('does not treat the argument of %s as a unit', label => {
    expect(legendValue(label)).toBe('0.50');
  });
  it('keeps the derivative units from the axis label', () => {
    expect(legendValue('dμ/dE (cm⁻¹ eV⁻¹)')).toBe('0.50cm−1eV−1');
  });
  it('shows explicit spectrum units when the axis label has no unit parentheses', () => {
    expect(legendValue('Strength / eV', 'eV⁻¹')).toBe('0.50eV−1');
  });
});
