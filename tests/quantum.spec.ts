import { readFileSync } from 'node:fs';
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
  page.locator('section[aria-labelledby="qx-spectrum"] .qx-readout div').filter({ hasText: label }).locator('dd');

test('the quantum page loads water, rebuilds its spectrum and puts the peak on the exact one', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./quantum/');
  await expect(page).toHaveTitle('Quantum XAS: an X-ray absorption spectrum computed by a quantum algorithm | Beamline Twin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Quantum XAS');
  await expect(page.getByLabel('Absorber and cluster')).toHaveValue('h2o-o-k-sto3g');
  await expect(peak(page, 'Main peak, exact')).toHaveText(/^5\d\d\.\d\d eV$/);
  expect(await peak(page, 'Main peak, measured').textContent()).toBe(await peak(page, 'Main peak, exact').textContent());
  await expect(page.locator('.qx-stage canvas')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Against experiment' })).toContainText('First peak, O 1s to 4a1: measured 534.00 eV, this model 542.24 eV (+8.24 eV).');
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
  await expect(table.getByRole('row')).toHaveCount(16);
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

test('the beamline measures the oxide clusters and the fit reads the mixture back, from a scan or a file', async ({ page }) => {
  await page.goto('./quantum/');
  const card = page.getByRole('region', { name: 'Measure on a soft X-ray beamline, and compare' });
  const fraction = async (name: string) => parseFloat(await card.locator('tbody tr').filter({ hasText: name }).locator('td').first().innerText());
  const readout = async (name: string) => card.locator('.qx-readout div').filter({ hasText: name }).locator('dd').innerText();
  await expect.poll(async () => Math.abs(await fraction('Li₂MnO₃, O2 site') - 66.7)).toBeLessThan(2);
  await expect.poll(async () => Math.abs(await fraction('Li₂MnO₃, O1 site') - 33.3)).toBeLessThan(2);
  await expect.poll(async () => Math.abs(parseFloat(await readout('Shift applied')))).toBeLessThanOrEqual(0.05);
  const resolution = card.getByRole('slider', { name: 'Candidates, as a quantum run resolves them' });
  await resolution.fill('4');
  await expect(card.getByRole('status').filter({ hasText: 'Longest circuit' })).toContainText('fits the Starling class');
  await resolution.fill('2');
  await expect(card.getByRole('status').filter({ hasText: 'Longest circuit' })).toContainText('needs the Blue Jay class');
  await resolution.fill('0');
  const [scan] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Download the scan' }).click()]);
  expect(scan.suggestedFilename()).toBe('quantum-scan-crystal.csv');

  await card.getByRole('combobox').selectOption('charged');
  await expect.poll(async () => Math.abs(await fraction('one lithium removed') - 30)).toBeLessThan(2);
  await card.getByRole('button', { name: 'Fluorescence yield' }).click();
  await expect.poll(async () => parseFloat((await readout('Misfit')).split('χ²ᵥ')[1])).toBeGreaterThan(10);

  await card.getByLabel('Load your measured spectrum').setInputFiles({ name: 'my-scan.csv', mimeType: 'text/csv', buffer: readFileSync(await scan.path()) });
  await expect(card.getByRole('combobox')).toHaveValue('file');
  await expect.poll(async () => Math.abs(parseFloat(await readout('Shift applied')))).toBeLessThanOrEqual(0.1);
  await expect.poll(async () => Math.abs(await fraction('Li₂MnO₃, O2 site') - 66.7)).toBeLessThan(4);
});

test('electron energy loss turns with q: the pi* of CO across the bond, its sigma* along it', async ({ page }) => {
  await page.goto('./quantum/');
  await page.getByLabel('Absorber and cluster').selectOption('co-o-k-sto3g');
  const card = page.getByRole('region', { name: 'Electron energy loss, for an oriented sample' });
  const loss = (label: string) => card.locator('.qx-readout div').filter({ hasText: label }).locator('dd');
  await card.getByRole('button', { name: 'q along x' }).click();
  await expect(loss('Strongest loss, exact')).toHaveText('540.00 eV');
  await card.getByRole('button', { name: 'q along z' }).click();
  await expect(loss('Strongest loss, exact')).toHaveText(/^556\.\d\d eV$/);
  await expect(card.getByRole('button', { name: 'q along z' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Absorber and cluster').selectOption('li2mno3-o2-k-18');
  await expect(card).toHaveCount(0);
});

test('resonant inelastic scattering maps CO, samples a row, and loses the elastic line across the bond', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./quantum/');
  await page.getByLabel('Absorber and cluster').selectOption('co-o-k-sto3g');
  const card = page.getByRole('region', { name: 'Resonant inelastic X-ray scattering' });
  const readout = (label: string) => card.locator('.qx-readout div').filter({ hasText: label }).locator('dd');
  await expect(card.getByRole('img', { name: /^RIXS map, inelastic part/ })).toBeVisible();
  await expect(readout('Elastic line')).toHaveText(/^\d+\.\d % of samples$/);
  await expect(readout('Block encoding succeeds')).toHaveText(/ %, \d+ rounds$/);
  await card.getByRole('button', { name: 'Oriented' }).click();
  await card.getByRole('button', { name: 'In along x' }).click();
  await card.getByRole('button', { name: 'Out along z' }).click();
  await expect(card.getByRole('button', { name: 'Out along z' })).toHaveAttribute('aria-pressed', 'true');
  await expect(readout('Elastic line')).toHaveText('0.00 % of samples');
  const incident = card.getByRole('slider', { name: 'Incident photon energy' });
  await incident.fill('0');
  await expect(card.locator('output[for="qx-rixs-in"]')).toHaveText('538.00 eV');
  await page.getByLabel('Absorber and cluster').selectOption('li2mno3-o2-k-18');
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Mn L edges split with spin orbit coupling and come in the order of the oxidation states', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./quantum/');
  const card = page.getByRole('region', { name: 'Mn L edges, with spin orbit coupling' });
  const readout = (label: string) => card.locator('.qx-readout div').filter({ hasText: label }).locator('dd');
  const l3 = async () => parseFloat((await readout('L₃, centroid').textContent())!);
  await expect(readout('L₂ above L₃')).toHaveText(/^1[01]\.\d\d eV$/);
  const four = await l3();
  await card.getByRole('button', { name: 'Mn²⁺' }).click();
  await expect.poll(l3).toBeLessThan(four);
  await card.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(readout('L₃ share')).toHaveText('no L₃ or L₂');
  expect(errors).toEqual([]);
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
