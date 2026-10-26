// Renders the twin's guided tour to an MP4 frame by frame at exactly 30 fps. The page clock and requestAnimationFrame
// are driven by hand, so a slow machine still gives a smooth video. Frames go to ffmpeg (libx264) as JPEGs.
//   node scripts/tour-video.mjs <out.mp4> <ffmpeg> [viewport width] [height] [pixel ratio] [video width] [site base URL]
// A small window at a high pixel ratio keeps the caption big enough to read when the video plays on a phone.
//   CHROME_PATH=<chrome.exe> to use a particular browser build.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const [, , out = 'tour.mp4', ffmpeg = 'ffmpeg', w = '1152', h = '720', ratio = '1.6667', width = '1600', base = 'http://127.0.0.1:3000/quantum-battery-xas-lab/'] = process.argv;
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +ratio });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base + 'twin/?v=' + Date.now());
await page.locator('.twin-scene:not([aria-busy="true"])').waitFor({ timeout: 90000 });
if (+w > 700) await page.getByRole('button', { name: 'Scene only', exact: true }).click();
await page.waitForTimeout(4000);
await page.evaluate(() => {
  let now = performance.now(); const queue = [];
  performance.now = () => now;
  window.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = ms => { now += ms; const run = queue.splice(0); run.forEach(cb => cb(now)); return run.length; };
});
const box = await page.locator('.hutch-stage').boundingBox();
const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
const enc = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-',
  '-vf', `scale=${width}:-2:flags=lanczos:in_range=pc:out_range=tv,setsar=1,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
await page.getByRole('button', { name: 'Play tour', exact: true }).click();
let frames = 0; const t0 = Date.now();
for (;;) {
  await page.evaluate(() => window.__step(1000 / 30));
  await page.waitForTimeout(0);
  const touring = await page.locator('.hutch-tour').count();
  if (!touring && frames > 30) break;
  const jpg = await page.screenshot({ clip, type: 'jpeg', quality: 92 });
  if (!enc.stdin.write(jpg)) await new Promise(r => enc.stdin.once('drain', r));
  frames++;
  if (frames % 300 === 0) console.log(frames, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + ' s');
}
enc.stdin.end();
await new Promise(r => enc.on('close', r));
console.log('frames', frames, 'video seconds', (frames / 30).toFixed(1), 'clip', JSON.stringify(clip), 'errors', JSON.stringify(errors));
await browser.close();
