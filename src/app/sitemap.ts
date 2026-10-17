import type { MetadataRoute } from 'next';
import { PAGES, pageUrl } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(p => ({ url: pageUrl(p.slug), changeFrequency: 'monthly', priority: p.slug ? 0.8 : 1 }));
}
