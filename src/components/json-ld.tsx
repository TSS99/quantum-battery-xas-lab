import { pageJsonLd } from '@/lib/site';

/** Structured data for one route, rendered into the static HTML: a module slug, or prepared data. */
export function JsonLd({ slug = '', data }: { slug?: string; data?: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data ?? pageJsonLd(slug)).replace(/</g, '\\u003c') }} />;
}
