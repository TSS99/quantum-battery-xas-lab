import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ELEMENTS, elementBySlug, elementTitle, scannableEdges } from '@/lib/elements';
import { ElementPage, ElementsIndex } from './element-pages';

afterEach(() => vi.unstubAllEnvs());

describe('element pages in static HTML', () => {
  it('includes all periodic-table links, named scrolling regions and one main title', () => {
    const html = renderToStaticMarkup(createElement(ElementsIndex));
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html.match(/role="region"/g)).toHaveLength(2);
    for (const el of ELEMENTS) {
      // Next's build supplies trailingSlash; its Link default in a unit renderer omits it.
      expect(html).toMatch(new RegExp(`href="/elements/${el.slug}/?"`));
      expect(html).toContain(`aria-label="${el.name} (${el.symbol}), atomic number ${el.Z}"`);
    }
    expect(html).not.toContain('katex-error');
  });

  it('renders every edge and its range status without client table code or KaTeX errors', () => {
    for (const el of ELEMENTS) {
      const html = renderToStaticMarkup(createElement(ElementPage, { element: el }));
      expect(html).toContain(`<h1>${elementTitle(el)}</h1>`);
      expect(html.match(/<h1>/g)).toHaveLength(1);
      expect(html.match(/<th scope="row">/g)).toHaveLength(el.edges.length);
      expect(html.match(/>Outside range</g) ?? []).toHaveLength(el.edges.length - scannableEdges(el).length);
      expect(html.match(/aria-label="Scan the /g) ?? []).toHaveLength(scannableEdges(el).length);
      expect(html).not.toContain('katex-error');
      expect(html).not.toContain('<script');
      expect(html).toContain('Density is retained');
    }
  });

  it('keeps lab links under the deployment base path and labels an out-of-range edge honestly', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/quantum-battery-xas-lab');
    const iron = renderToStaticMarkup(createElement(ElementPage, { element: elementBySlug('fe')! }));
    expect(iron).toContain('href="/quantum-battery-xas-lab/crystal/?element=Fe&amp;edge=K"');
    expect(iron).toContain('href="/quantum-battery-xas-lab/beamline/?element=Fe&amp;edge=K"');
    expect(iron).toContain('href="/quantum-battery-xas-lab/crystal/?scenario=');
    const hydrogen = renderToStaticMarkup(createElement(ElementPage, { element: elementBySlug('h')! }));
    expect(hydrogen).toContain('Inspect the absorption background');
    expect(hydrogen).not.toContain('Scan it on the beamline');
    expect(hydrogen).toContain('outside the lab range');
  });
});
