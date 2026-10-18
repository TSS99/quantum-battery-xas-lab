import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only; tests/ui.spec.ts is run by Playwright (npm run test:ui).
// The alias mirrors tsconfig "paths" so component tests can import modules that use "@/".
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'] },
});
