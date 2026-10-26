'use client';
/* The beamline as a 3D model: the same hardware, beam and readings as the diagram (hutch-scene.tsx), lit and shaded
   in WebGL. The labels stay page buttons: every frame projects each part's anchor to the screen and moves its button
   and leader line there, so they keep working with the keyboard, screen readers and the part cards. Loaded only on
   the twin page, and only when the browser has WebGL 2. */
import { Suspense, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode, type EffectComposer as EffectComposerImpl } from 'postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useReducedMotion } from 'motion/react';
import { Tex } from '../tex';
import type { TwinState } from '@/lib/twin/types';
import { C1, CHAMBERS, PARTS, SOURCE_X, XS, YB0, drawnBraggDeg, hasCue, labelledParts, lcdVolts, legLit, partActive, sceneFor, type Leg, type PartId } from './hutch-parts';
import { FLOOR, FOV, LABEL3, TABLE, TIP3, clampToBox, frameFor, toThree, type V3 } from './hutch-3d-layout';
import { YB } from '../scene-kit';
import { Blk, Bolts, CylX, CylY, CylZ, Part, TextPlate, Tube, drapePoints, ring, useMaterials, type Mats } from './hutch-3d-kit';
export { texturesReady } from './hutch-3d-kit';
import type { HutchSceneProps } from './hutch-scene';
import { modeInfo } from './twin-state';
import { BeamOutline, Photons } from './hutch-3d-photons';
import { COLOR_RANGE_eV, WIDTH_SCALE, energyColor, photonSetup, type PhotonSetup } from './photon-sim';

const percent = (fraction: number) => fraction >= 0.9995 ? '100' : fraction < 0.001 ? (fraction * 100).toExponential(1) : (fraction * 100).toFixed(1);
const short = (value: number) => value.toExponential(1).replace('e+', 'e');
const gasText = (gas?: Partial<Record<string, number>>) => gas ? Object.entries(gas).filter(([, f]) => (f ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([name]) => name.replace('2', '₂')).join(' + ') : '';

const LEGS: readonly Leg[] = ['upstream', 'i0-to-sample', 'sample-to-it', 'it-to-iref', 'iref-to-stop', 'to-detector', 'to-ammeter'];
const LEG_NAMES: Record<Leg, string> = {
  upstream: 'source to the I0 chamber', 'i0-to-sample': 'I0 chamber to the sample', 'sample-to-it': 'sample to the It chamber',
  'it-to-iref': 'It chamber through the reference foil', 'iref-to-stop': 'Iref chamber to the beam stop',
  'to-detector': 'sample to the fluorescence detector', 'to-ammeter': 'sample to the drain current ammeter',
};
type ChamberBox = (typeof CHAMBERS)[keyof typeof CHAMBERS];
/** The electron orbit through the magnet: a 300 unit radius arc tangent to the beamline at the source point and
    curving away from the viewer towards the ring's centre, so the X-ray fan leaves along the tangent, as it must. */
const ORBIT: V3[] = Array.from({ length: 16 }, (_, i) => { const t = -0.28 + i * 0.52 / 15; return [SOURCE_X + 300 * Math.sin(t), YB0, 300 * (1 - Math.cos(t))]; });

/* ---------- Glow textures, made once ---------- */
let glowTexture: THREE.Texture | null = null;
function glow() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return glowTexture = new THREE.CanvasTexture(c);
}
/* ---------- The beam ---------- */
const additive = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

function GlowSprite({ at, size, color, opacity = 1 }: { at: V3; size: number; color: string; opacity?: number }) {
  return <sprite position={toThree(at)} scale={[size, size, 1]} renderOrder={3}>
    <spriteMaterial map={glow()} color={color} opacity={opacity} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
  </sprite>;
}

/* ---------- Hardware ---------- */
function Pipe({ m, x0, x1, y, bellows }: { m: Mats; x0: number; x1: number; y: number; bellows?: [number, number] }) {
  const xm = (x0 + x1) / 2;
  return <>
    <CylX x0={x0} x1={x1} y={y} r={6} m={m.steel} />
    {[x0 + 1.5, x1 - 1.5].map(x => <CylX key={x} x0={x - 1.5} x1={x + 1.5} y={y} r={10.5} m={m.steel} />)}
    <Bolts points={[...ring(x0 - 0.3, y, 8.6), ...ring(x1 + 0.3, y, 8.6)]} axis="x" m={m.steel} size={1} height={1.2} />
    {bellows && Array.from({ length: Math.floor((bellows[1] - bellows[0]) / 2.2) }, (_, i) => <CylX key={i} x0={bellows[0] + i * 2.2} x1={bellows[0] + i * 2.2 + 1.1} y={y} r={7.8} m={m.steel} seg={24} />)}
    <Blk x0={xm - 2.5} x1={xm + 2.5} y0={FLOOR + 2} y1={y - 6} z0={-2.5} z1={2.5} m={m.white} />
    <Blk x0={xm - 9} x1={xm + 9} y0={FLOOR} y1={FLOOR + 2} z0={-9} z1={9} m={m.white} />
    <Bolts points={[[xm - 6, FLOOR + 2.4, -6], [xm + 6, FLOOR + 2.4, -6], [xm - 6, FLOOR + 2.4, 6], [xm + 6, FLOOR + 2.4, 6]]} axis="y" m={m.steel} size={1.3} height={0.9} />
  </>;
}

/** A stainless vacuum tank on a granite stand, with a glass viewport in its front wall. */
function Tank({ m, x0, x1, y1, z, win: [wy0, wy1], plate, children }: { m: Mats; x0: number; x1: number; y1: number; z: number; win: [number, number]; plate?: string; children?: ReactNode }) {
  const y0 = 4, t = 3, xm = (x0 + x1) / 2, frameBolts = Math.max(2, Math.floor((x1 - x0 - 24) / 9));
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
    <Bolts points={[wy0 - 3, wy1 + 3].flatMap(y => Array.from({ length: frameBolts }, (_, i): V3 => [x0 + 14 + i * (x1 - x0 - 28) / (frameBolts - 1), y, -z - 0.5]))} axis="z" m={m.steel} size={0.9} height={1} />
    {[x0 + 14, x1 - 14].map(x => <mesh key={x} position={toThree([x, y1 + 3.2, 0])} castShadow material={m.steel}><torusGeometry args={[2.6, 0.7, 8, 20]} /></mesh>)}
    <CylY x={xm + 16} z={z - 12} y0={y1} y1={y1 + 9} r={2.4} m={m.steel} seg={16} />
    <CylZ x={xm + 16} y={y1 + 13} z0={z - 14} z1={z - 10} r={4.5} m={m.steel} />
    <mesh position={toThree([xm + 16, y1 + 13, z - 14.05])}><circleGeometry args={[3.8, 24]} /><meshStandardMaterial color="#f4f6f8" roughness={0.3} /></mesh>
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

/**
 * An ion chamber at real scale (scene units are centimetres): an aluminium box a few centimetres longer than its
 * plates, Kapton windows on the beam axis, two parallel collector plates either side of the beam, HV and signal
 * connectors and gas fittings on top, on a post from the table. The front is drawn as a window so the ionisation
 * flashes inside can be seen. Its current amplifier stands in front on the table, with the output display and the fill.
 */
function Chamber({ m, c, readout, gas, length }: { m: Mats; c: ChamberBox; readout?: string; gas?: Partial<Record<string, number>>; length?: number }) {
  const { x0, x1, y0, y1, z } = c, xc = (x0 + x1) / 2, t = 1.2;
  return <>
    {/* Post and base from the table top */}
    <Blk x0={xc - 6} x1={xc + 6} y0={0} y1={1.5} z0={-6} z1={6} m={m.alu} r={0.4} />
    <CylY x={xc} y0={1.5} y1={y0} r={1.6} m={m.steel} seg={16} />
    <Blk x0={xc - 4} x1={xc + 4} y0={y0 - 2} y1={y0} z0={-4} z1={4} m={m.alu} r={0.3} />
    {/* Box: bottom, top, back and ends; the front is the window */}
    <Blk x0={x0} x1={x1} y0={y0} y1={y0 + t} z0={-z} z1={z} m={m.alu} r={0.6} />
    <Blk x0={x0} x1={x1} y0={y1 - t} y1={y1} z0={-z} z1={z} m={m.alu} r={0.6} />
    <Blk x0={x0} x1={x1} y0={y0} y1={y1} z0={z - t} z1={z} m={m.alu} r={0.6} />
    {[[x0, x0 + t], [x1 - t, x1]].map(([a, b]) => <Blk key={a} x0={a} x1={b} y0={y0} y1={y1} z0={-z} z1={z} m={m.alu} r={0.6} />)}
    {[[x0, x0 + 2.4], [x1 - 2.4, x1]].map(([a, b]) => <Blk key={'f' + a} x0={a} x1={b} y0={y0} y1={y1} z0={-z} z1={-z + t} m={m.alu} r={0.5} />)}
    <mesh position={toThree([xc, (y0 + y1) / 2, z - t - 0.1])} material={m.inner}><planeGeometry args={[x1 - x0 - 2 * t, y1 - y0 - 2 * t]} /></mesh>
    <mesh position={toThree([xc, (y0 + y1) / 2, -z + 0.6])} material={m.glass} renderOrder={1}><planeGeometry args={[x1 - x0 - 4.8, y1 - y0 - 2 * t]} /></mesh>
    {/* Collector and HV plates, either side of the beam, on ceramic standoffs */}
    {[YB + 5, YB - 5].map(y => <group key={y}>
      <Blk x0={x0 + 3} x1={x1 - 3} y0={y - 0.25} y1={y + 0.25} z0={-(z - 2.5)} z1={z - 2.5} m={m.copper} r={0.1} />
      {[x0 + 5, x1 - 5].map(x => <CylY key={x} x={x} z={z - 4} y0={y > YB ? y + 0.25 : y0 + t} y1={y > YB ? y1 - t : y - 0.25} r={0.6} m={m.ceramic} seg={8} />)}
    </group>)}
    {/* Kapton windows on the beam axis */}
    {[x0, x1].map(x => <group key={x}>
      <CylX x0={x - 0.6} x1={x + 0.6} y={YB} r={4.2} m={m.steel} />
      <CylX x0={x + (x === x0 ? -0.9 : 0.6)} x1={x + (x === x0 ? -0.6 : 0.9)} y={YB} r={3} m={m.kapton} />
    </group>)}
    {/* SHV and BNC connectors with their cables, gas fittings with their lines */}
    {[x0 + 4, x1 - 4].map((x, i) => <group key={x}>
      <CylY x={x} z={-2} y0={y1} y1={y1 + 2.5} r={1.1} m={i ? m.steel : m.red} seg={12} />
      <Tube points={drapePoints(x, y1 + 2.4, -2, 10, 6)} r={0.45} m={i ? m.cable : m.hv} />
    </group>)}
    {[xc - 3, xc + 3].map(x => <group key={x}>
      <CylY x={x} z={4} y0={y1} y1={y1 + 1.8} r={0.8} m={m.brass} seg={10} />
      <Tube points={drapePoints(x, y1 + 1.7, 4, 12, 5)} r={0.35} m={m.gas} />
    </group>)}
    {/* The current amplifier in front, on the table: output display, fill and active length */}
    <Blk x0={xc - 14} x1={xc + 14} y0={0} y1={9} z0={-z - 22} z1={-z - 10} m={m.panel} r={0.6} />
    {readout !== undefined && <TextPlate at={[xc - 4, 5.6, -z - 22.15]} w={16} h={4.4} text={readout} fg="#74dcaa" bg="#06130f" mono glow />}
    {[xc + 7, xc + 11].map(x => <CylZ key={x} x={x} y={5.6} z0={-z - 23.2} z1={-z - 22} r={1} m={m.black} seg={12} />)}
    {gas && <TextPlate at={[xc - 4, 1.9, -z - 22.15]} w={20} h={2.2} text={gasText(gas) + (length ? ` · ${length} cm` : '')} bg="#16191d" fg="#cfd6de" />}
    <Tube points={[[xc + 10, 9, -z - 16], [xc + 10, 14, -z - 8], [xc + 6, y0 + 4, -z + 1], [x1 - 4, y1 + 2.5, -2]]} r={0.4} m={m.cable} />
  </>;
}

/** Height of the stage's rotation table: the sample holder rises from here to the beam. */
const STAGE_TOP = YB - 12;

/**
 * The sample and its environment at real size (scene units are centimetres), centred on the beam at the sample
 * position: a 13 mm pellet in a small holder, a closed-cycle cryostat tail with Kapton windows, a compact furnace, an
 * operando coin cell holder or a liquid cell with its tubing.
 */
function Environment3D({ m, kind }: { m: Mats; kind: TwinState['environment']['kind'] }) {
  switch (kind) {
    case 'cryostat': return <>
      <CylY x={XS} y0={STAGE_TOP} y1={YB - 6} r={5} m={m.steel} />
      <CylY x={XS} y0={YB - 6} y1={YB + 8} r={4.2} m={m.steel} />
      <CylY x={XS} y0={YB - 2.2} y1={YB + 2.2} r={4.3} m={m.kapton} />
      <CylY x={XS} y0={YB + 8} y1={YB + 10} r={6.5} m={m.steel} />
      <CylY x={XS} y0={YB + 10} y1={YB + 34} r={5.5} m={m.steel} />
      <CylY x={XS} y0={YB + 34} y1={YB + 40} r={3} m={m.brass} />
      {[2, -2].map(dz => <Tube key={dz} points={[[XS + 2, YB + 38, dz], [XS + 10, YB + 46, 10 + dz], [XS + 22, YB + 30, 50], [XS + 26, 4, 70], [XS + 26, -82, 80]]} r={1.1} m={m.steel} />)}
    </>;
    case 'furnace': return <>
      <Blk x0={XS - 7} x1={XS + 7} y0={STAGE_TOP} y1={YB + 9} z0={-7} z1={7} m={m.ceramic} r={1} />
      <mesh position={toThree([XS - 7.05, YB, 0])} rotation-y={-Math.PI / 2}><circleGeometry args={[2.4, 24]} /><meshBasicMaterial color="#ff7a2d" toneMapped={false} /></mesh>
      <GlowSprite at={[XS - 8, YB, 0]} size={14} color="#ff6a2a" opacity={0.6} />
      {[YB + 6, YB + 3].map(y => <Tube key={y} points={[[XS + 7, y, 0], [XS + 14, y + 3, 12], [XS + 18, 10, 60], [XS + 18, -82, 80]]} r={0.6} m={m.gas} />)}
    </>;
    case 'operando-cell': return <>
      <Blk x0={XS - 0.8} x1={XS + 1.6} y0={STAGE_TOP} y1={YB + 5} z0={-4} z1={4} m={m.alu} r={0.3} />
      <CylX x0={XS - 1.2} x1={XS - 0.8} y={YB} r={2.2} m={m.steel} />
      <CylX x0={XS - 1.4} x1={XS - 1.2} y={YB} r={0.9} m={m.kapton} />
      <Tube points={[[XS + 1.6, YB + 3, 2], [XS + 8, YB + 6, 10], [XS + 14, 20, 50], [XS + 14, -82, 80]]} r={0.35} m={m.hv} />
      <Tube points={[[XS + 1.6, YB + 1, -2], [XS + 9, YB + 4, 12], [XS + 16, 18, 52], [XS + 16, -82, 80]]} r={0.35} m={m.cable} />
    </>;
    case 'liquid-cell': return <>
      <Blk x0={XS - 1} x1={XS + 1.5} y0={STAGE_TOP} y1={YB + 5} z0={-3.5} z1={3.5} m={m.peek} r={0.3} />
      <CylX x0={XS - 1.3} x1={XS - 1} y={YB} r={1.6} m={m.glass} />
      <mesh position={toThree([XS - 1.15, YB, 0])} rotation={[0, Math.PI / 2, 0]}><circleGeometry args={[1.5, 24]} /><meshStandardMaterial color="#7fb8e8" transparent opacity={0.55} roughness={0.1} /></mesh>
      {[YB + 4, YB - 2].map(y => <Tube key={y} points={[[XS + 1.5, y, 0], [XS + 8, y + 2, 10], [XS + 14, 16, 50], [XS + 14, -82, 80]]} r={0.4} m={m.gas} />)}
    </>;
    default: return <>
      {/* A pellet holder: a rod from the rotation table and a small aluminium frame holding a 13 mm pellet */}
      <CylY x={XS + 0.5} y0={STAGE_TOP} y1={YB - 3} r={0.6} m={m.steel} seg={12} />
      <Blk x0={XS} x1={XS + 1} y0={YB - 3.2} y1={YB + 3.2} z0={-3.2} z1={3.2} m={m.alu} r={0.3} />
      <CylX x0={XS - 0.2} x1={XS} y={YB} r={0.65} m={m.pellet} seg={24} />
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
    {Array.from({ length: 5 }, (_, i) => <Blk key={i} x0={x0 + 5} x1={x1 - 5} y0={FLOOR + 6 + i * 18} y1={FLOOR + 22 + i * 18} z0={z0 - 0.5} z1={z0 + 2} m={m.paint} r={0.4} />)}
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
function Effects({ light, hq, composer }: { light: boolean; hq: boolean; composer: MutableRefObject<EffectComposerImpl | null> }) {
  return <EffectComposer ref={composer} multisampling={hq ? 8 : light ? 0 : 4} enableNormalPass={false}>
    <N8AO aoRadius={24} distanceFalloff={0.8} intensity={2.2} quality={hq ? 'ultra' : light ? 'performance' : 'low'} halfRes={!hq} />
    {/* Bloom only on what is brighter than white: photon packets, lamps and displays */}
    <Bloom luminanceThreshold={1.15} luminanceSmoothing={0.2} intensity={0.35} mipmapBlur radius={0.4} />
    <Vignette offset={0.32} darkness={0.22} />
    <ToneMapping mode={ToneMappingMode.AGX} />
  </EffectComposer>;
}

/** What never changes with the instrument: the room, its fittings and the optical table. Memoised, so a slider step
    does not walk it again. */
const Room = memo(function Room({ m }: { m: Mats }) {
  return <>
    {/* The hutch: a graphite resin floor, painted wall panels, the concrete shield wall, hazard tape and the floor duct */}
    <mesh rotation-x={-Math.PI / 2} position={[800, FLOOR, 150]} material={m.floor} receiveShadow><planeGeometry args={[2400, 800]} /></mesh>
    <mesh position={[800, 135, -200]} material={m.wall} receiveShadow><planeGeometry args={[2400, 450]} /></mesh>
    <mesh position={[800, 150, -199.3]} material={m.led}><planeGeometry args={[2400, 1.1]} /></mesh>
    {[330, 1700].map(x => <mesh key={x} position={[x, 30, -199.3]} material={m.ledSoft}><planeGeometry args={[1, 240]} /></mesh>)}
    <Blk x0={-400} x1={2000} y0={FLOOR} y1={FLOOR + 14} z0={194} z1={200} m={m.dark} cast={false} />
    <mesh position={[800, FLOOR + 14.6, -193.6]} material={m.ledSoft}><planeGeometry args={[2400, 0.9]} /></mesh>
    <Trefoil at={[1490, 150, 199.5]} />
    {/* The shield wall between the ring tunnel (source and front end) and the optics: the pipe passes through a lead collar */}
    <Blk x0={292} x1={320} y0={FLOOR} y1={170} z0={-140} z1={200} m={m.concrete} r={1} />
    <mesh rotation-x={-Math.PI / 2} position={toThree([(TABLE.x0 + TABLE.x1) / 2, FLOOR + 0.3, -TABLE.z - 22])} material={m.hazard}><planeGeometry args={[TABLE.x1 - TABLE.x0 + 40, 10]} /></mesh>
    <Blk x0={TABLE.x0} x1={TABLE.x1} y0={FLOOR} y1={FLOOR + 10} z0={TABLE.z + 12} z1={TABLE.z + 28} m={m.duct} />
    <WallFittings m={m} />
    <Rack m={m} x0={985} z0={128} tall />
    <Rack m={m} x0={1455} z0={128} tall={false} />
    {/* Wall lamps: white housings with bright diffusers */}
    {[380, 700, 1020, 1340, 1660].map(x => <group key={x}>
      <Blk x0={x - 72} x1={x + 72} y0={197} y1={207} z0={191} z1={199} m={m.white} r={1.5} />
      <mesh position={toThree([x, 201, 190.9])} material={m.lamp}><planeGeometry args={[136, 5]} /></mesh>
    </group>)}
    {/* Pendant light bars over the experiment table, hung on wires */}
    {[1060, 1280].map(x => <group key={x}>
      <Blk x0={x - 120} x1={x + 120} y0={226} y1={232} z0={24} z1={36} m={m.white} r={1.5} />
      <mesh position={toThree([x, 229, 23.9])} material={m.lamp}><planeGeometry args={[232, 2.6]} /></mesh>
      <mesh position={toThree([x, 225.9, 30])} rotation-x={Math.PI / 2} material={m.lamp}><planeGeometry args={[232, 10]} /></mesh>
      {[x - 100, x + 100].map(xx => <CylY key={xx} x={xx} z={30} y0={232} y1={420} r={0.5} m={m.steel} seg={6} />)}
    </group>)}
    {/* The hutch door, sliding on its rail, with hazard edges, a window, and the search and interlock panel beside it */}
    <Blk x0={1590} x1={1790} y0={136} y1={142} z0={190} z1={196} m={m.steel} r={0.8} />
    <Blk x0={1600} x1={1780} y0={FLOOR} y1={134} z0={186} z1={192} m={m.white} r={1.2} />
    {[1600, 1774].map(x => <mesh key={x} position={toThree([x + 3, 22, 185.6])} material={m.hazardV}><planeGeometry args={[6, 224]} /></mesh>)}
    <Blk x0={1660} x1={1720} y0={70} y1={110} z0={185.4} z1={186} m={m.glass} r={0.2} cast={false} />
    <CylY x={1612} z={184} y0={10} y1={50} r={1.6} m={m.steel} />
    <TextPlate at={[1690, 125, 185.5]} w={64} h={7} text="HUTCH 1 · INTERLOCKED" fg="#16191d" bg="#f2c230" />
    <Blk x0={1556} x1={1584} y0={30} y1={74} z0={193} z1={198} m={m.dark} r={1} />
    {[[1564, 62, '#5dff9a'], [1576, 62, '#ff5a4a']].map(([x, y, c]) => <mesh key={x as number} position={toThree([x as number, y as number, 192.3])}><circleGeometry args={[3, 20]} /><meshBasicMaterial color={c as string} toneMapped={false} /></mesh>)}
    <CylZ x={1570} y={46} z0={191} z1={193} r={4} m={m.yellow} />
    <TextPlate at={[1570, 36, 192.4]} w={24} h={4} text="SEARCH" fg="#cfd6de" bg="#16191d" mono />
    {/* Fire extinguisher on its wall bracket */}
    <CylY x={1540} z={186} y0={FLOOR + 2} y1={-34} r={6} m={m.red} />
    <CylY x={1540} z={186} y0={-34} y1={-28} r={2.4} m={m.black} />
    <Tube points={[[1543, -30, 186], [1550, -36, 182], [1549, -60, 181]]} r={0.9} m={m.black} />
    <Blk x0={1534} x1={1546} y0={-60} y1={-56} z0={192} z1={198} m={m.dark} />
    {/* Power and network outlets along the skirting */}
    {[930, 1190, 1420].map(x => <group key={x}>
      <Blk x0={x - 10} x1={x + 10} y0={FLOOR + 22} y1={FLOOR + 34} z0={197} z1={199.6} m={m.white} r={0.8} />
      {[x - 4, x + 4].map(xx => <mesh key={xx} position={toThree([xx, FLOOR + 28, 196.9])}><circleGeometry args={[2, 16]} /><meshStandardMaterial color="#2b3038" roughness={0.6} /></mesh>)}
    </group>)}

    {/* Experiment table: a thick optical table on pneumatic isolators */}
    {[[TABLE.x0 + 22, TABLE.z - 11], [TABLE.x1 - 22, TABLE.z - 11], [TABLE.x0 + 22, -TABLE.z + 11], [TABLE.x1 - 22, -TABLE.z + 11]].map(([x, z]) => <group key={x + ':' + z}>
      <CylY x={x} z={z} y0={FLOOR} y1={-30} r={8} m={m.isolator} />
      <CylY x={x} z={z} y0={FLOOR} y1={FLOOR + 8} r={10} m={m.dark} />
      <CylY x={x} z={z} y0={-40} y1={-37} r={9} m={m.dark} />
    </group>)}
    <Blk x0={TABLE.x0} x1={TABLE.x1} y0={-26} y1={-0.2} z0={-TABLE.z} z1={TABLE.z} m={m.tableSide} r={1.5} />
    <mesh position={toThree([(TABLE.x0 + TABLE.x1) / 2, -23.5, -TABLE.z - 0.4])} material={m.led}><planeGeometry args={[TABLE.x1 - TABLE.x0 - 8, 0.8]} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position={[(TABLE.x0 + TABLE.x1) / 2, 0, 0]} material={m.tableTop} receiveShadow><planeGeometry args={[TABLE.x1 - TABLE.x0, 2 * TABLE.z]} /></mesh>
  </>;
});

/** Everything in the hutch. */
function World({ twin, live, animate, hq, setup }: { twin: TwinState; live: HutchSceneProps['live']; animate: boolean; hq: boolean; setup: PhotonSetup | null }) {
  const m = useMaterials();
  const { mode, environment, profile } = twin;
  const idle = (id: PartId) => !partActive(mode, id);
  const lit = (leg: Leg) => legLit(mode, leg);
  const gas = (id: 'I0' | 'It' | 'Iref') => profile.chambers.find(c => c.id === id)?.gas;
  const hrm = profile.mirrors.find(r => r.role === 'harmonic-rejection');
  const collimating = profile.mirrors.find(r => r.role === 'collimating'), focusing = profile.mirrors.find(r => r.role === 'focusing');
  const helium = live.energy_eV < 5000;
  const fluorescing = hasCue(mode, 'cone') && (live.fluorescence_per_s ?? 0) > 0;
  const fast = hasCue(mode, 'fast'), rocking = hasCue(mode, 'rocking');
  // In fluorescence and electron yield the sample turns to its incidence angle, facing between the beam and the detector.
  const turn = setup?.sample.rotation ?? 0;
  // The beam's footprint on the sample face: its size at the focus, longer across the face when the sample is turned.
  const spot = setup ? { w: Math.max(0.3, setup.envelope.real(XS).width_mm / 10 * WIDTH_SCALE) / Math.cos(turn), h: Math.max(0.2, setup.envelope.real(XS).height_mm / 10 * WIDTH_SCALE), color: setup.orders[0].color } : null;
  const tv = drawnBraggDeg(live.theta_deg) * Math.PI / 180, c2x = C1 + (YB - YB0) / Math.tan(2 * tv);

  // Moving parts: crystals rocking, the harmonic rejection mirror sliding, electrons going round.
  const crystal1 = useRef<THREE.Group>(null), crystal2 = useRef<THREE.Group>(null), hrmGroup = useRef<THREE.Group>(null);
  const electrons = useRef<THREE.Group>(null);
  const orbit = useMemo(() => new THREE.CatmullRomCurve3(ORBIT.map(p => new THREE.Vector3(...toThree(p)))), []);
  const hrmY = hrm?.inserted ? 0 : -16;
  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime(), rock = (on: boolean) => on && animate ? Math.sin(t * Math.PI / 1.6) * 2.5 * Math.PI / 180 : 0;
    if (crystal1.current) crystal1.current.rotation.z = tv + rock(fast);
    if (crystal2.current) crystal2.current.rotation.z = tv + rock(rocking);
    if (hrmGroup.current) hrmGroup.current.position.y += (hrmY - hrmGroup.current.position.y) * (animate ? Math.min(1, dt * 5) : 1);
    electrons.current?.children.forEach((e, i) => e.position.copy(orbit.getPointAt(((animate ? t * 0.7 : 0) + i / 6) % 1)));
  });
  const gl = useThree(state => state.gl), invalidate = useThree(state => state.invalidate);
  // Shadows are redrawn once a change settles rather than on every slider step: what moves meanwhile (the crystals,
  // the sliding mirror) sits inside the tanks, where a shadow a moment late cannot be seen.
  useEffect(() => {
    const timer = setTimeout(() => { gl.shadowMap.needsUpdate = true; invalidate(); }, 150);
    return () => clearTimeout(timer);
  });
  // A 4K capture redraws the shadow maps at twice the resolution, then goes back.
  const keyRef = useRef<THREE.DirectionalLight>(null), spotRef = useRef<THREE.SpotLight>(null);
  useEffect(() => {
    for (const [light, size] of [[keyRef.current, hq ? 4096 : 2048], [spotRef.current, hq ? 2048 : 1024]] as const) {
      if (!light || light.shadow.mapSize.x === size) continue;
      light.shadow.mapSize.set(size, size); light.shadow.map?.dispose(); light.shadow.map = null;
    }
    gl.shadowMap.needsUpdate = true;
  }, [hq, gl]);
  const lightTarget = useMemo(() => new THREE.Object3D(), []), spots = useMemo(() => [new THREE.Object3D(), new THREE.Object3D()], []);
  const current = useMemo(() => additive('#7fd8cf', 0.5), []);

  return <>
    {/* Lighting in the metrology palette: a warm 4300 K key from the ceiling, a neutral 5000 K fill from the camera side,
        a cool 6000 K rim from behind, and a little environment for reflections. */}
    <color attach="background" args={['#aeb6be']} />
    <fogExp2 attach="fog" args={['#aeb6be', 0.00022]} />
    <Environment map={m.pano} environmentIntensity={0.35} />
    <hemisphereLight args={['#eef2f6', '#3a4048', 0.5]} />
    <primitive object={lightTarget} position={[820, 0, 0]} />
    {spots.map((target, i) => <primitive key={i} object={target} position={[[1230, 560][i], 0, 0]} />)}
    <spotLight ref={spotRef} target={spots[0]} position={[1170, 560, 80]} angle={0.5} penumbra={0.9} intensity={2.6} decay={0} color="#ffd6ad" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
    <spotLight target={spots[1]} position={[520, 560, 60]} angle={0.6} penumbra={0.9} intensity={1.7} decay={0} color="#ffd6ad" />
    <directionalLight ref={keyRef} target={lightTarget} position={[520, 1000, 650]} intensity={1.15} color="#ffe2c4" castShadow
      shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.8}
      shadow-camera-left={-1150} shadow-camera-right={1150} shadow-camera-top={800} shadow-camera-bottom={-800} shadow-camera-near={100} shadow-camera-far={3200} />
    <directionalLight position={[-600, 300, 900]} intensity={0.42} color="#ffe9d6" />
    <directionalLight position={[900, 360, -900]} intensity={0.55} color="#f2f5ff" />

    <Room m={m} />
    <StatusScreen mode={mode} energy={live.energy_eV} theta={live.theta_deg} crystal={profile.mono.crystal} transmission={live.sampleTransmission} />

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
    <GlowSprite at={[SOURCE_X, YB0, 0]} size={18} color="#fff1d6" />

    {/* Front end and the optics, joined by vacuum pipes */}
    <Pipe m={m} x0={216} x1={238} y={YB0} />
    <Part idle={idle('front-end-slits')}>
      <Blk x0={244} x1={256} y0={FLOOR} y1={YB0 - 16} z0={-6} z1={6} m={m.paint} />
      <Blk x0={238} x1={262} y0={YB0 - 16} y1={YB0 + 16} z0={-16} z1={16} m={m.steel} />
      <CylY x={250} y0={YB0 + 16} y1={YB0 + 30} r={6} m={m.dark} />
      <CylZ x={250} y={YB0} z0={-26} z1={-16} r={5} m={m.dark} />
    </Part>
    <Pipe m={m} x0={262} x1={344} y={YB0} bellows={[324, 340]} />
    {/* Front-end photon shutter, raised (open): a cooled copper block that drops into the beam before anyone enters */}
    <Blk x0={270} x1={284} y0={YB0 + 7} y1={YB0 + 24} z0={-9} z1={9} m={m.copper} r={1} />
    <CylY x={277} y0={YB0 + 24} y1={YB0 + 44} r={3.2} m={m.alu} />
    {/* Lead collar where the pipe passes through the shield wall */}
    <CylX x0={290} x1={322} y={YB0} r={11} m={m.dark} />
    {/* Ion pump hanging under the pipe */}
    <Blk x0={277} x1={283} y0={YB0 - 12} y1={YB0 - 5} z0={-3} z1={3} m={m.steel} />
    <Blk x0={270} x1={290} y0={YB0 - 42} y1={YB0 - 12} z0={-12} z1={12} m={m.dark} />
    <Blk x0={266} x1={270} y0={YB0 - 38} y1={YB0 - 16} z0={-10} z1={10} m={m.magnet} />
    <Tube points={[[290, YB0 - 30, 0], [298, YB0 - 34, -4], [300, YB0 - 80, -6], [300, FLOOR + 1, -8]]} r={1.5} m={m.hv} />
    {collimating ? <Part idle={idle('collimating-mirror')}>
      <Tank m={m} x0={344} x1={452} y1={YB0 + 40} z={34} win={[YB0 - 26, YB0 + 26]} plate={collimating.id + ' ' + collimating.coating}>
        <Mirror m={m} x0={356} x1={440} top={YB0 - 1} coating={collimating.coating} />
      </Tank>
    </Part> : <Pipe m={m} x0={344} x1={452} y={YB0} />}
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
    <Pipe m={m} x0={640} x1={680} y={YB} bellows={[648, 670]} />
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
    <Pipe m={m} x0={868} x1={988} y={YB} />
    {/* Exit window: the vacuum ends here and the beam enters the air of the experiment table through Kapton */}
    <CylX x0={988} x1={991} y={YB} r={4} m={m.steel} />
    <CylX x0={991} x1={991.3} y={YB} r={2.2} m={m.kapton} />

    <Part idle={idle('experiment-slits')}>
      {/* Four blade slits at real size: tungsten blades above, below and either side of the beam, with their motors */}
      <Blk x0={998} x1={1014} y0={0} y1={2} z0={-8} z1={8} m={m.dark} r={0.4} />
      <Blk x0={1003} x1={1009} y0={2} y1={YB - 9} z0={-3} z1={3} m={m.alu} r={0.4} />
      <Blk x0={1001} x1={1011} y0={YB - 9} y1={YB - 8} z0={-9} z1={9} m={m.alu} r={0.3} />
      <Blk x0={1001} x1={1011} y0={YB + 8} y1={YB + 9} z0={-9} z1={9} m={m.alu} r={0.3} />
      <Blk x0={1001} x1={1011} y0={YB - 9} y1={YB + 9} z0={8} z1={9} m={m.alu} r={0.3} />
      <Blk x0={1003} x1={1009} y0={YB + 0.6} y1={YB + 7} z0={-5} z1={5} m={m.tungsten} r={0.2} />
      <Blk x0={1003} x1={1009} y0={YB - 7} y1={YB - 0.6} z0={-5} z1={5} m={m.tungsten} r={0.2} />
      <Blk x0={1003} x1={1009} y0={YB - 5} y1={YB + 5} z0={1} z1={6} m={m.tungsten} r={0.2} />
      <Blk x0={1003} x1={1009} y0={YB - 5} y1={YB + 5} z0={-6} z1={-1} m={m.tungsten} r={0.2} />
      {[1003, 1009].map(x => <CylY key={x} x={x} y0={YB + 9} y1={YB + 15} r={1.6} m={m.black} seg={12} />)}
    </Part>
    <Part idle={idle('helium-path')}>
      {[1026, 1074].map(x => <CylY key={x} x={x} y0={0} y1={YB - 3} r={1} m={m.steel} seg={12} />)}
      <CylX x0={1018} x1={1082} y={YB} r={3} m={m.alu} />
      <CylX x0={1018} x1={1082} y={YB} r={3.15} m={helium ? m.gas : m.glass} />
      {[1018, 1082].map(x => <CylX key={x} x0={x - 0.4} x1={x + 0.4} y={YB} r={2.8} m={m.kapton} />)}
      <TextPlate at={[1036, YB, -3.3]} w={6} h={3} text="He" fg="#16191d" bg="rgba(0,0,0,0)" />
      <Tube points={drapePoints(1050, YB + 3, 0, 10, 6)} r={0.4} m={m.gas} />
    </Part>

    {/* Fluorescence detector behind the sample, at 90 degrees to the beam in the horizontal plane */}
    <Part idle={idle('fluorescence-detector')}>
      {/* A silicon drift detector at real scale: snout, housing and electronics about 55 cm long, on a post from the table */}
      <CylY x={XS} z={58} y0={0} y1={YB - 8} r={1.8} m={m.steel} seg={16} />
      <Blk x0={XS - 7} x1={XS + 7} y0={0} y1={1.5} z0={51} z1={65} m={m.alu} r={0.4} />
      <Blk x0={XS - 5} x1={XS + 5} y0={YB - 9} y1={YB - 7} z0={50} z1={66} m={m.dark} r={0.3} />
      <CylZ x={XS} y={YB} z0={31.4} z1={44} r={3.2} m={m.steel} />
      <CylZ x={XS} y={YB} z0={31.2} z1={31.4} r={2.6} m={m.black} />
      <CylZ x={XS} y={YB} z0={44} z1={72} r={7} m={m.steel} />
      <Blk x0={XS - 8} x1={XS + 8} y0={YB - 7} y1={YB + 9} z0={72} z1={86} m={m.alu} r={1.2} />
      {profile.sdd.soller && Array.from({ length: 5 }, (_, i) => <Blk key={i} x0={XS - 2.6 + 1.3 * i} x1={XS - 2.4 + 1.3 * i} y0={YB - 2.6} y1={YB + 2.6} z0={27} z1={31} m={m.tungsten} r={0.05} />)}
      {profile.sdd.filter && <CylZ x={XS} y={YB} z0={30.4} z1={30.8} r={3} m={m.copper} />}
      <TextPlate at={[XS - 8.15, YB + 1, 79]} w={12} h={4} text={live.fluorescence_per_s === null ? '—' : short(live.fluorescence_per_s) + '/s'} fg="#74dcaa" bg="#06130f" mono glow />
      <Tube points={[[XS + 4, YB + 9, 82], [XS + 8, YB + 18, 90], [XS + 14, YB + 4, 96], [XS + 16, -82, 98]]} r={0.8} m={m.cable} />
    </Part>

    {/* The beam: invisible in reality. Its outline (real width, three times enlarged) and photon packets whose every
        absorption, reflection and emission follows the twin's numbers; see photon-sim.ts. */}
    {setup && <BeamOutline setup={setup} />}
    {setup && <Photons setup={setup} animate={animate} seed={twin.seed} />}

    <Part idle={idle('i0')}><Chamber m={m} c={CHAMBERS.I0} length={profile.chambers.find(c => c.id === 'I0')?.length_cm} readout={live.i0 ? lcdVolts(live.i0.voltage_V, live.i0.saturated) : undefined} gas={gas('I0')} /></Part>
    <Part idle={idle('sample-stage')}>
      {/* Motorised stages at real size: base plate, X and Z translations with steppers, a lift column and the rotation table */}
      <Blk x0={XS - 12} x1={XS + 12} y0={0} y1={1.5} z0={-12} z1={12} m={m.dark} r={0.4} />
      <Blk x0={XS - 9} x1={XS + 9} y0={1.5} y1={5} z0={-9} z1={9} m={m.alu} r={0.4} />
      <Blk x0={XS + 9} x1={XS + 15} y0={1.8} y1={4.8} z0={-2.5} z1={2.5} m={m.black} r={0.3} />
      <Blk x0={XS - 8} x1={XS + 8} y0={5} y1={8.5} z0={-8} z1={8} m={m.alu} r={0.4} />
      <Blk x0={XS - 2.5} x1={XS + 2.5} y0={5.3} y1={8.2} z0={-14} z1={-8} m={m.black} r={0.3} />
      <Blk x0={XS - 4} x1={XS + 4} y0={8.5} y1={STAGE_TOP - 2} z0={-4} z1={4} m={m.dark} r={0.4} />
      <CylY x={XS} y0={STAGE_TOP - 2} y1={STAGE_TOP} r={5.5} m={m.alu} seg={40} />
      <Tube points={[[XS + 15, 3.3, 0], [XS + 20, 5, 6], [XS + 24, 3, 30], [XS + 24, -82, 60]]} r={0.45} m={m.cable} />
      <Tube points={[[XS, 6.7, -14], [XS - 4, 6, -22], [XS - 6, 0.5, -40], [XS - 8, -26, -60], [XS - 10, FLOOR + 1, -66]]} r={0.45} m={m.cable} />
    </Part>
    <group position={toThree([XS, YB, 0])} rotation-y={-turn}><group position={[-XS, -YB, 0]}>
      <Part idle={idle('sample-environment')}><Environment3D m={m} kind={environment.kind} /></Part>
      {spot && environment.kind === 'ambient' && <mesh position={toThree([XS - 0.25, YB, 0])} rotation-y={-Math.PI / 2} renderOrder={3}>
        <planeGeometry args={[spot.w, spot.h]} />
        <meshBasicMaterial color={new THREE.Color(spot.color[0] * 1.6, spot.color[1] * 1.6, spot.color[2] * 1.6)} toneMapped={false} />
      </mesh>}
    </group></group>
    <Part idle={idle('it')}><Chamber m={m} c={CHAMBERS.It} length={profile.chambers.find(c => c.id === 'It')?.length_cm} readout={live.it ? lcdVolts(live.it.voltage_V, live.it.saturated) : undefined} gas={gas('It')} /></Part>
    <Part idle={idle('reference-foil')}>
      <Blk x0={1222} x1={1234} y0={0} y1={1.5} z0={-6} z1={6} m={m.dark} r={0.3} />
      <Blk x0={1226.5} x1={1229.5} y0={1.5} y1={YB - 8} z0={-1.5} z1={1.5} m={m.alu} r={0.3} />
      <Blk x0={1226} x1={1228} y0={YB - 8} y1={YB + 8} z0={-8} z1={8} m={m.alu} r={0.4} />
      <Blk x0={1225.6} x1={1226} y0={YB - 4} y1={YB + 4} z0={-4} z1={4} m={m.foil} r={0.05} />
    </Part>
    <Part idle={idle('iref')}><Chamber m={m} c={CHAMBERS.Iref} length={profile.chambers.find(c => c.id === 'Iref')?.length_cm} readout={live.iref ? lcdVolts(live.iref.voltage_V, live.iref.saturated) : undefined} gas={gas('Iref')} /></Part>
    <Part idle={idle('beam-stop')}>
      <Blk x0={1290} x1={1302} y0={0} y1={1.5} z0={-6} z1={6} m={m.dark} r={0.3} />
      <Blk x0={1294} x1={1298} y0={1.5} y1={YB - 5} z0={-2} z1={2} m={m.alu} r={0.3} />
      <Blk x0={1290} x1={1300} y0={YB - 5} y1={YB + 5} z0={-5} z1={5} m={m.tungsten} r={0.4} />
    </Part>

    {/* The detector's acceptance: fluorescence leaves the sample in every direction and only this cone is collected */}
    {fluorescing && <mesh position={toThree([XS, YB, 16])} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <coneGeometry args={[2.6, 31, 24, 1, true]} />
      <meshBasicMaterial color="#74dcaa" transparent opacity={lit('to-detector') ? 0.12 : 0.03} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>}

    {/* Drain current: the sample is wired to a picoammeter on the floor */}
    <Part idle={idle('drain-current')}>
      <Blk x0={1110} x1={1162} y0={FLOOR} y1={FLOOR + 24} z0={-80} z1={-58} m={m.dark} r={1.5} />
      <TextPlate at={[1129, FLOOR + 14, -80.4]} w={28} h={9} text="TEY" fg="#74dcaa" bg="#06130f" mono glow />
      <Tube points={[[XS - 3, 30, -6], [XS - 20, 14, -50], [1150, -30, -78], [1150, FLOOR + 24, -70]]} r={1.1} m={m.cable} />
    </Part>
    {lit('to-ammeter') && <Tube points={[[XS - 3, 30, -6], [XS - 20, 14, -50], [1150, -30, -78], [1150, FLOOR + 24, -70]]} r={1.6} m={current} />}
  </>;
}

/* ---------- 4K capture ---------- */
/**
 * Draws the current view once at 4K (3840 by 2160; 2560 by 1440 on phones) straight through the effect composer, with
 * full-quality effects and sharper shadows, reads that frame, and puts the renderer, camera and composer back. The
 * camera does not move, and the page's own canvas keeps its size.
 */
function Snapshot({ shot, light, onShot, setHq, composer }: { shot: number; light: boolean; onShot: (image: Blob | null, width: number, height: number) => void; setHq: (on: boolean) => void; composer: MutableRefObject<EffectComposerImpl | null> }) {
  const { gl, camera, invalidate } = useThree();
  const job = useRef<{ frames: number } | null>(null);
  useEffect(() => {
    if (!shot || job.current) return;
    job.current = { frames: 0 }; setHq(true); invalidate();
  }, [shot, setHq, invalidate]);
  useFrame(() => {
    const j = job.current, fx = composer.current; if (!j) return;
    // A few frames for the full-quality passes and the larger shadow maps to be built.
    if (j.frames++ < 3 || !fx) { invalidate(); return; }
    const width = light ? 2560 : 3840, height = light ? 1440 : 2160, cam = camera as THREE.PerspectiveCamera;
    const size = gl.getSize(new THREE.Vector2()), dpr = gl.getPixelRatio(), aspect = cam.aspect;
    gl.setPixelRatio(1); fx.setSize(width, height, false); cam.aspect = width / height; cam.updateProjectionMatrix();
    fx.render();
    gl.domElement.toBlob(image => onShot(image, width, height), 'image/png');
    gl.setPixelRatio(dpr); fx.setSize(size.x, size.y, false); cam.aspect = aspect; cam.updateProjectionMatrix();
    job.current = null; setHq(false); invalidate();
  }, 2);
  return null;
}

/** A wall screen with the beamline's live status. */
function StatusScreen({ mode, energy, theta, crystal, transmission }: { mode: TwinState['mode']; energy: number; theta: number | null; crystal: string; transmission: number | null }) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 700;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; return t;
  }, []);
  useLayoutEffect(() => {
    const c = texture.image as HTMLCanvasElement, g = c.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, 0, 700); bg.addColorStop(0, '#0b1a2b'); bg.addColorStop(1, '#06101c');
    g.fillStyle = bg; g.fillRect(0, 0, 1600, 700);
    g.strokeStyle = 'rgba(80,210,255,.25)'; g.lineWidth = 2;
    for (let x = 0; x < 1600; x += 80) { g.beginPath(); g.moveTo(x, 150); g.lineTo(x, 700); g.stroke(); }
    g.fillStyle = '#4fd8ff'; g.font = '600 64px ui-monospace, Consolas, monospace'; g.fillText('XAS LAB · HUTCH 1', 60, 100);
    g.fillStyle = '#5dff9a'; g.beginPath(); g.arc(1500, 80, 18, 0, 2 * Math.PI); g.fill();
    g.fillStyle = '#e8f6ff'; g.font = '500 76px ui-monospace, Consolas, monospace';
    const rows: [string, string][] = [['MODE', modeInfo(mode).name.toUpperCase()], ['ENERGY', energy.toFixed(1) + ' eV'], ['BRAGG', theta === null ? '—' : theta.toFixed(3) + '°  ' + crystal.replace(/Si(\d+)/, 'Si($1)')], ['SAMPLE T', transmission === null ? '—' : (transmission * 100).toFixed(1) + ' %']];
    rows.forEach(([k, v], i) => { g.fillStyle = 'rgba(160,230,255,.7)'; g.fillText(k, 60, 250 + i * 120); g.fillStyle = '#ffffff'; g.fillText(v, 520, 250 + i * 120); });
    texture.needsUpdate = true;
  }, [texture, mode, energy, theta, crystal, transmission]);
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  const frame = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1b2028', metalness: 0.5, roughness: 0.4 }), []);
  useLayoutEffect(() => () => frame.dispose(), [frame]);
  return <group>
    <Blk x0={556} x1={724} y0={116} y1={192} z0={194} z1={199} m={frame} r={1.5} />
    <mesh position={toThree([640, 154, 193.6])}><planeGeometry args={[160, 70]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>
  </group>;
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
interface Overlay { labelled: Set<PartId>; buttons: Map<PartId, HTMLButtonElement>; leaders: Map<PartId, SVGPathElement>; dots: Map<PartId, SVGCircleElement>; svg: SVGSVGElement | null; tips: Partial<Record<PartId, V3>>; drawn: Map<PartId, string>; widths: Map<PartId, number>; hud: HTMLDivElement | null; hudBox: { right: number; bottom: number } | null }

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
  // Re-framed when the box changes shape, not on every size change: a 4K capture keeps the shape.
  }, [mode, whole, focusOn, reset, Math.round(aspect * 50), reduced, camera, invalidate]);
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
      // Parts without a label in this close-up sit as markers on their hardware, like the whole-beamline view.
      const labelled = showLabels && o.labelled.has(part.id);
      let half = 14;
      if (labelled && !outside) {
        if (!o.widths.has(part.id)) o.widths.set(part.id, o.buttons.get(part.id)?.offsetWidth ?? 0);
        half = Math.max(14, o.widths.get(part.id)! / 2 + 4);
      }
      const at = outside ? near : clampToBox(labelled ? label.x : tip.x, labelled ? label.y : tip.y, w, h, 14, half);
      return { id: part.id, tip, x: at.x, y: at.y, outside, labelled, edge: near.x <= 14 ? 'l' : near.x >= w - 14 ? 'r' : near.y <= 14 ? 't' : 'b' };
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
      for (const p of placed.filter(q => !q.outside && q.labelled).sort((a, b) => a.y - b.y)) {
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
      const key = `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.tip.x.toFixed(1)} ${p.tip.y.toFixed(1)} ${p.outside} ${p.labelled}`;
      if (o.drawn.get(p.id) === key) continue;
      o.drawn.set(p.id, key);
      const button = o.buttons.get(p.id), leader = o.leaders.get(p.id), dot = o.dots.get(p.id);
      const tx = p.outside ? p.x : p.tip.x, ty = p.outside ? p.y : p.tip.y;
      if (button) {
        button.style.setProperty('--ax', p.x + 'px'); button.style.setProperty('--ay', p.y + 'px');
        button.style.setProperty('--tx', tx + 'px'); button.style.setProperty('--ty', ty + 'px');
        button.toggleAttribute('data-outside', p.outside);
        button.toggleAttribute('data-marker', !p.outside && !p.labelled && showLabels);
      }
      const below = p.y > p.tip.y;
      leader?.setAttribute('d', p.labelled && !p.outside ? `M${p.x.toFixed(1)} ${(p.y + (below ? -11 : 11)).toFixed(1)}L${p.tip.x.toFixed(1)} ${p.tip.y.toFixed(1)}` : '');
      if (dot) { dot.setAttribute('cx', p.tip.x.toFixed(1)); dot.setAttribute('cy', p.tip.y.toFixed(1)); dot.setAttribute('r', p.labelled && !p.outside ? '2' : '0'); }
    }
  });
  return null;
}

/** One significant figure as a power of ten, for the legend: 9.1e10 becomes "9 x 10^10". */
const power = (value: number) => { const e = Math.floor(Math.log10(value)), m = Math.round(value / 10 ** e); return m === 10 ? `10^{${e + 1}}` : String.raw`${m}\times10^{${e}}`; };

/** What the dots mean: X-rays are invisible, so the colours, the speed and the counts are spelled out. A chip with the
    energy bar; tap it for the rest. */
function PhotonLegend({ setup }: { setup: PhotonSetup }) {
  const [open, setOpen] = useState(false);
  const stops = [0, 0.25, 0.5, 0.75, 1].map(t => { const c = energyColor(COLOR_RANGE_eV[0] * (COLOR_RANGE_eV[1] / COLOR_RANGE_eV[0]) ** t); return `rgb(${c.map(v => Math.round(Math.min(1, v) * 255)).join(' ')}) ${t * 100}%`; });
  return <div className={'hutch-legend' + (open ? ' is-open' : '')} role="note" aria-label="How the photons are drawn">
    <button type="button" className="hutch-legend-chip" aria-expanded={open} aria-controls="hutch-legend-text" onClick={() => setOpen(!open)}>
      <strong>Photons</strong><span>2 keV</span><i style={{ background: `linear-gradient(90deg, ${stops.join(', ')})` }} /><span>45 keV</span>
    </button>
    <p id="hutch-legend-text" hidden={!open}>Invisible in reality: false colour, slowed <Tex plain>{'10^{8}'}</Tex> times{setup.photonsPerPacket > 0 && <> · 1 dot ≈ <Tex plain>{power(setup.photonsPerPacket)}</Tex> photons</>}{setup.whitePerSelected > 1 && <> · at these settings the crystals pass 1 white photon in <Tex plain>{power(setup.whitePerSelected)}</Tex></>} · ◆ fluorescence and scatter{setup.sample.fluorescenceBoost > 1 && <> <Tex plain>{String.raw`\times${setup.sample.fluorescenceBoost}`}</Tex></>} · width <Tex plain>{String.raw`\times${WIDTH_SCALE}`}</Tex> · flash: absorbed</p>
  </div>;
}

export interface Hutch3DProps extends HutchSceneProps {
  /** Bumped by the Reset view button. */
  reset: number;
  /** Bumped by the Save 4K image button; the image comes back through onShot. */
  shot: number;
  onShot: (image: Blob | null, width: number, height: number) => void;
}

function Hutch3D({ twin, live, labels, part: open, onPart, whole, reset, shot, onShot }: Hutch3DProps) {
  const reduced = !!useReducedMotion();
  const coarse = useMemo(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, []);
  const { mode } = twin;
  const scene = sceneFor(mode);
  const showLabels = labels && !whole;
  const stage = useRef<HTMLDivElement>(null);
  const overlay = useRef<Overlay>({ labelled: new Set(), buttons: new Map(), leaders: new Map(), dots: new Map(), svg: null, tips: {}, drawn: new Map(), widths: new Map(), hud: null, hudBox: null });
  const [visible, setVisible] = useState(true), [focusOn, setFocusOn] = useState<PartId | null>(null), [hq, setHq] = useState(false);
  const composer = useRef<EffectComposerImpl | null>(null);
  useEffect(() => {
    const el = stage.current; if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A new mode, view or reset frames the mode again rather than the last part picked off-screen.
  useEffect(() => setFocusOn(null), [mode, whole, reset]);
  overlay.current.drawn.clear(); overlay.current.widths.clear(); overlay.current.hudBox = null;
  overlay.current.labelled = new Set(labelledParts(mode, open));
  const tv = drawnBraggDeg(live.theta_deg) * Math.PI / 180;
  overlay.current.tips = { 'second-crystal': [C1 + (YB - YB0) / Math.tan(2 * tv), YB, 0] };
  // What the photon packets do, from the same state and readouts as everything else on the page.
  const setup = useMemo(() => { try { return photonSetup(twin, live, tv); } catch { return null; } }, [twin, live, tv]);

  const partClass = (id: PartId) => (partActive(mode, id) ? '' : 'is-idle') + (scene.emphasis.includes(id) ? ' is-focus' : '');
  const cues = scene.cues.map(cue => ' cue-' + cue).join('');
  const label = `Beamline drawing, 3D view, ${modeInfo(mode).name.toLowerCase()} mode. The monochromator passes ${live.energy_eV.toFixed(1)} eV` +
    (live.sampleTransmission === null ? '.' : ` and the sample passes ${percent(live.sampleTransmission)}% of the beam.`);

  return <div className={'hutch hutch-3d mode-' + mode + cues + (showLabels ? '' : ' no-labels') + (hq ? ' is-capturing' : '')}>
    <div className="hutch-stage" ref={stage}>
      <div className="hutch-canvas" role="img" aria-label={label}>
        <Canvas shadows dpr={coarse ? [1, 1.5] : [1, 2]} frameloop={visible || hq ? 'demand' : 'never'} camera={{ fov: FOV, near: 10, far: 9000, position: [700, 600, 2400] }}
          gl={{ antialias: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.toneMappingExposure = 1; gl.shadowMap.autoUpdate = false; }}>
          <Suspense fallback={null}><World twin={twin} live={live} animate={!reduced} hq={hq} setup={setup} /></Suspense>
          <Rig mode={mode} whole={whole} focusOn={focusOn} reset={reset} reduced={reduced} />
          <Effects light={coarse} hq={hq} composer={composer} />
          <Snapshot shot={shot} light={coarse} onShot={onShot} setHq={setHq} composer={composer} />
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
      {setup && <PhotonLegend setup={setup} />}
      <ul className="sr-only" aria-label="Beam path">
        {LEGS.map(leg => <li key={leg} data-leg={leg} className={'hutch-leg' + (legLit(mode, leg) ? ' is-lit' : '')}>Beam from the {LEG_NAMES[leg]}: {legLit(mode, leg) ? 'in use' : 'not used in this mode'}</li>)}
      </ul>
    </div>
  </div>;
}

export default memo(Hutch3D);
