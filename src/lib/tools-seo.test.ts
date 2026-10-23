import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sitemap from '@/app/sitemap';
import { generateMetadata, generateStaticParams } from '@/app/tools/[tool]/page';
import { INSTRUCTORS_PAGE, PAGES, TOOLS_PAGE, TOOL_PAGES, instructorsJsonLd, instructorsMetadata, pageUrl, referenceTrails, toolsJsonLd, toolsMetadata } from './site';

describe('calculator and instructor routes and search metadata', () => {
  it('exports one route per calculator', () => {
    expect(generateStaticParams()).toEqual([{ tool: 'ion-chamber-gas' }, { tool: 'harmonic-rejection-mirror' }, { tool: 'self-absorption' }, { tool: 'x-ray-dose' }]);
  });

  it('gives every page a unique title and description, a canonical URL and an existing share card', async () => {
    const pages = [TOOLS_PAGE, ...TOOL_PAGES, INSTRUCTORS_PAGE];
    expect(new Set([...PAGES, ...pages].map(p => p.title)).size).toBe(PAGES.length + pages.length);
    expect(new Set(pages.map(p => p.description)).size).toBe(pages.length);
    for (const page of pages) {
      expect(page.title.length, page.title).toBeLessThanOrEqual(65);
      expect(page.description.length, page.slug).toBeLessThanOrEqual(220);
      const meta = page === INSTRUCTORS_PAGE ? instructorsMetadata() : toolsMetadata(page);
      expect(meta).toMatchObject({ title: page.title, description: page.description, alternates: { canonical: pageUrl(page.slug) } });
      const image = (meta.openGraph!.images as { url: string }[])[0];
      expect(existsSync('public/og/' + image.url.split('/').at(-1))).toBe(true);
    }
    expect(await generateMetadata({ params: Promise.resolve({ tool: 'x-ray-dose' }) })).toEqual(toolsMetadata(TOOL_PAGES[3]));
    await expect(generateMetadata({ params: Promise.resolve({ tool: 'unknown' }) })).rejects.toThrow();
  });

  it('lists the pages in the sitemap and gives them breadcrumbs in JSON-LD and in the site shell', () => {
    const urls = sitemap().map(entry => entry.url);
    for (const page of [TOOLS_PAGE, ...TOOL_PAGES, INSTRUCTORS_PAGE]) expect(urls).toContain(pageUrl(page.slug));
    const item = (position: number, name: string, path: string) => ({ '@type': 'ListItem', position, name, item: pageUrl(path) });
    expect(toolsJsonLd(TOOL_PAGES[0])['@graph'].at(-1)).toEqual({ '@type': 'BreadcrumbList', itemListElement: [item(1, 'Overview', ''), item(2, 'Calculators', 'tools'), item(3, 'Ion chamber gas', 'tools/ion-chamber-gas')] });
    expect(instructorsJsonLd()['@graph'].at(-1)).toEqual({ '@type': 'BreadcrumbList', itemListElement: [item(1, 'Overview', ''), item(2, 'For instructors', 'instructors')] });
    expect(referenceTrails()['/tools/x-ray-dose/']).toEqual([['Calculators', '/tools/'], ['X-ray dose', '/tools/x-ray-dose/']]);
    expect(referenceTrails()['/instructors/']).toEqual([['For instructors', '/instructors/']]);
  });
});
