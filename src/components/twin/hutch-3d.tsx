'use client';
/* The beamline as a 3D model: the same hardware, beam and readings as the diagram (hutch-scene.tsx), lit and shaded
   in WebGL. The labels stay page buttons: every frame projects each part's anchor to the screen and moves its button
   and leader line there, so they keep working with the keyboard, screen readers and the part cards. Loaded only on
   the twin page, and only when the browser has WebGL 2. */
import { Suspense, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useReducedMotion } from 'motion/react';
import { Tex } from '../tex';
import type { TwinState } from '@/lib/twin/types';
import { C1, PARTS, SOURCE_X, XS, YB0, beamGlow, drawnBraggDeg, hasCue, lcdVolts, legLit, partActive, sceneFor, type Leg, type PartId } from './hutch-parts';
import { FLOOR, FOV, LABEL3, TIP3, clampToBox, frameFor, toThree, type V3 } from './hutch-3d-layout';
import { YB } from '../scene-kit';
import { Blk, CylX, CylY, CylZ, Part, TextPlate, Tube, drapePoints, useMaterials, type Mats } from './hutch-3d-kit';
export { texturesReady } from './hutch-3d-kit';
import type { HutchSceneProps } from './hutch-scene';
import { modeInfo } from './twin-state';

const percent = (fraction: number) => fraction >= 0.9995 ? '100' : fraction < 0.001 ? (fraction * 100).toExponential(1) : (fraction * 100).toFixed(1);
const short = (value: number) => value.toExponential(1).replace('e+', 'e');
const gasText = (gas?: Partial<Record<string, number>>) => gas ? Object.entries(gas).filter(([, f]) => (f ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([name]) => name.replace('2', '₂')).join(' + ') : '';

const LEGS: readonly Leg[] = ['upstream', 'i0-to-sample', 'sample-to-it', 'it-to-iref', 'iref-to-stop', 'to-detector', 'to-ammeter'];
const LEG_NAMES: Record<Leg, string> = {
  upstream: 'source to the I0 chamber', 'i0-to-sample': 'I0 chamber to the sample', 'sample-to-it': 'sample to the It chamber',
  'it-to-iref': 'It chamber through the reference foil', 'iref-to-stop': 'Iref chamber to the beam stop',
  'to-detector': 'sample to the fluorescence detector', 'to-ammeter': 'sample to the drain current ammeter',
};
const CHAMBER = {
  i0: { x0: 1010, x1: 1090, y0: 30, y1: 102, z: 30 },
  it: { x0: 1215, x1: 1300, y0: 30, y1: 102, z: 30 },
  iref: { x0: 1390, x1: 1450, y0: 38, y1: 94, z: 24 },
} as const;
type ChamberBox = (typeof CHAMBER)[keyof typeof CHAMBER];
/** The electron orbit: a 300 unit radius arc that curves away from the viewer through the magnet. */
const ORBIT: V3[] = Array.from({ length: 16 }, (_, i) => { const t = i * 0.5 / 15; return [-20 + 300 * Math.sin(t), YB0, 300 * (1 - Math.cos(t))]; });

/* ---------- Glow textures, made once ---------- */
let glowTexture: THREE.Texture | null = null, dashTexture: THREE.Texture | null = null;
function glow() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return glowTexture = new THREE.CanvasTexture(c);
}
function dash() {
  if (dashTexture) return dashTexture;
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d')!, r = g.createLinearGradient(0, 0, 0, 64);
  r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(0.45, 'rgba(255,255,255,1)'); r.addColorStop(0.55, 'rgba(255,255,255,1)'); r.addColorStop(0.62, 'rgba(0,0,0,0)');
  g.fillStyle = '#000'; g.fillRect(0, 0, 4, 64); g.fillStyle = r; g.fillRect(0, 0, 4, 64);
  dashTexture = new THREE.CanvasTexture(c); dashTexture.wrapS = dashTexture.wrapT = THREE.RepeatWrapping;
  return dashTexture;
}

/* ---------- The beam ---------- */
const additive = (color: string, opacity: number, map?: THREE.Texture) => new THREE.MeshBasicMaterial({ color, opacity, ...(map ? { map } : {}), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const UP = new THREE.Vector3(0, 1, 0);

/** One straight stretch of beam: a bright core in a soft halo, with pulses running along it while the leg is in use. */
function BeamSeg({ a, b, color = '#ffc46b', core = '#fff1d6', glow: strength, lit = true, flow = true, speed = 1, animate }: { a: V3; b: V3; color?: string; core?: string; glow: number; lit?: boolean; flow?: boolean; speed?: number; animate: boolean }) {
  const pa = new THREE.Vector3(...toThree(a)), pb = new THREE.Vector3(...toThree(b)), length = pa.distanceTo(pb);
  const mid = pa.clone().add(pb).multiplyScalar(0.5), q = new THREE.Quaternion().setFromUnitVectors(UP, pb.clone().sub(pa).normalize());
  const k = strength * (lit ? 1 : 0.16), moving = flow && lit && strength > 0;
  const mats = useMemo(() => {
    const map = dash().clone(); map.needsUpdate = true; map.repeat.set(1, Math.max(1, length / 26));
    return [additive(color, 0.05), additive(color, 0.14), additive(core, 0.9), additive(core, 0.8, map)];
  }, [color, core, length]);
  useLayoutEffect(() => () => mats.forEach(m => { m.map?.dispose(); m.dispose(); }), [mats]);
  mats[0].opacity = 0.06 * k; mats[1].opacity = 0.16 * k; mats[2].opacity = 0.9 * k; mats[3].opacity = moving ? 0.7 * k : 0;
  useFrame((_, dt) => { if (moving && animate && mats[3].map) mats[3].map.offset.y -= Math.min(dt, 0.1) * 2.3 * speed; });
  if (length < 0.5) return null;
  return <group position={mid} quaternion={q}>
    {[5.5, 2.6, 0.75, 1.15].map((r, i) => <mesh key={i} material={mats[i]} renderOrder={2}><cylinderGeometry args={[r, r, length, 16, 1, true]} /></mesh>)}
  </group>;
}

function GlowSprite({ at, size, color, opacity = 1 }: { at: V3; size: number; color: string; opacity?: number }) {
  return <sprite position={toThree(at)} scale={[size, size, 1]} renderOrder={3}>
    <spriteMaterial map={glow()} color={color} opacity={opacity} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
  </sprite>;
}

/* ---------- Hardware ---------- */
function Pipe({ m, x0, x1, y }: { m: Mats; x0: number; x1: number; y: number }) {
  const xm = (x0 + x1) / 2;
  return <>
    <CylX x0={x0} x1={x1} y={y} r={6} m={m.steel} />
    {[x0 + 1.5, x1 - 1.5].map(x => <CylX key={x} x0={x - 1.5} x1={x + 1.5} y={y} r={10.5} m={m.steel} />)}
    <Blk x0={xm - 2.5} x1={xm + 2.5} y0={FLOOR + 2} y1={y - 6} z0={-2.5} z1={2.5} m={m.paint} />
    <Blk x0={xm - 9} x1={xm + 9} y0={FLOOR} y1={FLOOR + 2} z0={-9} z1={9} m={m.paint} />
  </>;
}

/** A stainless vacuum tank on a granite stand, with a glass viewport in its front wall. */
function Tank({ m, x0, x1, y1, z, win: [wy0, wy1], plate, children }: { m: Mats; x0: number; x1: number; y1: number; z: number; win: [number, number]; plate?: string; children?: ReactNode }) {
  const y0 = 4, t = 3, xm = (x0 + x1) / 2;
  return <>
    <Blk x0={x0 + 10} x1={x1 - 10} y0={FLOOR + 4} y1={y0} z0={-z + 8} z1={z - 8} m={m.granite} r={2} />
    {[x0 + 14, x1 - 14].flatMap(x => [-z + 12, z - 12].map(zz => <CylY key={x + ':' + zz} x={x} z={zz} y0={FLOOR} y1={FLOOR + 4} r={5} m={m.dark} seg={12} />))}
    <Blk x0={x0} x1={x1} y0={y0} y1={y0 + t} z0={-z} z1={z} m={m.steel} />
    <Blk x0={x0} x1={x1} y0={y1 - t} y1={y1} z0={-z} z1={z} m={m.steel} />
    <Blk x0={x0} x1={x1} y0={y0} y1={y1} z0={z - t} z1={z} m={m.steel} />
    <Blk x0={x0} x1={x0 + t} y0={y0} y1={y1} z0={-z} z1={z} m={m.steel} />
    <Blk x0={x1 - t} x1={x1} y0={y0} y1={y1} z0={-z} z1={z} m={m.steel} />
    <Blk x0={x0} x1={x1} y0={y0} y1={wy0} z0={-z} z1={-z + t} m={m.steel} />
    <Blk x0={x0} x1={x1} y0={wy1} y1={y1} z0={-z} z1={-z + t} m={m.steel} />
    <Blk x0={x0} x1={x0 + 10} y0={wy0} y1={wy1} z0={-z} z1={-z + t} m={m.steel} />
    <Blk x0={x1 - 10} x1={x1} y0={wy0} y1={wy1} z0={-z} z1={-z + t} m={m.steel} />
    <mesh position={toThree([xm, (y0 + y1) / 2, z - t - 0.2])} material={m.inner}><planeGeometry args={[x1 - x0 - 2 * t, y1 - y0 - 2 * t]} /></mesh>
    <mesh position={toThree([xm, (wy0 + wy1) / 2, -z + 1.5])} material={m.glass} renderOrder={1}><planeGeometry args={[x1 - x0 - 20, wy1 - wy0]} /></mesh>
    {Array.from({ length: Math.floor((x1 - x0 - 8) / 14) }, (_, i) => <CylY key={i} x={x0 + 7 + i * 14} z={-z + 4} y0={y1} y1={y1 + 1.4} r={1.5} m={m.steel} seg={8} />)}
    <mesh position={toThree([xm, wy1 + 1.4, -z - 0.2])} material={m.led}><planeGeometry args={[x1 - x0 - 24, 0.8]} /></mesh>
    {plate && <TextPlate at={[x0 + 26, (y0 + t + wy0) / 2, -z - 0.4]} w={36} h={Math.min(9, wy0 - y0 - t - 1)} text={plate} bg="#16191d" fg="#cfd6de" />}
    {children}
  </>;
}

/** A grazing-incidence mirror: a polished silicon block with its coating stripe, on two posts. */
function Mirror({ m, x0, x1, top, coating }: { m: Mats; x0: number; x1: number; top: number; coating: string }) {
  return <>
    <Blk x0={x0} x1={x1} y0={top - 12} y1={top} z0={-14} z1={14} m={m.silicon} r={0.6} />
    <Blk x0={x0 + 2} x1={x1 - 2} y0={top - 0.2} y1={top + 0.5} z0={-4} z1={4} m={m.coatings[coating] ?? m.coatings.Si} r={0.15} />
    <Blk x0={x0 + 6} x1={x0 + 14} y0={7} y1={top - 12} z0={-6} z1={6} m={m.dark} />
    <Blk x0={x1 - 14} x1={x1 - 6} y0={7} y1={top - 12} z0={-6} z1={6} m={m.dark} />
  </>;
}

/** An ion chamber: aluminium box, Kapton windows at both ends, collector plates seen through a viewport, amplifier display. */
function Chamber({ m, c, beam, readout, gas }: { m: Mats; c: ChamberBox; beam: number; readout?: string; gas?: Partial<Record<string, number>> }) {
  const { x0, x1, y0, y1, z } = c, xc = (x0 + x1) / 2, t = 3, half = Math.min(16, y1 - YB - 14), wy0 = YB - half, wy1 = YB + half;
  const lcdH = Math.min(13, y1 - wy1 - 3);
  return <>
    <Blk x0={x0 + 6} x1={x1 - 6} y0={0} y1={3} z0={-(z - 4)} z1={z - 4} m={m.alu} />
    <Blk x0={x0 + 12} x1={x1 - 12} y0={3} y1={y0} z0={-(z - 10)} z1={z - 10} m={m.dark} />
    <Blk x0={x0} x1={x1} y0={y0} y1={y0 + t} z0={-z} z1={z} m={m.alu} r={1.5} />
    <Blk x0={x0} x1={x1} y0={y1 - t} y1={y1} z0={-z} z1={z} m={m.alu} r={1.5} />
    <Blk x0={x0} x1={x1} y0={y0} y1={y1} z0={z - t} z1={z} m={m.alu} r={1.5} />
    {[[x0, x0 + t], [x1 - t, x1]].map(([a, b]) => <Blk key={a} x0={a} x1={b} y0={y0} y1={y1} z0={-z} z1={z} m={m.alu} r={1.5} />)}
    <Blk x0={x0} x1={x1} y0={y0} y1={wy0} z0={-z} z1={-z + t} m={m.alu} r={1.5} />
    <Blk x0={x0} x1={x1} y0={wy1} y1={y1} z0={-z} z1={-z + t} m={m.alu} r={1.5} />
    {[[x0, x0 + 10], [x1 - 10, x1]].map(([a, b]) => <Blk key={a} x0={a} x1={b} y0={wy0} y1={wy1} z0={-z} z1={-z + t} m={m.alu} r={1} />)}
    <mesh position={toThree([xc, (y0 + y1) / 2, z - t - 0.2])} material={m.inner}><planeGeometry args={[x1 - x0 - 2 * t, y1 - y0 - 2 * t]} /></mesh>
    {[YB + 12, YB - 12].map(y => <Blk key={y} x0={x0 + 8} x1={x1 - 8} y0={y - 1} y1={y + 1} z0={-(z - 6)} z1={z - 6} m={m.copper} r={0.3} />)}
    <mesh position={toThree([xc, YB, 0])} renderOrder={2}>
      <boxGeometry args={[x1 - x0 - 18, 20, 2 * z - 14]} />
      <meshBasicMaterial color="#6fb4ff" transparent opacity={0.015 + 0.05 * beam} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh position={toThree([xc, YB, -z + 1.5])} material={m.glass} renderOrder={1}><planeGeometry args={[x1 - x0 - 20, wy1 - wy0]} /></mesh>
    {[x0, x1].map(x => <group key={x}>
      <CylX x0={x - 0.8} x1={x + 0.8} y={YB} r={14} m={m.steel} />
      <CylX x0={x + (x === x0 ? -1.2 : 0.4)} x1={x + (x === x0 ? -0.4 : 1.2)} y={YB} r={10.5} m={m.kapton} />
    </group>)}
    {readout !== undefined && <TextPlate at={[xc, (wy1 + y1) / 2, -z - 0.4]} w={54} h={lcdH} text={readout} fg="#74dcaa" bg="#06130f" mono glow />}
    <mesh position={toThree([xc, y0 + 1.6, -z - 0.45])} material={m.led}><planeGeometry args={[x1 - x0 - 16, 0.9]} /></mesh>
    {gas && <TextPlate at={[xc, (y0 + wy0) / 2, -z - 0.4]} w={40} h={8} text={gasText(gas)} bg="#16191d" fg="#cfd6de" />}
    {[x0 + 14, x1 - 14].map(x => <group key={x}>
      <CylY x={x} y0={y1} y1={y1 + 9} r={4} m={m.steel} />
      <CylY x={x} y0={y1 + 9} y1={y1 + 16} r={3} m={m.black} />
      <Tube points={drapePoints(x, y1 + 15)} r={1.5} m={m.cable} />
    </group>)}
    {[xc - 10, xc + 10].map(x => <group key={x}>
      <CylY x={x} z={14} y0={y1} y1={y1 + 5} r={2.6} m={m.brass} seg={12} />
      <Tube points={drapePoints(x, y1 + 4.5, 14, 16, 8)} r={1} m={m.gas} />
    </group>)}
  </>;
}

/** The sample environment on top of the stage; the sample face sits at XS. */
function Environment3D({ m, kind }: { m: Mats; kind: TwinState['environment']['kind'] }) {
  switch (kind) {
    case 'cryostat': return <>
      <CylY x={XS} y0={26} y1={38} r={24} m={m.steel} />
      <CylY x={XS} y0={38} y1={96} r={18} m={m.steel} />
      <CylY x={XS} y0={YB - 8} y1={YB + 8} r={18.4} m={m.kapton} />
      <CylY x={XS} y0={96} y1={104} r={20} m={m.steel} />
      <CylY x={XS} y0={104} y1={138} r={11} m={m.steel} />
      <CylY x={XS} y0={138} y1={148} r={5} m={m.brass} />
      <Tube points={[[XS + 5, 140, 0], [XS + 20, 150, 20], [XS + 40, 130, 70], [XS + 44, 6, 86], [XS + 44, -82, 90]]} r={2.6} m={m.steel} />
    </>;
    case 'furnace': return <>
      <Blk x0={XS - 24} x1={XS + 24} y0={26} y1={102} z0={-24} z1={24} m={m.ceramic} r={3} />
      <mesh position={toThree([XS - 9, YB, -24.5])}><planeGeometry args={[30, 34]} /><meshBasicMaterial color="#ff8a3d" toneMapped={false} /></mesh>
      <GlowSprite at={[XS - 9, YB, -30]} size={60} color="#ff7a3d" opacity={0.7} />
      {[90, 80].map(y => <Tube key={y} points={[[XS + 24, y, 0], [XS + 40, y + 6, 30], [XS + 46, 30, 76], [XS + 46, -82, 90]]} r={1.6} m={m.gas} />)}
    </>;
    case 'operando-cell': return <>
      <Blk x0={XS - 3} x1={XS + 3} y0={26} y1={98} z0={-22} z1={22} m={m.alu} />
      <CylX x0={XS - 4} x1={XS - 3} y={YB} r={13} m={m.steel} />
      <CylX x0={XS - 4.4} x1={XS - 3.6} y={YB} r={7} m={m.kapton} />
      <Tube points={[[XS + 3, 90, 10], [XS + 18, 96, 30], [XS + 30, 40, 76], [XS + 30, -82, 90]]} r={1.2} m={m.hv} />
      <Tube points={[[XS + 3, 84, 10], [XS + 20, 88, 34], [XS + 34, 36, 78], [XS + 34, -82, 90]]} r={1.2} m={m.cable} />
    </>;
    case 'liquid-cell': return <>
      <Blk x0={XS - 5} x1={XS + 5} y0={26} y1={98} z0={-20} z1={20} m={m.peek} />
      <CylX x0={XS - 5.6} x1={XS - 4.8} y={YB} r={9} m={m.glass} />
      <mesh position={toThree([XS - 5.2, YB, 0])} rotation={[0, Math.PI / 2, 0]}><circleGeometry args={[8.6, 24]} /><meshStandardMaterial color="#7fb8e8" transparent opacity={0.55} roughness={0.1} /></mesh>
      {[78, 58].map(y => <Tube key={y} points={[[XS + 5, y, 0], [XS + 20, y + 4, 24], [XS + 32, 30, 74], [XS + 32, -82, 90]]} r={1.4} m={m.gas} />)}
    </>;
    default: return <>
      <Blk x0={XS - 3} x1={XS + 3} y0={26} y1={44} z0={-4} z1={4} m={m.alu} />
      <Blk x0={XS - 3} x1={XS + 3} y0={44} y1={90} z0={-18} z1={18} m={m.alu} />
      <CylX x0={XS - 4.5} x1={XS - 3} y={YB} r={10} m={m.pellet} />
    </>;
  }
}

/** The radiation warning sign on the hutch wall. */
function Trefoil({ at }: { at: V3 }) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#15181c';
    g.beginPath(); g.arc(64, 64, 9, 0, 2 * Math.PI); g.fill();
    for (const a of [30, 150, 270]) { const t0 = (a - 30) * Math.PI / 180, t1 = (a + 30) * Math.PI / 180; g.beginPath(); g.arc(64, 64, 44, -t1, -t0); g.arc(64, 64, 15, -t0, -t1, true); g.closePath(); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
  return <mesh position={toThree(at)}><planeGeometry args={[26, 26]} /><meshStandardMaterial map={texture} roughness={0.5} /></mesh>;
}

/** A 19 inch electronics rack against the wall: current amplifiers, a NIM bin and the ion chambers' high-voltage supply. */
function Rack({ m, x0, z0, tall }: { m: Mats; x0: number; z0: number; tall: boolean }) {
  const w = 60, d = 46, x1 = x0 + w, top = tall ? 120 : 90;
  const led = (x: number, y: number, color: string) => <mesh key={x + ':' + y} position={toThree([x, y, z0 - 1.4])}><sphereGeometry args={[0.8, 8, 6]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>;
  const amp = (y: number, label: string) => <group key={y}>
    <Blk x0={x0 + 5} x1={x1 - 5} y0={y} y1={y + 9} z0={z0 - 1} z1={z0 + 2} m={m.panel} r={0.4} />
    <TextPlate at={[x0 + 18, y + 4.5, z0 - 1.2]} w={18} h={5} text={label} fg="#74dcaa" bg="#06130f" mono glow />
    {[x0 + 34, x0 + 42].map(x => <CylZ key={x} x={x} y={y + 4.5} z0={z0 - 3} z1={z0 - 1} r={2} m={m.black} seg={12} />)}
    {led(x0 + 50, y + 4.5, '#5dff9a')}
  </group>;
  return <>
    <Blk x0={x0} x1={x1} y0={FLOOR} y1={top} z0={z0 + 1} z1={z0 + d} m={m.dark} r={1} />
    {[x0 + 1, x1 - 5].map(x => <Blk key={x} x0={x} x1={x + 4} y0={FLOOR + 4} y1={top - 2} z0={z0} z1={z0 + 1.5} m={m.alu} r={0.3} />)}
    {tall && amp(98, '1E-8 A/V')}{amp(86, '1E-7 A/V')}{amp(74, '1E-9 A/V')}
    <Blk x0={x0 + 5} x1={x1 - 5} y0={46} y1={70} z0={z0 - 0.5} z1={z0 + 2} m={m.dark} r={0.4} />
    {Array.from({ length: 8 }, (_, i) => <group key={i}>
      <Blk x0={x0 + 6 + i * 6} x1={x0 + 11.4 + i * 6} y0={47} y1={69} z0={z0 - 1.2} z1={z0 + 1} m={i % 3 === 0 ? m.panel : m.paint} r={0.2} />
      {led(x0 + 8.7 + i * 6, 65, ['#ff5a4a', '#5dff9a', '#ffcf4a'][i % 3])}
      <CylZ x={x0 + 8.7 + i * 6} y={55} z0={z0 - 2.6} z1={z0 - 1.2} r={1} m={m.brass} seg={8} />
    </group>)}
    <Blk x0={x0 + 5} x1={x1 - 5} y0={28} y1={42} z0={z0 - 1} z1={z0 + 2} m={m.panel} r={0.4} />
    <TextPlate at={[x0 + 22, 35, z0 - 1.2]} w={24} h={7} text="+1500 V" fg="#ff6a4a" bg="#140605" mono glow />
    {led(x0 + 48, 35, '#ff5a4a')}
    {Array.from({ length: 5 }, (_, i) => <Blk key={i} x0={x0 + 5} x1={x1 - 5} y0={-80 + i * 20} y1={-62 + i * 20} z0={z0 - 0.5} z1={z0 + 2} m={m.paint} r={0.4} />)}
  </>;
}

/** Things on the hutch wall: a ladder cable tray with its cables, conduits, the emergency stop, a gas panel and the beam-on lamp. */
function WallFittings({ m }: { m: Mats }) {
  const rungs = useMemo(() => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 1.5, 18), m.alu, 57);
    const o = new THREE.Object3D();
    for (let i = 0; i < 57; i++) { o.position.set(300 + i * 25, 189, -186); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); }
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }, [m.alu]);
  useLayoutEffect(() => () => { rungs.geometry.dispose(); rungs.dispose(); }, [rungs]);
  const trayCables: [number, number, THREE.Material][] = [[182, 191.5, m.cable], [186, 191.5, m.hv], [190, 191.5, m.cable], [184, 194, m.gas]];
  return <>
    {[176, 196].map(z => <Blk key={z} x0={290} x1={1720} y0={186} y1={194} z0={z - 1.5} z1={z + 1.5} m={m.alu} r={0.4} />)}
    <primitive object={rungs} />
    {trayCables.map(([z, y, mat], i) => <CylX key={i} x0={290} x1={1720} y={y} z={z} r={1.6} m={mat} seg={10} />)}
    {[880, 1190, 1580].map(x => <CylY key={x} x={x} z={197} y0={FLOOR} y1={186} r={2.4} m={m.steel} seg={12} />)}
    <Blk x0={862} x1={878} y0={30} y1={50} z0={192} z1={198} m={m.yellow} r={1} />
    <CylZ x={870} y={40} z0={186} z1={192} r={5} m={m.red} />
    <TextPlate at={[870, 24, 197.6]} w={26} h={5} text="EMERGENCY STOP" fg="#16191d" bg="#f2c230" />
    <Blk x0={1100} x1={1186} y0={108} y1={160} z0={196} z1={199} m={m.panel} r={1} />
    {[1116, 1143, 1170].map(x => <group key={x}>
      <CylZ x={x} y={128} z0={188} z1={196} r={5} m={m.brass} />
      <CylZ x={x} y={146} z0={192} z1={196} r={6} m={m.steel} />
      <mesh position={toThree([x, 146, 191.8])}><circleGeometry args={[5, 24]} /><meshStandardMaterial color="#f2f2ee" roughness={0.4} /></mesh>
      <Tube points={[[x, 120, 192], [x + 2, 100, 190], [x + 4, 20, 188], [x + 4, FLOOR + 1, 186]]} r={1} m={m.gas} />
    </group>)}
    <Blk x0={1262} x1={1338} y0={164} y1={182} z0={194} z1={199} m={m.dark} r={1} />
    <TextPlate at={[1300, 173, 193.6]} w={68} h={13} text="BEAM ON" fg="#ff4a3a" bg="#200605" glow />
  </>;
}

/** Ambient occlusion, bloom on the beam and displays, a soft vignette and filmic tone mapping. Lighter on phones. */
function Effects({ light }: { light: boolean }) {
  return <EffectComposer multisampling={light ? 0 : 2} enableNormalPass={false}>
    <N8AO aoRadius={24} distanceFalloff={0.8} intensity={2.6} quality={light ? 'performance' : 'low'} halfRes />
    <Bloom luminanceThreshold={0.72} luminanceSmoothing={0.25} intensity={0.95} mipmapBlur radius={0.78} />
    <Vignette offset={0.26} darkness={0.6} />
    <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
  </EffectComposer>;
}

/** A faint cyan grid on the floor around the experiment, fading out towards the edges. */
function FloorGrid() {
  const texture = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d')!, cell = 1024 / 40;
    g.strokeStyle = 'rgba(120,220,255,.75)'; g.lineWidth = 1;
    for (let x = 0; x <= 1024; x += cell) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
    for (let y = 0; y <= 512; y += cell) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
    const fade = g.createRadialGradient(512, 256, 30, 512, 256, 440);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = fade; g.fillRect(0, 0, 1024, 512);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
  }, []);
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  return <mesh rotation-x={-Math.PI / 2} position={toThree([1150, FLOOR + 0.4, -60])} renderOrder={1}>
    <planeGeometry args={[2000, 1000]} />
    <meshBasicMaterial map={texture} transparent opacity={0.085} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
  </mesh>;
}

/** What never changes with the instrument: the room, its fittings and the optical table. Memoised, so a slider step
    does not walk it again. */
const Room = memo(function Room({ m }: { m: Mats }) {
  return <>
    {/* The hutch: a glossy resin floor, dark composite wall panels with light lines, a light grid on the floor,
        the concrete shield wall, hazard tape and the floor duct */}
    <mesh rotation-x={-Math.PI / 2} position={[800, FLOOR, 150]} material={m.floor} receiveShadow><planeGeometry args={[2400, 800]} /></mesh>
    <FloorGrid />
    <mesh position={[800, 135, -200]} material={m.wall} receiveShadow><planeGeometry args={[2400, 450]} /></mesh>
    <mesh position={[800, 150, -199.3]} material={m.led}><planeGeometry args={[2400, 1.1]} /></mesh>
    {[330, 1700].map(x => <mesh key={x} position={[x, 30, -199.3]} material={m.ledSoft}><planeGeometry args={[1, 240]} /></mesh>)}
    <Blk x0={-400} x1={2000} y0={FLOOR} y1={FLOOR + 14} z0={194} z1={200} m={m.dark} cast={false} />
    <mesh position={[800, FLOOR + 14.6, -193.6]} material={m.ledSoft}><planeGeometry args={[2400, 0.9]} /></mesh>
    <Trefoil at={[1490, 150, 199.5]} />
    <Blk x0={196} x1={216} y0={FLOOR} y1={170} z0={-140} z1={200} m={m.concrete} r={1} />
    <mesh rotation-x={-Math.PI / 2} position={toThree([1240, FLOOR + 0.3, -101])} material={m.hazard}><planeGeometry args={[720, 10]} /></mesh>
    <Blk x0={880} x1={1580} y0={FLOOR} y1={FLOOR + 10} z0={82} z1={98} m={m.duct} />
    <WallFittings m={m} />
    <Rack m={m} x0={985} z0={128} tall />
    <Rack m={m} x0={1455} z0={128} tall={false} />

    {/* Experiment table: a thick optical table on pneumatic isolators */}
    {[[912, 59], [1544, 59], [912, -59], [1544, -59]].map(([x, z]) => <group key={x + ':' + z}>
      <CylY x={x} z={z} y0={FLOOR} y1={-30} r={9} m={m.isolator} />
      <CylY x={x} z={z} y0={FLOOR} y1={FLOOR + 10} r={11.5} m={m.dark} />
      <CylY x={x} z={z} y0={-52} y1={-48} r={10} m={m.dark} />
    </group>)}
    <Blk x0={890} x1={1560} y0={-26} y1={-0.2} z0={-70} z1={70} m={m.tableSide} r={1.5} />
    <mesh position={toThree([1225, -23.5, -70.4])} material={m.led}><planeGeometry args={[662, 1.1]} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position={[1225, 0, 0]} material={m.tableTop} receiveShadow><planeGeometry args={[670, 140]} /></mesh>
  </>;
});

/** Everything in the hutch. */
function World({ twin, live, animate }: { twin: TwinState; live: HutchSceneProps['live']; animate: boolean }) {
  const m = useMaterials();
  const { mode, environment, profile } = twin;
  const idle = (id: PartId) => !partActive(mode, id);
  const lit = (leg: Leg) => legLit(mode, leg);
  const gas = (id: 'I0' | 'It' | 'Iref') => profile.chambers.find(c => c.id === id)?.gas;
  const hrm = profile.mirrors.find(r => r.role === 'harmonic-rejection');
  const collimating = profile.mirrors.find(r => r.role === 'collimating'), focusing = profile.mirrors.find(r => r.role === 'focusing');
  const helium = live.energy_eV < 5000;
  const afterI0 = beamGlow(live.afterI0), afterSample = beamGlow(live.afterSample), afterIt = beamGlow(live.afterIt), afterFoil = beamGlow(live.afterFoil);
  const fluorescing = hasCue(mode, 'cone') && (live.fluorescence_per_s ?? 0) > 0;
  const focused = hasCue(mode, 'focused'), fast = hasCue(mode, 'fast'), rocking = hasCue(mode, 'rocking');
  const tv = drawnBraggDeg(live.theta_deg) * Math.PI / 180, c2x = C1 + (YB - YB0) / Math.tan(2 * tv);

  // Moving parts: crystals rocking, the harmonic rejection mirror sliding, electrons going round, the detector and heat glows pulsing.
  const crystal1 = useRef<THREE.Group>(null), crystal2 = useRef<THREE.Group>(null), hrmGroup = useRef<THREE.Group>(null);
  const electrons = useRef<THREE.Group>(null), pulse = useRef<THREE.Group>(null);
  const orbit = useMemo(() => new THREE.CatmullRomCurve3(ORBIT.map(p => new THREE.Vector3(...toThree(p)))), []);
  const hrmY = hrm?.inserted ? 0 : -16;
  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime(), rock = (on: boolean) => on && animate ? Math.sin(t * Math.PI / 1.6) * 2.5 * Math.PI / 180 : 0;
    if (crystal1.current) crystal1.current.rotation.z = tv + rock(fast);
    if (crystal2.current) crystal2.current.rotation.z = tv + rock(rocking);
    if (hrmGroup.current) hrmGroup.current.position.y += (hrmY - hrmGroup.current.position.y) * (animate ? Math.min(1, dt * 5) : 1);
    electrons.current?.children.forEach((e, i) => e.position.copy(orbit.getPointAt(((animate ? t * 0.7 : 0) + i / 6) % 1)));
    if (pulse.current) pulse.current.children.forEach(s => { ((s as THREE.Sprite).material as THREE.SpriteMaterial).opacity = animate ? 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2)) : 0.9; });
  });
  const gl = useThree(state => state.gl);
  useEffect(() => { gl.shadowMap.needsUpdate = true; });
  const lightTarget = useMemo(() => new THREE.Object3D(), []), spots = useMemo(() => [new THREE.Object3D(), new THREE.Object3D()], []);
  const current = useMemo(() => additive('#7fd8cf', 0.5), []);
  const fan = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...toThree([SOURCE_X, YB0, 0]), ...toThree([250, YB0, -16]), ...toThree([250, YB0, 16])], 3));
    return g;
  }, []);

  return <>
    <color attach="background" args={['#070b12']} />
    <fogExp2 attach="fog" args={['#070b12', 0.00032]} />
    <Environment map={m.pano} environmentIntensity={1.1} />
    <hemisphereLight args={['#9fc8ff', '#05070a', 0.24]} />
    <primitive object={lightTarget} position={[820, 0, 0]} />
    {spots.map((target, i) => <primitive key={i} object={target} position={[[1230, 560][i], 0, 0]} />)}
    <spotLight target={spots[0]} position={[1180, 560, 80]} angle={0.62} penumbra={0.85} intensity={2.4} decay={0} color="#eaf6ff" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
    <spotLight target={spots[1]} position={[520, 560, 60]} angle={0.6} penumbra={0.9} intensity={1.6} decay={0} color="#dff0ff" />
    <directionalLight target={lightTarget} position={[520, 1000, 650]} intensity={0.75} color="#e8f2ff" castShadow
      shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.8}
      shadow-camera-left={-1150} shadow-camera-right={1150} shadow-camera-top={800} shadow-camera-bottom={-800} shadow-camera-near={100} shadow-camera-far={3200} />
    <directionalLight position={[-600, 300, 900]} intensity={0.4} color="#59c8ff" />
    <directionalLight position={[900, 260, -900]} intensity={0.9} color="#3fbfff" />
    {[1060, 1400].map(x => <pointLight key={x} position={[x, -62, 0]} color="#3fd0ff" intensity={0.6} distance={300} decay={0} />)}

    <Room m={m} />

    {/* Source: the storage ring vacuum chamber curving through a C-shaped bending magnet */}
    <Part idle={idle('source')}>
      <Blk x0={60} x1={160} y0={FLOOR} y1={8} z0={-20} z1={20} m={m.granite} r={2} />
      <Blk x0={50} x1={170} y0={8} y1={YB0 + 40} z0={26} z1={42} m={m.magnet} r={2} />
      <Blk x0={52} x1={168} y0={8} y1={YB0 - 7} z0={-26} z1={26} m={m.magnet} r={2} />
      <Blk x0={46} x1={174} y0={YB0 - 15} y1={YB0 - 7} z0={-30} z1={30} m={m.copper} r={3} />
      <Blk x0={46} x1={174} y0={YB0 + 7} y1={YB0 + 15} z0={-30} z1={30} m={m.copper} r={3} />
      <Blk x0={52} x1={168} y0={YB0 + 15} y1={YB0 + 40} z0={-26} z1={26} m={m.magnet} r={2} />
      <Tube points={ORBIT} r={4.5} m={m.steel} />
      <TextPlate at={[86, 22, -26.4]} w={34} h={8} text="DIPOLE" bg="#16191d" fg="#cfd6de" />
    </Part>
    <group ref={electrons}>{Array.from({ length: 6 }, (_, i) => <mesh key={i}><sphereGeometry args={[1.6, 10, 8]} /><meshBasicMaterial color="#9ef0ff" toneMapped={false} /></mesh>)}</group>
    <mesh geometry={fan} renderOrder={2}>
      <meshBasicMaterial color="#f4f1ea" transparent opacity={0.22} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
    <GlowSprite at={[SOURCE_X, YB0, 0]} size={18} color="#fff1d6" />

    {/* Front end and the optics, joined by vacuum pipes */}
    <Pipe m={m} x0={216} x1={238} y={YB0} />
    <Part idle={idle('front-end-slits')}>
      <Blk x0={244} x1={256} y0={FLOOR} y1={YB0 - 16} z0={-6} z1={6} m={m.paint} />
      <Blk x0={238} x1={262} y0={YB0 - 16} y1={YB0 + 16} z0={-16} z1={16} m={m.steel} />
      <CylY x={250} y0={YB0 + 16} y1={YB0 + 30} r={6} m={m.dark} />
      <CylZ x={250} y={YB0} z0={-26} z1={-16} r={5} m={m.dark} />
    </Part>
    <Pipe m={m} x0={262} x1={344} y={YB0} />
    {/* Ion pump hanging under the pipe */}
    <Blk x0={277} x1={283} y0={YB0 - 12} y1={YB0 - 5} z0={-3} z1={3} m={m.steel} />
    <Blk x0={270} x1={290} y0={YB0 - 42} y1={YB0 - 12} z0={-12} z1={12} m={m.dark} />
    <Blk x0={266} x1={270} y0={YB0 - 38} y1={YB0 - 16} z0={-10} z1={10} m={m.magnet} />
    <Tube points={[[290, YB0 - 30, 0], [298, YB0 - 34, -4], [300, YB0 - 80, -6], [300, FLOOR + 1, -8]]} r={1.5} m={m.hv} />
    <Part idle={idle('collimating-mirror')}>
      <Tank m={m} x0={344} x1={452} y1={YB0 + 40} z={34} win={[YB0 - 26, YB0 + 26]} plate={'M1 ' + (collimating?.coating ?? '')}>
        <Mirror m={m} x0={356} x1={440} top={YB0 - 1} coating={collimating?.coating ?? 'Si'} />
      </Tank>
    </Part>
    <Pipe m={m} x0={452} x1={480} y={YB0} />
    <Part idle={idle('monochromator')}>
      <Tank m={m} x0={480} x1={640} y1={100} z={40} win={[16, 92]} plate={profile.mono.crystal.replace(/Si(\d+)/, 'Si($1)')}>
        {[C1 - 4, C1 + 4].map(x => <Blk key={x} x0={x - 1} x1={x + 1} y0={YB0 - 10} y1={97} z0={8} z1={11} m={m.copper} r={0.3} />)}
        <Blk x0={C1 - 10} x1={C1 + 10} y0={7} y1={YB0 - 12} z0={-12} z1={12} m={m.dark} />
        <CylY x={c2x} y0={YB + 10} y1={97} r={2} m={m.steel} />
      </Tank>
    </Part>
    <Part idle={idle('first-crystal')}>
      <group ref={crystal1} position={toThree([C1, YB0, 0])} rotation={[0, 0, tv]}><Blk x0={-15} x1={15} y0={-8} y1={0} z0={-12} z1={12} m={m.silicon} r={0.5} /></group>
    </Part>
    <Part idle={idle('second-crystal')}>
      <group ref={crystal2} position={toThree([c2x, YB, 0])} rotation={[0, 0, tv]}><Blk x0={-15} x1={15} y0={0} y1={8} z0={-12} z1={12} m={m.silicon} r={0.5} /></group>
    </Part>
    <Pipe m={m} x0={640} x1={680} y={YB} />
    <Part idle={idle('focusing-mirror')}>
      <Tank m={m} x0={680} x1={772} y1={YB + 34} z={34} win={[YB - 26, YB + 26]} plate={'M2 ' + (focusing?.coating ?? '')}>
        <Mirror m={m} x0={690} x1={762} top={YB - 1} coating={focusing?.coating ?? 'Si'} />
      </Tank>
    </Part>
    <Pipe m={m} x0={772} x1={812} y={YB} />
    {/* Gate valve with its pneumatic actuator */}
    <Blk x0={786} x1={798} y0={YB - 12} y1={YB + 22} z0={-10} z1={10} m={m.steel} />
    <CylY x={792} y0={YB + 22} y1={YB + 40} r={4.5} m={m.alu} />
    <Part idle={idle('harmonic-rejection-mirror')}>
      <Tank m={m} x0={812} x1={868} y1={YB + 30} z={30} win={[YB - 30, YB + 22]} plate={hrm?.inserted ? 'IN' : 'OUT'}>
        <group ref={hrmGroup}><Mirror m={m} x0={820} x1={860} top={YB - 1} coating={hrm?.coating ?? 'Si'} /></group>
      </Tank>
    </Part>
    <Pipe m={m} x0={868} x1={898} y={YB} />

    <Part idle={idle('experiment-slits')}>
      <Blk x0={898} x1={920} y0={0} y1={6} z0={-16} z1={16} m={m.dark} />
      <Blk x0={905} x1={913} y0={6} y1={YB - 24} z0={-5} z1={5} m={m.alu} />
      <Blk x0={903} x1={915} y0={YB - 24} y1={YB - 5} z0={-14} z1={14} m={m.tungsten} />
      <Blk x0={903} x1={915} y0={YB + 5} y1={YB + 22} z0={-14} z1={14} m={m.tungsten} />
      <Blk x0={903} x1={915} y0={YB - 24} y1={YB + 22} z0={14} z1={18} m={m.alu} />
      <CylY x={909} y0={YB + 22} y1={YB + 32} r={4} m={m.dark} />
    </Part>
    <Part idle={idle('helium-path')}>
      {[940, 986].map(x => <CylY key={x} x={x} y0={0} y1={YB - 8} r={2.5} m={m.steel} />)}
      <CylX x0={926} x1={1000} y={YB} r={8.5} m={m.alu} />
      <CylX x0={926} x1={1000} y={YB} r={8.8} m={helium ? m.gas : m.glass} />
      {[926, 1000].map(x => <CylX key={x} x0={x - 0.6} x1={x + 0.6} y={YB} r={8} m={m.kapton} />)}
      <TextPlate at={[946, YB, -9.2]} w={14} h={7} text="He" fg="#16191d" bg="rgba(0,0,0,0)" />
      <Tube points={drapePoints(962, YB + 8.5, 0, 12, 10)} r={1} m={m.gas} />
    </Part>

    {/* Fluorescence detector behind the sample, at 90 degrees to the beam in the horizontal plane */}
    <Part idle={idle('fluorescence-detector')}>
      <CylY x={XS} z={110} y0={FLOOR} y1={YB - 14} r={4} m={m.steel} />
      <Blk x0={XS - 14} x1={XS + 14} y0={FLOOR} y1={FLOOR + 3} z0={96} z1={124} m={m.dark} />
      <Blk x0={XS - 6} x1={XS + 6} y0={YB - 14} y1={YB - 10} z0={102} z1={118} m={m.dark} />
      <Blk x0={XS - 12} x1={XS + 12} y0={YB - 13} y1={YB + 13} z0={150} z1={178} m={m.alu} r={2} />
      <CylZ x={XS} y={YB} z0={74} z1={150} r={14} m={m.steel} />
      <CylZ x={XS} y={YB} z0={32} z1={74} r={6.5} m={m.steel} />
      <CylZ x={XS} y={YB} z0={31.4} z1={32} r={4.5} m={m.black} />
      {profile.sdd.soller && Array.from({ length: 5 }, (_, i) => <Blk key={i} x0={XS - 6.3 + 3 * i} x1={XS - 5.7 + 3 * i} y0={YB - 6} y1={YB + 6} z0={26} z1={31} m={m.tungsten} r={0.1} />)}
      {profile.sdd.filter && <CylZ x={XS} y={YB} z0={30} z1={30.6} r={6} m={m.copper} />}
      <TextPlate at={[XS, YB + 6, 149.5]} w={22} h={8} text={live.fluorescence_per_s === null ? '—' : short(live.fluorescence_per_s) + '/s'} fg="#74dcaa" bg="#06130f" mono glow />
      <Tube points={[[XS + 8, YB + 13, 172], [XS + 12, YB + 26, 182], [XS + 20, YB + 8, 190], [XS + 20, FLOOR + 1, 192]]} r={1.6} m={m.cable} />
    </Part>

    {/* The beam: white before the monochromator, one energy after it; each leg dims by what the element before it absorbed */}
    <BeamSeg a={[SOURCE_X, YB0, 0]} b={[C1, YB0, 0]} color="#f4f1ea" core="#ffffff" glow={1} animate={animate} />
    <BeamSeg a={[C1, YB0, 0]} b={[c2x, YB, 0]} glow={1} animate={animate} speed={fast ? 3 : 1} />
    <BeamSeg a={[c2x, YB, 0]} b={[1090, YB, 0]} glow={1} animate={animate} speed={fast ? 3 : 1} />
    <BeamSeg a={[1090, YB, 0]} b={[XS - 3, YB, 0]} glow={afterI0} lit={lit('i0-to-sample')} animate={animate} speed={fast ? 3 : 1} />
    <BeamSeg a={[XS + 3, YB, 0]} b={[1300, YB, 0]} glow={afterSample} lit={lit('sample-to-it')} animate={animate} speed={fast ? 3 : 1} />
    <BeamSeg a={[1300, YB, 0]} b={[1354, YB, 0]} glow={afterIt} lit={lit('it-to-iref')} animate={animate} />
    <BeamSeg a={[1354, YB, 0]} b={[1450, YB, 0]} glow={afterFoil} lit={lit('it-to-iref')} animate={animate} />
    <BeamSeg a={[1450, YB, 0]} b={[1500, YB, 0]} glow={afterFoil} lit={lit('iref-to-stop')} animate={animate} />

    <Part idle={idle('i0')}><Chamber m={m} c={CHAMBER.i0} beam={1} readout={live.i0 ? lcdVolts(live.i0.voltage_V, live.i0.saturated) : undefined} gas={gas('I0')} /></Part>
    <Part idle={idle('sample-stage')}>
      <Blk x0={XS - 26} x1={XS + 26} y0={0} y1={8} z0={-28} z1={28} m={m.dark} />
      <Blk x0={XS - 20} x1={XS + 20} y0={8} y1={18} z0={-22} z1={22} m={m.alu} />
      <Blk x0={XS + 20} x1={XS + 33} y0={9} y1={17} z0={-6} z1={6} m={m.black} />
      <CylX x0={XS + 33} x1={XS + 36} y={13} r={3} m={m.steel} />
      <Blk x0={XS - 6} x1={XS + 6} y0={1} y1={8} z0={-42} z1={-28} m={m.black} />
      <CylY x={XS} y0={18} y1={26} r={17} m={m.dark} seg={40} />
      <Tube points={drapePoints(XS + 30, 17, 0, 6)} r={1.4} m={m.cable} />
      <Tube points={[[XS - 6, 4, -36], [XS - 16, 4, -52], [XS - 18, 0, -71], [XS - 18, -26, -73], [XS - 20, FLOOR + 1, -78]]} r={1.4} m={m.cable} />
    </Part>
    <Part idle={idle('sample-environment')}><Environment3D m={m} kind={environment.kind} /></Part>
    <Part idle={idle('it')}><Chamber m={m} c={CHAMBER.it} beam={afterSample} readout={live.it ? lcdVolts(live.it.voltage_V, live.it.saturated) : undefined} gas={gas('It')} /></Part>
    <Part idle={idle('reference-foil')}>
      <Blk x0={1346} x1={1358} y0={0} y1={34} z0={-4} z1={4} m={m.alu} />
      <Blk x0={1348} x1={1354} y0={34} y1={92} z0={-16} z1={16} m={m.alu} />
      <Blk x0={1354} x1={1354.8} y0={56} y1={76} z0={-10} z1={10} m={m.foil} r={0.1} />
    </Part>
    <Part idle={idle('iref')}><Chamber m={m} c={CHAMBER.iref} beam={afterFoil} readout={live.iref ? lcdVolts(live.iref.voltage_V, live.iref.saturated) : undefined} gas={gas('Iref')} /></Part>
    <Part idle={idle('beam-stop')}>
      <Blk x0={1500} x1={1508} y0={0} y1={50} z0={-4} z1={4} m={m.alu} />
      <Blk x0={1494} x1={1514} y0={50} y1={82} z0={-12} z1={12} m={m.tungsten} />
    </Part>

    {/* What the sample does with the beam */}
    <GlowSprite at={[XS - 3, YB, 0]} size={focused ? 9 : 16} color="#ffd08a" />
    <group ref={pulse}>
      {focused && <GlowSprite at={[XS - 3, YB, -2]} size={40} color="#ff7a3d" />}
      {hasCue(mode, 'spectrum') && <GlowSprite at={[XS, YB, 31]} size={30} color="#74dcaa" />}
    </group>
    {fluorescing && <group>
      <mesh position={toThree([XS - 1.5, YB, 16])} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <coneGeometry args={[6.5, 30, 24, 1, true]} />
        <meshBasicMaterial color="#74dcaa" transparent opacity={lit('to-detector') ? 0.22 : 0.04} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <BeamSeg a={[XS - 3, YB, 0]} b={[XS, YB, 31]} color="#74dcaa" core="#c9ffe6" glow={0.8} lit={lit('to-detector')} animate={animate} />
    </group>}

    {/* Drain current: the sample is wired to a picoammeter on the floor */}
    <Part idle={idle('drain-current')}>
      <Blk x0={1110} x1={1162} y0={FLOOR} y1={-66} z0={-80} z1={-58} m={m.dark} r={1.5} />
      <TextPlate at={[1129, -73, -80.4]} w={28} h={9} text="TEY" fg="#74dcaa" bg="#06130f" mono glow />
      <Tube points={[[XS - 3, 30, -6], [XS - 20, 14, -50], [1150, -40, -78], [1150, -66, -70]]} r={1.1} m={m.cable} />
    </Part>
    {lit('to-ammeter') && <Tube points={[[XS - 3, 30, -6], [XS - 20, 14, -50], [1150, -40, -78], [1150, -66, -70]]} r={1.6} m={current} />}
  </>;
}

/* ---------- Frame pacing ---------- */
/**
 * The canvas draws only when asked. While something moves (the beam pulses, the electrons, a rocking crystal) this asks
 * for 30 frames a second, and it holds off for a moment while the page is busy with a key press or a drag outside the
 * canvas, so the controls answer first. Turning the camera and every change of the instrument draw at once.
 */
function Pacer({ animate }: { animate: boolean }) {
  const { invalidate, gl } = useThree();
  useEffect(() => {
    if (!animate) return;
    let busyUntil = 0;
    const busy = (e: Event) => {
      if (e.type === 'pointermove' && !(e as PointerEvent).buttons) return;
      if (e.target instanceof Node && gl.domElement.contains(e.target)) return;
      busyUntil = performance.now() + 160;
    };
    const types = ['keydown', 'pointerdown', 'pointermove', 'input'];
    types.forEach(t => window.addEventListener(t, busy, { capture: true, passive: true }));
    const timer = setInterval(() => { if (performance.now() > busyUntil) invalidate(); }, 1000 / 30);
    return () => { clearInterval(timer); types.forEach(t => window.removeEventListener(t, busy, { capture: true })); };
  }, [animate, gl, invalidate]);
  return null;
}

/* ---------- Camera and labels ---------- */
interface Overlay { buttons: Map<PartId, HTMLButtonElement>; leaders: Map<PartId, SVGPathElement>; dots: Map<PartId, SVGCircleElement>; svg: SVGSVGElement | null; tips: Partial<Record<PartId, V3>>; drawn: Map<PartId, string>; widths: Map<PartId, number>; hud: HTMLDivElement | null; hudBox: { right: number; bottom: number } | null }

/** Moves the camera to the mode's frame, smoothly unless motion is reduced, and lets the user turn, pan and zoom. */
function Rig({ mode, whole, focusOn, reset, reduced }: { mode: TwinState['mode']; whole: boolean; focusOn: PartId | null; reset: number; reduced: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, gl, invalidate } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  const tween = useRef<{ from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number } | null>(null), placed = useRef(false);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  useEffect(() => {
    const c = controls.current; if (!c || size.width < 2 || size.height < 2) return;
    const f = frameFor(mode, whole, aspect);
    let target = new THREE.Vector3(...toThree(f.target)), position = new THREE.Vector3(...toThree(f.position));
    if (focusOn) { const tip = new THREE.Vector3(...toThree(TIP3[focusOn])); position.add(tip.clone().sub(target)); target = tip; }
    if (!placed.current || reduced) { camera.position.copy(position); c.target.copy(target); c.update(); placed.current = true; invalidate(); return; }
    tween.current = { from: [camera.position.clone(), c.target.clone()], to: [position, target], t: 0 };
    invalidate();
  }, [mode, whole, focusOn, reset, aspect, size.width, size.height, reduced, camera, invalidate]);
  // One finger scrolls the page on phones; two fingers turn and zoom the hutch.
  useEffect(() => { if (coarse) gl.domElement.style.touchAction = 'pan-y'; });
  useFrame((_, dt) => {
    const tw = tween.current, c = controls.current; if (!tw || !c) return;
    tw.t = Math.min(1, tw.t + dt / 0.9);
    const e = 1 - Math.pow(1 - tw.t, 3);
    camera.position.lerpVectors(tw.from[0], tw.to[0], e); c.target.lerpVectors(tw.from[1], tw.to[1], e); c.update();
    if (tw.t >= 1) tween.current = null; else invalidate();
  });
  return <OrbitControls ref={controls} makeDefault enableDamping={!reduced} dampingFactor={0.12} minDistance={120} maxDistance={4800}
    minPolarAngle={0.25} maxPolarAngle={1.47} minAzimuthAngle={-1.1} maxAzimuthAngle={1.1} screenSpacePanning
    {...(coarse ? { touches: { ONE: -1 as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE } } : {})} onStart={() => { tween.current = null; }} />;
}

/**
 * Projects each part's anchor and label point to the screen and moves its button and leader there. A part outside
 * the view becomes a small marker on the nearest edge; markers on one edge are spread so they do not overlap.
 */
function Projector({ overlay, showLabels }: { overlay: MutableRefObject<Overlay>; showLabels: boolean }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const o = overlay.current, w = size.width, h = size.height; if (w < 2 || h < 2) return;
    if (o.svg && o.svg.getAttribute('viewBox') !== `0 0 ${w} ${h}`) o.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const project = (p: V3) => { v.set(...toThree(p)).project(camera); return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, behind: v.z > 1 }; };
    const placed = PARTS.map(part => {
      const tip = project(o.tips[part.id] ?? TIP3[part.id]), label = project(LABEL3[part.id]);
      const near = clampToBox(tip.x, tip.y, w, h), outside = tip.behind || near.outside;
      let half = 14;
      if (showLabels && !outside) {
        if (!o.widths.has(part.id)) o.widths.set(part.id, o.buttons.get(part.id)?.offsetWidth ?? 0);
        half = Math.max(14, o.widths.get(part.id)! / 2 + 4);
      }
      const at = outside ? near : clampToBox(showLabels ? label.x : tip.x, showLabels ? label.y : tip.y, w, h, 14, half);
      return { id: part.id, tip, x: at.x, y: at.y, outside, edge: near.x <= 14 ? 'l' : near.x >= w - 14 ? 'r' : near.y <= 14 ? 't' : 'b' };
    });
    // The HUD strip in the top left corner: measured once per render, then kept clear of.
    if (!o.hudBox && o.hud) o.hudBox = { right: o.hud.offsetLeft + o.hud.offsetWidth, bottom: o.hud.offsetTop + o.hud.offsetHeight };
    const hud = o.hudBox;
    for (const edge of ['l', 'r', 't', 'b']) {
      const along = edge === 'l' || edge === 'r' ? 'y' : 'x', limit = along === 'y' ? h - 14 : w - 14;
      const row = placed.filter(p => p.outside && p.edge === edge).sort((a, b) => a[along] - b[along]);
      if (hud && row.length && edge === 'l') row[0].y = Math.max(row[0].y, hud.bottom + 14);
      if (hud && row.length && edge === 't') row[0].x = Math.max(row[0].x, hud.right + 14);
      for (let i = 1; i < row.length; i++) row[i][along] = Math.max(row[i][along], row[i - 1][along] + 28);
      const over = row.length ? row[row.length - 1][along] - limit : 0;
      if (over > 0) row.forEach(p => { p[along] = Math.max(14, p[along] - over); });
    }
    // Labels that would overlap another, higher one move down below it, so every name stays readable.
    if (showLabels) {
      const done: { x: number; y: number; half: number; tall: number }[] = hud ? [{ x: hud.right / 2, y: hud.bottom / 2, half: hud.right / 2 + 4, tall: hud.bottom / 2 }] : [];
      for (const p of placed.filter(q => !q.outside).sort((a, b) => a.y - b.y)) {
        const half = (o.widths.get(p.id) ?? 0) / 2 + 3;
        for (let moved = true, guard = 0; moved && guard < 8; guard++) {
          moved = false;
          for (const q of done) if (Math.abs(q.x - p.x) < q.half + half && Math.abs(q.y - p.y) < q.tall + 15) { p.y = q.y + q.tall + 15; moved = true; }
        }
        p.y = Math.min(p.y, h - 14);
        done.push({ x: p.x, y: p.y, half, tall: 12 });
      }
    }
    for (const p of placed) {
      const key = `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.tip.x.toFixed(1)} ${p.tip.y.toFixed(1)} ${p.outside} ${showLabels}`;
      if (o.drawn.get(p.id) === key) continue;
      o.drawn.set(p.id, key);
      const button = o.buttons.get(p.id), leader = o.leaders.get(p.id), dot = o.dots.get(p.id);
      const tx = p.outside ? p.x : p.tip.x, ty = p.outside ? p.y : p.tip.y;
      if (button) {
        button.style.setProperty('--ax', p.x + 'px'); button.style.setProperty('--ay', p.y + 'px');
        button.style.setProperty('--tx', tx + 'px'); button.style.setProperty('--ty', ty + 'px');
        button.toggleAttribute('data-outside', p.outside);
      }
      const below = p.y > p.tip.y;
      leader?.setAttribute('d', showLabels && !p.outside ? `M${p.x.toFixed(1)} ${(p.y + (below ? -11 : 11)).toFixed(1)}L${p.tip.x.toFixed(1)} ${p.tip.y.toFixed(1)}` : '');
      if (dot) { dot.setAttribute('cx', p.tip.x.toFixed(1)); dot.setAttribute('cy', p.tip.y.toFixed(1)); dot.setAttribute('r', showLabels && !p.outside ? '2' : '0'); }
    }
  });
  return null;
}

export interface Hutch3DProps extends HutchSceneProps {
  /** Bumped by the Reset view button. */
  reset: number;
}

function Hutch3D({ twin, live, labels, part: open, onPart, whole, reset }: Hutch3DProps) {
  const reduced = !!useReducedMotion();
  const coarse = useMemo(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, []);
  const { mode } = twin;
  const scene = sceneFor(mode);
  const showLabels = labels && !whole;
  const stage = useRef<HTMLDivElement>(null);
  const overlay = useRef<Overlay>({ buttons: new Map(), leaders: new Map(), dots: new Map(), svg: null, tips: {}, drawn: new Map(), widths: new Map(), hud: null, hudBox: null });
  const [visible, setVisible] = useState(true), [focusOn, setFocusOn] = useState<PartId | null>(null);
  useEffect(() => {
    const el = stage.current; if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A new mode, view or reset frames the mode again rather than the last part picked off-screen.
  useEffect(() => setFocusOn(null), [mode, whole, reset]);
  overlay.current.drawn.clear(); overlay.current.widths.clear(); overlay.current.hudBox = null;
  const tv = drawnBraggDeg(live.theta_deg) * Math.PI / 180;
  overlay.current.tips = { 'second-crystal': [C1 + (YB - YB0) / Math.tan(2 * tv), YB, 0] };

  const partClass = (id: PartId) => (partActive(mode, id) ? '' : 'is-idle') + (scene.emphasis.includes(id) ? ' is-focus' : '');
  const cues = scene.cues.map(cue => ' cue-' + cue).join('');
  const label = `Beamline drawing, 3D view, ${modeInfo(mode).name.toLowerCase()} mode. The monochromator passes ${live.energy_eV.toFixed(1)} eV` +
    (live.sampleTransmission === null ? '.' : ` and the sample passes ${percent(live.sampleTransmission)}% of the beam.`);

  return <div className={'hutch hutch-3d mode-' + mode + cues + (showLabels ? '' : ' no-labels')}>
    <div className="hutch-stage" ref={stage}>
      <div className="hutch-canvas" role="img" aria-label={label}>
        <Canvas shadows dpr={[1, 1.5]} frameloop={visible ? 'demand' : 'never'} camera={{ fov: FOV, near: 10, far: 9000, position: [700, 600, 2400] }}
          gl={{ antialias: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.toneMappingExposure = 1.05; gl.shadowMap.autoUpdate = false; }}>
          <Suspense fallback={null}><World twin={twin} live={live} animate={!reduced} /></Suspense>
          <Rig mode={mode} whole={whole} focusOn={focusOn} reset={reset} reduced={reduced} />
          <Effects light={coarse} />
          <Pacer animate={!reduced && visible} />
          <Projector overlay={overlay} showLabels={showLabels} />
        </Canvas>
      </div>
      <svg className="hutch-leaders hutch-leaders-3d" aria-hidden="true" ref={el => { overlay.current.svg = el; }}>
        {PARTS.map(part => <g key={part.id}>
          <path ref={el => { if (el) overlay.current.leaders.set(part.id, el); }} />
          <circle ref={el => { if (el) overlay.current.dots.set(part.id, el); }} r={0} />
        </g>)}
      </svg>
      <div className="hutch-parts">
        {PARTS.map(part => <button key={part.id} type="button" data-part-button={part.id} ref={el => { if (el) overlay.current.buttons.set(part.id, el); }}
          className={'hutch-part ' + partClass(part.id)} style={{ '--ax': '-100px', '--ay': '-100px', '--tx': '-100px', '--ty': '-100px' } as CSSProperties}
          aria-label={part.name} title={showLabels ? undefined : part.name} aria-expanded={open === part.id} aria-controls={open === part.id ? 'hutch-card' : undefined}
          onClick={e => {
            if (e.currentTarget.hasAttribute('data-outside')) setFocusOn(part.id);
            onPart(open === part.id ? null : part.id);
          }}
          onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); onPart(null); } }}>
          <span className="hutch-part-text" aria-hidden="true">{part.tex ? <Tex plain>{part.tex}</Tex> : part.name}{part.tex ? ' chamber' : ''}</span>
        </button>)}
      </div>
      <div className="hutch-hud" aria-hidden="true" ref={el => { overlay.current.hud = el; }}>
        <span className="hutch-hud-live">Live</span><span>{modeInfo(mode).name}</span><span>{live.energy_eV.toFixed(1)} eV</span><span>{twin.profile.mono.crystal.replace(/Si(\d+)/, 'Si($1)')}</span>
      </div>
      <ul className="sr-only" aria-label="Beam path">
        {LEGS.map(leg => <li key={leg} data-leg={leg} className={'hutch-leg' + (legLit(mode, leg) ? ' is-lit' : '')}>Beam from the {LEG_NAMES[leg]}: {legLit(mode, leg) ? 'in use' : 'not used in this mode'}</li>)}
      </ul>
    </div>
  </div>;
}

export default memo(Hutch3D);
