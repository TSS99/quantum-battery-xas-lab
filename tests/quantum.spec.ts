import { expect, test } from '@playwright/test';
import { axeViolations } from './axe';

// The Quantum XAS page (/quantum/). Names avoid the word "mobile" so the desktop project runs them; the phone check
// sets a 390 px viewport itself.

function collectErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

const peak = (page: import('@playwright/test').Page, label: string) =>
  page.locator('.qx-readout div').filter({ hasText: label }).locator('dd');

test('the quantum page loads water, rebuilds its spectrum and puts the peak on the exact one', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./quantum/');
  await expect(page).toHaveTitle('Quantum XAS: an X-ray absorption spectrum computed by a quantum algorithm | Beamline Twin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Quantum XAS');
  await expect(page.getByLabel('Absorber and cluster')).toHaveValue('h2o-o-k-sto3g');
  await expect(peak(page, 'Main peak, exact')).toHaveText(/^5\d\d\.\d\d eV$/);
  expect(await peak(page, 'Main peak, measured').textContent()).toBe(await peak(page, 'Main peak, exact').textContent());
  await expect(page.locator('.qx-stage canvas')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://tss99.github.io/quantum-battery-xas-lab/quantum/');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('running the circuits in the browser gives the Python emulator signal', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./quantum/');
  const before = await peak(page, 'Largest difference').textContent();
  await page.getByRole('button', { name: 'Run the circuits in your browser' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'computed here' })).toBeVisible({ timeout: 60_000 });
  // Same seed, same shots, the same signal to 1e-6: the readout does not move.
  await expect(peak(page, 'Largest difference')).toHaveText(before!);
  expect(errors).toEqual([]);
});

test('the controls change the measurement: fewer shots, a shorter evolution, the compressed factorization', async ({ page }) => {
  await page.goto('./quantum/');
  const difference = async () => parseFloat((await peak(page, 'Largest difference').textContent())!);
  const first = await difference();
  await page.getByRole('slider', { name: 'Shots per dipole direction' }).fill('0');
  await expect.poll(difference).toBeGreaterThan(first);
  await page.getByRole('slider', { name: 'Shots per dipole direction' }).fill('6');
  await page.getByRole('slider', { name: 'Evolution length, j_max' }).fill('10');
  await expect.poll(difference).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Compressed' }).click();
  await expect(page.getByRole('button', { name: 'Compressed' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.qx-facts').filter({ hasText: 'Fragments' })).toContainText('7, integral error');
});

test('the twin links the quantum page, and Methods lists the quantum models and their tests', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('link', { name: 'Quantum XAS' })).toHaveAttribute('href', /\/quantum\/$/);
  await page.goto('./methods/');
  const table = page.getByRole('table', { name: 'Quantum XAS models, checks and tests' });
  await expect(table.getByRole('row')).toHaveCount(10);
  await expect(table).toContainText('PennyLane circuit, gate for gate');
  await expect(page.getByRole('table', { name: 'Beamline twin models, checks and tests' }).getByRole('row')).toHaveCount(24);
});

test('the cost section says what each problem needs on a fault tolerant machine', async ({ page }) => {
  await page.goto('./quantum/');
  const cost = page.getByRole('region', { name: 'Cost on a fault tolerant quantum computer' });
  await expect(cost.locator('.qx-readout div').filter({ hasText: 'Logical qubits' }).locator('dd')).toHaveText('78');
  await expect(cost.locator('.qx-machines li').first()).toContainText('This problem fits.');
  await page.getByLabel('Absorber and cluster').selectOption('li2mno3-o2-k-18');
  await expect(cost.locator('.qx-readout div').filter({ hasText: 'Logical qubits' }).locator('dd')).toHaveText('100');
  await expect(cost.locator('.qx-machines li').first()).toContainText('Its longest circuit is too long.');
  await cost.getByRole('spinbutton', { name: 'Gates per circuit' }).fill('1000000000');
  await expect(cost.getByRole('status')).toContainText('Fits.');
  const [file] = await Promise.all([page.waitForEvent('download'), cost.getByRole('button', { name: 'Download the readiness report' }).click()]);
  expect(file.suggestedFilename()).toBe('quantum-readiness-li2mno3-o2-k-18.md');
});

test('the quantum page fits a phone and has no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./quantum/');
  await expect(peak(page, 'Main peak, exact')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await axeViolations(page)).toEqual([]);
});
