'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Tex } from '../tex';
import { B, Beam, Box, Breadboard, CylY, CylZ, Disc, IonChamber, K, P, Q, SceneDefs, Shadow, YB, circleYZ, line, pts, type V3 } from '../scene-kit';
import type { TwinState } from '@/lib/twin/types';
import { PARTS, VIEW, beamGlow, drawnBraggDeg, hasCue, legLit, lcdVolts, partActive, partOf, sceneFor, type Leg, type PartId } from './hutch-parts';
import { NARROW_QUERY } from './fold';
import type { HutchLive } from './hutch-live';
import { modeInfo } from './twin-state';

/* The beamline from the storage ring to the beam stop in cabinet projection (scene-kit): X along the
   beam, Y up, Z into the page. Not to scale: the long stretches are cut at the break symbols. */

const YB0 = 46; // beam height before the fixed-exit monochromator; YB is after it
const XS = 1150; // sample position
const C1 = 512; // first crystal
const SOURCE_X = 96; // tangent point of the electron orbit inside the bending magnet
/** The electron orbit: a 300 unit radius arc that curves away from the viewer through the magnet. */
const ORBIT = line(...Array.from({ length: 24 }, (_, i): V3 => { const t = i * 0.5 / 23; return [-20 + 300 * Math.sin(t), YB0, 300 * (1 - Math.cos(t))]; }));

const percent = (fraction: number) => fraction >= 0.9995 ? '100' : fraction < 0.001 ? (fraction * 100).toExponential(1) : (fraction * 100).toFixed(1);
const short = (value: number) => value.toExponential(1).replace('e+', 'e');

/** A horizontal vacuum pipe along the beam with a flange at each end. */
function Pipe({ x0, x1, y, r = 7 }: { x0: number; x1: number; y: number; r?: number }) {
  return <g>
    <rect x={x0} y={B - y - r} width={x1 - x0} height={2 * r} fill="url(#bl-pipe)" />
    {[x0, x1 - 4].map(x => <rect key={x} x={x} y={B - y - r - 4} width={4} height={2 * r + 8} fill="url(#bl-pipe)" />)}
    <Box x0={(x0 + x1) / 2 - 3} x1={(x0 + x1) / 2 + 3} y0={-90} y1={y - r} z0={-3} z1={3} front="url(#bl-dark)" />
  </g>;
}

/** A vacuum tank with its front wall cut away; the children are drawn inside the opening. */
function Tank({ id, x0, x1, y1, z, win, plate, children }: { id: string; x0: number; x1: number; y1: number; z: number; win: [number, number]; plate?: string; children: ReactNode }) {
  const fx = x0 + K * -z, fy = (y: number) => B - y - Q * -z, w = x1 - x0;
  return <g>
    <Box x0={x0 + 10} x1={x1 - 10} y0={-86} y1={4} z0={-z + 8} z1={z - 8} front="url(#bl-granite)" />
    <Box x0={x0} x1={x1} y0={4} y1={y1} z0={-z} z1={z} />
    <clipPath id={id}><rect x={fx + 8} y={fy(win[1])} width={w - 16} height={win[1] - win[0]} rx={4} /></clipPath>
    <g clipPath={`url(#${id})`}>
      <rect x={fx} y={fy(y1)} width={w + 40} height={y1} fill="#0c1116" />
      <polygon points={pts([x0 + 4, 8, -z], [x1 - 4, 8, -z], [x1 - 4, 8, z], [x0 + 4, 8, z])} fill="#18202a" />
      <rect x={x0 + 4 + K * z} y={B - y1 + 4 - Q * z} width={w - 8} height={y1 - 12} fill="#10161d" />
      {children}
    </g>
    <path fillRule="evenodd" fill="url(#bl-front)" d={`M${fx} ${fy(y1)}h${w}v${y1 - 4}h${-w}z M${fx + 12} ${fy(win[1])}h${w - 24}a4 4 0 0 1 4 4v${win[1] - win[0] - 8}a4 4 0 0 1 -4 4h${-(w - 24)}a4 4 0 0 1 -4 -4v${-(win[1] - win[0] - 8)}a4 4 0 0 1 4 -4z`} />
    {Array.from({ length: Math.floor(w / 17) }, (_, i) => <circle key={i} cx={fx + 7 + i * 17} cy={fy(y1) + 4} r={1.3} fill="#8796a8" />)}
    {plate && <text x={fx + 8} y={fy(4) - 4} className="bl-plate">{plate}</text>}
  </g>;
}

/** A grazing-incidence mirror: a polished slab under the beam with its coating stripe. */
function Mirror({ x0, x1, top, coating }: { x0: number; x1: number; top: number; coating: string }) {
  return <g>
    <Box x0={x0} x1={x1} y0={top - 12} y1={top} z0={-14} z1={14} front="#56657a" top="url(#bl-si)" side="#3a4654" />
    <polygon points={pts([x0, top, -4], [x1, top, -4], [x1, top, 4], [x0, top, 4])} fill={coating} opacity={0.75} />
    <Box x0={x0 + 6} x1={x0 + 14} y0={8} y1={top - 12} z0={-6} z1={6} front="url(#bl-dark)" />
    <Box x0={x1 - 14} x1={x1 - 6} y0={8} y1={top - 12} z0={-6} z1={6} front="url(#bl-dark)" />
  </g>;
}

const COATING: Record<string, string> = { Rh: '#c9ccd1', Pt: '#e4e1da', Ni: '#a7a39a', Si: '#8195ab' };

/** Concrete shield wall the beam passes through, and the break symbol that shortens the drawing after it. */
function Wall() {
  return <Box x0={196} x1={216} y0={-90} y1={112} z0={-60} z1={60} front="url(#hutch-concrete)" top="#5d6268" side="#3a3e43" />;
}
function BreakMark({ x, y }: { x: number; y: number }) {
  const top = B - y - 15, steps = [0, 4, 0, 4, 0, 4, 0];
  const zig = (dx: number) => steps.map((s, i) => [x + dx + s, top + i * 5] as const);
  const left = zig(0), right = zig(7).reverse(), path = (p: readonly (readonly [number, number])[]) => 'M' + p.map(v => v.join(' ')).join('L');
  return <g aria-hidden="true">
    <path d={path([...left, ...right]) + 'Z'} fill="#0b1015" />
    <path d={path(left) + path(zig(7))} fill="none" stroke="#c4ccd6" strokeWidth={1.2} />
  </g>;
}

/** The sample environment on top of the stage; the sample face sits at XS. */
function Environment({ kind }: { kind: TwinState['environment']['kind'] }) {
  const [wx, wy] = P(XS, YB, 0);
  switch (kind) {
    case 'cryostat': return <g>
      <Disc x={XS} y0={26} y1={38} r={24} />
      <Disc x={XS} y0={38} y1={96} r={18} side="url(#bl-steel-side)" />
      <rect x={wx - 15} y={wy - 8} width={30} height={16} rx={3} fill="url(#bl-kapton)" opacity={0.7} />
      <Disc x={XS} y0={96} y1={104} r={20} />
      <Disc x={XS} y0={104} y1={138} r={11} side="url(#bl-steel-side)" />
      <CylY x={XS} y0={138} y1={148} r={5} />
      <path d={`M${P(XS + 8, 128, 0).join(' ')}c18 -10 30 -6 44 -22`} className="bl-cable" />
    </g>;
    case 'furnace': return <g>
      <Box x0={XS - 24} x1={XS + 24} y0={26} y1={102} z0={-24} z1={24} />
      <rect x={P(XS - 24, 0, -24)[0] + 8} y={wy - 18 + Q * 24} width={32} height={36} rx={4} fill="url(#hutch-heat-glow)" />
      <circle cx={wx - K * 24} cy={wy + Q * 24} r={4} fill="#140b06" />
      <path d={`M${P(XS + 24, 90, 0).join(' ')}c20 0 26 -16 40 -30M${P(XS + 24, 80, 0).join(' ')}c24 2 32 -14 46 -26`} fill="none" stroke="#3d6c9e" strokeWidth={2.4} strokeLinecap="round" />
    </g>;
    case 'operando-cell': return <g>
      <Box x0={XS - 3} x1={XS + 3} y0={26} y1={98} z0={-22} z1={22} />
      <path d={circleYZ(XS - 3, YB, 0, 13)} fill="url(#bl-steel-top)" />
      <path d={circleYZ(XS - 3, YB, 0, 7)} fill="url(#bl-kapton)" />
      <path d={`M${P(XS + 3, 90, 10).join(' ')}c20 -4 30 -20 44 -36`} fill="none" stroke="#b5413a" strokeWidth={2} strokeLinecap="round" />
      <path d={`M${P(XS + 3, 84, 10).join(' ')}c22 -2 34 -16 50 -30`} fill="none" stroke="#14181d" strokeWidth={2} strokeLinecap="round" />
    </g>;
    case 'liquid-cell': return <g>
      <Box x0={XS - 5} x1={XS + 5} y0={26} y1={98} z0={-20} z1={20} front="#3b4a5a" top="#51657a" side="#2a3541" />
      <path d={circleYZ(XS - 5, YB, 0, 9)} fill="#9cc5e8" opacity={0.45} />
      {[78, 58].map(y => <path key={y} d={`M${P(XS + 5, y, 0).join(' ')}c18 -6 30 -24 40 -40`} fill="none" stroke="#7fd8cf" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />)}
    </g>;
    default: return <g>
      <Box x0={XS - 3} x1={XS + 3} y0={26} y1={44} z0={-4} z1={4} />
      <Box x0={XS - 3} x1={XS + 3} y0={44} y1={90} z0={-18} z1={18} />
      <path d={circleYZ(XS - 3, YB, 0, 10)} fill="url(#bl-pellet)" />
    </g>;
  }
}

export interface HutchSceneProps {
  twin: TwinState; live: HutchLive; labels: boolean;
  /** The part whose card is open, and how to open or close one. */
  part: PartId | null; onPart: (id: PartId | null) => void;
  /** Fit the whole beamline in the box instead of a close-up on the mode's parts (wide screens). */
  whole: boolean;
}

/** Where a mode's camera points: the mean x of the parts the mode is about. */
const focusX = (mode: TwinState['mode']) => { const xs = sceneFor(mode).emphasis.map(id => partOf(id).tip[0]); return xs.reduce((a, b) => a + b, 0) / xs.length; };

export function HutchScene({ twin, live, labels, part: open, onPart, whole }: HutchSceneProps) {
  const { mode, environment, profile } = twin;
  const scroller = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), [scrolls, setScrolls] = useState(false);
  // Wide screens size the drawing to the box: a close-up as tall as the box, or the whole beamline. Phones keep the CSS minimum width.
  const [stageW, setStageW] = useState<number | null>(null);
  useEffect(() => {
    const el = scroller.current, inner = stage.current; if (!el || !inner) return;
    const narrow = matchMedia(NARROW_QUERY);
    const check = () => {
      setStageW(narrow.matches ? null : whole ? el.clientWidth : Math.round(Math.max(el.clientWidth, Math.min(el.clientHeight * VIEW.width / VIEW.height, el.clientWidth * 3))));
      setScrolls(el.scrollWidth > el.clientWidth + 1);
    };
    const observer = new ResizeObserver(check); observer.observe(el); observer.observe(inner);
    narrow.addEventListener('change', check);
    return () => { observer.disconnect(); narrow.removeEventListener('change', check); };
  }, [whole]);
  // Point the camera at the mode's parts: at once when the size changes, smoothly when the mode does.
  const framed = useRef<TwinState['mode'] | null>(null);
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const smooth = framed.current !== null && framed.current !== mode && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    framed.current = mode;
    el.scrollTo({ left: (focusX(mode) - VIEW.x) / VIEW.width * el.scrollWidth - el.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
  }, [mode, stageW]);
  // On wide screens the wheel pans along the beamline; a mouse drag on the drawing does too.
  useEffect(() => {
    const el = scroller.current; if (!el || stageW === null) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault(); el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stageW]);
  const drag = useRef<{ x: number; left: number } | null>(null), [dragging, setDragging] = useState(false);

  const scene = sceneFor(mode);
  const partClass = (id: PartId) => (partActive(mode, id) ? '' : 'is-idle') + (scene.emphasis.includes(id) ? ' is-focus' : '');
  const legClass = (leg: Leg) => 'hutch-leg' + (legLit(mode, leg) ? ' is-lit' : '');
  const cues = scene.cues.map(cue => ' cue-' + cue).join('');

  // Crystals at the live Bragg angle, clamped for legibility; the readout keeps the true angle.
  const tv = drawnBraggDeg(live.theta_deg) * Math.PI / 180;
  const c1: [number, number] = [C1, YB0], c2: [number, number] = [C1 + (YB - YB0) / Math.tan(2 * tv), YB];
  const u = [Math.cos(tv), Math.sin(tv)], n = [-Math.sin(tv), Math.cos(tv)], L = 15;
  const slab = (c: [number, number], side: number): V3[] => [[c[0] - u[0] * L, c[1] - u[1] * L, -12], [c[0] + u[0] * L, c[1] + u[1] * L, -12], [c[0] + u[0] * L + side * n[0] * 8, c[1] + u[1] * L + side * n[1] * 8, -12], [c[0] - u[0] * L + side * n[0] * 8, c[1] - u[1] * L + side * n[1] * 8, -12]];
  const surface = (c: [number, number], off: number): V3[] => [-12, 12].flatMap(z => (z < 0 ? [-1, 1] : [1, -1]).map(s => [c[0] + s * u[0] * L + off * n[0], c[1] + s * u[1] * L + off * n[1], z] as V3));

  const hrm = profile.mirrors.find(m => m.role === 'harmonic-rejection');
  const collimating = profile.mirrors.find(m => m.role === 'collimating'), focusing = profile.mirrors.find(m => m.role === 'focusing');
  const helium = live.energy_eV < 5000;
  const afterI0 = beamGlow(live.afterI0), afterSample = beamGlow(live.afterSample), afterIt = beamGlow(live.afterIt), afterFoil = beamGlow(live.afterFoil);
  const fluorescing = hasCue(mode, 'cone') && (live.fluorescence_per_s ?? 0) > 0;
  const [sx, sy] = P(XS - 3, YB, 0), [dx, dy] = P(XS, YB, 30);
  const focused = hasCue(mode, 'focused');
  const tips: Partial<Record<PartId, readonly [number, number]>> = { 'second-crystal': [c2[0], B - YB] };
  const at = (v: readonly [number, number]) => ({ x: (v[0] - VIEW.x) / VIEW.width * 100 + '%', y: (v[1] - VIEW.y) / VIEW.height * 100 + '%' });
  const g = (id: PartId, children: ReactNode) => <g data-part={id} className={partClass(id)}>{children}</g>;

  const label = `Beamline drawing, ${modeInfo(mode).name.toLowerCase()} mode. The monochromator passes ${live.energy_eV.toFixed(1)} eV` +
    (live.sampleTransmission === null ? '.' : ` and the sample passes ${percent(live.sampleTransmission)}% of the beam.`);

  const endDrag = () => { drag.current = null; setDragging(false); };
  return <div className={'hutch mode-' + mode + cues + (labels && !whole ? '' : ' no-labels')}>
    <div className={'hutch-scroll' + (dragging ? ' is-dragging' : '')} ref={scroller} tabIndex={scrolls ? 0 : undefined} role={scrolls ? 'region' : undefined} aria-label={scrolls ? 'Beamline drawing, scrolls sideways' : undefined}
      onPointerDown={e => {
        if (e.pointerType !== 'mouse' || e.button !== 0 || !scrolls || (e.target as Element).closest('button')) return;
        drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft }; e.currentTarget.setPointerCapture(e.pointerId); setDragging(true);
      }}
      onPointerMove={e => { if (drag.current) e.currentTarget.scrollLeft = drag.current.left - (e.clientX - drag.current.x); }}
      onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div className="hutch-stage" ref={stage} style={stageW === null ? undefined : { width: stageW, minWidth: 0 }}>
        <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`} role="img" aria-label={label}>
          <SceneDefs />
          <defs>
            <linearGradient id="hutch-concrete" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#585d63" /><stop offset="1" stopColor="#3b4046" /></linearGradient>
            <linearGradient id="hutch-fan" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#f4f1ea" stopOpacity=".55" /><stop offset="1" stopColor="#f4f1ea" stopOpacity=".08" /></linearGradient>
            <radialGradient id="hutch-heat-glow"><stop offset="0" stopColor="#ffd08a" /><stop offset=".45" stopColor="#ff7a3d" stopOpacity=".75" /><stop offset="1" stopColor="#ff4d2e" stopOpacity="0" /></radialGradient>
            <linearGradient id="hutch-cone" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#74dcaa" stopOpacity=".5" /><stop offset="1" stopColor="#74dcaa" stopOpacity=".08" /></linearGradient>
          </defs>

          {/* Floor, back wall and the shadows of the stands */}
          <polygon points={pts([-200, -90, 200], [1800, -90, 200], [1800, -90, -220], [-200, -90, -220])} fill="url(#bl-floor)" />
          <path d={Array.from({ length: 19 }, (_, i) => line([-120 + i * 110, -90, 200], [-120 + i * 110 - 160, -90, -220])).join('') + [100, 0, -100].map(z => line([-200, -90, z], [1800, -90, z])).join('')} stroke="#fff" strokeOpacity=".035" />
          <path d={Array.from({ length: 15 }, (_, i) => line([i * 120, -90, 200], [i * 120, 300, 200])).join('')} stroke="#fff" strokeOpacity=".025" />
          {[[110, 70], [398, 60], [560, 80], [726, 52], [840, 34], [1225, 380]].map(([x, w]) => <Shadow key={x} x={x} y={-90} w={w} h={11} />)}

          {/* Source: the storage ring vacuum chamber curving through a C-shaped bending magnet */}
          {g('source', <>
            <Box x0={60} x1={160} y0={-86} y1={8} z0={-20} z1={20} front="url(#bl-granite)" />
            <Box x0={50} x1={170} y0={8} y1={YB0 + 40} z0={26} z1={42} front="#2b4563" top="#3d5f86" side="#22384f" />
            <path d={ORBIT} fill="none" stroke="#2c3541" strokeWidth={18} />
            <path d={ORBIT} fill="none" stroke="#56657a" strokeWidth={11} />
            <path d={ORBIT} className="bl-electrons" />
            <Box x0={52} x1={168} y0={8} y1={YB0 - 7} z0={-26} z1={26} front="#2b4563" top="#3d5f86" side="#22384f" />
            <Box x0={46} x1={174} y0={YB0 - 15} y1={YB0 - 7} z0={-30} z1={30} front="#a8682e" top="#c98a4a" side="#7d4c20" />
            <polygon points={pts([SOURCE_X, YB0, 0], [250, YB0, -16], [250, YB0, 16])} fill="url(#hutch-fan)" />
            <ellipse cx={SOURCE_X} cy={B - YB0} rx={7} ry={5} fill="url(#bl-spot)" />
            <Box x0={46} x1={174} y0={YB0 + 7} y1={YB0 + 15} z0={-30} z1={30} front="#a8682e" top="#c98a4a" side="#7d4c20" />
            <Box x0={52} x1={168} y0={YB0 + 15} y1={YB0 + 40} z0={-26} z1={26} front="#2b4563" top="#3d5f86" side="#22384f" />
            <text x={P(56, 20, -26)[0]} y={P(56, 20, -26)[1]} className="bl-plate">DIPOLE</text>
          </>)}

          {/* Front end and the optics, joined by vacuum pipes */}
          <Pipe x0={216} x1={238} y={YB0} />
          {g('front-end-slits', <>
            <Box x0={244} x1={256} y0={-86} y1={YB0 - 16} z0={-6} z1={6} front="url(#bl-dark)" />
            <Box x0={238} x1={262} y0={YB0 - 16} y1={YB0 + 16} z0={-16} z1={16} />
            <CylY x={250} y0={YB0 + 16} y1={YB0 + 30} r={6} />
            <path d={circleYZ(262, YB0, 0, 5)} fill="#0c1116" />
          </>)}
          <Pipe x0={262} x1={344} y={YB0} />
          {g('collimating-mirror', <Tank id="hutch-m1" x0={344} x1={452} y1={YB0 + 40} z={34} win={[YB0 - 26, YB0 + 26]} plate={'M1 ' + (collimating?.coating ?? '')}>
            <Mirror x0={356} x1={440} top={YB0 - 1} coating={COATING[collimating?.coating ?? 'Si']} />
          </Tank>)}
          <Pipe x0={452} x1={480} y={YB0} />
          {g('monochromator', <Tank id="hutch-dcm" x0={480} x1={640} y1={100} z={40} win={[16, 92]} plate={profile.mono.crystal.replace(/Si(\d+)/, 'Si($1)')}>
            <path d={line([c1[0] - 4, c1[1] - 10, 0], [c1[0] - 4, 96, 0]) + line([c1[0] + 4, c1[1] - 10, 0], [c1[0] + 4, 96, 0])} stroke="#c27c4e" strokeWidth={2.2} fill="none" />
            <Box x0={c1[0] - 10} x1={c1[0] + 10} y0={8} y1={c1[1] - 12} z0={-12} z1={12} front="url(#bl-dark)" />
            {g('first-crystal', <g className="hutch-rock hutch-c1"><polygon points={pts(...surface(c1, 0))} fill="url(#bl-si)" /><polygon points={pts(...slab(c1, -1))} fill="#6c7f94" /></g>)}
            {g('second-crystal', <g className="hutch-rock hutch-c2"><polygon points={pts(...surface(c2, 8))} fill="#56657a" /><polygon points={pts(...slab(c2, 1))} fill="#7d90a6" /></g>)}
            <path d={line([c2[0], c2[1] + 10, 0], [c2[0], 96, 0])} stroke="#6b7a8c" strokeWidth={4} />
          </Tank>)}
          <Pipe x0={640} x1={680} y={YB} />
          {g('focusing-mirror', <Tank id="hutch-m2" x0={680} x1={772} y1={YB + 34} z={34} win={[YB - 26, YB + 26]} plate={'M2 ' + (focusing?.coating ?? '')}>
            <Mirror x0={690} x1={762} top={YB - 1} coating={COATING[focusing?.coating ?? 'Si']} />
          </Tank>)}
          <Pipe x0={772} x1={812} y={YB} />
          {g('harmonic-rejection-mirror', <Tank id="hutch-m3" x0={812} x1={868} y1={YB + 30} z={30} win={[YB - 30, YB + 22]} plate={hrm?.inserted ? 'IN' : 'OUT'}>
            <g className="hutch-hrm-mirror" style={{ transform: `translateY(${hrm?.inserted ? 0 : 16}px)` }}>
              <Mirror x0={820} x1={860} top={YB - 1} coating={COATING[hrm?.coating ?? 'Si']} />
            </g>
          </Tank>)}
          <Pipe x0={868} x1={898} y={YB} />

          {/* Experiment table */}
          {[[904, -66], [904, 52], [1536, -66], [1536, 52]].map(([x, z]) => <Box key={x + ':' + z} x0={x} x1={x + 16} y0={-90} y1={-14} z0={z} z1={z + 14} front="url(#bl-dark)" />)}
          <Breadboard x0={890} x1={1560} z0={-70} z1={70} />
          {g('experiment-slits', <>
            <Box x0={898} x1={920} y0={0} y1={6} z0={-16} z1={16} front="url(#bl-dark)" />
            <Box x0={905} x1={913} y0={6} y1={YB - 24} z0={-5} z1={5} />
            <Box x0={903} x1={915} y0={YB - 24} y1={YB - 6} z0={-14} z1={14} front="url(#bl-tungsten)" />
          </>)}
          {g('helium-path', <>
            {[940, 986].map(x => <Box key={x} x0={x - 3} x1={x + 3} y0={0} y1={YB - 9} z0={-3} z1={3} front="url(#bl-dark)" />)}
            <rect x={926} y={B - YB - 9} width={74} height={18} rx={2} fill="url(#bl-pipe)" />
            <rect x={926} y={B - YB - 9} width={74} height={18} rx={2} fill="#7fd8cf" opacity={helium ? 0.22 : 0.06} />
            <path d={circleYZ(1000, YB, 0, 9)} fill="url(#bl-kapton)" opacity={0.85} />
            <text x={932} y={B - YB + 3.5} className="bl-plate">He</text>
            <path d={`M${P(960, YB + 9, 0).join(' ')}c-2 -14 10 -24 26 -30`} className="bl-cable" />
          </>)}

          {/* Fluorescence detector behind the sample, at 90 degrees to the beam in the horizontal plane */}
          {g('fluorescence-detector', <>
            <Box x0={XS - 6} x1={XS + 6} y0={0} y1={YB - 14} z0={104} z1={116} front="url(#bl-dark)" />
            <Box x0={XS - 12} x1={XS + 12} y0={YB - 13} y1={YB + 13} z0={150} z1={178} />
            <CylZ x={XS} y={YB} z0={74} z1={150} r={14} />
            <CylZ x={XS} y={YB} z0={32} z1={74} r={6.5} />
            {profile.sdd.soller && <path d={Array.from({ length: 5 }, (_, i) => line([XS - 6 + 3 * i, YB - 6, 30], [XS - 6 + 3 * i, YB + 6, 30])).join('')} stroke="#c4ccd6" strokeWidth={0.8} />}
            {profile.sdd.filter && <circle cx={dx} cy={dy} r={6} fill="#b87333" opacity={0.6} />}
            <circle cx={dx} cy={dy} r={4} fill="#151b22" stroke="#74dcaa" strokeOpacity={0.6} strokeWidth={1.2} />
            <circle cx={dx} cy={dy} r={16} fill="url(#bl-fluor)" className="hutch-sdd-glow" />
            {(() => { const [lx, ly] = P(XS, YB + 13, 164); return <g><rect x={lx - 24} y={ly - 17} width={48} height={13} rx={2} fill="#06130f" stroke="#2c3a46" /><text x={lx} y={ly - 7.4} className="bl-lcd">{live.fluorescence_per_s === null ? '—' : short(live.fluorescence_per_s) + '/s'}</text></g>; })()}
          </>)}

          {/* The beam: white before the monochromator, one energy after it; each leg dims by what the element before it absorbed */}
          <g className={legClass('upstream')} data-leg="upstream">
            <Beam d={`M${SOURCE_X} ${B - YB0}H250`} color="url(#bl-white)" core="#ffffff" flow={false} />
            <Beam d={`M250 ${B - YB0}H${c1[0]}`} color="#f4f1ea" core="#ffffff" />
            <Beam d={`M${c1[0]} ${B - c1[1]}L${c2[0]} ${B - c2[1]}L1010 ${B - YB}`} color="#ffc46b" core="#fff1d6" />
          </g>
          <g className={legClass('i0-to-sample')} data-leg="i0-to-sample"><Beam d={`M1090 ${B - YB}H${XS - 3}`} glow={afterI0} /></g>
          <g className={legClass('sample-to-it')} data-leg="sample-to-it"><Beam d={`M${XS + 3} ${B - YB}H1215`} glow={afterSample} /></g>
          <g className={legClass('it-to-iref')} data-leg="it-to-iref"><Beam d={`M1300 ${B - YB}H1390`} glow={afterIt} /></g>
          <g className={legClass('iref-to-stop')} data-leg="iref-to-stop"><Beam d={`M1450 ${B - YB}H1500`} glow={afterFoil} /></g>

          {/* Hardware in front of the beam */}
          <Wall />
          <BreakMark x={222} y={YB0} />
          <BreakMark x={884} y={YB} />
          {g('i0', <IonChamber id="hutch-i0" x0={1010} x1={1090} y0={30} y1={102} z={30} beam={1} readout={live.i0 ? lcdVolts(live.i0.voltage_V, live.i0.saturated) : undefined} />)}
          {g('sample-stage', <>
            <Box x0={XS - 26} x1={XS + 26} y0={0} y1={8} z0={-28} z1={28} front="url(#bl-dark)" />
            <Box x0={XS - 20} x1={XS + 20} y0={8} y1={18} z0={-22} z1={22} />
            <Disc x={XS} y0={18} y1={26} r={17} top="url(#bl-black-top)" side="url(#bl-dark)" />
          </>)}
          {g('sample-environment', <Environment kind={environment.kind} />)}
          {g('it', <IonChamber id="hutch-it" x0={1215} x1={1300} y0={30} y1={102} z={30} beam={afterSample} readout={live.it ? lcdVolts(live.it.voltage_V, live.it.saturated) : undefined} />)}
          {g('reference-foil', <>
            <Box x0={1346} x1={1358} y0={0} y1={34} z0={-4} z1={4} />
            <Box x0={1348} x1={1354} y0={34} y1={92} z0={-16} z1={16} />
            <polygon points={pts([1354, 56, -10], [1354, 76, -10], [1354, 76, 10], [1354, 56, 10])} fill="url(#bl-foil)" />
          </>)}
          {g('iref', <IonChamber id="hutch-iref" x0={1390} x1={1450} y0={38} y1={94} z={24} beam={afterFoil} readout={live.iref ? lcdVolts(live.iref.voltage_V, live.iref.saturated) : undefined} />)}
          {g('beam-stop', <>
            <Box x0={1500} x1={1508} y0={0} y1={50} z0={-4} z1={4} />
            <Box x0={1494} x1={1514} y0={50} y1={82} z0={-12} z1={12} front="url(#bl-tungsten)" />
          </>)}
          {[[1090, 1102, afterI0, 'i0-to-sample'], [XS + 3, XS + 12, afterSample, 'sample-to-it'], [1300, 1312, afterIt, 'it-to-iref'], [1354, 1362, afterFoil, 'it-to-iref'], [1450, 1462, afterFoil, 'iref-to-stop']].map(([a, b, glow, leg]) =>
            <g key={a} className={legClass(leg as Leg)}><Beam d={`M${a} ${B - YB}H${b}`} glow={glow as number} flow={false} /></g>)}

          {/* What the sample does with the beam */}
          <circle cx={sx} cy={sy} r={20} fill="url(#hutch-heat-glow)" className="hutch-heat" />
          <ellipse cx={sx} cy={sy} rx={focused ? 2.5 : 5} ry={focused ? 3 : 6} fill="url(#bl-spot)" />
          {fluorescing && <g className={legClass('to-detector')} data-leg="to-detector">
            <polygon points={`${sx},${sy} ${dx - 5},${dy - 5} ${dx + 5},${dy + 5}`} fill="url(#hutch-cone)" />
            <g className="bl-fluor-rays" stroke="#74dcaa" strokeLinecap="round">
              {[-150, -110, -60, 70, 110, 160, -20].map(a => <path key={a} d={`M${sx} ${sy}l${(22 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(-22 * Math.sin(a * Math.PI / 180)).toFixed(1)}`} strokeWidth={1.3} opacity={0.65} />)}
              <path d={`M${sx} ${sy}L${dx} ${dy}`} strokeWidth={2.2} />
            </g>
          </g>}

          {/* Drain current: the sample is wired to a picoammeter on the floor */}
          {g('drain-current', <>
            <Box x0={1110} x1={1162} y0={-90} y1={-66} z0={-80} z1={-58} />
            {(() => { const [ax, ay] = P(1114, -72, -80); return <><rect x={ax} y={ay - 8} width={30} height={11} rx={2} fill="#06130f" stroke="#2c3a46" /><text x={ax + 15} y={ay} className="bl-lcd">TEY</text></>; })()}
            <path d={`M${P(XS - 3, 30, -6).join(' ')}C${P(XS - 30, 10, -70).join(' ')} ${P(1150, -40, -80).join(' ')} ${P(1150, -66, -70).join(' ')}`} className="bl-cable" />
            <g className={legClass('to-ammeter')} data-leg="to-ammeter">
              <path d={`M${P(XS - 3, 30, -6).join(' ')}C${P(XS - 30, 10, -70).join(' ')} ${P(1150, -40, -80).join(' ')} ${P(1150, -66, -70).join(' ')}`} fill="none" stroke="#7fd8cf" strokeWidth={1.6} className="hutch-current" />
            </g>
          </>)}

          {/* Leader lines from the labels to the hardware */}
          <g className="hutch-leaders">
            {PARTS.map(part => { const tip = tips[part.id] ?? part.tip, below = part.at[1] > tip[1]; return <g key={part.id}>
              <path d={`M${part.at[0]} ${part.at[1] + (below ? -11 : 11)}L${tip[0]} ${tip[1]}`} />
              <circle cx={tip[0]} cy={tip[1]} r={2} />
            </g>; })}
          </g>
        </svg>
        <div className="hutch-parts">
          {PARTS.map(part => {
            const a = at(part.at), t = at(tips[part.id] ?? part.tip), cls = partClass(part.id);
            return <button key={part.id} type="button" data-part-button={part.id}
              className={'hutch-part ' + cls} style={{ '--ax': a.x, '--ay': a.y, '--tx': t.x, '--ty': t.y } as CSSProperties}
              aria-label={part.name} title={labels && !whole ? undefined : part.name} aria-expanded={open === part.id} aria-controls={open === part.id ? 'hutch-card' : undefined}
              onClick={() => onPart(open === part.id ? null : part.id)} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); onPart(null); } }}>
              <span className="hutch-part-text" aria-hidden="true">{part.tex ? <Tex plain>{part.tex}</Tex> : part.name}{part.tex ? ' chamber' : ''}</span>
            </button>;
          })}
        </div>
      </div>
    </div>
  </div>;
}
