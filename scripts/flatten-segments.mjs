// Next 16 static export writes dynamic-route prefetch segments as nested files
// (crystal/__next.$d$module/__PAGE__.txt), but the client router requests the
// flat name (crystal/__next.$d$module.__PAGE__.txt). Static hosts such as
// GitHub Pages cannot rewrite, so copy each nested segment to its flat name.
import { copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('out');
let copied = 0;

async function files(dir, prefix = []) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...await files(full, [...prefix, name]));
    else out.push({ full, parts: [...prefix, name] });
  }
  return out;
}

async function walk(dir) {
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    if (!(await stat(full)).isDirectory()) continue;
    if (name.startsWith('__next.')) {
      for (const file of await files(full)) {
        await copyFile(file.full, path.join(dir, [name, ...file.parts].join('.')));
        copied++;
      }
    } else await walk(full);
  }
}

await walk(root);
console.log(`Flattened ${copied} prefetch segment file(s) for static hosting.`);
