import type { Metadata } from 'next';
import { Laboratory } from '@/components/laboratory';
import { JsonLd } from '@/components/json-ld';
import { PAGES, pageMetadata } from '@/lib/site';

export function generateStaticParams() { return PAGES.filter(p => p.slug).map(p => ({ module: p.slug })); }
export const dynamicParams = false;
export async function generateMetadata({ params }: { params: Promise<{ module: string }> }): Promise<Metadata> {
  const { module } = await params;
  return pageMetadata(module);
}
export default async function Page({ params }: { params: Promise<{ module: string }> }) { const { module } = await params; return <><JsonLd slug={module} /><Laboratory module={module} /></>; }
