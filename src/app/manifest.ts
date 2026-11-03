import type { MetadataRoute } from 'next';
import { HOME_PAGE, SITE_NAME } from '@/lib/site';

export const dynamic = 'force-static';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

// Lets browsers install the twin as a desktop or phone app; public/sw.js (built by scripts/make-sw.mjs) makes it work offline.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${BASE}/`,
    name: `${SITE_NAME}: an X-ray absorption beamline`,
    short_name: SITE_NAME,
    description: HOME_PAGE.description,
    start_url: `${BASE}/`,
    scope: `${BASE}/`,
    display: 'standalone',
    background_color: '#0f141a',
    theme_color: '#0f141a',
    categories: ['education', 'science', 'utilities'],
    icons: [
      { src: `${BASE}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${BASE}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${BASE}/icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [{ src: `${BASE}/og/twin.png`, sizes: '1200x630', type: 'image/png', form_factor: 'wide', label: 'The Beamline Twin' }],
  };
}
