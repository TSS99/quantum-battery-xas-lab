import type { Metadata } from 'next';
import { SpectrumPage } from '@/components/spectrum/spectrum-page';
import { JsonLd } from '@/components/json-ld';
import { spectrumJsonLd, spectrumMetadata } from '@/lib/site';
import { twinFonts } from '../fonts';
import '../twin.css';
import '../spectrum.css';

export const metadata: Metadata = spectrumMetadata();

export default function Page() {
  return <><JsonLd data={spectrumJsonLd()} /><div className={twinFonts}><SpectrumPage /></div></>;
}
