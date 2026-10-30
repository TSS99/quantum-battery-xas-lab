// Page titles, descriptions, canonical URLs, share images and JSON-LD for every route.
import type { Metadata } from 'next';
import site from '@/data/site-pages.json';

export type SitePage = (typeof site.pages)[number];
export const SITE_NAME = site.siteName;
export const SITE_URL = site.siteUrl;
export const PAGES: SitePage[] = site.pages;
/** The element pages (/elements/ and /elements/<symbol>/) sit outside the eight modules and share one card. */
export const ELEMENTS_PAGE = site.elements;
/** The beamline twin runs full screen outside the eight modules and has its own card. */
export const TWIN_PAGE = site.twin;
/** Read the spectrum: the shells behind an EXAFS spectrum, full screen like the twin and opened from its Results. */
export const SPECTRUM_PAGE = site.spectrum;
/** The calculators (/tools/ and /tools/<name>/) share one card, like the element pages. */
export const TOOLS_PAGE = site.tools;
export type ToolPage = (typeof site.tools.pages)[number];
export const TOOL_PAGES: ToolPage[] = site.tools.pages;
/** The page for teachers running a class on the twin. */
export const INSTRUCTORS_PAGE = site.instructors;

/** Absolute URL with a trailing slash, matching trailingSlash: true. */
export const pageUrl = (slug: string) => `${SITE_URL}/${slug ? slug + '/' : ''}`;
export const ogImageUrl = (slug: string) => `${SITE_URL}/og/${slug || 'home'}.png`;

export function sitePage(slug: string): SitePage {
  const page = PAGES.find(p => p.slug === slug);
  if (!page) throw new Error(`No site metadata for "${slug}".`);
  return page;
}

interface RouteMeta { path: string; title: string; description: string; ogSlug: string; ogAlt: string; absoluteTitle?: boolean }

function routeMetadata({ path, title, description, ogSlug, ogAlt, absoluteTitle = false }: RouteMeta): Metadata {
  const url = pageUrl(path);
  const image = { url: ogImageUrl(ogSlug), width: 1200, height: 630, alt: ogAlt };
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_US', url, title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export function pageMetadata(slug: string): Metadata {
  const page = sitePage(slug);
  return routeMetadata({ path: slug, title: page.title, description: page.description, ogSlug: slug, ogAlt: page.ogAlt, absoluteTitle: !slug });
}

/** Metadata for an element page, path such as "elements/fe", with the shared elements card. */
export function elementsMetadata(path: string, title: string, description: string): Metadata {
  return routeMetadata({ path, title, description, ogSlug: ELEMENTS_PAGE.slug, ogAlt: ELEMENTS_PAGE.ogAlt });
}

const webSite = { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: SITE_NAME, url: pageUrl(''), inLanguage: 'en' };

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

/** Breadcrumbs from Overview through [name, path] steps. */
const breadcrumbs = (trail: [string, string][]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [['Overview', ''], ...trail].map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: pageUrl(path) })),
});

/** JSON-LD for one route: WebSite and WebApplication everywhere, BreadcrumbList on module pages. */
export function pageJsonLd(slug: string) {
  const graph: object[] = [webSite, webApplication];
  if (slug) graph.push(breadcrumbs([[sitePage(slug).name, slug]]));
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function twinMetadata(): Metadata {
  return routeMetadata({ path: TWIN_PAGE.slug, title: TWIN_PAGE.title, description: TWIN_PAGE.description, ogSlug: TWIN_PAGE.slug, ogAlt: TWIN_PAGE.ogAlt });
}

/** JSON-LD for the twin: Overview > Beamline twin. */
export function twinJsonLd() {
  return { '@context': 'https://schema.org', '@graph': [webSite, webApplication, breadcrumbs([[TWIN_PAGE.name, TWIN_PAGE.slug]])] };
}

/** Read the spectrum shares the twin's card. */
export function spectrumMetadata(): Metadata {
  return routeMetadata({ path: SPECTRUM_PAGE.slug, title: SPECTRUM_PAGE.title, description: SPECTRUM_PAGE.description, ogSlug: TWIN_PAGE.slug, ogAlt: SPECTRUM_PAGE.ogAlt });
}

/** JSON-LD for Read the spectrum: Overview > Read the spectrum. */
export function spectrumJsonLd() {
  return { '@context': 'https://schema.org', '@graph': [webSite, webApplication, breadcrumbs([[SPECTRUM_PAGE.name, SPECTRUM_PAGE.slug]])] };
}

/** Metadata for the calculator index or one calculator, with the shared calculators card. */
export function toolsMetadata(page: { slug: string; title: string; description: string }): Metadata {
  return routeMetadata({ path: page.slug, title: page.title, description: page.description, ogSlug: TOOLS_PAGE.slug, ogAlt: TOOLS_PAGE.ogAlt });
}

/** JSON-LD for the calculators: Overview > Calculators, then the calculator when there is one. */
export function toolsJsonLd(tool?: ToolPage) {
  const trail: [string, string][] = [[TOOLS_PAGE.name, TOOLS_PAGE.slug]];
  if (tool) trail.push([tool.name, tool.slug]);
  return { '@context': 'https://schema.org', '@graph': [webSite, webApplication, breadcrumbs(trail)] };
}

export function instructorsMetadata(): Metadata {
  const page = INSTRUCTORS_PAGE;
  return routeMetadata({ path: page.slug, title: page.title, description: page.description, ogSlug: page.slug, ogAlt: page.ogAlt });
}

export function instructorsJsonLd() {
  return { '@context': 'https://schema.org', '@graph': [webSite, webApplication, breadcrumbs([[INSTRUCTORS_PAGE.name, INSTRUCTORS_PAGE.slug]])] };
}

/** Breadcrumb trails after Overview for the pages outside the modules that the site shell draws, keyed by path. */
export function referenceTrails(): Record<string, [string, string][]> {
  const tools: [string, string] = [TOOLS_PAGE.name, `/${TOOLS_PAGE.slug}/`];
  return {
    [tools[1]]: [tools],
    ...Object.fromEntries(TOOL_PAGES.map(t => [`/${t.slug}/`, [tools, [t.name, `/${t.slug}/`]]])),
    [`/${INSTRUCTORS_PAGE.slug}/`]: [[INSTRUCTORS_PAGE.name, `/${INSTRUCTORS_PAGE.slug}/`]],
  };
}

/** JSON-LD for the element pages: Overview > Elements, then the element when there is one. */
export function elementsJsonLd(element?: { name: string; path: string }) {
  const trail: [string, string][] = [[ELEMENTS_PAGE.name, ELEMENTS_PAGE.slug]];
  if (element) trail.push([element.name, element.path]);
  return { '@context': 'https://schema.org', '@graph': [webSite, webApplication, breadcrumbs(trail)] };
}
