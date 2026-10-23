import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

// First-load JavaScript per page in KB, gzip compressed: the module scripts named in the exported HTML (the noModule
// polyfills only reach old browsers). The 3D view and the data tables load later and are not counted.
// Each limit is the size at the 2026-10-23 hardening pass plus a little headroom, so growth has to be deliberate.
const BUDGET_KB: Record<string, number> = { '': 300, 'twin/': 400, 'spectra/': 300, 'beamline/': 300, 'validation/': 300, 'elements/fe/': 200, 'tools/x-ray-dose/': 300, 'instructors/': 200 };

test('first-load JavaScript stays within each page budget', async ({ request, baseURL }) => {
  for (const [path, limit] of Object.entries(BUDGET_KB)) {
    const html = await (await request.get(path)).text();
    const scripts = new Set([...html.matchAll(/<script(?![^>]*noModule)[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]));
    let bytes = 0;
    for (const src of scripts) bytes += gzipSync(await (await request.get(new URL(src, baseURL).href)).body(), { level: 9 }).length;
    console.log(`${path || 'home'}: ${scripts.size} scripts, ${(bytes / 1024).toFixed(0)} KB gzip (limit ${limit} KB)`);
    expect(bytes / 1024, `${path || 'home'} first-load JavaScript, KB gzip`).toBeLessThanOrEqual(limit);
  }
});
