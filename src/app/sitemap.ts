import type { MetadataRoute } from 'next';
import { ELEMENTS } from '@/lib/elements';
import { ELEMENTS_PAGE, INSTRUCTORS_PAGE, PAGES, SPECTRUM_PAGE, TOOLS_PAGE, TOOL_PAGES, TWIN_PAGE, pageUrl } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...PAGES.map(p => ({ url: pageUrl(p.slug), changeFrequency: 'monthly' as const, priority: p.slug ? 0.8 : 1 })),
    { url: pageUrl(TWIN_PAGE.slug), changeFrequency: 'monthly', priority: 0.8 },
    { url: pageUrl(SPECTRUM_PAGE.slug), changeFrequency: 'monthly', priority: 0.7 },
    { url: pageUrl(TOOLS_PAGE.slug), changeFrequency: 'monthly', priority: 0.7 },
    ...TOOL_PAGES.map(t => ({ url: pageUrl(t.slug), changeFrequency: 'monthly' as const, priority: 0.7 })),
    { url: pageUrl(INSTRUCTORS_PAGE.slug), changeFrequency: 'monthly', priority: 0.7 },
    { url: pageUrl(ELEMENTS_PAGE.slug), changeFrequency: 'monthly', priority: 0.7 },
    ...ELEMENTS.map(el => ({ url: pageUrl(`${ELEMENTS_PAGE.slug}/${el.slug}`), changeFrequency: 'monthly' as const, priority: 0.6 })),
  ];
}
