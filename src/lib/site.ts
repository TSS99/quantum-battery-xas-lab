// Page titles, descriptions, canonical URLs, share images and JSON-LD for every route.
import type { Metadata } from 'next';
import site from '@/data/site-pages.json';

export type SitePage = (typeof site.pages)[number];
export const SITE_NAME = site.siteName;
export const SITE_URL = site.siteUrl;
export const PAGES: SitePage[] = site.pages;

/** Absolute URL with a trailing slash, matching trailingSlash: true. */
export const pageUrl = (slug: string) => `${SITE_URL}/${slug ? slug + '/' : ''}`;
export const ogImageUrl = (slug: string) => `${SITE_URL}/og/${slug || 'home'}.png`;

export function sitePage(slug: string): SitePage {
  const page = PAGES.find(p => p.slug === slug);
  if (!page) throw new Error(`No site metadata for "${slug}".`);
  return page;
}

export function pageMetadata(slug: string): Metadata {
  const page = sitePage(slug), url = pageUrl(slug);
  const image = { url: ogImageUrl(slug), width: 1200, height: 630, alt: page.ogAlt };
  return {
    title: slug ? page.title : { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_US', url, title: page.title, description: page.description, images: [image] },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: [image] },
  };
}

const webApplication = {
  '@type': 'WebApplication',
  '@id': `${SITE_URL}/#app`,
  name: SITE_NAME,
  url: pageUrl(''),
  description: sitePage('').description,
  applicationCategory: 'EducationalApplication',
  operatingSystem: 'Any (runs in a web browser)',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author: { '@type': 'Person', name: site.author.name, url: site.author.url },
  codeRepository: site.repository,
  inLanguage: 'en',
};

/** JSON-LD for one route: WebSite and WebApplication everywhere, BreadcrumbList on module pages. */
export function pageJsonLd(slug: string) {
  const graph: object[] = [
    { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: SITE_NAME, url: pageUrl(''), inLanguage: 'en' },
    webApplication,
  ];
  if (slug) graph.push({
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Overview', item: pageUrl('') },
      { '@type': 'ListItem', position: 2, name: sitePage(slug).name, item: pageUrl(slug) },
    ],
  });
  return { '@context': 'https://schema.org', '@graph': graph };
}
