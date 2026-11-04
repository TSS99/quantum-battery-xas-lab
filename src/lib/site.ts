// Page titles, descriptions, canonical URLs, share images and JSON-LD for the routes: the twin (/), /quantum/ and /methods/.
import type { Metadata } from 'next';
import site from '@/data/site-pages.json';

export type SitePage = typeof site.home;
export const SITE_NAME = site.siteName;
export const SITE_URL = site.siteUrl;
export const HOME_PAGE: SitePage = site.home;
export const METHODS_PAGE: SitePage = site.methods;
export const QUANTUM_PAGE: SitePage = site.quantum;

/** Absolute URL with a trailing slash, matching trailingSlash: true. */
export const pageUrl = (slug: string) => `${SITE_URL}/${slug ? slug + '/' : ''}`;
/** Every page shares the twin's card. */
const OG_IMAGE = `${SITE_URL}/og/twin.png`;

export function pageMetadata(page: SitePage): Metadata {
  const url = pageUrl(page.slug), { title, description } = page;
  const image = { url: OG_IMAGE, width: 1200, height: 630, alt: page.ogAlt };
  return {
    title: page.slug ? title : { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_US', url, title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

const webSite = { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: SITE_NAME, url: pageUrl(''), inLanguage: 'en' };

const webApplication = {
  '@type': 'WebApplication',
  '@id': `${SITE_URL}/#app`,
  name: SITE_NAME,
  url: pageUrl(''),
  description: HOME_PAGE.description,
  applicationCategory: 'EducationalApplication',
  operatingSystem: 'Any (runs in a web browser)',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author: { '@type': 'Person', name: site.author.name, url: site.author.url },
  codeRepository: site.repository,
  inLanguage: 'en',
};

/** JSON-LD for one page: WebSite and WebApplication, and below the home page a breadcrumb back to the twin. */
export function pageJsonLd(page: SitePage) {
  const graph: object[] = [webSite, webApplication];
  if (page.slug) graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: [[HOME_PAGE.name, ''], [page.name, page.slug]].map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: pageUrl(path) })),
  });
  return { '@context': 'https://schema.org', '@graph': graph };
}
