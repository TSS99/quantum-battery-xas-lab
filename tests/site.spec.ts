import { expect, test } from '@playwright/test';

// The pages around the twin: Methods, the move from /twin/, the 404 page and offline use. The phone check runs in the
// mobile project; the rest run on the desktop.

test('the Methods page lists the models and their tests, and leads back to the twin', async ({ page }) => {
  await page.goto('./methods/');
  await expect(page).toHaveTitle('Beamline Twin methods: every model, its source and its checks | Beamline Twin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Methods');
  const table = page.getByRole('table', { name: 'Beamline twin models, checks and tests' });
  await expect(table.getByRole('row')).toHaveCount(24);
  await expect(table).toContainText('Larch sigma2_eins');
  await table.getByText('3 tests').first().click();
  await expect(table.locator('details[open] li').first()).toContainText('.test.ts');
  await expect(page.getByRole('heading', { name: 'Sources and licences' })).toBeVisible();
  await expect(page.locator('.measured-figure figcaption')).toContainText('correlation');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://tss99.github.io/quantum-battery-xas-lab/methods/');
  await page.getByRole('link', { name: 'Back to the twin' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beamline Twin');
});

test('an old /twin/ link opens the twin at the root with its settings', async ({ page }) => {
  await page.goto('./twin/#mode=xrf&seed=7');
  // The twin writes its whole state into the hash; the mode and seed from the old link are in it.
  await expect(page).toHaveURL(/^[^#]*\/#(.*&)?mode=xrf&seed=7(&|$)/);
  expect(new URL(page.url()).pathname).not.toContain('/twin');
  await expect(page.getByRole('group', { name: 'Modes' }).getByRole('button', { name: 'XRF spectrum', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a page of the old lab answers 404 and points to the twin', async ({ page }) => {
  const response = await page.goto('./spectrum/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(page.getByRole('link', { name: 'Open the Beamline Twin' })).toHaveAttribute('href', /\/quantum-battery-xas-lab\/$|^\/$/);
});

test('the twin links the desktop installers', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('link', { name: 'Desktop app' })).toHaveAttribute('href', 'https://github.com/TSS99/quantum-battery-xas-lab/releases/latest');
});

test('installs as an app and keeps working offline', async ({ page, context }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await page.request.get(new URL(href!, page.url()).toString())).json();
  expect(manifest.name).toBe('Beamline Twin: an X-ray absorption beamline');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toMatch(/\/$/);
  for (const icon of manifest.icons) expect((await page.request.get(new URL(icon.src, page.url()).toString())).status(), icon.src).toBe(200);
  // The installed app sends this message; here the test sends it to cache everything.
  const cached = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise<{ total: number; failed: number }>(resolve => {
      navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'precached') resolve(event.data); });
      registration.active!.postMessage({ type: 'precache-all' });
    });
  });
  expect(cached.total).toBeGreaterThan(50);
  expect(cached.failed).toBe(0);
  await context.setOffline(true);
  // The X-ray tables, 3D code and textures come from the cache.
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beamline Twin');
  await expect(page.getByRole('img', { name: /^Beamline drawing, 3D view/ })).toBeVisible({ timeout: 30_000 });
  await page.goto('./methods/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Methods');
  await context.setOffline(false);
});

test('mobile: the Methods and 404 pages fit a phone', async ({ page }) => {
  for (const path of ['methods/', 'spectrum/']) {
    await page.goto('./' + path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `/${path} sideways overflow`).toBeLessThanOrEqual(0);
  }
});
