import { pageJsonLd } from '@/lib/site';

/** Structured data for one route, rendered into the static HTML. */
export function JsonLd({ slug }: { slug: string }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd(slug)).replace(/</g, '\\u003c') }} />;
}
