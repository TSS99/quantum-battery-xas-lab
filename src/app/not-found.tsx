import type { Metadata } from 'next';
import Link from 'next/link';
import { PAGES } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'This address does not match a page in XAS Lab. Pick a module from the list to keep going.',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return <div className="page-content"><section className="not-found">
    <p className="eyebrow">Error 404</p>
    <h1>Page not found</h1>
    <p className="lead">This address does not match a page in the lab. It may have moved, or the link has a typo. Pick a module to keep going.</p>
    <ul className="not-found-links">
      {PAGES.map(p => <li key={p.slug}><Link href={p.slug ? `/${p.slug}/` : '/'}><strong>{p.name}</strong><span>{p.description}</span></Link></li>)}
    </ul>
  </section></div>;
}
