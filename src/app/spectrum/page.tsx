import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from 'next/font/google';
import { SpectrumPage } from '@/components/spectrum/spectrum-page';
import { JsonLd } from '@/components/json-ld';
import { spectrumJsonLd, spectrumMetadata } from '@/lib/site';
import '../twin.css';
import '../spectrum.css';

// The twin console's type, so this window reads as part of it.
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-twin-serif', display: 'swap' });
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-twin-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-twin-mono', display: 'swap' });

export const metadata: Metadata = spectrumMetadata();

export default function Page() {
  return <><JsonLd data={spectrumJsonLd()} /><div className={`twin-fonts ${serif.variable} ${sans.variable} ${mono.variable}`}><SpectrumPage /></div></>;
}
