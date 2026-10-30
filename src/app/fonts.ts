import localFont from 'next/font/local';

/*
 * The site's fonts, bundled in src/fonts/ so the build never fetches them: the latin files of Fontsource 5.3.0, which
 * are Google Fonts' own files, under the SIL Open Font License 1.1 (src/fonts/OFL-*.txt). next/font self-hosts them
 * and adds metric-matched fallbacks, as it did when they came from Google at build time.
 */

/** Outfit, the site's type (300, 400, 500). */
export const outfit = localFont({
  src: [
    { path: '../fonts/outfit-latin-300-normal.woff2', weight: '300', style: 'normal' },
    { path: '../fonts/outfit-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/outfit-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-outfit', display: 'swap',
});

/** The instrument consoles (/twin/, /spectrum/): a serif for titles, a sans for reading and a mono for labels and readouts. */
export const twinSerif = localFont({
  src: [
    { path: '../fonts/instrument-serif-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/instrument-serif-latin-400-italic.woff2', weight: '400', style: 'italic' },
  ],
  variable: '--font-twin-serif', display: 'swap', adjustFontFallback: 'Times New Roman',
});

export const twinSans = localFont({
  src: [
    { path: '../fonts/ibm-plex-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/ibm-plex-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/ibm-plex-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-twin-sans', display: 'swap',
});

export const twinMono = localFont({
  src: [
    { path: '../fonts/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-twin-mono', display: 'swap', adjustFontFallback: false,
});

/** The class that puts the console fonts' variables on a page. */
export const twinFonts = `twin-fonts ${twinSerif.variable} ${twinSans.variable} ${twinMono.variable}`;
