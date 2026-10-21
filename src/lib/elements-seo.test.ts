import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sitemap from '@/app/sitemap';
import { generateMetadata, generateStaticParams } from '@/app/elements/[symbol]/page';
import { ELEMENTS, elementDescription, elementTitle } from './elements';
import { ELEMENTS_PAGE, PAGES, elementsJsonLd, elementsMetadata, pageUrl } from './site';

const pages = [
  { path: ELEMENTS_PAGE.slug, title: ELEMENTS_PAGE.title, description: ELEMENTS_PAGE.description },
  ...ELEMENTS.map(el => ({ path: `elements/${el.slug}`, title: elementTitle(el), description: elementDescription(el) })),
];

describe('static element routes and search metadata', () => {
  it('exports exactly the 98 lower-case symbol routes', () => {
    expect(generateStaticParams()).toEqual(ELEMENTS.map(el => ({ symbol: el.slug })));
  });

  it('gives the index and every element unique titles, descriptions and canonical URLs', async () => {
    expect(new Set([...PAGES.map(p => p.title), ...pages.map(p => p.title)]).size).toBe(107);
    expect(new Set(pages.map(p => p.description)).size).toBe(99);
    for (const page of pages) {
      const meta = elementsMetadata(page.path, page.title, page.description);
      expect(meta).toMatchObject({
        title: page.title, description: page.description,
        alternates: { canonical: pageUrl(page.path) },
        openGraph: { title: page.title, description: page.description, url: pageUrl(page.path), type: 'website' },
        twitter: { title: page.title, description: page.description, card: 'summary_large_image' },
      });
      for (const share of [meta.openGraph, meta.twitter]) {
        const images = share!.images as { url: string; alt: string; width: number; height: number }[];
        expect(images).toHaveLength(1);
        expect(images[0]).toMatchObject({ width: 1200, height: 630 });
        expect(images[0].alt).toBeTruthy();
        expect(existsSync('public/og/' + images[0].url.split('/').at(-1))).toBe(true);
      }
    }
    expect(await generateMetadata({ params: Promise.resolve({ symbol: 'fe' }) })).toEqual(elementsMetadata('elements/fe', pages[26].title, pages[26].description));
    await expect(generateMetadata({ params: Promise.resolve({ symbol: 'unknown' }) })).rejects.toThrow();
  });

  it('lists every canonical page exactly once in the sitemap without query links', () => {
    const urls = sitemap().map(entry => entry.url);
    // Overview and seven modules, the beamline twin, the element index and the 98 elements from H to Cf.
    expect(urls).toHaveLength(108);
    expect(urls).toContain(pageUrl('twin'));
    expect(new Set(urls).size).toBe(urls.length);
    for (const page of pages) expect(urls).toContain(pageUrl(page.path));
    for (const url of urls) expect(url).toMatch(/\/$/);
  });

  it('provides ordered, absolute breadcrumbs for the index and every element', () => {
    const overview = { '@type': 'ListItem', position: 1, name: 'Overview', item: pageUrl('') };
    const index = { '@type': 'ListItem', position: 2, name: 'Elements', item: pageUrl('elements') };
    expect(elementsJsonLd()['@graph'].at(-1)).toEqual({ '@type': 'BreadcrumbList', itemListElement: [overview, index] });
    for (const el of ELEMENTS) {
      expect(elementsJsonLd({ name: el.name, path: `elements/${el.slug}` })['@graph'].at(-1)).toEqual({
        '@type': 'BreadcrumbList', itemListElement: [overview, index, { '@type': 'ListItem', position: 3, name: el.name, item: pageUrl(`elements/${el.slug}`) }],
      });
    }
  });
});
