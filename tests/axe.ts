import type { Page } from '@playwright/test';

// The accessibility check injects the pinned axe-core dev dependency from disk, so it never depends on a network.
const AXE_PATH = require.resolve('axe-core/axe.min.js');

/** axe-core violations on the page as "rule: selectors" lines; an empty list means none. */
export async function axeViolations(page: Page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
  });
}
