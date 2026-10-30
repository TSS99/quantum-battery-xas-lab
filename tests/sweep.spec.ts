import { expect, test } from '@playwright/test';
import { axeViolations } from './axe';

// Every top-level page at desktop and phone width: no console errors, no sideways scrolling, no broken maths and no
// axe violations.
const PAGES = ['', 'spectra/', 'quantum/', 'crystal/', 'electronic/', 'beamline/', 'experiments/', 'validation/', 'elements/', 'elements/fe/', 'tools/', 'tools/ion-chamber-gas/', 'tools/harmonic-rejection-mirror/', 'tools/self-absorption/', 'tools/x-ray-dose/', 'instructors/', 'twin/', 'spectrum/'];

for (const width of [1440, 390]) {
  test(`every page is clean at ${width} px: console, overflow, maths and axe`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    for (const path of PAGES) {
      await page.goto('./' + path, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `/${path} sideways overflow`).toBeLessThanOrEqual(0);
      await expect(page.locator('.katex-error'), `/${path} maths`).toHaveCount(0);
      expect(await axeViolations(page), `/${path} axe`).toEqual([]);
      expect(errors, `/${path} console`).toEqual([]);
    }
  });
}
