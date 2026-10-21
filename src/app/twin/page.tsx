import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from 'next/font/google';
import { TwinPage } from '@/components/twin/twin-page';
import { JsonLd } from '@/components/json-ld';
import { twinJsonLd, twinMetadata } from '@/lib/site';
import '../twin.css';

// The instrument console's type: a serif for titles, a sans for reading and a mono for labels and readouts.
// Self-hosted at build time like the rest of the site, so the installed app works offline.
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-twin-serif', display: 'swap' });
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-twin-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-twin-mono', display: 'swap' });

export const metadata: Metadata = twinMetadata();

export default function Page() {
  return <><JsonLd data={twinJsonLd()} /><div className={`twin-fonts ${serif.variable} ${sans.variable} ${mono.variable}`}><TwinPage /></div></>;
}
