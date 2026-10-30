'use client';
import { useEffect, useRef, useState } from 'react';
import { Tex } from '../tex';

// Plot text uses the LaTeX font, like the site's other plots.
const TEX_FONT = "KaTeX_Main, 'Latin Modern Roman', 'Times New Roman', serif";
const INK = '#d4dae3', MUTED = '#a7b1c1', GRID = '#35404d', SCAN = '#8ce3ff';

export interface ShellCurve { id: string; color: string; dash?: string; y: number[]; label: string }
export interface Marker { x: number; text: string; color: string; dashed?: boolean }

interface Props {
  x: number[];
  xMax: number;
  curves: ShellCurve[];
  total: number[];
  scan?: { x: number[]; y: number[] } | null;
  selected: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  xLabel: string;
  yTex: string;
  title: string;
  /** Shaded x range, such as the Fourier transform window. */
  band?: { from: number; to: number; label: string };
  markers?: Marker[];
  /** Labels drawn on the curves at these points, by curve id. */
  labelAt?: Record<string, number>;
  /** Curves as they were before a "what if" change, drawn dashed underneath. */
  ghosts?: { y: number[]; color: string }[];
  height?: number;
}

/**
 * One EXAFS view split into shells: every shell's curve, the total and, from the twin, the scan. Pointing at the plot
 * picks the shell that contributes most there; clicking keeps it. The shell table beside it offers the same by keyboard.
 */
export function ShellPlot({ x, xMax, curves, total, scan, selected, onHover, onSelect, xLabel, yTex, title, band, markers = [], labelAt = {}, ghosts = [], height = 220 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!wrap.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, []);
  const end = Math.max(2, x.findIndex(v => v > xMax));
  const xs = x.slice(0, end);
  const visible = [total, ...curves.map(c => c.y), ...ghosts.map(g => g.y)].map(y => y.slice(0, end));
  const scanShown = scan ? scan.x.map((v, i) => [v, scan.y[i]] as const).filter(([v]) => v <= xMax) : [];
  let low = 0, high = 0;
  for (const y of visible) for (const v of y) { low = Math.min(low, v); high = Math.max(high, v); }
  for (const [, v] of scanShown) { low = Math.min(low, v); high = Math.max(high, v); }
  const pad = (high - low || 1) * 0.08;
  const y0 = low < 0 ? low - pad : 0, y1 = high + pad;
  const W = width, H = height, L = 52, R = 14, T = 12, B = 40;
  const px = (v: number) => L + (v - xs[0]) / (xMax - xs[0]) * (W - L - R);
  const py = (v: number) => H - B - (v - y0) / (y1 - y0) * (H - T - B);
  const path = (xv: readonly number[], y: readonly number[]) => y.map((v, i) => (i ? 'L' : 'M') + px(xv[i]).toFixed(1) + ',' + py(v).toFixed(1)).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const fmt = (n: number) => Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1);

  // The shell with the largest contribution at this x.
  const pick = (clientX: number, box: DOMRect) => {
    const value = xs[0] + ((clientX - box.left) / box.width * W - L) / (W - L - R) * (xMax - xs[0]);
    if (value < xs[0] || value > xMax) return null;
    const i = Math.min(xs.length - 1, Math.max(0, Math.round((value - xs[0]) / (xs[1] - xs[0]))));
    let best: ShellCurve | null = null;
    for (const c of curves) if (!best || Math.abs(c.y[i]) > Math.abs(best.y[i])) best = c;
    return best?.id ?? null;
  };

  // Direct labels, tallest first, skipping any that would overlap one already placed.
  const tall = (c: ShellCurve) => labelAt[c.id] === undefined ? -1 : Math.abs(c.y[nearest(xs, labelAt[c.id])]);
  const placed: { x: number; y: number; text: string }[] = [];
  for (const c of [...curves].sort((a, b) => tall(b) - tall(a))) {
    const at = labelAt[c.id];
    if (at === undefined || at > xMax || (selected && selected !== c.id)) continue;
    const lx = px(at), ly = Math.max(T + 12, py(c.y[nearest(xs, at)]) - 8);
    // Labels are centred and about 7 px a character.
    if (placed.some(p => Math.abs(p.x - lx) < 3.5 * (p.text.length + c.label.length) && Math.abs(p.y - ly) < 16)) continue;
    placed.push({ x: lx, y: ly, text: c.label });
  }

  return <div className="shell-plot" ref={wrap}>
    <div className="shell-plot-top"><Tex>{yTex}</Tex></div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}
      onPointerMove={e => onHover(pick(e.clientX, e.currentTarget.getBoundingClientRect()))}
      onPointerLeave={() => onHover(null)}
      onClick={e => { const id = pick(e.clientX, e.currentTarget.getBoundingClientRect()); if (id) onSelect(id); }}>
      <rect width={W} height={H} fill="#172235" />
      {ticks.map(t => <g key={t}>
        <line x1={L} x2={W - R} y1={py(y0 + t * (y1 - y0))} y2={py(y0 + t * (y1 - y0))} stroke={GRID} />
        <text x={L - 6} y={py(y0 + t * (y1 - y0)) + 4} textAnchor="end" fill={MUTED} fontSize="12" fontFamily={TEX_FONT}>{fmt(y0 + t * (y1 - y0))}</text>
        <text x={px(xs[0] + t * (xMax - xs[0]))} y={H - B + 17} textAnchor="middle" fill={MUTED} fontSize="12" fontFamily={TEX_FONT}>{fmt(xs[0] + t * (xMax - xs[0]))}</text>
      </g>)}
      {band && <g><rect x={px(band.from)} y={T} width={px(Math.min(band.to, xMax)) - px(band.from)} height={H - T - B} fill="#9cc5e8" opacity=".07" />
        <text x={px(band.from) + 5} y={T + 13} fill={MUTED} fontSize="11.5" fontFamily={TEX_FONT}>{band.label}</text></g>}
      {ghosts.map((g, i) => <path key={'ghost' + i} d={path(xs, g.y.slice(0, end))} fill="none" stroke={g.color} strokeDasharray="4 4" strokeWidth="1.6" opacity="0.6" />)}
      {curves.map(c => <path key={c.id} d={path(xs, c.y.slice(0, end))} fill="none" stroke={c.color} strokeDasharray={c.dash}
        strokeWidth={selected === c.id ? 2.6 : 1.6} opacity={selected && selected !== c.id ? 0.18 : 0.95} />)}
      <path d={path(xs, total.slice(0, end))} fill="none" stroke={INK} strokeWidth="2" opacity={selected ? 0.55 : 0.9} />
      {scanShown.length > 1 && <path d={path(scanShown.map(p => p[0]), scanShown.map(p => p[1]))} fill="none" stroke={SCAN} strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" />}
      {markers.map(m => <g key={m.text}>
        <line x1={px(m.x)} x2={px(m.x)} y1={T} y2={H - B} stroke={m.color} strokeDasharray={m.dashed ? '4 4' : undefined} strokeWidth="1.5" />
        <text x={px(m.x) + 4} y={T + 30} fill={INK} fontSize="11.5" fontFamily={TEX_FONT} paintOrder="stroke" stroke="#172235" strokeWidth="3">{m.text}</text>
      </g>)}
      {placed.map(p => <text key={p.text + p.x} x={p.x} y={p.y} textAnchor="middle" fill={INK} fontSize="12" fontFamily={TEX_FONT} paintOrder="stroke" stroke="#172235" strokeWidth="3">{p.text}</text>)}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fill={MUTED} fontSize="12.5" fontFamily={TEX_FONT}>{xLabel}</text>
    </svg>
  </div>;
}

function nearest(xs: number[], value: number) {
  const i = Math.round((value - xs[0]) / (xs[1] - xs[0]));
  return Math.min(xs.length - 1, Math.max(0, i));
}
