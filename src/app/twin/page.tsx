import type { Metadata } from 'next';
import { Instrument_Serif } from 'next/font/google';
import { TwinPage } from '@/components/twin/twin-page';
import { JsonLd } from '@/components/json-ld';
import { twinJsonLd, twinMetadata } from '@/lib/site';
import '../twin.css';

// The instrument console's titles are a serif; its reading and readout type is the site's IBM Plex (layout.tsx).
// Self-hosted at build time like the rest of the site, so the installed app works offline.
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-twin-serif', display: 'swap' });

export const metadata: Metadata = twinMetadata();

export default function Page() {
  return <><JsonLd data={twinJsonLd()} /><div className={`twin-fonts ${serif.variable}`}><TwinPage /></div></>;
}
