// Writes out/sw.js from scripts/sw.template.js after `next build`.
// The worker is stamped with this build's id, so every deploy installs a fresh worker and drops old caches.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('out');
const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

async function list(dir) {
  const files = [];
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    if ((await stat(full)).isDirectory()) files.push(...await list(full));
    else files.push(full);
  }
  return files;
}
// encodeURI matches what the browser requests: chunks under app/[module]/ are fetched as app/%5Bmodule%5D/.
const url = file => encodeURI(base + '/' + path.relative(root, file).split(path.sep).join('/'));

const all = await list(root);
const buildId = (await readdir(path.join(root, '_next/static'))).find(name => !['chunks', 'css', 'media'].includes(name));
if (!buildId) throw new Error('No build id folder in out/_next/static; run next build first.');

// Pages are cached at install (small). Everything the app needs offline is cached only when the installed app asks.
const pages = all.filter(file => file.endsWith('index.html') || file.endsWith(path.sep + '404.html'))
  .map(file => url(file).replace(/index\.html$/, ''));
const assets = all.filter(file => !file.endsWith('.html') && !file.endsWith('sw.js') && !file.includes(path.sep + 'og' + path.sep)).map(url);
const bytes = (await Promise.all(all.filter(file => assets.includes(url(file))).map(file => stat(file)))).reduce((sum, info) => sum + info.size, 0);

const template = await readFile('scripts/sw.template.js', 'utf8');
const worker = template
  .replaceAll('__VERSION__', buildId)
  .replace('__BASE__', () => base)
  .replace('__PAGES__', () => JSON.stringify(pages))
  .replace('__ASSETS__', () => JSON.stringify(assets)); // functions, so "$" in file names is never read as a pattern
await writeFile(path.join(root, 'sw.js'), worker);
console.log(`Wrote out/sw.js for build ${buildId}: ${pages.length} pages at install, ${assets.length} assets (${(bytes / 1e6).toFixed(1)} MB) for offline use.`);
