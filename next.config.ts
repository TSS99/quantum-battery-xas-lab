import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';
const config: NextConfig = {
  output: 'export', trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  // The landing page links the desktop installers of this version (src/components/landing.tsx).
  env: { NEXT_PUBLIC_APP_VERSION: JSON.parse(readFileSync('package.json', 'utf8')).version },
  images: { unoptimized: true }, devIndicators: false,
  productionBrowserSourceMaps: false,
};
export default config;
