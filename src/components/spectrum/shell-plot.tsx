'use client';
import { useEffect, useRef, useState } from 'react';
import { Tex } from '../tex';
import { niceTicks, tickLabel } from './ticks';

// Plot text uses the LaTeX font, like the site's other plots.
const TEX_FONT = "KaTeX_Main, 'Latin Modern Roman', 'Times New Roman', serif";
const INK = '#d4dae3', MUTED = '#a7b1c1', GRID = '#35404d', SCAN = '#8ce3ff', BG = '#172235';
/** Height of one lane in the stacked view, px. */
const LANE = 46;

export interface ShellCurve { id: string; color: string; dash?: string; y: number[]; label: string }
export interface Marker { x: number; text: string; color: string; dashed?: boolean }
/** A shell's true distance, drawn as a bar of height share (0 to 1, its number of atoms against the largest), with an arrow to its peak. */
export interface Stick { id: string; x: number; peak: number; share: number; color: string }

interface Props {
  x: number[];
  xMax: number;
  curves: ShellCurve[];
  total: number[];
  scan?: { x: number[]; y: number[]; label: string } | null;
  selected: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  xLabel: string;
  yTex: string;
  title: string;
  /** Overlay: every curve on one axis. Stacked: one lane per curve on a shared scale, the total on top. */
  mode?: 'overlay' | 'stacked';
  /** Shaded x range, such as the Fourier transform window. */
  band?: { from: number; to: number; label: string };
  markers?: Marker[];
  /** Labels drawn on the curves at these points, by curve id (overlay). */
  labelAt?: Record<string, number>;
  /** Curves as they were before a "what if" change, drawn dashed underneath; `id` puts one in its lane when stacked ('total' for the total). */
  ghosts?: { y: number[]; color: string; id?: string }[];
  sticks?: Stick[];
  height?: number;
}

/**
 * One EXAFS view split into shells: every shell's curve, the total and a measured or scanned curve. Pointing at the
 * plot picks the shell that contributes most there (overlay) or the lane under the pointer (stacked); clicking keeps
 * it. The shell table beside it offers the same by keyboard.
 */
export function ShellPlot({ x, xMax, curves, total, scan, selected, onHover, onSelect, xLabel, yTex, title, mode = 'overlay', band, markers = [], labelAt = {}, ghosts = [], sticks = [], height = 220 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!wrap.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, []);
  const stacked = mode === 'stacked';
  const end = Math.max(2, x.findIndex(v => v > xMax));
  const xs = x.slice(0, end);
  const cut = (y: number[]) => y.slice(0, end);
  const scanShown = scan ? scan.x.map((v, i) => [v, scan.y[i]] as const).filter(([v]) => v <= xMax) : [];
  const signed = [total, ...curves.map(c => c.y)].some(y => cut(y).some(v => v < 0));
  const W = width, L = 52, R = 14, T = 12, B = 40;
  const lanes = stacked ? curves.length + 1 : 1;
  const H = stacked ? T + B + lanes * LANE : height;
  const px = (v: number) => L + (v - xs[0]) / (xMax - xs[0]) * (W - L - R);
  const path = (xv: readonly number[], y: readonly number[], py: (v: number) => number) => y.map((v, i) => (i ? 'L' : 'M') + px(xv[i]).toFixed(1) + ',' + py(v).toFixed(1)).join('');
  const xTicks = niceTicks(xs[0], xMax, 7);

  // Overlay: one y axis for everything.
  let low = 0, high = 0;
  for (const y of [total, ...curves.map(c => c.y), ...ghosts.map(g => g.y)]) for (const v of cut(y)) { low = Math.min(low, v); high = Math.max(high, v); }
  for (const [, v] of scanShown) { low = Math.min(low, v); high = Math.max(high, v); }
  const pad = (high - low || 1) * 0.08;
  const y0 = low < 0 ? low - pad : 0, y1 = high + pad;
  const pyOverlay = (v: number) => H - B - (v - y0) / (y1 - y0) * (H - T - B);
  const yTicks = niceTicks(y0, y1, 5);

  // Stacked: lane 0 is the total (with the scan), then one lane per curve; the shells share one scale.
  const peak = (ys: number[][]) => Math.max(1e-12, ...ys.flatMap(y => cut(y).map(Math.abs)));
  const shellScale = peak(curves.map(c => c.y)), totalScale = peak([total, ...(scanShown.length ? [scanShown.map(p => p[1])] : [])]);
  const laneY = (lane: number, scale: number) => (v: number) => {
    const top = T + lane * LANE, inner = LANE - 10;
    return signed ? top + LANE / 2 - v / scale * inner / 2 : top + LANE - 4 - v / scale * (inner - 2);
  };
  const laneOf = (id: string) => curves.findIndex(c => c.id === id) + 1;
  const pyFor = (id: string | 'total') => !stacked ? pyOverlay : id === 'total' ? laneY(0, totalScale) : laneY(laneOf(id), shellScale);

  const pick = (clientX: number, clientY: number, box: DOMRect) => {
    const sx = (clientX - box.left) / box.width * W, sy = (clientY - box.top) / box.height * H;
    const value = xs[0] + (sx - L) / (W - L - R) * (xMax - xs[0]);
    if (value < xs[0] || value > xMax) return null;
    if (stacked) {
      const lane = Math.floor((sy - T) / LANE);
      return lane >= 1 && lane <= curves.length ? curves[lane - 1].id : null;
    }
    const i = Math.min(xs.length - 1, Math.max(0, Math.round((value - xs[0]) / (xs[1] - xs[0]))));
    let best: ShellCurve | null = null;
    for (const c of curves) if (!best || Math.abs(c.y[i]) > Math.abs(best.y[i])) best = c;
    return best?.id ?? null;
  };

  // Direct labels (overlay), tallest first, skipping any that would overlap one already placed.
  const tall = (c: ShellCurve) => labelAt[c.id] === undefined ? -1 : Math.abs(c.y[nearest(xs, labelAt[c.id])]);
  const placed: { x: number; y: number; text: string }[] = [];
  if (!stacked) for (const c of [...curves].sort((a, b) => tall(b) - tall(a))) {
    const at = labelAt[c.id];
    if (at === undefined || at > xMax || (selected && selected !== c.id)) continue;
    const lx = px(at), ly = Math.max(T + 12, pyOverlay(c.y[nearest(xs, at)]) - 8);
    // Labels are centred and about 7 px a character.
    if (placed.some(p => Math.abs(p.x - lx) < 3.5 * (p.text.length + c.label.length) && Math.abs(p.y - ly) < 16)) continue;
    placed.push({ x: lx, y: ly, text: c.label });
  }

  const arrow = (s: Stick, y: number, label: boolean) => {
    const a = px(s.x), b = px(s.peak), dir = b < a ? 1 : -1;
    return <g key={'arrow' + s.id}>
      {Math.abs(b - a) > 6 && <>
        <line x1={a} x2={b} y1={y} y2={y} stroke={s.color} strokeWidth="1.5" />
        <path d={`M${b + dir * 6},${y - 4} L${b},${y} L${b + dir * 6},${y + 4}`} fill="none" stroke={s.color} strokeWidth="1.5" />
      </>}
      {label && <text x={Math.max(a, b) + 8} y={y + 4} fill={INK} fontSize="11.5" fontFamily={TEX_FONT} paintOrder="stroke" stroke={BG} strokeWidth="3">
        {`true ${s.x.toFixed(2)} Å → peak ${s.peak.toFixed(2)} Å`}</text>}
    </g>;
  };

  return <div className="shell-plot" ref={wrap}>
    <div className="shell-plot-top"><Tex>{yTex}</Tex></div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}
      onPointerMove={e => onHover(pick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()))}
      onPointerLeave={() => onHover(null)}
      onClick={e => { const id = pick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()); if (id) onSelect(id); }}>
      <rect width={W} height={H} fill={BG} />
      {xTicks.values.map(t => <g key={'x' + t}>
        <line x1={px(t)} x2={px(t)} y1={T} y2={H - B} stroke={GRID} opacity={stacked ? 0.6 : 0.35} />
        <text x={px(t)} y={H - B + 17} textAnchor="middle" fill={MUTED} fontSize="12" fontFamily={TEX_FONT}>{tickLabel(t, xTicks.step)}</text>
      </g>)}
      {!stacked && yTicks.values.map(t => <g key={'y' + t}>
        <line x1={L} x2={W - R} y1={pyOverlay(t)} y2={pyOverlay(t)} stroke={GRID} />
        <text x={L - 6} y={pyOverlay(t) + 4} textAnchor="end" fill={MUTED} fontSize="12" fontFamily={TEX_FONT}>{tickLabel(t, yTicks.step)}</text>
      </g>)}
      {stacked && Array.from({ length: lanes }, (_, lane) => {
        const c = lane ? curves[lane - 1] : null, zero = (lane ? laneY(lane, shellScale) : laneY(0, totalScale))(0);
        const dim = selected && c && selected !== c.id;
        return <g key={'lane' + lane} opacity={dim ? 0.35 : 1}>
          {lane > 0 && <line x1={L} x2={W - R} y1={T + lane * LANE} y2={T + lane * LANE} stroke={GRID} />}
          <line x1={L} x2={W - R} y1={zero} y2={zero} stroke={GRID} strokeDasharray="2 3" />
          <line x1={L - 34} x2={L - 20} y1={T + lane * LANE + LANE / 2} y2={T + lane * LANE + LANE / 2} stroke={c ? c.color : INK} strokeWidth="2.5" strokeDasharray={c?.dash} />
        </g>;
      })}
      {band && <g><rect x={px(band.from)} y={T} width={px(Math.min(band.to, xMax)) - px(band.from)} height={H - T - B} fill="#9cc5e8" opacity=".07" />
        <text x={px(band.from) + 5} y={T + 13} fill={MUTED} fontSize="11.5" fontFamily={TEX_FONT}>{band.label}</text></g>}
      {ghosts.map((g, i) => (!stacked || g.id) && <path key={'ghost' + i} d={path(xs, cut(g.y), pyFor(g.id ?? 'total'))} fill="none" stroke={g.color} strokeDasharray="4 4" strokeWidth="1.6" opacity="0.6" />)}
      {sticks.length > 0 && !stacked && sticks.map(s => {
        const base = H - B, top = base - s.share * 0.22 * (H - T - B), lit = !selected || selected === s.id;
        return <g key={'stick' + s.id} opacity={lit ? 0.9 : 0.25}>
          <line x1={px(s.x)} x2={px(s.x)} y1={base} y2={top} stroke={s.color} strokeWidth="4" strokeLinecap="round" />
          {selected === s.id && arrow(s, top - 2, true)}
        </g>;
      })}
      {sticks.length > 0 && stacked && sticks.map(s => {
        const lane = laneOf(s.id);
        if (lane < 1) return null;
        const base = T + (lane + 1) * LANE - 4, top = base - 0.55 * (LANE - 10) * Math.max(0.35, s.share);
        return <g key={'stick' + s.id} opacity={!selected || selected === s.id ? 0.9 : 0.3}>
          <line x1={px(s.x)} x2={px(s.x)} y1={base} y2={top} stroke={s.color} strokeWidth="4" strokeLinecap="round" />
          {arrow(s, top - 1, selected === s.id)}
        </g>;
      })}
      {curves.map(c => <path key={c.id} d={path(xs, cut(c.y), pyFor(c.id))} fill="none" stroke={c.color} strokeDasharray={c.dash}
        strokeWidth={selected === c.id ? 2.6 : stacked ? 1.8 : 1.6} opacity={selected && selected !== c.id ? (stacked ? 0.35 : 0.18) : 0.95} />)}
      <path d={path(xs, cut(total), pyFor('total'))} fill="none" stroke={INK} strokeWidth="2" opacity={selected && !stacked ? 0.55 : 0.9} />
      {scanShown.length > 1 && <path d={path(scanShown.map(p => p[0]), scanShown.map(p => p[1]), pyFor('total'))} fill="none" stroke={SCAN} strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" />}
      {markers.map(m => <g key={m.text}>
        <line x1={px(m.x)} x2={px(m.x)} y1={T} y2={H - B} stroke={m.color} strokeDasharray={m.dashed ? '4 4' : undefined} strokeWidth="1.5" />
        <text x={px(m.x) + 4} y={T + 30} fill={INK} fontSize="11.5" fontFamily={TEX_FONT} paintOrder="stroke" stroke={BG} strokeWidth="3">{m.text}</text>
      </g>)}
      {stacked && Array.from({ length: lanes }, (_, lane) => {
        const c = lane ? curves[lane - 1] : null;
        const text = c ? c.label : `Total${scanShown.length ? ` and ${scan!.label}` : ''}${totalScale > 1.15 * shellScale ? ` (÷${(totalScale / shellScale).toFixed(1)})` : ''}`;
        return <text key={'name' + lane} x={L + 6} y={T + lane * LANE + 14} fill={INK} fontSize="12" fontFamily={TEX_FONT} paintOrder="stroke" stroke={BG} strokeWidth="3"
          opacity={selected && c && selected !== c.id ? 0.45 : 1}>{text}</text>;
      })}
      {placed.map(p => <text key={p.text + p.x} x={p.x} y={p.y} textAnchor="middle" fill={INK} fontSize="12" fontFamily={TEX_FONT} paintOrder="stroke" stroke={BG} strokeWidth="3">{p.text}</text>)}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fill={MUTED} fontSize="12.5" fontFamily={TEX_FONT}>{xLabel}</text>
    </svg>
  </div>;
}

function nearest(xs: number[], value: number) {
  const i = Math.round((value - xs[0]) / (xs[1] - xs[0]));
  return Math.min(xs.length - 1, Math.max(0, i));
}
