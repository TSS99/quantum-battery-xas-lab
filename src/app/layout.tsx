import type { Metadata, Viewport } from 'next';
import { LabProvider } from '@/components/lab-context';
import { Shell } from '@/components/shell';
import { SITE_NAME, SITE_URL, sitePage } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL + '/'),
  title: { default: sitePage('').title, template: `%s | ${SITE_NAME}` },
  description: sitePage('').description,
  applicationName: SITE_NAME,
  authors: [{ name: 'TSS99', url: 'https://github.com/TSS99' }],
};
export const viewport: Viewport = { themeColor: '#0f141a', colorScheme: 'dark' };
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="en"><body><LabProvider><Shell>{children}</Shell></LabProvider></body></html>;
}
