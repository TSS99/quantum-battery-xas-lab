import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Browser tests for the /twin/ beamline twin. Names avoid the word "mobile" so the desktop project runs them;
// the phone checks set a 390 px viewport themselves.
const MODES = ['Transmission', 'Fluorescence', 'Electron yield', 'XRF spectrum', 'Monochromator', 'Energy calibration', 'Time resolved', 'Beam damage'];
// axe-core is not a dependency of the project, so the accessibility check loads a pinned copy from a CDN.
const AXE_URL = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';

const mode = (page: Page, name: string) => page.getByRole('group', { name: 'Modes' }).getByRole('button', { name, exact: true });
const changed = (page: Page) => page.locator('.twin-changed [aria-live="polite"]');

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  // A failed attempt to fetch the axe-core test helper from its CDN is the test's own network, not the page's.
  page.on('console', m => { if (m.type() === 'error' && !m.location().url.startsWith(AXE_URL)) errors.push(m.text()); });
  return errors;
}

async function openTwin(page: Page, hash = '') {
  await page.goto('./twin/' + hash);
  // The drawing appears once the X-ray tables have loaded and the page has hydrated.
  await expect(page.getByRole('img', { name: /^Beamline drawing/ })).toBeVisible();
}

async function axeViolations(page: Page) {
  // The CDN occasionally drops or stalls a request; give each try 15 s and try three times before giving up on the check.
  let loaded = false;
  for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
    const stalled = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stalled')), 15_000));
    try { await Promise.race([page.addScriptTag({ url: AXE_URL }), stalled]); loaded = true; } catch { await page.waitForTimeout(1000); }
  }
  if (!loaded) test.skip(true, `axe-core could not be loaded from ${AXE_URL}`);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
  });
}

test('twin page loads with one h1, a breadcrumb, indexable metadata and no console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page);
  await expect(page).toHaveTitle('Beamline twin: operate an XAS beamline in your browser | XAS Lab');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beamline twin');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs.getByRole('link', { name: 'Beamline twin' })).toHaveAttribute('aria-current', 'page');
  await expect(crumbs).not.toContainText('Preview');
  await expect(crumbs).not.toContainText('Page not found');
  // The twin runs full screen: no site header or module bar, and the breadcrumb leads back to the lab.
  await expect(page.getByRole('navigation', { name: 'Laboratory modules' })).toHaveCount(0);
  await expect(crumbs.getByRole('link', { name: 'XAS Lab' })).toHaveAttribute('href', /\/quantum-battery-xas-lab\/?$|^\/$/);
  // Chromium has speech synthesis, so the explanation offers to read itself aloud.
  await expect(page.getByRole('complementary', { name: 'Explanation' }).getByRole('button', { name: 'Read aloud' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://tss99.github.io/quantum-battery-xas-lab/twin/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/og\/twin\.png$/);
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('modes switch by click and by keys 1 to 8, and the mode and seed round-trip through the hash', async ({ page }) => {
  await openTwin(page);
  await mode(page, 'Fluorescence').click();
  await expect(mode(page, 'Fluorescence')).toHaveAttribute('aria-pressed', 'true');
  await expect(mode(page, 'Transmission')).toHaveAttribute('aria-pressed', 'false');
  await expect(page).toHaveURL(/#v=1&mode=fluorescence&seed=1&s=/);
  await expect(changed(page)).toContainText('Fluorescence');
  await expect(page.getByRole('complementary', { name: 'Explanation' })).toContainText('self-absorption');
  for (const [i, name] of MODES.entries()) {
    await page.keyboard.press(String(i + 1));
    await expect(mode(page, name)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Modes' }).locator('[aria-pressed="true"]')).toHaveCount(1);
  }
  await expect(page).toHaveURL(/#v=1&mode=damage&seed=1&s=/);
  await page.goto('./twin/#mode=xrf&seed=7');
  await expect(mode(page, 'XRF spectrum')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('2');
  await expect(page).toHaveURL(/#v=1&mode=fluorescence&seed=7&s=/);
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
  await expect(page.getByRole('complementary', { name: 'Explanation' }).locator('.twin-stats')).toContainText('Bragg angle');
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
  await expect(tabs).toHaveCount(9);
  await page.getByRole('tab', { name: 'χ(k)', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'χ(k)', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '|χ(R)|', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Press Acquire');
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

test('hutch scene: every part is a button that opens its card, labels toggle, and the mode lights its path', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page);
  const scene = page.locator('.hutch');
  const part = (name: string) => scene.getByRole('button', { name, exact: true });
  await expect(scene.locator('.hutch-parts').getByRole('button')).toHaveCount(19);
  await part('I0 chamber').click();
  await expect(part('I0 chamber')).toHaveAttribute('aria-expanded', 'true');
  const card = page.getByRole('region', { name: 'I0 chamber' });
  await expect(card).toContainText('ion chamber');
  await expect(card).toContainText('absorbs');
  await expect(card).toContainText('What goes wrong');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(part('I0 chamber')).toBeFocused();
  // Without labels every part is still a button, drawn as a dot on the hardware.
  await page.getByRole('button', { name: 'Labels', exact: true }).click();
  await expect(scene).toHaveClass(/no-labels/);
  await expect(scene.locator('.hutch-parts').getByRole('button')).toHaveCount(19);
  await part('Monochromator').click();
  await expect(page.getByRole('region', { name: 'Monochromator' })).toContainText('it passes');
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press('l');
  await expect(scene).not.toHaveClass(/no-labels/);
  // Transmission lights the beam through the sample to It; fluorescence lights the detector instead.
  const leg = (name: string) => scene.locator(`[data-leg="${name}"]`).first();
  await expect(leg('sample-to-it')).toHaveClass(/is-lit/);
  await expect(part('It chamber')).toHaveClass(/is-focus/);
  await mode(page, 'Fluorescence').click();
  await expect(leg('sample-to-it')).not.toHaveClass(/is-lit/);
  await expect(leg('to-detector')).toHaveClass(/is-lit/);
  await expect(part('Fluorescence detector')).toHaveClass(/is-focus/);
  await expect(part('It chamber')).toHaveClass(/is-idle/);
  await mode(page, 'Electron yield').click();
  await expect(leg('to-ammeter')).toHaveClass(/is-lit/);
  await mode(page, 'Monochromator').click();
  await expect(scene).toHaveClass(/cue-rocking/);
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('3D hutch: shown by default, its parts open their cards, and the diagram choice is remembered', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page);
  const view = page.getByRole('button', { name: '3D view', exact: true });
  await expect(view).toHaveAttribute('aria-pressed', 'true');
  const scene = page.locator('.hutch-3d');
  await expect(page.getByRole('img', { name: /^Beamline drawing, 3D view, transmission mode/ })).toBeVisible();
  await expect(scene.locator('canvas')).toBeVisible();
  // The labels are page buttons placed over the model; the mode's parts are in view, the rest wait at the edges.
  await expect(scene.locator('.hutch-parts').getByRole('button')).toHaveCount(19);
  const itChamber = scene.getByRole('button', { name: 'It chamber', exact: true });
  await expect(itChamber).not.toHaveAttribute('data-outside');
  await itChamber.click();
  await expect(page.getByRole('region', { name: 'It chamber' })).toContainText('What goes wrong');
  await page.keyboard.press('Escape');
  await expect(scene.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('data-outside', '');
  // Picking a part off the view turns the camera to it.
  await scene.getByRole('button', { name: 'Monochromator', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Monochromator' })).toBeVisible();
  await expect(scene.getByRole('button', { name: 'Monochromator', exact: true })).not.toHaveAttribute('data-outside');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(scene.getByRole('button', { name: 'Monochromator', exact: true })).toHaveAttribute('data-outside', '');
  // The whole beamline fits the box.
  await page.getByRole('button', { name: 'Whole beamline', exact: true }).click();
  for (const name of ['Source', 'Monochromator', 'Beam stop']) await expect(scene.getByRole('button', { name, exact: true })).not.toHaveAttribute('data-outside');
  // The diagram stays chosen after a reload.
  await view.click();
  await expect(view).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.hutch-3d')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('img', { name: /^Beamline drawing, transmission mode/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '3D view', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.getByRole('img', { name: /^Beamline drawing, 3D view/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Acquire runs a scan in the worker: points build up, the acquisition is stored and downloads as XDI', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page, '#mode=transmission&seed=7');
  await page.getByRole('tab', { name: 'μ(E)', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Acquire/ })).toBeEnabled();
  await page.keyboard.press('i');
  await expect(changed(page)).toContainText('Acquiring one scan');
  await expect(page.getByRole('progressbar', { name: 'Scan progress' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(changed(page)).toContainText('Acquisition 1 stored', { timeout: 30_000 });
  await expect(page.getByRole('tabpanel').locator('svg path').first()).toBeVisible();
  const gallery = page.getByRole('region', { name: 'Acquisitions' });
  await expect(gallery.getByRole('listitem')).toHaveCount(1);
  // The Cu foil is in the FEFF library, so the scan's EXAFS is its path sum.
  await expect(page.getByRole('tabpanel')).toContainText('Fine structure: FEFF paths of Cu');
  const [download] = await Promise.all([page.waitForEvent('download'), gallery.getByRole('button', { name: 'Download acquisition 1 as XDI' }).click()]);
  expect(download.suggestedFilename()).toBe('twin-1-CuK.xdi');
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toMatch(/^# XDI\/1\.0 /);
  for (const field of ['Element.symbol: Cu', 'Element.edge: K', 'Mono.d_spacing: 3.135601', 'Column.1: energy eV']) expect(text).toContain('# ' + field);
  await page.getByRole('tab', { name: 'Normalized', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('edge step');
  await page.getByRole('tab', { name: 'χ(k)', exact: true }).click();
  await expect(page.getByRole('tabpanel').locator('svg path').first()).toBeVisible();
  // The first shell fit uses the same FEFF paths, so it lands near the values that made the spectrum.
  await page.getByRole('tab', { name: 'Fit', exact: true }).click();
  const fitTable = page.getByRole('table', { name: 'First shell fit' });
  await expect(fitTable.getByRole('columnheader', { name: 'Used by the twin' })).toBeVisible();
  await expect(fitTable.getByRole('row')).toHaveCount(5);
  await expect(page.getByRole('tabpanel')).toContainText('independent points');
  await page.getByRole('tab', { name: 'Live channels', exact: true }).click();
  await expect(page.getByRole('tabpanel')).not.toContainText('clipped');
  await page.getByRole('tab', { name: 'XRF spectrum', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('saturated');
  await page.getByRole('tab', { name: 'Rocking curve', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('third harmonic');

  // Sessions restore the gallery after a reload; importing the exported XDI adds measured data.
  await page.getByRole('button', { name: 'Session', exact: true }).click();
  let sessionDialog = page.getByRole('dialog', { name: 'Session' });
  const [sessionDownload] = await Promise.all([page.waitForEvent('download'), sessionDialog.getByRole('button', { name: 'Save session' }).click()]);
  expect(sessionDownload.suggestedFilename()).toBe('xaslab-twin-session.json');
  await sessionDialog.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(page.getByRole('img', { name: /^Beamline drawing/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Acquisitions' }).getByRole('listitem')).toHaveCount(0);
  await page.getByRole('button', { name: 'Session', exact: true }).click();
  sessionDialog = page.getByRole('dialog', { name: 'Session' });
  await sessionDialog.getByLabel('Session file').setInputFiles((await sessionDownload.path())!);
  await expect(sessionDialog.getByRole('status')).toContainText('restored its acquisitions');
  await sessionDialog.getByRole('button', { name: 'Close' }).click();
  const restoredGallery = page.getByRole('region', { name: 'Acquisitions' });
  await expect(restoredGallery.getByRole('listitem')).toHaveCount(1);
  await restoredGallery.getByLabel('Acquisition data file').setInputFiles((await download.path())!);
  await expect(restoredGallery.getByRole('status')).toContainText('imported as measured data');
  await expect(restoredGallery.getByRole('listitem')).toHaveCount(2);
  await expect(restoredGallery.getByRole('listitem').nth(1)).toContainText('Measured');
  const [larchDownload] = await Promise.all([page.waitForEvent('download'), restoredGallery.getByRole('button', { name: 'Download acquisition 2 as Larch' }).click()]);
  const larchText = await readFile(await larchDownload.path(), 'utf8');
  expect(larchText).toContain('pre_edge(');
  expect(larchText).toContain('autobk(');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('Space pauses and resumes a running scan', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page, '#mode=transmission&seed=7');
  await expect(page.getByRole('button', { name: /^Acquire/ })).toBeEnabled();
  await page.keyboard.press('i');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeVisible();
  await page.keyboard.press('Space');
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await expect(changed(page)).toContainText('Scan paused at point');
  const bar = page.getByRole('progressbar', { name: 'Scan progress' });
  const held = await bar.getAttribute('aria-valuenow');
  await page.waitForTimeout(800);
  await expect(bar).toHaveAttribute('aria-valuenow', held!);
  await page.keyboard.press('Space');
  await expect(changed(page)).toContainText('Scan resumed');
  await expect(changed(page)).toContainText('Acquisition 1 stored', { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('Pop out shows the results in a second window with its own view list', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page, '#mode=transmission&seed=7');
  await page.getByRole('tab', { name: 'Rocking curve', exact: true }).click();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Pop out' }).click()]);
  await expect(popup.getByRole('heading', { level: 1 })).toContainText('Results');
  const view = popup.getByRole('combobox', { name: 'View' });
  await expect(view).toHaveValue('rocking');
  await expect(popup.getByRole('slider', { name: /^twin-rocking/ })).toBeVisible();
  await view.selectOption('xrf');
  await expect(popup.getByRole('slider', { name: /^twin-xrf/ })).toBeVisible();
  await expect(changed(page)).toContainText('opened in a second window');
  await expect(popup.locator('.katex-error')).toHaveCount(0);
  await popup.close();
  expect(errors).toEqual([]);
});

test('the XRF counting window moves by dragging its edge and by the keyboard controls', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page, '#mode=xrf&seed=7');
  await page.getByRole('tab', { name: 'XRF spectrum', exact: true }).click();
  const controls = page.getByRole('complementary', { name: 'Controls' });
  const fold = controls.getByRole('button', { name: 'Fluorescence detector', exact: true });
  if (await fold.getAttribute('aria-expanded') === 'false') await fold.click();
  const to = controls.getByRole('slider', { name: 'Counting window to' });
  const before = Number(await to.inputValue());
  const grip = page.getByRole('tabpanel').locator('[data-band-edge="to"]');
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(changed(page)).toContainText('Counting window set to');
  await expect.poll(async () => Number(await to.inputValue())).toBeGreaterThan(before + 50);
  const dragged = Number(await to.inputValue());
  await to.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Number(await to.inputValue())).toBeLessThan(dragged);
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the explanation switches between General and Physics, remembers it, and auto narrate toggles', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page, '#mode=transmission&seed=7');
  const card = page.getByRole('complementary', { name: 'Explanation' });
  const level = card.getByRole('group', { name: 'Explanation level' });
  await expect(level.getByRole('button', { name: 'General' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('goes straight through the sample');
  await expect(card).not.toContainText('Beer-Lambert');
  await level.getByRole('button', { name: 'Physics' }).click();
  await expect(card).toContainText('Beer-Lambert');
  await page.reload();
  await expect(page.getByRole('img', { name: /^Beamline drawing/ })).toBeVisible();
  await expect(level.getByRole('button', { name: 'Physics' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('Beer-Lambert');
  const narrate = card.getByRole('button', { name: 'Auto narrate' });
  await expect(narrate).toHaveAttribute('aria-pressed', 'false');
  await narrate.click();
  await expect(narrate).toHaveAttribute('aria-pressed', 'true');
  await narrate.click();
  await expect(narrate).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('every controls section changes the instrument and says what changed', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page);
  const controls = page.getByRole('complementary', { name: 'Controls' });
  const open = async (title: string) => {
    const fold = controls.getByRole('button', { name: title, exact: true });
    if (await fold.getAttribute('aria-expanded') === 'false') await fold.click();
  };
  await open('Source');
  await controls.getByRole('slider', { name: 'Ring current' }).fill('200');
  await expect(changed(page)).toContainText('Ring current');
  await open('Mirrors');
  await controls.getByRole('checkbox', { name: /M3, harmonic rejection/ }).check();
  await expect(changed(page)).toContainText('inserted');
  await controls.getByLabel('Crystals').selectOption('Si311');
  await expect(changed(page)).toContainText('Si(311)');
  await controls.getByRole('slider', { name: 'Second crystal detune' }).fill('30');
  await expect(changed(page)).toContainText('30 %');
  await open('Ion chambers');
  const it = controls.locator('.twin-chamber').nth(1);
  await it.getByLabel('Amplifier gain').selectOption('10');
  await expect(it).toContainText('OVER');
  await controls.getByRole('button', { name: 'Auto gain' }).click();
  await expect(it).not.toContainText('OVER');
  await expect(changed(page)).toContainText('Amplifier gains set');
  await controls.getByRole('group', { name: 'Preset' }).getByRole('button', { name: 'Fe, 2 mM in water' }).click();
  await expect(changed(page)).toContainText('Fe, 2 mM in water');
  await expect(page.getByRole('slider', { name: 'Photon energy', exact: true })).toHaveValue(/^71/);
  await open('Environment');
  const setting = controls.getByRole('group', { name: 'Setting' });
  await expect(setting.getByRole('button', { name: 'Liquid cell' })).toHaveAttribute('aria-pressed', 'true');
  await setting.getByRole('button', { name: 'Cryostat' }).click();
  await expect(changed(page)).toContainText('cryostat');
  await open('Fluorescence detector');
  await controls.getByRole('checkbox', { name: 'Soller slits' }).check();
  await expect(changed(page)).toContainText('Fluorescence detector changed');
  await open('Scan');
  await controls.getByLabel('Plan').selectOption('xanes');
  await expect(changed(page)).toContainText('Scan plan changed');
  await expect(controls).toContainText('Beamline time');
  await controls.getByLabel('Beamline profile').selectOption('tender');
  await expect(changed(page)).toContainText('Tender X-rays');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test('training: S0 with a fixed seed runs from the task to the reveal, replay and recording', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page, '#mode=transmission&seed=3');
  await expect(page.getByRole('slider', { name: 'Photon energy', exact: true })).toBeEnabled();
  await page.keyboard.press('t');
  const dialog = page.getByRole('dialog', { name: 'Training scenarios' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /Record this run/ }).check();
  await dialog.getByRole('button', { name: 'Start find the edge' }).click();
  await expect(dialog).toBeHidden();
  const task = page.getByRole('region', { name: 'Task: Find the edge' });
  await expect(task).toBeVisible();
  await expect(changed(page)).toContainText('Seed 3');
  const controls = page.getByRole('complementary', { name: 'Controls' });
  await expect(controls.getByLabel('Beamline profile')).toBeDisabled();
  const field = page.getByRole('spinbutton', { name: /Type an energy/ });
  await field.fill('8979');
  await field.press('Enter');
  await page.waitForTimeout(1200);
  await task.getByRole('button', { name: 'Done' }).click();
  await task.getByRole('radio', { name: 'Certain' }).check();
  await task.getByRole('checkbox').first().check();
  await task.getByRole('button', { name: 'Show the truth' }).click();
  await expect(task).toContainText('100 out of 100');
  await expect(task.getByRole('heading', { name: 'Replay' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), task.getByRole('button', { name: 'Download the recording' }).click()]);
  const log = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(log.format).toBe('xaslab-twin-telemetry/1');
  expect(log.scenario).toEqual({ id: 's0-find-the-edge', seed: 3 });
  expect(log.events.some((e: { type: string }) => e.type === 'snap')).toBe(true);
  expect(log.events.at(-1)).toMatchObject({ type: 'end', score: 100, success: true });
  expect(await axeViolations(page)).toEqual([]);
  await task.getByRole('button', { name: 'Close' }).click();
  await expect(task).toBeHidden();
  await expect(controls.getByLabel('Beamline profile')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('training: S4 self absorption is fixed by switching to electron yield', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page, '#mode=transmission&seed=6');
  await page.keyboard.press('t');
  const dialog = page.getByRole('dialog', { name: 'Training scenarios' });
  await expect(dialog.getByRole('listitem')).toHaveCount(9);
  await dialog.getByRole('button', { name: 'Start self absorption' }).click();
  const task = page.getByRole('region', { name: 'Task: Self absorption' });
  await expect(task).toBeVisible();
  await expect(mode(page, 'Fluorescence')).toHaveAttribute('aria-pressed', 'true');
  // The sample is locked, so the presets cannot swap the pellet away.
  await expect(page.getByRole('group', { name: 'Preset' }).getByRole('button').first()).toBeDisabled();
  await page.keyboard.press('3');
  await expect(mode(page, 'Electron yield')).toHaveAttribute('aria-pressed', 'true');
  await task.getByRole('button', { name: 'Done' }).click();
  await task.getByRole('radio', { name: 'Fairly' }).check();
  await task.getByRole('button', { name: 'Show the truth' }).click();
  await expect(task).toContainText('well done');
  await expect(task).toContainText('White line lost now');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('training: S8 glitch spikes go away once the foil is uniform', async ({ page }) => {
  const errors = collectErrors(page);
  await openTwin(page, '#mode=transmission&seed=3');
  await page.keyboard.press('t');
  await page.getByRole('dialog', { name: 'Training scenarios' }).getByRole('button', { name: 'Start glitch hunt' }).click();
  const task = page.getByRole('region', { name: 'Task: Glitch hunt' });
  await expect(task).toBeVisible();
  // Glitches only appear with realistic detectors, and the crystal is locked so they cannot be moved away.
  await expect(page.getByRole('button', { name: /^Realistic/ })).toHaveAttribute('aria-pressed', 'true');
  const controls = page.getByRole('complementary', { name: 'Controls' });
  const fold = controls.getByRole('button', { name: 'Sample', exact: true });
  if (await fold.getAttribute('aria-expanded') === 'false') await fold.click();
  await controls.getByRole('slider', { name: 'Pinholes' }).fill('0');
  await controls.getByRole('slider', { name: 'Thickness spread' }).fill('0');
  await task.getByRole('button', { name: 'Done' }).click();
  await task.getByRole('radio', { name: 'Quite' }).check();
  await task.getByRole('button', { name: 'Show the truth' }).click();
  await expect(task).toContainText('100 out of 100, well done');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('classroom: a class link opens the assigned task, the result downloads, and the instructor view tabulates it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./twin/#train=s6-gases&seed=42');
  await expect(page.getByRole('img', { name: /^Beamline drawing/ })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Training scenarios' });
  const assigned = dialog.getByRole('region', { name: "Your instructor's task" });
  await expect(assigned).toContainText('Ion chamber gases');
  await expect(assigned).toContainText('42');
  await assigned.getByRole('button', { name: 'Start the assigned task' }).click();
  const task = page.getByRole('region', { name: 'Task: Ion chamber gases' });
  await expect(task).toBeVisible();
  await task.getByRole('button', { name: 'Done' }).click();
  await task.getByRole('radio', { name: 'Fairly' }).check();
  await task.getByRole('button', { name: 'Show the truth' }).click();
  await expect(task).toContainText('out of');
  await task.getByLabel('Your name for the class result (optional)').fill('Asha K');
  const [file] = await Promise.all([page.waitForEvent('download'), task.getByRole('button', { name: 'Download the result' }).click()]);
  expect(file.suggestedFilename()).toBe('twin-result-s6-gases-seed42-asha-k.json');
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await dialog.getByText('For instructors: class links and results').click();
  await dialog.getByLabel('Student result files').setInputFiles((await file.path())!);
  await expect(dialog.getByRole('status')).toContainText('1 result loaded');
  await expect(dialog.getByRole('table', { name: 'Results by student' })).toContainText('Asha K');
  await expect(dialog.getByRole('table', { name: 'Results by task' })).toContainText('Ion chamber gases');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keyboard shortcuts dialog lists the keys, blocks them while open and returns focus', async ({ page }) => {
  await openTwin(page);
  const opener = page.getByRole('button', { name: 'Keyboard shortcuts' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('row')).toHaveCount(19);
  await page.keyboard.press('4');
  await expect(mode(page, 'Transmission')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('calibration dialog loads a generated mystery file and applies its energy correction', async ({ page }) => {
  await openTwin(page);
  await page.getByRole('button', { name: 'Calibrate from data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Calibrate from data' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Try mystery instrument' }).click();
  await expect(dialog.getByRole('status')).toContainText('3 calibration fits completed', { timeout: 30_000 });
  const [mysteryDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download mystery XDI' }).click(),
  ]);
  const mysteryPath = await mysteryDownload.path();
  expect(mysteryPath).not.toBeNull();

  await dialog.getByLabel('Calibration data file').setInputFiles(mysteryPath!);
  await expect(dialog.getByRole('status')).toContainText('3 calibration fits completed', { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Apply to profile' }).click();
  await expect(dialog.getByRole('status')).toContainText('Applied energy correction and processor dead time');
  // The twin models dead time as the peaking time, so the fitted value shows in the detector's list.
  await expect(page.getByRole('complementary', { name: 'Controls' }).getByLabel('Peaking time').locator('option:checked')).toContainText('(fitted)');
  await dialog.getByRole('button', { name: 'Profile editor' }).click();
  await expect(dialog.getByLabel('Energy correction')).not.toHaveValue('0');
});

test('phone layout: one column, sticky mode bar, folded explanation and controls, no horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTwin(page);
  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await width()).toBeLessThanOrEqual(390);
  // The 3D view fits its box; the diagram, one tap away, scrolls sideways inside its own box, centred on the sample.
  await expect(page.getByRole('img', { name: /^Beamline drawing, 3D view/ })).toBeVisible();
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  const drawing = page.getByRole('region', { name: 'Beamline drawing, scrolls sideways' });
  await expect(drawing).toBeVisible();
  expect(await drawing.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
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
