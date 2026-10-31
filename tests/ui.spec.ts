import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const modules = [
  ['Overview', ''],
  ['Sample', 'crystal'],
  ['XAS beamline', 'beamline'],
  ['Spectra studio', 'spectra'],
  ['Electronic structure', 'electronic'],
  ['Quantum dynamics', 'quantum'],
  ['Experiments', 'experiments'],
  ['Methods & validation', 'validation'],
] as const;

// KaTeX writes a true minus sign and a zero-width space after sub- and superscripts.
const MINUS = String.fromCharCode(0x2212), ZWSP = String.fromCharCode(0x200b);

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
  await expect(metric(page, 'Mn oxidation')).toContainText('+3.00');
  await expect(page.getByRole('img', { name: '100 percent manganese three plus in the charge-balance model' })).toBeVisible();
  await lithium.press('Home');
  await expect(metric(page, 'Mn oxidation')).toContainText('+4.00');
  await page.getByRole('navigation', {name:'Laboratory modules'}).getByRole('link', { name: 'XAS beamline' }).click();
  await expect(page.getByRole('slider', { name: 'Lithium content', exact: true })).toHaveValue('0');
  await expect(metric(page, 'Mn oxidation')).toContainText('+4.00');
});

test('beamline energy and thickness update actual counts with a provenance link', async ({ page }) => {
  await page.goto('./beamline/');
  await expect(page.locator('.plot-legend').first()).toContainText('Tabulated atomic data');
  await expect(page.getByRole('link', { name: 'Data source and limits' })).toBeVisible();
  const energy = page.getByRole('slider', { name: 'Photon energy', exact: true });
  await energy.focus();
  await energy.press('Home');
  const initialAbsorption = await metric(page, 'Absorption').locator('strong').innerText();
  await energy.press('End');
  expect(Number(await energy.inputValue())).toBeGreaterThan(6600);
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
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Simulate Poisson detector counts' }).check();
  const seed = page.getByRole('spinbutton', { name: 'Random seed' });
  const previousSeed = Number(await seed.inputValue());
  await page.getByRole('button', { name: 'New seeded draw' }).click();
  await expect(seed).toHaveValue(String((previousSeed + 1) >>> 0));
  await expect(page.getByText(/With zero counts, μ can't be computed/)).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Synthetic test sample', exact: true }).first()).toBeVisible();
  await expect(page.locator('.plot-legend')).toContainText('Imported synthetic');
  await input.setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('energy,mu\n6530,1\n6540,2') });
  // Next.js also renders an empty route-announcer alert, so match the validation message itself.
  await expect(page.getByRole('alert').filter({ hasText: 'CSV headers' })).toContainText('CSV headers must be energy_eV,mu_cm_inv');
  await expect(page.getByRole('button', { name: 'Synthetic test sample', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Research', exact: true }).click();
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

test('spectra reduces a selected post-edge curve to chi(k) and chi(R) in a worker', async ({ page }) => {
  await page.goto('./spectra/');
  const e0 = 7112, etok = 0.26246842396479836;
  const pre = Array.from({ length: 40 }, (_, i) => e0 - 200 + i * 5);
  const k = Array.from({ length: 281 }, (_, i) => i * 0.05);
  const energy = [...pre, ...k.map(value => e0 + value * value / etok)];
  const mu = energy.map((value, i) => {
    const offset = value - e0, baseline = 35 + 0.014 * offset;
    if (i < pre.length) return baseline;
    const wave = k[i - pre.length], turnOn = 1 - Math.exp(-((wave / 1.35) ** 4));
    const chi = 10.5 * Math.sin(2 * wave * 2.24 + 0.42) * Math.exp(-0.014 * wave * wave) * turnOn / (1 + 0.055 * wave);
    return baseline + 100 * (1 - Math.exp(-offset / 5)) + chi;
  });
  await page.getByLabel('Import spectrum CSV or JSON').setInputFiles({
    name: 'exafs-worker-test.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ name: 'EXAFS worker test', provenance: 'synthetic', energy_eV: energy, mu_cm_inv: mu })),
  });
  await expect(page.getByRole('heading', { name: 'EXAFS reduction', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Processing complete' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('slider', { name: /exafs-chi-k:/ })).toBeVisible();
  await expect(page.getByRole('slider', { name: /exafs-chi-r:/ })).toBeVisible();
  await expect(page.getByText(/is not a bond length/)).toBeVisible();
  await page.getByLabel('k-weight', { exact: true }).selectOption('3');
  await expect(page.getByRole('status').filter({ hasText: 'Processing complete' })).toBeVisible({ timeout: 30_000 });
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
  await expect(page.getByText('These spectra are a teaching model, not measured data.')).toBeVisible();
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
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('At x = 1.00, Mn is +3.00');
  await expect(page.locator('.delta-readout')).toContainText('+0.50');
  await page.getByRole('navigation', {name:'Laboratory modules'}).getByRole('link', { name: 'Electronic structure', exact: true }).click();
  await page.getByRole('button', { name: /1s → d-like character/ }).click();
  await page.getByRole('button', { name: 'Excite the electron' }).click();
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('dashed circle marks the core hole');
});

test('plot inspection includes units and SVG export remains standalone', async ({ page }) => {
  await page.goto('./spectra/');
  await page.getByRole('button', { name: 'Derivative', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('dμ/dE');
  const plot = page.getByRole('slider', { name: /spectra-derivative:/ });
  await plot.focus();
  await plot.press('ArrowRight');
  await expect(page.locator('.plot-readout').first()).toContainText('eV');
  await expect(page.locator('.plot-legend').first()).toContainText(new RegExp(`cm${MINUS}${ZWSP}?1\\s*eV${MINUS}${ZWSP}?1`));
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
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('Spectrum error vs exact changed from', { timeout: 30_000 });
  await page.getByRole('navigation', {name:'Laboratory modules'}).getByRole('link', { name: 'Methods & validation', exact: true }).click();
  await expect(page.getByText(/Adjustable peaks and edge shifts are models, not measured data/)).toBeVisible();
  await page.getByRole('button', { name: 'Run sanity checks' }).click();
  await expect(page.getByRole('complementary', { name: 'Try this' })).toContainText('9 of 9 checks passed', { timeout: 30_000 });
});

test('sample presets and free formulas select real edges across modules', async ({ page }) => {
  await page.goto('./crystal/');
  const preset = page.getByLabel('Sample preset');
  await expect(preset).toBeEnabled();
  await preset.selectOption('fe2o3-hematite');
  await expect(page.getByLabel('Chemical formula')).toHaveValue('Fe2O3');
  await expect(page.getByRole('slider', { name: 'Lithium content', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link', { name: 'XAS beamline' }).click();
  const ironWindow = await page.getByTestId('beamline-window').innerText();
  expect(ironWindow).toContain('7076');
  await page.getByRole('link', { name: 'Change sample' }).click();
  await page.getByLabel('Absorber', { exact: true }).selectOption('O');
  await page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link', { name: 'XAS beamline' }).click();
  await expect(page.getByTestId('beamline-window')).not.toHaveText(ironWindow);
  await expect(page.getByTestId('beamline-window')).toContainText('513');
  await page.getByRole('link', { name: 'Change sample' }).click();
  await page.getByLabel('Chemical formula').fill('CuSO4·5H2O');
  await page.getByLabel('Density (g/cm³)').fill('2.286');
  await page.getByRole('button', { name: 'Use this formula' }).click();
  await expect(page.getByLabel('Sample preset')).toHaveValue('custom');
  await page.getByLabel('Absorber', { exact: true }).selectOption('Cu');
  await expect(page.getByLabel('Absorption edge')).toHaveValue('K');
  await page.getByLabel('Chemical formula').fill('Qq2(');
  await page.getByRole('button', { name: 'Use this formula' }).click();
  await expect(page.locator('#sample-error')).toContainText('Unknown element');
  await expect(page.getByLabel('Absorber', { exact: true })).toHaveValue('Cu');
});

test('custom Hamiltonians validate Pauli JSON and run independently of the sample', async ({ page }) => {
  await page.goto('./quantum/');
  await expect(page.getByRole('button', { name: 'Keep run as reference' })).toBeEnabled({ timeout: 30000 });
  await page.getByText('Load your Hamiltonian', { exact: true }).click();
  await page.getByLabel('Pauli strings JSON').fill('{"qubits":2,"terms":[{"label":"AX","coefficient":1}]}');
  await page.getByRole('button', { name: 'Load and run Hamiltonian' }).click();
  await expect(page.locator('#hamiltonian-error')).toContainText('letters from I, X, Y, Z');
  await page.getByLabel('Pauli strings JSON').fill(JSON.stringify({ name: 'Complex test', qubits: 2, terms: [{ label: 'YI', coefficient: .6 }, { label: 'IZ', coefficient: .4 }, { label: 'XX', coefficient: .2 }] }));
  await page.getByRole('button', { name: 'Load and run Hamiltonian' }).click();
  await expect(page.getByText('Loaded: Complex test, 2 qubits, 3 Pauli terms.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep run as reference' })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByRole('slider', { name: /^quantum-spectrum:/ })).toBeVisible();
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await expect(page.getByText('Custom Pauli evolution is calculated directly.', { exact: false })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Full run JSON' }).click();
  const file = await downloading;
  const result = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(result.result.customHamiltonian.name).toBe('Complex test');
  expect(result.result.validation.unitarityError).toBeLessThan(1e-10);
  await page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Research workflow' }).getByRole('link', { name: /Kick the ground state, completed/ })).toBeVisible();
});
test('presets navigate immediately and undo restores the previous sample', async ({ page }) => {
  await page.goto('./crystal/');
  await expect(page.getByLabel('Sample preset')).toBeEnabled();
  await page.getByLabel('Sample preset').selectOption('water');
  await page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link', { name: 'Experiments', exact: true }).click();
  await page.getByRole('link', { name: /Across the absorption edge/ }).click();
  await expect(page).toHaveURL(/\/beamline\/$/);
  await page.getByRole('button', { name: 'Undo preset' }).click();
  await expect(page.locator('.sample-summary')).toContainText(new RegExp(`H${ZWSP}?2${ZWSP}?O`));
});

test('beamline drawing follows the monochromator and the absorption edge', async ({ page }) => {
  await page.goto('./beamline/');
  const legend = page.locator('.beam-legend');
  await expect(legend).toContainText('Bragg angle');
  await expect(page.getByRole('img', { name: /reach detector 2/ })).toBeVisible();
  const energy = page.getByRole('slider', { name: 'Photon energy', exact: true });
  await energy.focus();
  await energy.press('Home');
  await expect(legend).toContainText('Below the Mn K edge');
  const lowAngle = await legend.locator('li').nth(1).innerText();
  await energy.press('End');
  await expect(legend).toContainText('Above the Mn K edge');
  await expect(legend.locator('li').nth(1)).not.toHaveText(lowAngle);
});

test('equations are typeset with KaTeX on every page that shows them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  for (const route of ['', 'crystal', 'beamline', 'spectra', 'electronic', 'quantum', 'validation']) {
    await page.goto(route ? `./${route}/` : './');
    await page.getByRole('button', { name: 'Research', exact: true }).click();
    if (route === 'quantum') await expect(page.getByRole('button', { name: 'Keep run as reference' })).toBeEnabled({ timeout: 30_000 });
    if (route === 'validation') { await page.getByRole('button', { name: 'Run sanity checks' }).click(); await expect(page.locator('.check-results > div')).toHaveCount(9, { timeout: 30_000 }); }
    if (route === 'beamline') await expect(page.locator('.beam-legend')).toBeVisible();
    await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
    expect(await page.locator('.katex').count(), route).toBeGreaterThan(0);
    await expect(page.locator('.katex-error')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('installs as an app and keeps working offline', async ({ page, context }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await page.request.get(new URL(href!, page.url()).toString())).json();
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
  await page.goto('./spectra/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Spectra studio');
  await page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link', { name: 'Quantum dynamics' }).click();
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Quantum dynamics');
  await page.goto('./beamline/');
  await expect(page.locator('.beam-legend')).toContainText('Bragg angle');
  // The beamline twin too: its X-ray tables, 3D code and textures come from the cache.
  await page.goto('./twin/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beamline twin');
  await expect(page.getByRole('img', { name: /^Beamline drawing, 3D view/ })).toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);
});

test('mobile element references keep all elements keyboard accessible with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./elements/');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Laboratory modules' }).getByRole('link')).toHaveCount(8);
  await expect(page.locator('.periodic-table a')).toHaveCount(98);
  const hydrogen = page.getByRole('link', { name: 'Hydrogen (H), atomic number 1', exact: true });
  await hydrogen.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Helium (He), atomic number 2', exact: true })).toBeFocused();
  expect(await page.locator(':focus').evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  for (const route of ['elements', 'elements/fe', 'elements/cu', 'elements/h', 'elements/cf']) {
    await page.goto(`./${route}/`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await expect(page.locator('.katex-error')).toHaveCount(0);
  }
});

test('element references and search metadata are usable without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('./elements/');
    await page.getByRole('link', { name: 'Iron (Fe), atomic number 26', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Iron (Fe) X-ray absorption edges');
    await expect(page).toHaveTitle('Iron (Fe) X-ray absorption edges | XAS Lab');
    const canonical = 'https://tss99.github.io/quantum-battery-xas-lab/elements/fe/';
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'K', exact: true }) });
    await expect(row.getByRole('cell').first()).toHaveText('7,112');
    await expect(row.getByRole('link', { name: 'Scan the Fe K edge on the beamline', exact: true })).toHaveAttribute('href', /\/beamline\/\?element=Fe&edge=K$/);
    const graph = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!)['@graph'];
    expect(graph.find((item: { '@type': string }) => item['@type'] === 'BreadcrumbList').itemListElement.map((item: { name: string }) => item.name)).toEqual(['Overview', 'Elements', 'Iron']);
  } finally {
    await context.close();
  }
});

test('element and compound links select the requested sample and edge after navigation', async ({ page }) => {
  await page.goto('./elements/fe/');
  await page.getByRole('link', { name: 'Open Fe K on the Sample page', exact: true }).click();
  await expect(page.getByLabel('Chemical formula')).toHaveValue('Fe');
  await expect(page.getByLabel('Absorber', { exact: true })).toHaveValue('Fe');
  await expect(page.getByLabel('Absorption edge')).toHaveValue('K');
  await page.goto('./elements/cu/');
  await page.getByRole('link', { name: 'Scan the Cu L3 edge on the beamline', exact: true }).click();
  await expect(page.locator('.sample-summary')).toContainText(new RegExp(`Cu\\s+L${ZWSP}?3`));
  await expect(page.getByRole('slider', { name: 'Photon energy', exact: true })).toHaveValue('932.7');
  await page.goto('./elements/fe/');
  await page.getByRole('link', { name: 'Hematite', exact: true }).click();
  await expect(page.getByLabel('Sample preset')).toHaveValue('fe2o3-hematite');
  await expect(page.getByLabel('Chemical formula')).toHaveValue('Fe2O3');
  await expect(page.getByLabel('Density (g/cm³)')).toHaveValue('5.26');
});

test('element links handle unavailable storage and reject nonexistent shells', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('Storage unavailable'); }; });
  await page.goto('./crystal/?element=Fe&edge=K');
  await expect(page.getByLabel('Chemical formula')).toHaveValue('Fe');
  await page.goto('./crystal/?element=H&edge=L3');
  await expect(page.getByLabel('Absorber', { exact: true })).toHaveValue('Mn');
  await expect(page.getByRole('status').filter({ hasText: 'H has no L3 edge' })).toBeVisible();
  await page.goto('./elements/h/');
  await page.getByRole('link', { name: 'Inspect the absorption background', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'This edge is outside' })).toBeVisible();
});

test('the landing page and footer link the desktop installers of this version', async ({ page }) => {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const release = `https://github.com/TSS99/quantum-battery-xas-lab/releases/download/v${version}/`;
  await page.goto('./');
  const downloads = page.locator('#desktop');
  await expect(downloads.getByRole('link', { name: 'Windows installer' })).toHaveAttribute('href', release + `XAS.Lab_${version}_x64-setup.exe`);
  await expect(downloads.getByRole('link', { name: '.msi' })).toHaveAttribute('href', release + `XAS.Lab_${version}_x64_en-US.msi`);
  await expect(downloads.getByRole('link', { name: 'macOS disk image' })).toHaveAttribute('href', release + `XAS.Lab_${version}_universal.dmg`);
  await expect(downloads.getByRole('link', { name: 'Linux AppImage' })).toHaveAttribute('href', release + `XAS.Lab_${version}_amd64.AppImage`);
  await expect(downloads.getByRole('link', { name: '.deb' })).toHaveAttribute('href', release + `XAS.Lab_${version}_amd64.deb`);
  await expect(downloads.getByRole('link', { name: '.rpm' })).toHaveAttribute('href', release + `XAS.Lab-${version}-1.x86_64.rpm`);
  await expect(page.locator('.site-footer').getByRole('link', { name: 'Desktop app' })).toHaveAttribute('href', /\/#desktop$/);
});

test('the beamline twin is linked from the header and landing page, and the Methods page lists its models and tests', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.hero-actions').getByRole('link', { name: 'Operate the beamline twin' })).toHaveAttribute('href', /\/twin\/$/);
  await page.goto('./validation/');
  // Phones reach the header links through the menu. A tap before hydration does nothing, so tap until it opens.
  if ((page.viewportSize()?.width ?? 1440) < 800) await expect(async () => {
    await page.getByRole('button', { name: 'Open menu' }).click({ timeout: 1000 });
    await expect(page.locator('#mobile-menu')).toBeVisible({ timeout: 1000 });
  }).toPass();
  const menu = (page.viewportSize()?.width ?? 1440) < 800 ? page.locator('#mobile-menu') : page.locator('.header-links');
  await expect(menu.getByRole('link', { name: /^Beamline twin/ }).first()).toHaveAttribute('href', /\/twin\/$/);
  await page.keyboard.press('Escape');
  const table = page.getByRole('table', { name: 'Beamline twin models, checks and tests' });
  await expect(table.getByRole('row')).toHaveCount(24);
  await expect(table).toContainText('Larch sigma2_eins');
  await table.getByText('3 tests').first().click();
  await expect(table.locator('details[open] li').first()).toContainText('.test.ts');
  await expect(page.getByRole('heading', { name: 'Sources and licences' })).toBeVisible();
  await expect(page.locator('.measured-figure figcaption')).toContainText('correlation');
  await expect(page.locator('.katex-error')).toHaveCount(0);
});
