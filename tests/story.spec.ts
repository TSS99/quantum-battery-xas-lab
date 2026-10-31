import { expect, test, type Page } from '@playwright/test';

// Read the spectrum, the story view: the default, one idea per scene, written for readers from about 15 years old.

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** Syllables by vowel groups, a silent final e dropped: the usual estimate behind reading grade formulas. */
function syllables(word: string) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  const groups = w.replace(/(?<!l)e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 0);
}

/** Flesch Kincaid grade: 0.39 words per sentence + 11.8 syllables per word - 15.59. */
function grade(text: string) {
  const sentences = text.split(/[.!?](?:\s|$)/).filter(s => s.trim()).length;
  const words = text.split(/\s+/).filter(Boolean);
  return 0.39 * words.length / sentences + 11.8 * words.reduce((s, w) => s + syllables(w), 0) / words.length - 15.59;
}

const sceneWords = (page: Page) => page.locator('.story-scene').evaluateAll(scenes => scenes.map(s => ({
  title: s.querySelector('.story-h')!.textContent!.trim(),
  body: s.querySelector('.story-body')!.textContent!.trim().replace(/\s+/g, ' '),
})));

test('the story is the default view, and the switch opens every panel and comes back', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./spectrum/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Read the spectrum');
  await expect(page.locator('.story-scene')).toHaveCount(2);
  await expect(page.locator('.story-scene .story-step')).toHaveText(['Step 1', 'Step 2']);
  // At most one control under each picture.
  for (const control of await page.locator('.story-control').all()) await expect(control.locator(':scope > *')).toHaveCount(1);
  await page.getByRole('button', { name: 'Detailed', exact: true }).click();
  await expect(page).toHaveURL(/view=detailed/);
  await expect(page.locator('.spectrum-table-wrap .spectrum-table tbody tr').first()).toContainText('12 copper');
  await page.getByRole('button', { name: 'Simple', exact: true }).click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.locator('.story-scene')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('the story stays short and plain: few words, a low reading grade, no symbols', async ({ page }) => {
  for (const sample of ['cu-foil', 'pt-foil', 'licoo2-pellet']) {
    await page.goto(`./spectrum/?sample=${sample}`);
    await expect(page.locator('.story-scene')).toHaveCount(2);
    const scenes = await sceneWords(page);
    const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
    for (const s of scenes) {
      expect(words(s.title), `${sample}: ${s.title}`).toBeLessThanOrEqual(10);
      expect(words(s.body), `${sample}: ${s.title}`).toBeLessThanOrEqual(45);
      // The field's names and symbols stay in the "Scientists call this" tags.
      expect(s.body, `${sample}: ${s.title}`).not.toMatch(/χ|σ|E₀|XANES|EXAFS|Fourier|wavenumber|Å⁻¹|\bk\b/);
    }
    const all = scenes.map(s => `${s.title}. ${s.body}`).join(' ');
    expect(words(all), sample).toBeLessThanOrEqual(340);
    expect(grade(all), `${sample} reading grade`).toBeLessThanOrEqual(8);
  }
});

test('step 1: the count falls at the jump and the graph records it', async ({ page }) => {
  await page.goto('./spectrum/?sample=cuo-pellet');
  const scene = page.locator('#story-shine'), readout = scene.locator('.story-readout');
  const absorbed = async () => Number((await readout.locator('b').first().textContent())!);
  await expect(readout).toContainText('of 100 absorbed');
  const below = await absorbed();
  await expect(scene.getByRole('img', { name: /X-rays absorbed against X-ray energy/ })).not.toHaveAccessibleName(/jump/);
  await scene.getByRole('slider', { name: /X-ray energy/ }).fill('100');
  expect(await absorbed()).toBeGreaterThan(below + 30);
  // CuO's edge sits 5.4 eV above the copper metal's 8979 eV.
  await expect(scene.getByRole('img', { name: /X-rays absorbed against X-ray energy/ })).toHaveAccessibleName(/with a jump at 8,984 eV/);
});

test('step 2: below the jump the X-ray passes by; above it the electron is knocked out of its layer', async ({ page }) => {
  await page.goto('./spectrum/?sample=cu-foil');
  const scene = page.locator('#story-jump'), caption = scene.locator('.story-caption');
  await expect(scene.locator('.story-body')).toContainText('At 8,979 eV an X-ray has just enough energy to knock an electron out of the innermost layer of a copper atom');
  await expect(caption).toContainText('passes by');
  await scene.getByRole('slider', { name: /X-ray energy/ }).fill('5');
  await expect(caption).toContainText('8,984 eV is enough. The electron is knocked out');
  // Platinum is read at its L3 edge: the electron comes from the second layer.
  await page.goto('./spectrum/?sample=pt-foil');
  await expect(page.locator('#story-jump .story-body')).toContainText('out of the second layer of a platinum atom');
});

test('the story keeps still for readers who ask for less motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./spectrum/');
  // The 3D pictures hold their animation clock still.
  await expect(page.locator('#story-shine .story-stage[role="img"]')).toHaveAttribute('data-still', 'true');
  await page.locator('#story-jump').scrollIntoViewIfNeeded();
  await expect(page.locator('#story-jump .story-stage[role="img"]')).toHaveAttribute('data-still', 'true');
});
