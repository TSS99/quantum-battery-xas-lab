// The site built for the desktop app: the same static export, served from the app's own root instead of the GitHub
// Pages subpath, copied to desktop-dist/ for Tauri to bundle (src-tauri/tauri.conf.json).
import { execSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';

execSync('npm run build', { stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_BASE_PATH: '' } });
await rm('desktop-dist', { recursive: true, force: true });
await cp('out', 'desktop-dist', { recursive: true });
console.log('Desktop build in desktop-dist/');
