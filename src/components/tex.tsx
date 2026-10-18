'use client';
import katex from 'katex';

/** Formats a JavaScript number string for LaTeX: 1.2e-5 becomes 1.2\times10^{-5}, 100,000 becomes 100{,}000. */
export const texNum = (value: string) => value.replace(/,/g, '{,}').replace(/e([+-]?)(\d+)$/i, (_, sign: string, exp: string) => `\\times10^{${sign === '-' ? '-' : ''}${exp}}`);

const SUPERSCRIPT: Record<string, string> = { '⁻': '-', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
/** Unit text such as "cm⁻¹ eV⁻¹", "g/cm³" or "μm" as upright LaTeX units. */
export function unitTex(unit: string) {
  return unit.trim().split(/\s+/).filter(Boolean).map(word => {
    if (word === 'x') return 'x';
    if (word === '%') return '\\%';
    return word.replace(/([^⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]*)/g, (_, base: string, sup: string) => {
      const upright = base.startsWith('μ') ? '\\mu' + (base.length > 1 ? `\\mathrm{${base.slice(1)}}` : '') : `\\mathrm{${base}}`;
      return sup ? `${upright}^{${[...sup].map(c => SUPERSCRIPT[c]).join('')}}` : upright;
    });
  }).join('\\ ');
}
/** Chemical formula with numeric subscripts: Li0.5MnO2 becomes \mathrm{Li_{0.5}MnO_{2}}. */
export const formulaTex = (formula: string) => '\\mathrm{' + formula.replace(/(?<=[A-Za-z)\]])(\d+(?:\.\d+)?)/g, '_{$1}').replace(/[·•]/g, '\\cdot ') + '}';

/**
 * LaTeX rendered with KaTeX during the static build and in the browser, so the HTML already contains typeset math.
 * `plain` skips the hidden MathML copy; use it for bare numbers and units whose text is read as-is.
 */
export function Tex({ children, block = false, plain = false }: { children: string; block?: boolean; plain?: boolean }) {
  const html = katex.renderToString(block ? '\\displaystyle ' + children : children, { throwOnError: false, strict: 'ignore', output: plain ? 'html' : 'htmlAndMathml' });
  return <span className={'tex' + (block ? ' tex-block' : '')} dangerouslySetInnerHTML={{ __html: html }} />;
}
/** A number with a true minus sign; exponent notation becomes a power of ten. */
export function Num({ children }: { children: string }) {
  return /e[+-]?\d+$/i.test(children) ? <Tex plain>{texNum(children)}</Tex> : <>{children.replace(/^-/, '−')}</>;
}
export const Unit = ({ children }: { children: string }) => children.trim() ? <Tex plain>{unitTex(children)}</Tex> : null;
