import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from 'next/font/google';
import { TwinPage } from '@/components/twin/twin-page';
import '../twin.css';

// The instrument console's type: a serif for titles, a sans for reading and a mono for labels and readouts.
// Self-hosted at build time like the rest of the site, so the installed app works offline.
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-twin-serif', display: 'swap' });
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-twin-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-twin-mono', display: 'swap' });

// In preview: not indexed, not in the sitemap and not in the module navigation.
export const metadata: Metadata = {
  title: 'Beamline twin',
  description: 'Preview of an XAS beamline you operate in the browser: eight measurement modes, the monochromator energy and the results each detector would record.',
  robots: { index: false, follow: true },
};

export default function Page() {
  return <div className={`twin-fonts ${serif.variable} ${sans.variable} ${mono.variable}`}><TwinPage /></div>;
}
