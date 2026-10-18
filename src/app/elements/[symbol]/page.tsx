import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ElementPage } from '@/components/element-pages';
import { JsonLd } from '@/components/json-ld';
import { ELEMENTS, elementBySlug, elementDescription, elementTitle } from '@/lib/elements';
import { elementsJsonLd, elementsMetadata } from '@/lib/site';

export function generateStaticParams() { return ELEMENTS.map(el => ({ symbol: el.slug })); }
export const dynamicParams = false;

async function element(params: Promise<{ symbol: string }>) {
  const found = elementBySlug((await params).symbol);
  if (!found) notFound();
  return found;
}
export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const el = await element(params);
  return elementsMetadata(`elements/${el.slug}`, elementTitle(el), elementDescription(el));
}
export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const el = await element(params);
  return <><JsonLd data={elementsJsonLd({ name: el.name, path: `elements/${el.slug}` })} /><ElementPage element={el} /></>;
}
