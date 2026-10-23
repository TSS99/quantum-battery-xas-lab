import { expect, test, type Page } from '@playwright/test';

// The calculator pages and the instructors page: static content, live calculators and their links.
const result = (page: Page) => page.locator('.tool-result');

test('calculator index links all four calculators, each with a breadcrumb and a worked-example table', async ({ page }) => {
  await page.goto('./tools/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beamline calculators');
  const names = ['Ion chamber gas', 'Harmonic rejection mirror', 'Self absorption', 'X-ray dose'];
  for (const name of names) await expect(page.getByRole('main').getByRole('link', { name, exact: true }).first()).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'X-ray dose', exact: true }).first().click();
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link');
  await expect(crumbs).toHaveText(['Overview', 'Calculators', 'X-ray dose']);
  await expect(crumbs.last()).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('table').first()).toBeVisible();
});

test('ion chamber gas: suggests a fill, follows the edge picker and the chamber role', async ({ page }) => {
  await page.goto('./tools/ion-chamber-gas/');
  await expect(result(page)).toContainText('N₂ 96 %, Ar 4 %');
  await expect(page.getByLabel('Edge', { exact: true })).toHaveValue('Cu K');
  await page.getByLabel('Edge', { exact: true }).selectOption('Mo K');
  await expect(page.getByLabel('Energy (eV)')).toHaveValue('20000');
  await expect(result(page)).toContainText('Ar 80 %, N₂ 20 %');
  await page.getByLabel('Chamber', { exact: true }).selectOption('It');
  await page.getByLabel('Active length (cm)').fill('30');
  await expect(result(page)).toContainText('Ar 84 %, Kr 16 %');
  await page.getByLabel('Active length (cm)').fill('0');
  await expect(result(page).getByRole('alert')).toHaveText('Length must be a number above zero.');
  // The table printed into the page has the same answer for Mo K.
  await expect(page.getByRole('region', { name: 'Fills at common edges' }).getByRole('row', { name: /^Mo\s*K/ })).toContainText('Ar 84 %, Kr 16 %');
});

test('harmonic rejection mirror: gives the angle or says why there is none', async ({ page }) => {
  await page.goto('./tools/harmonic-rejection-mirror/');
  await expect(result(page)).toContainText('6 mrad');
  await page.getByLabel('Coating', { exact: true }).selectOption('Si');
  await expect(result(page)).toContainText('3.25 mrad');
  await page.getByLabel('Fundamental energy (eV)').fill('25000');
  await expect(result(page).getByRole('status')).toContainText('tabulated');
});

test('self absorption: strong for a thick pellet, less once diluted, with an error for an unreadable formula', async ({ page }) => {
  await page.goto('./tools/self-absorption/');
  await expect(result(page)).toContainText('28.6%');
  await expect(result(page)).toContainText('Kα line');
  await page.getByLabel('Chemical formula').fill('NiO(BN)20');
  await page.getByLabel('Density (g/cm³)').fill('1.6');
  await page.getByLabel('Thickness (µm)').fill('500');
  await expect(result(page)).toContainText('43.9%');
  await page.getByLabel('Chemical formula').fill('Xq2');
  await expect(result(page).getByRole('alert')).toBeVisible();
});

test('x-ray dose: dose rate and times, and an error for a flux that is not a number', async ({ page }) => {
  await page.goto('./tools/x-ray-dose/');
  await expect(result(page)).toContainText('Mean dose rate');
  await expect(result(page).getByRole('row')).toHaveCount(5);
  await page.getByLabel('Flux on the sample (photons/s)').fill('abc');
  await expect(result(page).getByRole('alert')).toHaveText('Flux must be a number above zero.');
});

test('instructors page lists every training task and its link opens that task in the twin', async ({ page }) => {
  await page.goto('./instructors/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Teach XAS with the beamline twin: class links and results');
  const tasks = page.getByRole('region', { name: 'The tasks' }).getByRole('row');
  await expect(tasks).toHaveCount(10);
  await page.getByRole('link', { name: 'Calibrate the energy with a Cu foil', exact: true }).click();
  await expect(page).toHaveURL(/\/twin\/#train=s1-calibrate&seed=1$/);
  await expect(page.getByRole('dialog')).toContainText('Calibrate the energy with a Cu foil');
});
