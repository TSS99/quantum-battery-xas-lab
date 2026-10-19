import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only; tests/ui.spec.ts is run by Playwright (npm run test:ui).
// The alias mirrors tsconfig "paths" so component tests can import modules that use "@/".
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Rendering all 98 element pages takes about 4 s locally; CI runners are slower than the default 5 s limit allows.
  test: { include: ['src/**/*.test.ts'], testTimeout: 30_000 },
});
