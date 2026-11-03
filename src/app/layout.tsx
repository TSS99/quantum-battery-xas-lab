import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { outfit } from './fonts';
import { Shell } from '@/components/shell';
import { HOME_PAGE, SITE_NAME, SITE_URL } from '@/lib/site';
import 'katex/dist/katex.min.css';
import './globals.css';

// Digits everywhere use KaTeX's Computer Modern, so numbers match the typeset equations.
const texDigits = localFont({
  src: [
    { path: '../../node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/katex/dist/fonts/KaTeX_Main-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-tex-digits',
  declarations: [{ prop: 'unicode-range', value: 'U+0030-0039' }],
  fallback: [],
  adjustFontFallback: false,
});


export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL + '/'),
  title: { default: HOME_PAGE.title, template: `%s | ${SITE_NAME}` },
  description: HOME_PAGE.description,
  applicationName: SITE_NAME,
  authors: [{ name: 'TSS99', url: 'https://github.com/TSS99' }],
};
export const viewport: Viewport = { themeColor: '#121212', colorScheme: 'dark' };
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="en" className={`${texDigits.variable} ${outfit.variable}`}><body><Shell>{children}</Shell></body></html>;
}
