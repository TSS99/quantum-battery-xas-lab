import { defineConfig } from 'vitest/config';

// Unit tests only; tests/ui.spec.ts is run by Playwright (npm run test:ui).
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
