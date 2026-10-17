import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const modules = [
  ['Overview', ''],
  ['Battery & crystal', 'crystal'],
  ['XAS beamline', 'beamline'],
  ['Spectra studio', 'spectra'],
  ['Electronic structure', 'electronic'],
  ['Quantum dynamics', 'quantum'],
  ['Experiments', 'experiments'],
  ['Methods & validation', 'validation'],
] as const;

function metric(page: Page, label: string) {
  return page.locator('.metric').filter({ hasText: label });
}

test('all eight modules are navigable and keep a single main title', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('./');
  for (const [name, route] of modules) {
    await page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link', { name, exact: false }).click();
    if (route) await expect(page).toHaveURL(new RegExp(`/${route}/$`));
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect(failures).toEqual([]);
});

test('lithium slider obeys charge balance and remains synchronized across modules', async ({ page }) => {
  await page.goto('./crystal/');
  const lithium = page.getByRole('slider', { name: 'Lithium content', exact: true });
  await lithium.focus();
  await lithium.press('End');
  await expect(lithium).toHaveValue('1');
  await expect(metric(page, 'Nominal Mn oxidation')).toContainText('+3.00');
  await expect(page.getByRole('img', { name: '100 percent nominal manganese three plus' })).toBeVisible();
  await lithium.press('Home');
  await expect(metric(page, 'Nominal Mn oxidation')).toContainText('+4.00');
  await page.getByRole('navigation').getByRole('link', { name: 'XAS beamline' }).click();
  await expect(page.getByRole('slider', { name: 'Lithium content', exact: true })).toHaveValue('0');
  await expect(metric(page, 'Nominal Mn oxidation')).toContainText('+4.00');
});

test('beamline energy and thickness update actual counts with a provenance link', async ({ page }) => {
  await page.goto('./beamline/');
  await expect(page.getByText('Synthetic educational model', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Model provenance and limits' })).toBeVisible();
  const energy = page.getByRole('slider', { name: 'Photon energy', exact: true });
  await energy.focus();
  await energy.press('Home');
  const initialAbsorption = await metric(page, 'Absorption').locator('strong').innerText();
  await energy.press('End');
  await expect(energy).toHaveValue('6580');
  await expect(metric(page, 'Absorption').locator('strong')).not.toHaveText(initialAbsorption);
  const thickness = page.getByRole('slider', { name: 'Sample thickness', exact: true });
  await thickness.focus();
  await thickness.press('Home');
  const thinCounts = Number.parseFloat(await metric(page, 'Transmitted').locator('strong').innerText());
  await thickness.press('End');
  const thickCounts = Number.parseFloat(await metric(page, 'Transmitted').locator('strong').innerText());
  expect(thickCounts).toBeGreaterThanOrEqual(0);
  expect(thickCounts).toBeLessThan(thinCounts);
  expect(thinCounts).toBeLessThanOrEqual(100000);
  await page.getByRole('checkbox', { name: 'Simulate Poisson detector counts' }).check();
  const seed = page.getByRole('spinbutton', { name: 'Random seed' });
  const previousSeed = Number(await seed.inputValue());
  await page.getByRole('button', { name: 'New seeded draw' }).click();
  await expect(seed).toHaveValue(String((previousSeed + 1) >>> 0));
  await expect(page.getByText(/Zero counts make logarithmic attenuation undefined/)).toBeVisible();
});

test('spectra validates imports without losing valid runs and exports provenance', async ({ page }) => {
  await page.goto('./spectra/');
  const imported = {
    name: 'Synthetic test sample', provenance: 'synthetic',
    energy_eV: [6530, 6540, 6550, 6560, 6570],
    mu_cm_inv: [18, 20, 75, 128, 130],
    sigma_mu_cm_inv: [1, 1, 2, 2, 2],
    calibration: { reference: 'test-only axis', status: 'uncalibrated', offset_eV: 0 },
  };
  const input = page.getByLabel('Import spectrum CSV or JSON');
  await input.setInputFiles({ name: 'synthetic-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByRole('button', { name: 'Synthetic test sample', exact: true })).toBeVisible();
  await expect(page.getByText('Imported synthetic', { exact: true }).first()).toBeVisible();
  await input.setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('energy,mu\n6530,1\n6540,2') });
  // Next.js also renders an empty route-announcer alert, so match the validation message itself.
  await expect(page.getByRole('alert').filter({ hasText: 'CSV headers' })).toContainText('CSV headers must be energy_eV,mu_cm_inv');
  await expect(page.getByRole('button', { name: 'Synthetic test sample', exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Raw JSON', exact: true }).click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, 'utf8'));
  expect(exported.spectrum.declaredProvenance).toBe('synthetic');
  expect(exported.spectrum.provenance).toBe('imported');
  expect(exported.spectrum.mu_cm_inv).toEqual(imported.mu_cm_inv);
  expect(exported.spectrum.sigma_mu_cm_inv).toEqual(imported.sigma_mu_cm_inv);
  expect(exported.spectrum.calibration.status).toBe('uncalibrated');
  await page.getByRole('button', { name: 'Fit selected raw spectrum' }).click();
  await expect(page.getByRole('heading', { name: 'Fit audit', exact: true })).toBeVisible({ timeout: 30_000 });
});

test('mobile modules fit the viewport and respect reduced-motion preference', async ({ page }) => {
  await page.goto('./');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  for (const width of [375, 390]) {
   await page.setViewportSize({ width, height: 844 });
   for (const [name] of modules) {
    await page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link', { name, exact: false }).click();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    const geometry = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(geometry.content, `${name} should not cause page-wide horizontal overflow`).toBeLessThanOrEqual(geometry.viewport + 1);
   }
  }
});


test('overview starting paths choose a module and explanation level', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Synthetic educational model', { exact: true })).toBeVisible();
  await expect(page.getByText(/not quantitatively predictive data/)).toBeVisible();
  for (const [audience, route, mode] of [['Student', 'crystal', 'Explore'], ['Researcher', 'quantum', 'Research'], ['Industry R&D', 'spectra', 'Research']]) {
    await page.goto('./');
    await page.locator('.module-card').filter({ hasText: audience }).click();
    await expect(page).toHaveURL(new RegExp('/' + route + '/$'));
    await expect(page.getByRole('button', { name: mode, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
});

test('explanation level changes the guidance in every module', async ({ page }) => {
  await page.goto('./');
  for (const [name] of modules) {
    await page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Try this', exact: true }).first()).toBeVisible();
    const explanation = await page.locator('.try-this').first().innerText();
    await page.getByRole('button', { name: 'Research', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Model note', exact: true }).first()).toBeVisible();
    await expect(page.locator('.try-this').first()).not.toHaveText(explanation);
  }
});

test('guided controls report composition and orbital changes', async ({ page }) => {
  await page.goto('./crystal/');
  const lithium = page.getByRole('slider', { name: 'Lithium content', exact: true });
  await lithium.focus();
  await lithium.press('End');
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('At x = 1.00, nominal Mn is +3.00');
  await expect(page.locator('.delta-readout')).toContainText('+0.50');
  await page.getByRole('navigation').getByRole('link', { name: 'Electronic structure', exact: true }).click();
  await page.getByRole('button', { name: /1s → d-like character/ }).click();
  await page.getByRole('button', { name: 'Illustrate excitation' }).click();
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('dashed circle marks the core hole');
});

test('plot inspection includes units and SVG export remains standalone', async ({ page }) => {
  await page.goto('./spectra/');
  await page.getByRole('button', { name: 'Derivative', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('dμ/dE');
  const plot = page.getByRole('img', { name: /spectra-derivative:/ });
  await plot.focus();
  await plot.press('ArrowRight');
  await expect(page.locator('.plot-readout').first()).toContainText('eV');
  await expect(page.locator('.plot-legend').first()).toContainText('cm⁻¹ eV⁻¹');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download spectra-derivative as SVG' }).click();
  const file = await downloading;
  const svg = await readFile((await file.path())!, 'utf8');
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('<title>dμ/dE (cm⁻¹ eV⁻¹) versus Photon energy (eV)</title>');
  expect(svg).toContain('eV</text>');
});

test('quantum reference compares completed runs and validation reports actual checks', async ({ page }) => {
  await page.goto('./quantum/');
  const keep = page.getByRole('button', { name: 'Keep run as reference' });
  await expect(keep).toBeEnabled({ timeout: 30_000 });
  await keep.click();
  const steps = page.getByRole('slider', { name: 'Trotter steps', exact: true });
  await steps.focus();
  await steps.press('Home');
  await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('Trotter spectral L¹ error changed from', { timeout: 30_000 });
  await page.getByRole('navigation').getByRole('link', { name: 'Methods & validation', exact: true }).click();
  await expect(page.getByText(/not quantitatively predictive data/)).toBeVisible();
  await page.getByRole('button', { name: 'Run sanity checks' }).click();
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('9 of 9 checks passed', { timeout: 30_000 });
});
