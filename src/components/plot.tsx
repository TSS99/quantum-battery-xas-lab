'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Download } from 'lucide-react';
import { download } from './ui';
import { Num, Tex, Unit } from './tex';

// Plot text uses the LaTeX font; the exported SVG names it too and falls back to a serif.
const TEX_FONT = "KaTeX_Main, 'Latin Modern Roman', 'Times New Roman', serif";
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** 1.2e+5 as 1.2×10⁵ with a true minus sign, for SVG text that cannot hold KaTeX. */
const sciText = (s: string) => s.replace(/^-/, '−').replace(/e([+-]?)(\d+)$/, (_, sign: string, exp: string) => '×10' + (sign === '-' ? '⁻' : '') + [...exp].map(d => SUP[+d]).join(''));
export interface Series { name: string; label?: ReactNode; color: string; x: number[]; y: number[]; dashed?: boolean; sigma?: number[] }
interface Props { series: Series[]; xLabel?: string; yLabel?: string; yTex?: string; yUnit?: string; cursor?: number; onCursor?: (n: number) => void; height?: number; exportName?: string; minY?: number; ghostKey?: string; edge?: number; reveal?: number }
export function Plot({ series, xLabel = 'Photon energy (eV)', yLabel = 'μ (cm⁻¹)', yTex = yLabel === 'μ (cm⁻¹)' ? '\\mu\\ (\\mathrm{cm}^{-1})' : undefined, yUnit: explicitYUnit, cursor, onCursor, height = 240, exportName = 'spectrum', minY, ghostKey, edge, reveal = 1 }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, ''), reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null), ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(700), [hover, setHover] = useState<number | null>(null);
  const prior = useRef<{ key?: string; series: Series[]; edge?: number } | null>(null);
  const [ghost, setGhost] = useState<{ series: Series[]; delta: number | null } | null>(null);
  const valid = series.filter(s => s.x.length && s.x.length === s.y.length);
  useEffect(() => {
    if (!wrapRef.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(180, Math.round(entry.contentRect.width))));
    observer.observe(wrapRef.current); return () => observer.disconnect();
  }, [valid.length]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (ghostKey !== undefined && prior.current && prior.current.key !== ghostKey) {
      setGhost({ series: prior.current.series, delta: edge !== undefined && prior.current.edge !== undefined ? edge - prior.current.edge : null });
      timer = setTimeout(() => setGhost(null), 600);
    }
    prior.current = { key: ghostKey, series, edge };
    return () => clearTimeout(timer);
  }, [ghostKey]); // Cursor movement does not restart the edge comparison.
  if (!valid.length) return <div className="plot-empty">No curve yet. Run an experiment or import data.</div>;
  let x0 = Infinity, x1 = -Infinity, low = 0, high = 0;
  for (const s of valid) for (let i = 0; i < s.x.length; i++) { x0 = Math.min(x0, s.x[i]); x1 = Math.max(x1, s.x[i]); low = Math.min(low, s.y[i] - (s.sigma?.[i] ?? 0)); high = Math.max(high, s.y[i] + (s.sigma?.[i] ?? 0)); }
  const y0 = minY ?? low, y1 = Math.max(high, y0 + 1e-6) + (high - y0) * .1;
  const labelLines: string[] = [];
  const maxChars = Math.max(20, Math.floor((width - 16) / 7));
  for (const word of xLabel.split(' ')) {
    const last = labelLines.length - 1;
    if (last < 0 || labelLines[last].length + word.length + 1 > maxChars) labelLines.push(word); else labelLines[last] += ' ' + word;
  }
  const W = width, H = height + Math.max(0, labelLines.length - 1) * 16, L = width < 400 ? 58 : 64, R = 20, T = 30, B = 48 + Math.max(0, labelLines.length - 1) * 16;
  const px = (x: number) => L + (x - x0) / (x1 - x0 || 1) * (W - L - R);
  const py = (y: number) => H - B - (y - y0) / (y1 - y0 || 1) * (H - T - B);
  const line = (s: Series) => s.y.map((v, i) => (i ? 'L' : 'M') + px(s.x[i]).toFixed(2) + ',' + py(v).toFixed(2)).join(' ');
  const cx = Math.max(x0, Math.min(x1, hover ?? cursor ?? x0));
  const xUnit = xLabel.match(/\(([^)]+)\)/)?.[1].split(';')[0] ?? '';
  const yUnit = explicitYUnit ?? yLabel.match(/(?:^|\s)\(([^()]+)\)$/)?.[1] ?? '';
  const nearest = (s: Series) => s.x.reduce((best, x, j) => Math.abs(x - cx) < Math.abs(s.x[best] - cx) ? j : best, 0);
  const ticks = Array.from({ length: width < 400 ? 3 : 5 }, (_, i) => i / (width < 400 ? 2 : 4));
  const fmt = (n: number) => Math.abs(n) >= 100000 || (Math.abs(n) < .01 && n !== 0) ? n.toExponential(1) : Math.abs(n) > 100 ? n.toFixed(0) : n.toFixed(2);
  const inspect = (value: number, commit: boolean) => { setHover(value); if (commit) onCursor?.(value); };
  const pointerValue = (event: React.PointerEvent<SVGSVGElement>) => { const b = event.currentTarget.getBoundingClientRect(); return Math.max(x0, Math.min(x1, x0 + (((event.clientX - b.left) / b.width * W - L) / (W - L - R)) * (x1 - x0))); };
  return <div ref={wrapRef} className="plot-wrap">
    <div className="plot-top"><span>{yTex ? <Tex>{yTex}</Tex> : yLabel}</span>{ghost?.delta != null && <span className="edge-delta">edge {ghost.delta > 0 ? '+' : ''}<Num>{ghost.delta.toFixed(2)}</Num> <Unit>eV</Unit></span>}<button className="icon-button" aria-label={'Download ' + exportName + ' as SVG'} onClick={() => ref.current && download(exportName + '.svg', new XMLSerializer().serializeToString(ref.current), 'image/svg+xml')}><Download size={16} /></button></div>
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" role="slider" tabIndex={0} aria-label={exportName + ': ' + yLabel + ' versus ' + xLabel} aria-valuemin={x0} aria-valuemax={x1} aria-valuenow={cx} aria-valuetext={cx.toFixed(2) + ' ' + xUnit + '; ' + valid[0].name + ' ' + fmt(valid[0].y[nearest(valid[0])]) + ' ' + yUnit} aria-describedby={uid + '-help'} viewBox={'0 0 ' + W + ' ' + H}
      onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) { e.preventDefault(); inspect(e.key === 'Home' ? x0 : e.key === 'End' ? x1 : Math.max(x0, Math.min(x1, cx + (['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1) * (x1 - x0) / 100)), true); } }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); inspect(pointerValue(e), true); }}
      onPointerMove={e => inspect(pointerValue(e), e.buttons === 1)}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}>
      <title>{yLabel + ' versus ' + xLabel}</title>
      <rect width={W} height={H} fill="#11171e" />
      {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={py(y0 + t * (y1 - y0))} y2={py(y0 + t * (y1 - y0))} stroke="#35404d" /><text x={L - 8} y={py(y0 + t * (y1 - y0)) + 4} textAnchor="end" fill="#c4ccd6" fontSize="13" fontFamily={TEX_FONT}>{sciText(fmt(y0 + t * (y1 - y0)))}</text><text x={px(x0 + t * (x1 - x0))} y={H - B + 20} textAnchor="middle" fill="#c4ccd6" fontSize="13" fontFamily={TEX_FONT}>{sciText(fmt(x0 + t * (x1 - x0)))}</text></g>)}
      <defs><clipPath id={uid + '-clip'}><rect x={L} y={T} width={W - L - R} height={H - T - B} /></clipPath></defs>
      <g clipPath={'url(#' + uid + '-clip)'}>
        {valid.length === 1 && <path d={line(valid[0]) + ' L' + px(x1) + ',' + py(y0) + ' L' + px(x0) + ',' + py(y0) + 'Z'} fill={valid[0].color} opacity=".06" />}
        {ghost?.series.map((s, i) => <path key={i} className="edge-ghost" d={line(s)} stroke={s.color} opacity=".3" fill="none" strokeWidth="2" />)}
        {valid.map((s, j) => <g key={s.name}>
          {s.sigma && <path d={s.x.map((x, i) => (i ? 'L' : 'M') + px(x) + ',' + py(s.y[i] + s.sigma![i])).join(' ') + s.x.map((_, i) => { const k = s.x.length - 1 - i; return 'L' + px(s.x[k]) + ',' + py(s.y[k] - s.sigma![k]); }).join(' ') + 'Z'} fill={s.color} opacity=".13" />}
          <motion.path initial={false} animate={{ d: line(s), strokeDashoffset: j === 0 && reveal < 1 && !reduced ? 1 - reveal : 0 }} transition={{ duration: reduced ? 0 : reveal < 1 ? .065 : .24, ease: 'linear' }} pathLength={j === 0 && reveal < 1 ? 1 : undefined} fill="none" stroke={s.color} strokeWidth="2.2" strokeDasharray={j === 0 && reveal < 1 ? '1' : s.dashed ? '5 5' : undefined} />
        </g>)}
        <line x1={px(cx)} x2={px(cx)} y1={T} y2={H - B} stroke="#ffc46b" strokeDasharray="4 4" />
        {valid.map((s, i) => <circle key={i} cx={px(s.x[nearest(s)])} cy={py(s.y[nearest(s)])} r="4" fill={s.color} stroke="#11171e" strokeWidth="1.5" />)}
      </g>
      <text x={L} y="18" fill="#eef2f6" fontSize="13" fontFamily={TEX_FONT}>{sciText(cx.toFixed(2)) + ' ' + xUnit}</text>
      {labelLines.map((label, i) => <text key={i} x={W / 2} y={H - (labelLines.length - 1 - i) * 16 - 5} fill="#c4ccd6" fontSize="13" fontFamily={TEX_FONT}>{label}</text>)}
    </svg>
    <span id={uid + '-help'} className="sr-only">Use arrow keys, Home or End to inspect the curve. Drag to move the cursor.</span>
    <div className="plot-readout" aria-live="polite" aria-atomic="true"><Num>{cx.toFixed(2)}</Num> <Unit>{xUnit}</Unit>; values at the nearest samples.</div>
    <div className="plot-legend">{valid.map((s, i) => <span key={i}><i style={{ background: s.color }} />{s.label ?? s.name}<b><Num>{fmt(s.y[nearest(s)])}</Num> <Unit>{yUnit}</Unit></b></span>)}</div>
  </div>;
}
