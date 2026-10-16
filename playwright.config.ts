import { defineConfig, devices } from '@playwright/test';

// Set PLAYWRIGHT_CHANNEL=chromium after `npx playwright install chromium` when
// Microsoft Edge is not installed. A running preview is reused locally.
const channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 1000 } },
      grepInvert: /mobile/,
    },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' },
      testMatch: /ui\.spec\.ts/,
      grep: /mobile/,
    },
  ],
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER ? undefined : {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
