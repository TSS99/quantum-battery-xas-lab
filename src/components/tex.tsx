// No 'use client': these have no state or handlers, so server components (the element pages)
// typeset with them at build time without shipping KaTeX, and client components bundle them as before.
import katex from 'katex';

/** Formats a JavaScript number string for LaTeX: 1.2e-5 becomes 1.2\times10^{-5}, 100,000 becomes 100{,}000. */
export const texNum = (value: string) => value.replace(/,/g, '{,}').replace(/e([+-]?)(\d+)$/i, (_, sign: string, exp: string) => `\\times10^{${sign === '-' ? '-' : ''}${exp}}`);

const SUPERSCRIPT: Record<string, string> = { '⁻': '-', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
/** Unit text such as "cm⁻¹ eV⁻¹", "g/cm³" or "μm" as upright LaTeX units. */
export function unitTex(unit: string) {
  return unit.trim().split(/\s+/).filter(Boolean).map(word => {
    if (word === 'x') return 'x';
    if (word === '%') return '\\%';
    if (word === '°C') return '{}^\\circ\\mathrm{C}';
    if (word === '°') return '{}^\\circ';
    if (word === 'Å') return '\\mathring{\\mathrm{A}}';
    return word.replace(/µ/g, 'μ').split('/').map(part => {
      const match = part.match(/^(.+?)(?:\^([+-]?\d+)|([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))?$/);
      if (!match) return '';
      const [, base, exponent, superscript] = match;
      const upright = base === 'Å' ? '\\mathring{\\mathrm{A}}' : base.startsWith('μ') ? '\\mu' + (base.length > 1 ? '\\mathrm{' + base.slice(1) + '}' : '') : '\\mathrm{' + base + '}';
      const power = exponent ?? (superscript ? [...superscript].map(c => SUPERSCRIPT[c]).join('') : '');
      return upright + (power ? '^{' + power + '}' : '');
    }).join('/');
  }).join('\\ ');
}
/** Chemical formula with numeric subscripts: Li0.5MnO2 becomes \mathrm{Li_{0.5}MnO_{2}}. */
export const formulaTex = (formula: string) => '\\mathrm{' + formula.replace(/(?<=[A-Za-z)\]])(\d+(?:\.\d+)?)/g, '_{$1}').replace(/[·•]/g, '\\cdot ') + '}';

/**
 * LaTeX rendered with KaTeX during the static build and in the browser, so the HTML already contains typeset math.
 * `plain` skips the hidden MathML copy; use it for bare numbers and units whose text is read as-is.
 */
export function Tex({ children, block = false, plain = false }: { children: string; block?: boolean; plain?: boolean }) {
  let html = katex.renderToString(block ? '\\displaystyle ' + children : children, { throwOnError: false, strict: 'ignore', output: plain ? 'html' : 'htmlAndMathml' });
  if (plain) html = html.replace(' aria-hidden="true"', '');
  return <span className={'tex' + (block ? ' tex-block' : '')} dangerouslySetInnerHTML={{ __html: html }} />;
}
/** A number with a true minus sign; exponent notation becomes a power of ten. */
export function Num({ children }: { children: string }) {
  if (/^[+−-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?%$/i.test(children)) return <Tex plain>{texNum(children.slice(0, -1).replace('−', '-')) + '\\%'}</Tex>;
  return /e[+-]?\d+$/i.test(children) ? <Tex plain>{texNum(children)}</Tex> : <>{children.replace(/^-/, '−')}</>;
}
export const Unit = ({ children }: { children: string }) => children.trim() ? <Tex plain>{unitTex(children)}</Tex> : null;

/** Known math fragments in application-owned prose. The source strings and exports stay unchanged. */
export function ScienceText({ children }: { children: string }) {
  const tokens = /(\bD\((?:meas|calc)\.\)(?: = [\d.]+)?|\b[abcZ] = \d+(?:\.\d+)?|ρ = pM\/RT|\bR-3m\b|\bPnma\b|χ²|\d+σ|(?<![\w])(?:g\/cm³|g\/L|cm\^-1|eV\^-1|cm⁻¹|eV⁻¹|[μµ]m|°C|Å|kPa|keV|eV|mg|fs|MB|kB)(?![\w])|(?<![\w])(?:[-+−±]?\d+(?:\.\d+)?[eE][+-]?\d+|[-−±]\d+(?:\.\d+)?)(?![\w])|(?<![\w])[LM][1-5](?![\w]))/g;
  return <>{children.split(tokens).map((part, i) => {
    if (i % 2 === 0) return part;
    if (/^(?:g\/|cm|eV|[μµ]|°|Å|kPa|keV|mg|fs|MB|kB)/.test(part)) return <Unit key={i}>{part}</Unit>;
    const math = part === 'ρ = pM/RT' ? '\\rho = pM/(RT)'
      : part === 'R-3m' ? '\\mathrm{R}\\bar{3}\\mathrm{m}'
      : part === 'Pnma' ? '\\mathrm{Pnma}'
      : part.replace(/D\((meas|calc)\.\)/, 'D_{\\mathrm{$1.}}').replace('χ²', '\\chi^2').replace('σ', '\\sigma').replace('±', '\\pm ').replace('−', '-').replace(/^([LM])(\d)$/, '$1_{$2}');
    return <Tex plain key={i}>{texNum(math)}</Tex>;
  })}</>;
}
