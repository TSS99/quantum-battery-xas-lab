'use client';
import { useEffect, useRef } from 'react';
import { shellSlice, waveField, type WaveCurves } from '@/lib/twin/wave-field';

const W = 640, H = 300, GRID_W = 192, GRID_H = 90;
const BG = [18, 26, 43], CREST = [140, 227, 255], TROUGH = [217, 89, 38];
/** One drawn wave period every two seconds: the electron's real frequency is far beyond any drawing. */
const DRAWN_HZ = 0.5;

/**
 * The photoelectron wave in a slice through the absorber and the shell's atoms, to scale: crests cyan, troughs orange,
 * from the outgoing spherical wave and every neighbour's echo (wave-field.ts). The ring round the absorber shows how
 * the echoes arrive there: cyan in step (more absorption), orange out of step (less).
 */
export function WaveMap({ k, atoms, curves, color, absorber, element, echo, echoesOnly, label }: {
  k: number; atoms: [number, number, number][]; curves: WaveCurves; color: string; absorber: string; element: string; echo: number; echoesOnly: boolean; label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const { points } = shellSlice(atoms);
    // Scaled on the height, so every atom of the slice is in the frame.
    const reach = Math.max(1.5, ...points.map(p => Math.hypot(p.x, p.y)));
    const scale = (H / 2 - 18) / reach;
    const field = waveField(k, points, curves, !echoesOnly);
    // The echoes alone are much weaker than the outgoing wave; each view gets its own brightness, from its largest value.
    let largest = 1e-9;
    for (let j = 0; j < GRID_H; j += 3) for (let i = 0; i < GRID_W; i += 3) largest = Math.max(largest, Math.abs(field(((i + 0.5) / GRID_W * W - W / 2) / scale, (H / 2 - (j + 0.5) / GRID_H * H) / scale, 0)));
    const gain = (echoesOnly ? 2.2 : 0.9) / largest;
    const off = document.createElement('canvas');
    off.width = GRID_W; off.height = GRID_H;
    const octx = off.getContext('2d')!, img = octx.createImageData(GRID_W, GRID_H);
    const mix = (to: number[], t: number, c: number) => Math.round(BG[c] + (to[c] - BG[c]) * t);
    const start = performance.now();
    let frame = 0, last = -Infinity;
    const draw = (now: number) => {
      if (!reduced) frame = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      const wt = reduced ? 0 : 2 * Math.PI * DRAWN_HZ * (now - start) / 1000;
      for (let j = 0; j < GRID_H; j++) for (let i = 0; i < GRID_W; i++) {
        const x = ((i + 0.5) / GRID_W * W - W / 2) / scale, y = (H / 2 - (j + 0.5) / GRID_H * H) / scale;
        const v = Math.tanh(field(x, y, wt) * gain), to = v > 0 ? CREST : TROUGH, t = Math.abs(v) * 0.85, p = (j * GRID_W + i) * 4;
        img.data[p] = mix(to, t, 0); img.data[p + 1] = mix(to, t, 1); img.data[p + 2] = mix(to, t, 2); img.data[p + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);
      const at = (p: { x: number; y: number }) => [W / 2 + p.x * scale, H / 2 - p.y * scale] as const;
      ctx.font = '600 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const p of points) {
        const [x, y] = at(p);
        ctx.beginPath(); ctx.arc(x, y, 11, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
        ctx.fillStyle = '#121a2b'; ctx.fillText(element, x, y + 0.5);
      }
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 19, 0, 2 * Math.PI);
      ctx.strokeStyle = echo > 0.3 ? '#8ce3ff' : echo < -0.3 ? '#d95926' : '#a7b1c1'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 13, 0, 2 * Math.PI); ctx.fillStyle = '#f3f6fa'; ctx.fill();
      ctx.fillStyle = '#121a2b'; ctx.fillText(absorber, W / 2, H / 2 + 0.5);
      // Scale bar: 1 angstrom.
      ctx.strokeStyle = '#d4dae3'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W - 20 - scale, H - 18); ctx.lineTo(W - 20, H - 18); ctx.stroke();
      ctx.font = '12px sans-serif'; ctx.fillStyle = '#d4dae3'; ctx.textAlign = 'center';
      ctx.fillText('1 Å', W - 20 - scale / 2, H - 30);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    // Restart only when what is drawn changes, not when a new but equal array or object arrives.
  }, [JSON.stringify([k, atoms, curves, color, absorber, element, echo, echoesOnly]), reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={canvas} className="wave-map" width={W} height={H} role="img" aria-label={label} />;
}
