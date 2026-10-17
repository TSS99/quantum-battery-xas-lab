import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

// Crawlers read robots.txt only at the domain root (tss99.github.io/robots.txt). This copy
// documents the sitemap for this project site; submit the sitemap in Search Console too.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/' }, sitemap: `${SITE_URL}/sitemap.xml` };
}
