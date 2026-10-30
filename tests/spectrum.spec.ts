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
  const table = page.locator('.spectrum-table');
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
