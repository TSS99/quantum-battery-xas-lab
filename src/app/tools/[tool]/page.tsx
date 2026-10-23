import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DosePage, HarmonicMirrorPage, IonChamberGasPage, SelfAbsorptionPage } from '@/components/tools/tool-pages';
import { JsonLd } from '@/components/json-ld';
import { TOOL_PAGES, toolsJsonLd, toolsMetadata } from '@/lib/site';

const PAGES: Record<string, () => Promise<React.JSX.Element>> = {
  'ion-chamber-gas': IonChamberGasPage, 'harmonic-rejection-mirror': HarmonicMirrorPage, 'self-absorption': SelfAbsorptionPage, 'x-ray-dose': DosePage,
};

export function generateStaticParams() { return TOOL_PAGES.map(t => ({ tool: t.slug.replace('tools/', '') })); }
export const dynamicParams = false;

async function find(params: Promise<{ tool: string }>) {
  const { tool } = await params, page = TOOL_PAGES.find(t => t.slug === `tools/${tool}`);
  if (!page || !PAGES[tool]) notFound();
  return { page, Body: PAGES[tool] };
}
export async function generateMetadata({ params }: { params: Promise<{ tool: string }> }): Promise<Metadata> {
  return toolsMetadata((await find(params)).page);
}
export default async function Page({ params }: { params: Promise<{ tool: string }> }) {
  const { page, Body } = await find(params);
  return <><JsonLd data={toolsJsonLd(page)} /><Body /></>;
}
