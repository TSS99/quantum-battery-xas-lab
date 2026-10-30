'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { ETOK } from '@/lib/twin/exafs';
import { libraryFineStructure } from '@/lib/twin/sample';
import { pathCurves, type Shell } from '@/lib/twin/shells';
import { defaultNearEdgeFeatures } from '@/lib/xas-general';
import type { FeffMaterial } from '@/lib/twin/types';
import { Num } from '../tex';
import { atomName } from './atoms';

/*
 * How XAS works, in one energy scan: the photon energy (a slider, or Scan) drives three linked pictures. The beam
 * through the sample dims as absorption rises (what the detectors measure); the absorbing atom's levels show what the
 * photon does to the core electron at that energy; the spectrum builds up to the cursor. The curve is the twin's model
 * for this sample (teaching near edge, FEFF path sum above); the levels are drawn at their energies relative to E0.
 */

const FROM = -30, KNEE = 60, TO = 500, SPLIT = 0.55;
/** Position along the energy axis (0 to 1): the near edge stretched over 55 %, the fine structure over the rest. */
const toPos = (d: number) => d <= KNEE ? (d - FROM) / (KNEE - FROM) * SPLIT : SPLIT + (d - KNEE) / (TO - KNEE) * (1 - SPLIT);
const fromPos = (s: number) => s <= SPLIT ? FROM + s / SPLIT * (KNEE - FROM) : KNEE + (s - SPLIT) / (1 - SPLIT) * (TO - KNEE);
const SCAN_S = 16;

type Region = 'below' | 'pre' | 'edge' | 'xanes' | 'exafs';
const REGIONS: { id: Region; name: string }[] = [
  { id: 'below', name: 'Below the edge' }, { id: 'pre', name: 'Pre-edge' }, { id: 'edge', name: 'Edge' },
  { id: 'xanes', name: 'XANES' }, { id: 'exafs', name: 'EXAFS' },
];

const period = (z: number) => z <= 2 ? 1 : z <= 10 ? 2 : z <= 18 ? 3 : z <= 36 ? 4 : z <= 54 ? 5 : z <= 86 ? 6 : 7;

export function XasExplorer({ material, shift_eV, temperature_K, shell }: { material: FeffMaterial; shift_eV: number; temperature_K: number; shell: Shell | null }) {
  const reduced = useReducedMotion();
  const e0 = material.edge_energy_eV + shift_eV;
  const model = useMemo(() => libraryFineStructure(e0, material, temperature_K), [e0, material, temperature_K]);
  const f = defaultNearEdgeFeatures(e0);
  const z = material.sites[0].paths[0].geometry[0].atomic_number;
  const kEdge = material.edge === 'K', transition = kEdge && z >= 21 && z <= 30;
  const core = kEdge ? '1s' : '2p₃/₂';
  const empty = kEdge ? `empty ${period(z)}p` : z >= 72 && z <= 80 ? 'empty 5d' : 'empty d';
  const bound = transition ? '3d, nearly full' : 'bound states';
  // The regions, from the model's own feature positions.
  const region = (d: number): Region => d < -f.preEdgeOffset_eV - 2.5 * f.preEdgeWidth_eV ? 'below'
    : d <= -f.preEdgeOffset_eV + 2.5 * f.preEdgeWidth_eV ? 'pre' : d < -3 ? 'below' : d <= 15 ? 'edge' : d <= 50 ? 'xanes' : 'exafs';
  const centre: Record<Region, number> = { below: -25, pre: -f.preEdgeOffset_eV, edge: f.whiteLineOffset_eV, xanes: 32, exafs: 150 };

  const [pos, setPos] = useState(toPos(-25));
  const [playing, setPlaying] = useState(false);
  const start = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    start.current = performance.now() - pos * SCAN_S * 1000;
    const tick = (now: number) => {
      const s = Math.min(1, (now - start.current) / (SCAN_S * 1000));
      setPos(s);
      if (s < 1) frame = requestAnimationFrame(tick); else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Only a start or a pause restarts the loop; the scan carries on from wherever the slider was.
  }, [playing]);

  const d = fromPos(pos), here = region(d), mu = Math.max(0, model.factor(e0 + d));
  const k = d > 0 ? Math.sqrt(ETOK * d) : 0, lambda = k > 0 ? 2 * Math.PI / k : Infinity;
  const name = atomName(material.absorber);

  // The spectrum, sampled finely over the near edge and coarser above.
  const curve = useMemo(() => {
    const pts: [number, number][] = [];
    for (let x = FROM; x <= KNEE; x += 0.25) pts.push([x, model.factor(e0 + x)]);
    for (let x = KNEE + 2; x <= TO; x += 2) pts.push([x, model.factor(e0 + x)]);
    return pts;
  }, [model, e0]);
  const top = Math.max(...curve.map(p => p[1])) * 1.1;
  const W = 660, H = 320, L = 40, R = 12, T = 30, B = 40;
  const sx = (x: number) => L + toPos(x) * (W - L - R), sy = (v: number) => H - B - v / top * (H - T - B);
  const path = (pts: [number, number][]) => pts.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1)).join('');
  const done = curve.filter(p => p[0] <= d);
  const bands: [Region, number, number][] = [['pre', -f.preEdgeOffset_eV - 2.5 * f.preEdgeWidth_eV, -f.preEdgeOffset_eV + 2.5 * f.preEdgeWidth_eV], ['edge', -3, 15], ['xanes', 15, 50], ['exafs', 50, TO]];

  const caption: Record<Region, string> = {
    below: `Too little energy to free a ${name} ${core} electron: the X-rays mostly pass.`,
    pre: transition ? `Just enough to lift the ${core} electron into the nearly full 3d level: a weak, forbidden jump, the pre-edge.` : `Just enough to lift the ${core} electron into an empty bound state: a small peak before the edge.`,
    edge: `The ${core} electron jumps into ${empty} states: absorption shoots up. Where this happens tracks the oxidation state.`,
    xanes: `The electron is free but slow: it bounces between many neighbours, so this shape fingerprints the site's geometry.`,
    exafs: `A fast electron wave (λ = ${lambda.toFixed(2)} Å) echoes off the neighbours: in step, more absorption; out of step, less.`,
  };

  return <div className="xas-explorer">
    <div className="xas-explorer-figures">
      <AtomPicture here={here} d={d} f={f} mu={mu} top={top} core={core} empty={empty} bound={bound} absorber={material.absorber} k={k} shell={shell} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Normalized absorption of ${material.formula} against energy above its edge, measured up to ${d.toFixed(0)} eV: ${REGIONS.find(r => r.id === here)!.name}`}>
        <rect width={W} height={H} rx="10" fill="#121a2b" />
        {bands.map(([id, a, b]) => <g key={id}>
          <rect x={sx(a)} y={T} width={sx(b) - sx(a)} height={H - T - B} fill={id === here ? '#8ce3ff' : '#9cc5e8'} opacity={id === here ? 0.12 : 0.04} />
          <text x={(sx(a) + sx(b)) / 2} y={T - 10} textAnchor="middle" fill={id === here ? '#f3f6fa' : '#a7b1c1'} fontSize="12.5" fontWeight={id === here ? 600 : 400}>{REGIONS.find(r => r.id === id)!.name}</text>
        </g>)}
        <line x1={sx(KNEE)} x2={sx(KNEE)} y1={T} y2={H - B} stroke="#35404d" strokeDasharray="3 4" />
        {[-20, 0, 20, 40, 60, 200, 400].map(x => <text key={x} x={sx(x)} y={H - B + 16} textAnchor="middle" fill="#a7b1c1" fontSize="12">{x > 0 ? '+' + x : x}</text>)}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fill="#a7b1c1" fontSize="12">E − E₀ (eV), near edge stretched</text>
        <path d={path(curve)} fill="none" stroke="#d4dae3" strokeWidth="1.4" opacity="0.25" />
        {done.length > 1 && <path d={path(done)} fill="none" stroke="#f3f6fa" strokeWidth="2.4" />}
        <line x1={sx(d)} x2={sx(d)} y1={T} y2={H - B} stroke="#8ce3ff" strokeWidth="1.5" />
        <circle cx={sx(d)} cy={sy(mu)} r="5" fill="#8ce3ff" stroke="#121a2b" strokeWidth="2" />
      </svg>
    </div>
    <div className="xas-explorer-controls">
      {!reduced && <button type="button" className="twin-chip is-accent" onClick={() => { if (pos >= 1) setPos(0); setPlaying(p => !p); }}>
        {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{playing ? 'Pause' : 'Scan the energy'}</button>}
      <label className="xas-explorer-slider">
        <span>Photon energy <Num>{(e0 + d).toFixed(0)}</Num> eV <span className="xas-explorer-offset">(<Num>{(d >= 0 ? '+' : '') + d.toFixed(1)}</Num> eV from the edge)</span></span>
        <input type="range" aria-label="Photon energy above the edge" min={0} max={1} step={0.001} value={pos} onChange={e => { setPlaying(false); setPos(+e.target.value); }} />
      </label>
      <div className="xas-explorer-regions" role="group" aria-label="Jump to a region">
        {REGIONS.map(r => <button key={r.id} type="button" className="twin-chip" aria-pressed={here === r.id} onClick={() => { setPlaying(false); setPos(toPos(centre[r.id])); }}>{r.name}</button>)}
      </div>
    </div>
    <p className="xas-explorer-caption" aria-live="polite"><strong>{REGIONS.find(r => r.id === here)!.name}.</strong> {caption[here]}</p>
  </div>;
}

/**
 * The measurement and the atom at this energy. Top: the beam through the sample, dimmed by exp(-mu x), between the
 * two detectors. Below: the absorbing atom's levels (the core level far below, with a break; the bound and empty
 * levels and the threshold E0 at their energies), the photon, and where the core electron goes.
 */
function AtomPicture({ here, d, f, mu, top, core, empty, bound, absorber, k, shell }: {
  here: Region; d: number; f: ReturnType<typeof defaultNearEdgeFeatures>; mu: number; top: number; core: string; empty: string; bound: string; absorber: string; k: number; shell: Shell | null;
}) {
  const W = 420, H = 320;
  // Transmission through a sample a little over one absorption length above the edge (mu x = 0.35 + 1.3 x normalized mu).
  const through = Math.exp(-(0.35 + 1.3 * mu / (top / 1.1)));
  const S = 3.2, Y0 = 170, CORE = 292;
  const level = (e: number) => Y0 - e * S;
  const yPre = level(-f.preEdgeOffset_eV), yEmpty = level(f.whiteLineOffset_eV);
  const target = here === 'pre' ? yPre : here === 'edge' ? Math.max(level(Math.min(d, 15)), 110) : here === 'below' ? null : 92;
  // The photon's reach on the level scale: it falls short below the pre-edge.
  const reach = Math.max(level(Math.min(d, 18)), 88);
  const free = here === 'xanes' || here === 'exafs';
  const lambdaPx = k > 0 ? (2 * Math.PI / k) * 26 : 0;
  // In the fine structure: the outgoing wave and its echo off the first shell, in step where that shell's chi > 0.
  const echo = free && shell ? Math.sin(2 * k * shell.paths[0].reff + pathCurves(shell.paths[0], k).phase) : 0;
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The beam through the sample keeps ${(through * 100).toFixed(0)} percent; in the ${absorber} atom the ${core} electron ${here === 'below' ? 'stays put' : free ? 'is freed as a wave' : 'jumps to an empty level'}`}>
    <rect width={W} height={H} rx="10" fill="#121a2b" />
    {/* The measurement: I0, the sample, It */}
    <g>
      <rect x="18" y="18" width="46" height="34" rx="5" fill="#1d283e" stroke="#35404d" />
      <text x="41" y="40" textAnchor="middle" fill="#d4dae3" fontSize="13">I₀</text>
      <rect x="64" y="30" width="110" height="10" fill="#ffc46b" opacity="0.85" />
      <rect x="174" y="14" width="18" height="42" rx="3" fill="#7a8494" />
      <text x="183" y="70" textAnchor="middle" fill="#a7b1c1" fontSize="11.5">sample</text>
      <rect x="192" y={35 - 5 * through} width="110" height={10 * through} fill="#ffc46b" opacity={0.25 + 0.6 * through} />
      <rect x="302" y="18" width="46" height="34" rx="5" fill="#1d283e" stroke="#35404d" />
      <text x="325" y="40" textAnchor="middle" fill="#d4dae3" fontSize="13">Iₜ</text>
      <rect x="356" y={52 - 34 * through} width="12" height={34 * through} fill="#ffc46b" />
      <text x="388" y="40" fill="#a7b1c1" fontSize="11.5"><tspan x="374" dy="-8">{(through * 100).toFixed(0)} %</tspan><tspan x="374" dy="16">through</tspan></text>
    </g>
    {/* The atom's levels */}
    <rect x="150" y="84" width="250" height={Y0 - 84} fill="#8ce3ff" opacity={free ? 0.1 : 0.04} />
    <text x="392" y="98" textAnchor="end" fill="#a7b1c1" fontSize="11.5">free electron</text>
    <line x1="150" x2="400" y1={Y0} y2={Y0} stroke="#8ce3ff" strokeDasharray="4 4" opacity="0.6" />
    <text x="154" y={Y0 + 13} fill="#8ce3ff" fontSize="11.5">edge E₀</text>
    <line x1="150" x2="330" y1={yEmpty} y2={yEmpty} stroke="#d4dae3" strokeDasharray="2 3" />
    <text x="336" y={yEmpty + 4} fill="#a7b1c1" fontSize="11.5" opacity={free ? 0.45 : 1}>{empty}</text>
    <line x1="150" x2="330" y1={yPre} y2={yPre} stroke="#d4dae3" />
    <text x="336" y={yPre + 4} fill="#a7b1c1" fontSize="11.5">{bound}</text>
    <path d={`M150,${CORE - 40} l10,-6 l-20,-8 l10,-6`} fill="none" stroke="#35404d" />
    <text x="164" y={CORE - 46} fill="#a7b1c1" fontSize="11">thousands of eV below</text>
    <line x1="150" x2="330" y1={CORE} y2={CORE} stroke="#f3f6fa" strokeWidth="2" />
    <text x="336" y={CORE + 4} fill="#f3f6fa" fontSize="12">{core} (core)</text>
    {/* The two core electrons; one leaves when the photon is absorbed, leaving a core hole */}
    <circle cx="232" cy={CORE} r="6" fill="#8ce3ff" />
    <circle cx="256" cy={CORE} r="6" fill={target === null ? '#8ce3ff' : 'none'} stroke="#8ce3ff" strokeWidth="2" />
    {/* The photon: a wavy arrow from the left, reaching as far as its energy allows */}
    <path d={`M20,${CORE} q8,-8 16,0 t16,0 t16,0 t16,0 t16,0`} fill="none" stroke="#ffc46b" strokeWidth="2" />
    <text x="20" y={CORE + 22} fill="#ffc46b" fontSize="11.5">X-ray photon</text>
    <line x1="120" x2="120" y1={CORE} y2={reach} stroke="#ffc46b" strokeWidth="2" strokeDasharray={target === null ? '4 4' : undefined} opacity={target === null ? 0.5 : 1} />
    <path d={`M115,${reach + 8} L120,${reach} L125,${reach + 8}`} fill="none" stroke="#ffc46b" strokeWidth="2" />
    <text x="104" y={reach - 6} textAnchor="end" fill="#ffc46b" fontSize="11">E</text>
    {target !== null && !free && <>
      <line x1="256" x2="256" y1={CORE - 8} y2={target + 8} stroke="#8ce3ff" strokeWidth="1.5" strokeDasharray={here === 'pre' ? '3 3' : undefined} />
      <circle cx="256" cy={target} r="6" fill="#8ce3ff" />
    </>}
    {free && <>
      <line x1="256" x2="256" y1={CORE - 8} y2={Y0} stroke="#8ce3ff" strokeWidth="1.5" />
      {/* The free electron as a wave, its wavelength 2 pi / k to scale (26 px per angstrom) */}
      {lambdaPx > 0 && <path d={Array.from({ length: 61 }, (_, i) => `${i ? 'L' : 'M'}${(170 + i * 3.6).toFixed(1)},${(116 - 9 * Math.sin(2 * Math.PI * i * 3.6 / lambdaPx)).toFixed(1)}`).join('')} fill="none" stroke="#8ce3ff" strokeWidth="2" />}
      <text x="170" y="140" fill="#d4dae3" fontSize="11.5">λ = {(2 * Math.PI / Math.max(k, 1e-6)).toFixed(2)} Å{here === 'exafs' && shell ? ` · echo ${echo > 0.3 ? 'in step: up' : echo < -0.3 ? 'out of step: down' : 'between'}` : ''}</text>
    </>}
  </svg>;
}
