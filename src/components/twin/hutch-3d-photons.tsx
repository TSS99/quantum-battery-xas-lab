'use client';
/* The photons of the 3D hutch: packets from photon-sim.ts drawn as glowing dots with short streaks along their
   direction, flashes where they are absorbed, and the beam's outline (its real width, three times enlarged) fading
   with every absorber. X-rays are invisible; the colours are a false energy scale. */
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { C1, SLITS_X, SOURCE_X, STOP_X, YB0 } from './hutch-parts';
import { YB } from '../scene-kit';
import { toThree } from './hutch-3d-layout';
import { FLASH_LIFE, PhotonSim, WIDTH_SCALE, realDistance_m, type PhotonSetup, type V3 } from './photon-sim';

const MAX_PACKETS = 2000, MAX_FLASHES = 500, MAX_SEGMENTS = 3600, MAX_CARRIERS = 4000;
const ELECTRON: V3 = [0.62, 0.86, 1], POSITIVE_ION: V3 = [1, 0.62, 0.3];
/** Colours brighter than the bloom threshold, so the packets glow. */
const GLOW = 2.4;
const FLASH_GLOW: Record<string, number> = { heat: 2.6, ion: 3.2, absorb: 3.2, count: 4 };
const ION: V3 = [0.45, 0.6, 1];

const tmp = new THREE.Object3D(), color = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0), probe = new THREE.Vector3();

/**
 * The packets, their streaks and the absorption flashes, stepped every frame while `animate` is on. `pass`, while the
 * second crystal rocks, holds its throughput for each order right now.
 */
export function Photons({ setup, animate, seed = 1, pass, pulse = null }: { setup: PhotonSetup; animate: boolean; seed?: number; pass?: RefObject<number[] | null>; pulse?: PhotonSim['pulse'] }) {
  const sim = useMemo(() => {
    let s = seed >>> 0 || 1;
    const random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    // One simulation for the life of the view; a new state only changes the setup of packets still to come.
    return new PhotonSim(setup, random);
  }, []);
  const warmed = useRef(false);
  useEffect(() => { sim.setup = setup; if (!warmed.current) { sim.prewarm(6); warmed.current = true; } }, [sim, setup]);

  const [dots, gems, streaks, flashes, segments, carriers] = useMemo(() => {
    const make = (geometry: THREE.BufferGeometry, count: number, opacity = 1) => {
      const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }), count);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      mesh.frustumCulled = false; mesh.renderOrder = 4; mesh.count = 0;
      return mesh;
    };
    const streak = new THREE.CylinderGeometry(0.32, 0.05, 1, 6, 1, true); streak.translate(0, -0.5, 0);
    // Beam packets are spheres; fluorescence and scatter are diamonds, since their energies can sit close to the beam's.
    // Ionization tracks are thin rods between their points; the drifting electrons and ions are small beads.
    const rod = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true); rod.translate(0, 0.5, 0);
    return [make(new THREE.SphereGeometry(1, 10, 8), MAX_PACKETS), make(new THREE.OctahedronGeometry(1.5), MAX_PACKETS), make(streak, MAX_PACKETS, 0.4), make(new THREE.SphereGeometry(1, 12, 10), MAX_FLASHES),
      make(rod, MAX_SEGMENTS, 0.85), make(new THREE.SphereGeometry(1, 8, 6), MAX_CARRIERS)];
  }, []);
  useLayoutEffect(() => () => [dots, gems, streaks, flashes, segments, carriers].forEach(m => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose(); }), [dots, gems, streaks, flashes, segments, carriers]);

  useFrame(({ camera, clock }, dt) => {
    sim.secondCrystalPass = pass?.current ?? null; sim.pulse = pulse;
    if (animate) sim.step(Math.min(dt, 0.1), clock.elapsedTime);
    // Markers keep about the same size on screen: smaller than the hardware up close, still visible from afar.
    const near = (at: V3) => Math.min(1.5, Math.max(0.32, camera.position.distanceTo(probe.set(...at)) / 720));
    let n = 0, g = 0;
    for (const p of sim.packets) {
      if (n >= MAX_PACKETS) break;
      const at = toThree(sim.position(p)), d = sim.direction(p);
      const white = p.species === 'white', size = (white ? 1.3 : p.species === 'beam' ? 2 : 1.35) * near(at);
      color.setRGB(p.color[0] * GLOW, p.color[1] * GLOW, p.color[2] * GLOW);
      tmp.position.set(...at); tmp.quaternion.identity(); tmp.scale.setScalar(size); tmp.updateMatrix();
      if (p.species === 'fluorescence' || p.species === 'scatter') { gems.setMatrixAt(g, tmp.matrix); gems.setColorAt(g, color); g++; dots.setMatrixAt(n, HIDDEN); }
      else dots.setMatrixAt(n, tmp.matrix);
      dots.setColorAt(n, color);
      // The streak trails behind the packet along its direction of travel.
      dir.set(d[0], d[1], -d[2]).normalize();
      tmp.quaternion.setFromUnitVectors(UP, dir.negate()); tmp.scale.set(size, white ? 7 : 12, size); tmp.updateMatrix();
      streaks.setMatrixAt(n, tmp.matrix); streaks.setColorAt(n, color);
      n++;
    }
    dots.count = streaks.count = n; gems.count = g;
    let f = 0;
    for (const flash of sim.flashes) {
      if (f >= MAX_FLASHES) break;
      const t = flash.age / FLASH_LIFE, grow = Math.sin(Math.PI * Math.min(1, t)), glow = FLASH_GLOW[flash.kind] * (1 - t * 0.6);
      const c = flash.kind === 'ion' ? ION : flash.color;
      color.setRGB(c[0] * glow, c[1] * glow, c[2] * glow);
      const where = toThree(flash.at);
      tmp.position.set(...where); tmp.quaternion.identity(); tmp.scale.setScalar((0.6 + (flash.kind === 'count' ? 4.5 : 3.4) * grow) * near(where)); tmp.updateMatrix();
      flashes.setMatrixAt(f, tmp.matrix); flashes.setColorAt(f, color);
      f++;
    }
    flashes.count = f;
    // Tracks fade over their life; each segment is a rod from one point to the next.
    let s = 0;
    for (const track of sim.tracks) {
      const fade = Math.max(0, 1 - track.age / track.life), glow = 2.2 * fade;
      color.setRGB(track.color[0] * glow, track.color[1] * glow, track.color[2] * glow);
      for (let i = 1; i < track.points.length && s < MAX_SEGMENTS; i++) {
        const a = toThree(track.points[i - 1]), b = toThree(track.points[i]);
        dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const length = dir.length(); if (!(length > 0)) continue;
        tmp.position.set(...a); tmp.quaternion.setFromUnitVectors(UP, dir.normalize()); tmp.scale.set(0.035 * near(a), length, 0.035 * near(a)); tmp.updateMatrix();
        segments.setMatrixAt(s, tmp.matrix); segments.setColorAt(s, color); s++;
      }
    }
    segments.count = s;
    let c = 0;
    for (const carrier of sim.carriers) {
      if (c >= MAX_CARRIERS) break;
      const at = toThree(carrier.at), tint = carrier.kind === 'electron' ? ELECTRON : POSITIVE_ION;
      color.setRGB(tint[0] * 1.8, tint[1] * 1.8, tint[2] * 1.8);
      tmp.position.set(...at); tmp.quaternion.identity(); tmp.scale.setScalar((carrier.kind === 'electron' ? 0.09 : 0.13) * near(at)); tmp.updateMatrix();
      carriers.setMatrixAt(c, tmp.matrix); carriers.setColorAt(c, color); c++;
    }
    carriers.count = c;
    for (const m of [dots, gems, streaks, flashes, segments, carriers]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  });

  return <>
    <primitive object={streaks} />
    <primitive object={dots} />
    <primitive object={gems} />
    <primitive object={flashes} />
    <primitive object={segments} />
    <primitive object={carriers} />
  </>;
}

/**
 * The beam's outline from the source to the beam stop: the bending-magnet fan up to the front-end slits, then the
 * accepted beam at its real width (enlarged three times; heights of a fraction of a millimetre are drawn thicker),
 * narrowing to the focus at the sample and opening again past it. Each stretch between absorbers is fainter in
 * proportion to what the absorbers before it took out of the fundamental (with a floor, so a faint beam still shows
 * where it goes); past the second crystal it follows that crystal's throughput as it rocks.
 */
export function BeamOutline({ setup, pass }: { setup: PhotonSetup; pass?: RefObject<number[] | null> }) {
  // Materials are kept for the life of the view and only recoloured: disposing them on every slider step made three.js
  // throw away and recompile their shader program each time.
  const pool = useRef<THREE.MeshBasicMaterial[]>([]);
  const segments = useMemo(() => {
    const { envelope, stages, c2x, twoTheta, orders, fanMrad } = setup;
    // Breakpoints: every stage, the slits, the crystals and the focus; the fundamental's surviving share on each stretch.
    const cuts = [...new Set([SOURCE_X, SLITS_X, C1, c2x, ...stages.map(s => s.x0), ...stages.map(s => s.x1), envelope.focusX ?? STOP_X, STOP_X])].filter(x => x >= SOURCE_X && x <= STOP_X).sort((a, b) => a - b);
    const out: { geometry: THREE.BufferGeometry; color: V3; base: number; survive: number; afterCrystal: boolean }[] = [];
    const crystal = stages.find(s => s.kind === 'crystal');
    for (let i = 0; i + 1 < cuts.length; i++) {
      const xa = cuts[i], xb = cuts[i + 1];
      // What reaches this stretch, leaving out the second crystal, whose share can change from frame to frame.
      const survive = stages.filter(s => s.x1 <= xa && s !== crystal).reduce((r, s) => r * (1 - s.remove[0]), 1);
      const afterCrystal = !!crystal && crystal.x1 <= xa;
      if (xb - xa < 0.01 || survive < 1e-6) continue;
      const white = xb <= C1, steps = Math.max(2, Math.ceil((xb - xa) / 12));
      const ring = (x: number): V3[] => {
        const w = (x <= SLITS_X ? Math.max(0.9, realDistance_m(x) * fanMrad / 10 * WIDTH_SCALE) : Math.abs(envelope.width(x))) / 2, h = Math.abs(envelope.height(x)) / 2;
        const rising = x > C1 && x < c2x, y = x <= C1 ? YB0 : x >= c2x ? YB : YB0 + (x - C1) * Math.tan(twoTheta);
        const nx = rising ? -Math.sin(twoTheta) : 0, ny = rising ? Math.cos(twoTheta) : 1;
        return [[x - nx * h, y - ny * h, -w], [x - nx * h, y - ny * h, w], [x + nx * h, y + ny * h, w], [x + nx * h, y + ny * h, -w]];
      };
      const positions: number[] = [], index: number[] = [];
      for (let k = 0; k <= steps; k++) {
        for (const p of ring(xa + (xb - xa) * k / steps)) positions.push(...toThree(p));
        if (k) for (let side = 0; side < 4; side++) {
          const a = (k - 1) * 4 + side, b = (k - 1) * 4 + (side + 1) % 4, c = k * 4 + side, d = k * 4 + (side + 1) % 4;
          index.push(a, b, d, a, d, c);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(index);
      out.push({ geometry, color: white ? [0.92, 0.94, 1] : orders[0].color, base: white ? 0.28 : 0.34, survive, afterCrystal });
    }
    while (pool.current.length < out.length) pool.current.push(new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    out.forEach((segment, i) => pool.current[i].color.setRGB(...segment.color));
    return out;
  }, [setup, pass]);
  const setPass = 1 - (setup.stages.find(s => s.kind === 'crystal')?.remove[0] ?? 0);
  useFrame(() => {
    const now = pass?.current?.[0] ?? setPass;
    segments.forEach((segment, i) => {
      const share = segment.survive * (segment.afterCrystal ? now : 1);
      pool.current[i].opacity = share < 1e-6 ? 0 : segment.base * (0.12 + 0.88 * share);
    });
  });
  useLayoutEffect(() => () => segments.forEach(m => m.geometry.dispose()), [segments]);
  useLayoutEffect(() => () => pool.current.forEach(m => m.dispose()), []);
  return <>{segments.map((m, i) => <mesh key={i} geometry={m.geometry} material={pool.current[i]} renderOrder={2} />)}</>;
}
