import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { LabProvider } from '@/components/lab-context';
import { Shell } from '@/components/shell';
import { SITE_NAME, SITE_URL, referenceTrails, sitePage } from '@/lib/site';
import { ELEMENT_NAMES } from '@/lib/elements';
import 'katex/dist/katex.min.css';
import './globals.css';
import './design.css';

// Interface type: IBM Plex Sans for reading and IBM Plex Mono for readouts and labels, with their own digits;
// equations, symbols and units stay in KaTeX. Self-hosted at build time so the installed app works offline.
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-plex-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL + '/'),
  title: { default: sitePage('').title, template: `%s | ${SITE_NAME}` },
  description: sitePage('').description,
  applicationName: SITE_NAME,
  authors: [{ name: 'TSS99', url: 'https://github.com/TSS99' }],
};
export const viewport: Viewport = { themeColor: '#121212', colorScheme: 'dark' };
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="en" className={`${sans.variable} ${mono.variable}`}><body><LabProvider><Shell elementNames={ELEMENT_NAMES} trails={referenceTrails()}>{children}</Shell></LabProvider></body></html>;
}
