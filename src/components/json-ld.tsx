import { pageJsonLd, type SitePage } from '@/lib/site';

/** Structured data for one page, rendered into the static HTML. */
export function JsonLd({ page }: { page: SitePage }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd(page)).replace(/</g, '\\u003c') }} />;
}
