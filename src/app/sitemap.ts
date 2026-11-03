import type { MetadataRoute } from 'next';
import { HOME_PAGE, METHODS_PAGE, pageUrl } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: pageUrl(HOME_PAGE.slug), changeFrequency: 'monthly', priority: 1 },
    { url: pageUrl(METHODS_PAGE.slug), changeFrequency: 'monthly', priority: 0.6 },
  ];
}
