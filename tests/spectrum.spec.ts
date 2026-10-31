import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

test('Read the spectrum splits CuO into shells, and choosing one explains its peak and its offset', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./spectrum/?sample=cuo-pellet');
  const table = page.locator('.spectrum-table-wrap .spectrum-table');
  // Six shells, the farther atoms and the multiple scattering paths.
  await expect(table.locator('tbody tr')).toHaveCount(8);
  await expect(table.locator('tbody tr').first()).toContainText('4 oxygen');
  await expect(table.locator('tbody tr').first()).toContainText('1.96 Å');
  const first = table.getByRole('button', { name: '4 O at 1.96 Å' });
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  const explain = page.locator('.spectrum-explain');
  await expect(explain).toContainText('4 oxygen atoms at 1.96 Å from the copper atom');
  await expect(explain).toContainText('0.45 Å short of the true distance');
  await expect(page.getByRole('img', { name: /magnitude of chi of R for CuO/ })).toContainText('true 1.96 Å');
  await table.getByRole('button', { name: 'Multiple scattering' }).click();
  await expect(explain).toContainText('bounces off two or more atoms');
  await table.getByRole('button', { name: 'Multiple scattering' }).click();
  await expect(explain).toContainText('sends out an electron wave');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('what if: moving a shell moves its peak, and going back to the crystal restores it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./spectrum/?sample=cuo-pellet');
  await page.locator('.spectrum-table').getByRole('button', { name: '4 O at 1.96 Å' }).click();
  const back = page.getByRole('button', { name: 'Back to the crystal' });
  await expect(back).toBeDisabled();
  await page.getByRole('slider', { name: 'Distance of the oxygen neighbours' }).fill('2.16');
  // 0.2 angstrom farther: the peak moves out as much and drops (1/R^2 and the electron's range).
  await expect(page.locator('.what-if-readout')).toContainText('1.50 → 1.69 Å');
  await expect(page.locator('.what-if-readout')).toContainText('× 0.77');
  await expect(page.locator('.spectrum-legend')).toContainText('Before your changes');
  await page.getByRole('slider', { name: 'Number of oxygen neighbours' }).fill('8');
  await expect(page.locator('.what-if-readout')).toContainText('× 1.5');
  await back.click();
  await expect(page.locator('.spectrum-legend')).not.toContainText('Before your changes');
  await expect(page.locator('.what-if-readout')).toContainText('1.50 → 1.50 Å');
  expect(errors).toEqual([]);
});

test('the electron wave meets itself in step exactly where the shell chi(k) is positive', async ({ page }) => {
  await page.goto('./spectrum/?sample=cu-foil');
  const k = page.getByRole('slider', { name: 'Electron wavenumber k' }), verdict = page.locator('.wave-verdict');
  for (const value of ['3', '4.5', '6', '7.5', '9', '10.5', '12']) {
    await k.fill(value);
    await expect(verdict).toContainText(new RegExp(`k\\s*=\\s*${Number(value).toFixed(2)}`));
    const text = (await verdict.textContent())!;
    const chi = Number(text.match(/here: ([−+-]?\d+\.\d+)/)![1].replace('−', '-'));
    if (text.includes('in step')) expect(chi).toBeGreaterThan(0);
    if (text.includes('out of step')) expect(chi).toBeLessThan(0);
  }
});

test('the neighbour panel compares light and heavy scatterers from their FEFF amplitudes', async ({ page }) => {
  await page.goto('./spectrum/?sample=cuo-pellet');
  const legend = page.locator('.neighbour-legend');
  await expect(legend).toContainText('oxygen: largest near k = 3.2 (this shell)');
  await expect(legend).toContainText('platinum: largest near k = 16.0');
  await expect(legend).toContainText('copper: largest near k = 7.0');
});

test('around the edge: the measured edge position and the valence series of the element', async ({ page }) => {
  await page.goto('./spectrum/?sample=cuo-pellet');
  const edge = page.locator('#spectrum-edge');
  // Cu K at 8979.0 eV (xraydb) plus CuO's measured +5.4 eV.
  await expect(edge).toContainText('8984.4 eV');
  await expect(edge).toContainText('+5.4 eV from the metal');
  const series = page.locator('#spectrum-oxidation');
  await expect(series.locator('tbody tr')).toHaveCount(3);
  await expect(series.locator('tbody tr.is-active')).toContainText('CuO');
  await expect(series).toContainText('About 2.7 eV per unit of valence');
});

test('the guided tour walks from the edge to a bond distance with this sample\'s numbers', async ({ page }) => {
  await page.goto('./spectrum/?sample=cuo-pellet');
  await page.getByRole('button', { name: 'Guided tour' }).click();
  const tour = page.getByRole('complementary', { name: 'Guided tour' });
  await expect(tour).toContainText('Step 1 of 6');
  await expect(page.locator('#spectrum-explorer')).toHaveClass(/is-tour-target/);
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('E₀ = 8984.4 eV');
  await expect(page.locator('#spectrum-edge')).toHaveClass(/is-tour-target/);
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('2.7 eV per unit of valence');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('4 oxygen neighbours');
  await expect(page.locator('.spectrum-table').getByRole('button', { name: '4 O at 1.96 Å' })).toHaveAttribute('aria-pressed', 'true');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('peaks at 1.50 Å');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('0.45 Å from the true distance');
  await tour.getByRole('button', { name: 'Done' }).click();
  await expect(tour).toHaveCount(0);
});

test('how XAS works: scanning the energy takes the core electron from staying put to a jump to a free wave', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./spectrum/?sample=mno2-pellet');
  const explorer = page.locator('#spectrum-explorer'), caption = page.locator('.xas-explorer-caption');
  await expect(caption).toContainText('Too little energy to free a manganese 1s electron');
  await explorer.getByRole('button', { name: 'Pre-edge', exact: true }).click();
  // MnO2 is d3: its computed spectrum has a pre-edge, the 1s electron reaching the empty 3d states.
  await expect(caption).toContainText('empty 3d level');
  await explorer.getByRole('button', { name: 'Edge', exact: true }).click();
  await expect(caption).toContainText('empty 4p states');
  // 150 eV above the edge: k = sqrt(0.2625 x 150) = 6.27 per angstrom, a wavelength of 1.00 angstrom.
  await explorer.getByRole('button', { name: 'EXAFS', exact: true }).click();
  await expect(caption).toContainText('λ = 1.00 Å');
  await page.getByRole('slider', { name: 'Photon energy above the edge' }).fill('0');
  await expect(caption).toContainText('Too little energy');
  expect(errors).toEqual([]);
});

test('how XAS works names the levels of the absorber: sulfur 1s to empty 3p, no 3d', async ({ page }) => {
  await page.goto('./spectrum/?sample=na2so4-pellet');
  const explorer = page.locator('#spectrum-explorer'), caption = page.locator('.xas-explorer-caption');
  await explorer.getByRole('button', { name: 'Edge', exact: true }).click();
  await expect(caption).toContainText('empty 3p states');
  // Sulfate's computed spectrum has no pre-edge peak, and the caption says so.
  await explorer.getByRole('button', { name: 'Pre-edge', exact: true }).click();
  await expect(caption).toContainText('No pre-edge peak in this crystal');
});

test('the reading cards and the chapters take you to the panel to try', async ({ page }) => {
  await page.goto('./spectrum/?sample=cuo-pellet');
  await expect(page.locator('.read-card')).toHaveCount(3);
  await page.locator('.read-card').filter({ hasText: 'Edge position' }).getByRole('button', { name: 'Try it on this sample' }).click();
  await expect(page.locator('#spectrum-oxidation')).toBeInViewport();
  await page.getByRole('navigation', { name: 'Chapters' }).getByRole('button', { name: /Shells/ }).click();
  await expect(page.locator('#spectrum-plots')).toBeInViewport();
});

test('Read the spectrum says when a heavy neighbour peaks near its true distance', async ({ page }) => {
  await page.goto('./spectrum/?sample=pt-foil');
  await page.locator('.spectrum-table').getByRole('button', { name: /^12 Pt at 2\.7\d Å$/ }).click();
  await expect(page.locator('.spectrum-explain')).toContainText('close to the true distance');
});

test('Read the spectrum offers the absorber sites of a material with more than one', async ({ page }) => {
  await page.goto('./spectrum/?sample=mn-foil');
  const site = page.getByRole('combobox', { name: 'Absorber site' });
  await expect(site.locator('option')).toHaveCount(4);
  await site.selectOption({ index: 1 });
  await expect(page.locator('#spectrum-table-title')).toContainText(`Shells of site ${await site.inputValue()}`);
  await expect(page.locator('.spectrum-legend')).toContainText('Other sites');
});

test('the near edge is computed for each crystal: the chromate card and the edge panel read their numbers from it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./spectrum/?sample=k2cro4-pellet');
  const card = page.locator('.read-card').filter({ hasText: 'Edge shape' });
  await expect(card).toContainText('K₂CrO₄, tetrahedral');
  await expect(card).toContainText(/K₂CrO₄'s is \d+× Cr₂O₃'s/);
  const edge = page.locator('#spectrum-edge');
  await expect(page.locator('.spectrum-model')).toContainText('FEFF10 full multiple scattering for this crystal');
  await expect(edge).toContainText(/Pre-edge at \D?1\d\.\d eV/);
  await page.goto('./spectrum/?sample=ceo2-pellet');
  await expect(page.locator('#spectrum-edge')).toContainText('FEFF, a one electron calculation, gives one');
  expect(errors).toEqual([]);
});

test('the shell plots: stacked lanes first, build up adds groups until they make the spectrum, k weight changes the transform', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./spectrum/?sample=cuo-pellet');
  const plots = page.locator('#spectrum-plots');
  await expect(plots.getByRole('button', { name: 'Stacked' })).toHaveAttribute('aria-pressed', 'true');
  await plots.getByRole('button', { name: 'Build up' }).click();
  const build = plots.locator('.spectrum-build');
  await expect(build).toContainText('1 of 8: 4 O');
  for (let i = 0; i < 7; i++) await build.getByRole('button', { name: 'Add the next group' }).click();
  await expect(build).toContainText('8 of 8');
  await expect(build).toContainText('the whole spectrum');
  await expect(build.getByRole('button', { name: 'Add the next group' })).toBeDisabled();
  await plots.getByRole('button', { name: 'k weight 3' }).click();
  await expect(page.getByRole('img', { name: /k to the 3 times chi of k for CuO/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a measured spectrum of the same material is drawn with the model, where the Larch examples have one', async ({ page }) => {
  await page.goto('./spectrum/?sample=cu-foil');
  await expect(page.locator('#spectrum-plots .spectrum-legend')).toContainText('Measured Cu foil (APS 13-ID, 2001)');
  await page.goto('./spectrum/?sample=cuo-pellet');
  await page.locator('.spectrum-table').getByRole('button', { name: '4 O at 1.96 Å' }).click();
  await expect(page.locator('#spectrum-plots .spectrum-legend')).not.toContainText('Measured');
});

test('the atoms panel lays the shells out by distance and shows the chosen one as a sphere', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./spectrum/?sample=cuo-pellet');
  const atoms = page.locator('#spectrum-atoms');
  await expect(atoms.getByRole('img', { name: /Distances from the copper atom: 4 O at 1\.96 angstrom, 2 O at 2\.78 angstrom/ })).toBeVisible();
  const far = atoms.getByRole('button', { name: 'Show farther atoms' });
  await expect(far).toHaveAttribute('aria-pressed', 'false');
  await far.click();
  await expect(far).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.spectrum-table').getByRole('button', { name: '4 Cu at 2.90 Å' }).click();
  await expect(atoms).toContainText('4 Cu · 2.90 Å: the sphere through these atoms');
  expect(errors).toEqual([]);
});

test('the wave map draws the shell in a slice through the real cluster, whole or echoes alone', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./spectrum/?sample=cuo-pellet');
  const wave = page.locator('#spectrum-wave');
  await expect(wave.getByRole('img', { name: /around the copper atom and 4 of its 4 oxygen neighbours at 1\.96 angstrom, at k 6\.00: in step/ })).toBeVisible();
  await wave.getByRole('button', { name: 'Echoes alone' }).click();
  await expect(wave.getByRole('img', { name: /echoes alone: in step/ })).toBeVisible();
  await page.getByRole('slider', { name: 'Electron wavenumber k' }).fill('7.5');
  await expect(wave.locator('.wave-verdict')).toContainText(/k\s*=\s*7\.50/);
  expect(errors).toEqual([]);
});

test('the page reads in few words: the prose stays within 450 words, the model notes in one fold', async ({ page }) => {
  await page.goto('./spectrum/?sample=cuo-pellet');
  await expect(page.locator('.read-card')).toHaveCount(3);
  await expect(page.locator('.wave-map')).toBeVisible();
  const words = await page.evaluate(() => [...document.querySelectorAll('.spectrum-grid p, .spectrum-grid li')]
    .filter(e => !e.closest('svg, table, details, .read-card-legend, .spectrum-legend, .neighbour-legend'))
    .reduce((n, e) => n + (e as HTMLElement).innerText.split(/\s+/).filter(Boolean).length, 0));
  expect(words).toBeLessThanOrEqual(450);
  await expect(page.locator('details.spectrum-model summary')).toHaveText('Model and sources');
});
