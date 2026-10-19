import { expect, test, type Page } from '@playwright/test';

// Browser tests for the /twin/ preview. Names avoid the word "mobile" so the desktop project runs them;
// the phone checks set a 390 px viewport themselves.
const MODES = ['Transmission', 'Fluorescence', 'Electron yield', 'XRF spectrum', 'Monochromator', 'Energy calibration', 'Time resolved', 'Beam damage'];
// axe-core is not a dependency of the project, so the accessibility check loads a pinned copy from a CDN.
const AXE_URL = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';

const mode = (page: Page, name: string) => page.getByRole('group', { name: 'Modes' }).getByRole('button', { name, exact: true });
const changed = (page: Page) => page.locator('.twin-changed [aria-live="polite"]');

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

async function openTwin(page: Page, hash = '') {
  await page.goto('./twin/' + hash);
  // The drawing appears once the X-ray tables have loaded and the page has hydrated.
  await expect(page.getByRole('img', { name: /^Beamline drawing/ })).toBeVisible();
}

async function axeViolations(page: Page) {
  try { await page.addScriptTag({ url: AXE_URL }); } catch { test.skip(true, `axe-core could not be loaded from ${AXE_URL}`); }
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
  });
}

test('twin page loads with one h1, a preview breadcrumb, noindex and no console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page);
  await expect(page).toHaveTitle('Beamline twin | XAS Lab');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beamline twin');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs.getByRole('link', { name: 'Beamline twin' })).toHaveAttribute('aria-current', 'page');
  await expect(crumbs).toContainText('Preview');
  await expect(crumbs).not.toContainText('Page not found');
  const modules = page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link');
  await expect(modules).toHaveCount(8);
  await expect(modules.filter({ hasText: 'Beamline twin' })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('modes switch by click and by keys 1 to 8, and the mode and seed round-trip through the hash', async ({ page }) => {
  await openTwin(page);
  await mode(page, 'Fluorescence').click();
  await expect(mode(page, 'Fluorescence')).toHaveAttribute('aria-pressed', 'true');
  await expect(mode(page, 'Transmission')).toHaveAttribute('aria-pressed', 'false');
  await expect(page).toHaveURL(/#mode=fluorescence&seed=1$/);
  await expect(changed(page)).toContainText('Fluorescence');
  await expect(page.getByRole('complementary', { name: 'Explanation' })).toContainText('self-absorption');
  for (const [i, name] of MODES.entries()) {
    await page.keyboard.press(String(i + 1));
    await expect(mode(page, name)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Modes' }).locator('[aria-pressed="true"]')).toHaveCount(1);
  }
  await expect(page).toHaveURL(/#mode=damage&seed=1$/);
  await page.goto('./twin/#mode=xrf&seed=7');
  await expect(mode(page, 'XRF spectrum')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('2');
  await expect(page).toHaveURL(/#mode=fluorescence&seed=7$/);
});

test('shortcut keys are ignored while typing in a field', async ({ page }) => {
  await openTwin(page);
  const field = page.getByRole('spinbutton', { name: /Type an energy/ });
  await field.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('7112');
  await expect(mode(page, 'Transmission')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Realistic', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('slider', { name: 'Photon energy', exact: true })).toHaveValue('7112');
  await expect(changed(page)).toContainText('Energy set to');
  await expect(page.locator('.beam-legend')).toContainText('Bragg angle');
  // Out of the field the same keys act again.
  await mode(page, 'Transmission').focus();
  await page.keyboard.press('7');
  await expect(mode(page, 'Time resolved')).toHaveAttribute('aria-pressed', 'true');
});

test('the Realistic switch toggles by click and by C', async ({ page }) => {
  await openTwin(page);
  const educational = page.getByRole('button', { name: 'Educational', exact: true }), realistic = page.getByRole('button', { name: 'Realistic', exact: true });
  await expect(educational).toHaveAttribute('aria-pressed', 'true');
  await realistic.click();
  await expect(realistic).toHaveAttribute('aria-pressed', 'true');
  await expect(educational).toHaveAttribute('aria-pressed', 'false');
  await expect(changed(page)).toContainText('Realistic detectors');
  await page.keyboard.press('c');
  await expect(educational).toHaveAttribute('aria-pressed', 'true');
  await expect(realistic).toHaveAttribute('aria-keyshortcuts', 'C');
});

test('results dock tabs, Acquire, Enlarge, labels and rails respond to clicks and keys', async ({ page }) => {
  await openTwin(page);
  const tabs = page.getByRole('tablist', { name: 'Result views' }).getByRole('tab');
  await expect(tabs).toHaveCount(8);
  await page.getByRole('tab', { name: 'χ(k)', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'χ(k)', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '|χ(R)|', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('not connected yet');
  await page.keyboard.press('i');
  await expect(changed(page)).toContainText('Nothing was recorded');
  const enlarge = page.getByRole('button', { name: 'Enlarge', exact: true });
  await page.keyboard.press('x');
  await expect(enlarge).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('img', { name: /^Beamline drawing/ })).toBeHidden();
  // The enlarged results move up into the scene's place rather than leaving its row empty.
  const gap = await page.evaluate(() => document.querySelector('.twin-dock')!.getBoundingClientRect().top - document.querySelector('.twin-modes')!.getBoundingClientRect().bottom);
  expect(gap).toBeLessThan(40);
  await page.keyboard.press('Escape');
  await expect(enlarge).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('img', { name: /^Beamline drawing/ })).toBeVisible();
  await page.keyboard.press('l');
  await expect(page.getByRole('button', { name: 'Labels', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('[');
  await expect(page.getByRole('complementary', { name: 'Explanation' })).toBeHidden();
  await page.keyboard.press(']');
  await expect(page.getByRole('complementary', { name: 'Controls' })).toBeHidden();
  await page.getByRole('button', { name: 'Explanation', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Explanation' })).toBeVisible();
});

test('keyboard shortcuts dialog lists the keys, blocks them while open and returns focus', async ({ page }) => {
  await openTwin(page);
  const opener = page.getByRole('button', { name: 'Keyboard shortcuts' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('row')).toHaveCount(17);
  await page.keyboard.press('4');
  await expect(mode(page, 'Transmission')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('phone layout: one column, sticky mode bar, folded explanation and controls, no horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTwin(page);
  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await width()).toBeLessThanOrEqual(390);
  expect(await page.locator('.twin-modes').evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  // Scroll snapping must not shift the bar on load: the first group name and mode start in view.
  expect(await page.locator('.twin-modes').evaluate(el => el.scrollLeft)).toBe(0);
  await expect(page.locator('.twin-mode-group-name', { hasText: 'Measure' })).toBeInViewport({ ratio: 1 });
  // Both rails always show in one column, so [ changes nothing.
  await page.keyboard.press('[');
  await expect(page.getByRole('complementary', { name: 'Explanation' })).toBeVisible();
  await expect(changed(page)).not.toContainText('hidden');
  await expect(page.getByRole('button', { name: 'What you are looking at' })).toHaveAttribute('aria-expanded', 'false');
  const controls = page.getByRole('complementary', { name: 'Controls' });
  await expect(controls.getByRole('button', { name: 'Monochromator', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('slider', { name: 'Photon energy', exact: true })).toBeHidden();
  await page.keyboard.press('8');
  await expect(mode(page, 'Beam damage')).toBeInViewport();
  await page.getByRole('button', { name: 'What you are looking at' }).click();
  await expect(page.getByRole('complementary', { name: 'Explanation' })).toContainText('dose rate');
  await controls.getByRole('button', { name: 'Scan', exact: true }).click();
  expect(await width()).toBeLessThanOrEqual(390);
  // Widening the same window opens the sections that start open on desktop.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(controls.getByRole('button', { name: 'Monochromator', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('slider', { name: 'Photon energy', exact: true })).toBeVisible();
});

test('axe finds no accessibility violations on the twin page at 1440 and 390 px', async ({ page }) => {
  await openTwin(page);
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await openTwin(page);
  await page.getByRole('button', { name: 'What you are looking at' }).click();
  expect(await axeViolations(page)).toEqual([]);
});
