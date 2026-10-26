'use client';
/* Materials and building blocks for the 3D hutch. Sizes are in the diagram's units (scene-kit). The textures were
   made for this page with an image model (tileable aluminium, painted hutch wall, concrete, epoxy floor). Rounded
   boxes are extrusions with world-space UVs, so a texture repeats per world unit: a big tank and a small post show
   the same grain. */
import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { RoundedBox, useTexture } from '@react-three/drei';
import { toThree, type V3 } from './hutch-3d-layout';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
/* The last one is a panorama of a hutch interior, used only for what shiny surfaces reflect. */
export const TEXTURES = ['aluminium', 'hutch-wall', 'concrete', 'floor', 'hutch-pano'].map(name => `${BASE}/images/twin/${name}.webp`);
// Fetched as soon as this code loads; the page switches to the 3D view once they are in, so it never shows an empty room.
useTexture.preload(TEXTURES);
export const texturesReady = Promise.all(TEXTURES.map(url => new Promise<void>(done => { const img = new Image(); img.onload = img.onerror = () => done(); img.src = url; })));

/** A copy of a texture that repeats every `size` world units (or `rx` by `ry` times on a plane). */
function tiled(source: THREE.Texture, rx: number, ry = rx, color = true) {
  const t = source.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 16;
  t.needsUpdate = true;
  return t;
}

/** The optical table top: brushed steel with an M6 hole grid every 12.5 units. */
function tableTopTexture(alu: THREE.Texture, w: number, d: number) {
  const scale = 3, canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(d * scale);
  const g = canvas.getContext('2d')!;
  const img = alu.image as CanvasImageSource & { width: number; height: number };
  for (let x = 0; x < canvas.width; x += 256) for (let y = 0; y < canvas.height; y += 256) g.drawImage(img, x, y, 256, 256);
  g.fillStyle = 'rgba(40,46,54,.35)'; g.fillRect(0, 0, canvas.width, canvas.height);
  for (let x = 6.25; x < w; x += 12.5) for (let y = 6.25; y < d; y += 12.5) {
    g.beginPath(); g.arc(x * scale, y * scale, 1.7 * scale, 0, 2 * Math.PI); g.fillStyle = '#0b0e12'; g.fill();
    g.beginPath(); g.arc(x * scale - .6, y * scale - .6, 1.7 * scale, Math.PI * 1.1, Math.PI * 1.6); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; g.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

/** Yellow and black hazard tape. */
function hazardTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 16;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#e3b52c'; g.fillRect(0, 0, 64, 16); g.fillStyle = '#16181c';
  for (let x = -16; x < 64; x += 16) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 8, 16); g.lineTo(x + 16, 0); g.lineTo(x + 8, 0); g.fill(); }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeMaterials([alu, wall, concrete, floor, pano]: THREE.Texture[]) {
  const reflections = pano.clone();
  reflections.mapping = THREE.EquirectangularReflectionMapping; reflections.colorSpace = THREE.SRGBColorSpace; reflections.needsUpdate = true;
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const coating = (color: string) => std({ color, metalness: 1, roughness: 0.06 });
  return {
    // Instrument palette (stainless, bead blasted aluminium, black anodised, powder coat), roughness from real finishes.
    alu: std({ color: '#cfd5da', map: tiled(alu, 1 / 80), metalness: 0.9, roughness: 0.38 }),
    steel: std({ color: '#c9d0d5', map: tiled(alu, 1 / 50), roughnessMap: tiled(alu, 1 / 50, 1 / 50, false), metalness: 1, roughness: 0.3 }),
    paint: std({ color: '#3a414b', roughnessMap: tiled(floor, 1 / 60, 1 / 60, false), metalness: 0.35, roughness: 0.8 }),
    panel: std({ color: '#303941', metalness: 0, roughness: 0.48 }),
    yellow: std({ color: '#e2b22a', roughness: 0.5 }),
    red: std({ color: '#c62828', roughness: 0.35 }),
    dark: std({ color: '#24292f', metalness: 0.75, roughness: 0.32 }),
    black: std({ color: '#131518', metalness: 0.1, roughness: 0.5 }),
    magnet: std({ color: '#2d5f97', metalness: 0.3, roughness: 0.4 }),
    copper: std({ color: '#c27a45', metalness: 1, roughness: 0.22 }),
    brass: std({ color: '#c9a45c', metalness: 1, roughness: 0.28 }),
    concrete: std({ color: '#c9ccd1', map: tiled(concrete, 1 / 140), roughness: 0.9 }),
    granite: std({ color: '#6b727c', map: tiled(concrete, 1 / 90), metalness: 0.1, roughness: 0.5 }),
    white: std({ color: '#dde1df', metalness: 0, roughness: 0.48 }),
    tungsten: std({ color: '#7c8188', metalness: 0.9, roughness: 0.42 }),
    silicon: std({ color: '#7c8591', metalness: 0.45, roughness: 0.12 }),
    kapton: std({ color: '#d88a2c', emissive: '#4a2400', emissiveIntensity: 0.4, roughness: 0.35, transparent: true, opacity: 0.88 }),
    glass: std({ color: '#d8ecff', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.16, depthWrite: false }),
    inner: std({ color: '#1a1f26', metalness: 0.6, roughness: 0.5 }),
    cable: std({ color: '#141619', roughness: 0.48 }),
    gas: std({ color: '#4f89c7', roughness: 0.25, transparent: true, opacity: 0.92 }),
    hv: std({ color: '#9a3a34', roughness: 0.45 }),
    foil: std({ color: '#efe8da', metalness: 1, roughness: 0.12 }),
    pellet: std({ color: '#3d4148', roughness: 0.8 }),
    tableSide: std({ color: '#2b3038', metalness: 0.45, roughness: 0.45 }),
    isolator: std({ color: '#545d68', metalness: 0.45, roughness: 0.4 }),
    tableTop: std({ map: tableTopTexture(alu, 360, 120), metalness: 0.7, roughness: 0.34 }),
    // Walls kept under about 80 % white and the floor a graphite epoxy, so the hardware carries the light.
    wall: std({ color: '#c8ccce', map: tiled(wall, 2400 / 240, 450 / 240), metalness: 0.05, roughness: 0.7 }),
    floor: std({ color: '#5a626b', map: tiled(floor, 2400 / 140, 800 / 140), metalness: 0.1, roughness: 0.34 }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff8ee').multiplyScalar(2.6), toneMapped: false }),
    // Status strips stay faint: colour marks state, not decoration.
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color('#6fd3ee').multiplyScalar(0.9), toneMapped: false }),
    ledSoft: new THREE.MeshBasicMaterial({ color: new THREE.Color('#6fd3ee').multiplyScalar(0.5), toneMapped: false }),
    hazard: std({ map: (() => { const t = hazardTexture(); t.repeat.set(72, 1); return t; })(), roughness: 0.6 }),
    hazardV: std({ map: (() => { const t = hazardTexture(); t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; t.repeat.set(22, 1); return t; })(), roughness: 0.6 }),
    duct: std({ color: '#b8c0ca', metalness: 0.3, roughness: 0.5 }),
    ceramic: std({ color: '#d9d4c8', roughness: 0.7 }),
    peek: std({ color: '#b3a07a', roughness: 0.45 }),
    pano: reflections,
    coatings: { Rh: coating('#d9dce2'), Pt: coating('#ece6da'), Ni: coating('#b9b2a5'), Si: coating('#8ea2bd') } as Record<string, THREE.MeshStandardMaterial>,
  };
}

export type Mats = ReturnType<typeof makeMaterials>;

export function useMaterials(): Mats {
  const textures = useTexture(TEXTURES);
  return useMemo(() => makeMaterials(textures), [textures]);
}

/* The building blocks below skip re-rendering when their props are unchanged by value (callers build new point and
   position arrays on every render), so a slider step only re-renders the few parts that actually change. */
const same = (a: unknown, b: unknown): boolean => a === b || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
const sameProps = <P extends object>(a: P, b: P) => {
  const keys = Object.keys(a) as (keyof P)[];
  return keys.length === Object.keys(b).length && keys.every(key => same(a[key], b[key]));
};

/** A rounded box between two corners, in world coordinates. */
export const Blk = memo(function Blk({ x0, x1, y0, y1, z0, z1, m, r = 1.2, cast = true }: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; m: THREE.Material; r?: number; cast?: boolean }) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0, radius = Math.max(0.05, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  return <RoundedBox args={[w, h, d]} radius={radius} smoothness={2} bevelSegments={2} position={[(x0 + x1) / 2, (y0 + y1) / 2, -(z0 + z1) / 2]} material={m} castShadow={cast} receiveShadow />;
}, sameProps);

/** A cylinder along the beam (X). */
export const CylX = memo(function CylX({ x0, x1, y, z = 0, r, m, seg = 28 }: { x0: number; x1: number; y: number; z?: number; r: number; m: THREE.Material; seg?: number }) {
  return <mesh position={[(x0 + x1) / 2, y, -z]} rotation={[0, 0, Math.PI / 2]} material={m} castShadow receiveShadow>
    <cylinderGeometry args={[r, r, x1 - x0, seg]} />
  </mesh>;
}, sameProps);
/** An upright cylinder (Y). */
export const CylY = memo(function CylY({ x, z = 0, y0, y1, r, m, seg = 24 }: { x: number; z?: number; y0: number; y1: number; r: number; m: THREE.Material; seg?: number }) {
  return <mesh position={[x, (y0 + y1) / 2, -z]} material={m} castShadow receiveShadow>
    <cylinderGeometry args={[r, r, y1 - y0, seg]} />
  </mesh>;
}, sameProps);
/** A cylinder along the depth (Z). */
export const CylZ = memo(function CylZ({ x, y, z0, z1, r, m, seg = 28 }: { x: number; y: number; z0: number; z1: number; r: number; m: THREE.Material; seg?: number }) {
  return <mesh position={[x, y, -(z0 + z1) / 2]} rotation={[Math.PI / 2, 0, 0]} material={m} castShadow receiveShadow>
    <cylinderGeometry args={[r, r, z1 - z0, seg]} />
  </mesh>;
}, sameProps);

/** Hex bolt heads at world points, all facing along one axis, drawn as one instanced mesh. */
export const Bolts = memo(function Bolts({ points, axis, m, size = 1.1, height = 1.4 }: { points: V3[]; axis: 'x' | 'y' | 'z'; m: THREE.Material; size?: number; height?: number }) {
  const key = points.flat().join(' ');
  const mesh = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(size, size, height, 6);
    if (axis === 'x') geometry.rotateZ(Math.PI / 2); else if (axis === 'z') geometry.rotateX(Math.PI / 2);
    const bolts = new THREE.InstancedMesh(geometry, m, points.length), o = new THREE.Object3D();
    points.forEach((p, i) => { o.position.set(...toThree(p)); o.updateMatrix(); bolts.setMatrixAt(i, o.matrix); });
    bolts.castShadow = bolts.receiveShadow = true;
    return bolts;
  }, [key, axis, m, size, height]);
  useLayoutEffect(() => () => { mesh.geometry.dispose(); mesh.dispose(); }, [mesh]);
  return <primitive object={mesh} />;
}, sameProps);
/** Points on a circle around the beam axis (the YZ plane) at x, such as the bolts of a vacuum flange. */
export const ring = (x: number, y: number, r: number, n = 8, z = 0): V3[] => Array.from({ length: n }, (_, i) => { const a = (i + 0.5) / n * 2 * Math.PI; return [x, y + r * Math.sin(a), z + r * Math.cos(a)]; });

/** A cable or hose through world points. */
export const Tube = memo(function Tube({ points, r, m, segments = 64 }: { points: V3[]; r: number; m: THREE.Material; segments?: number }) {
  // Keyed by the coordinates, not the array: callers build a new array on every render.
  const key = points.flat().join(' ');
  const geometry = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...toThree(p))), false, 'catmullrom', 0.3), segments, r, 8), [key, r, segments]);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={m} castShadow receiveShadow />;
}, sameProps);

/** A cable from a fitting on top of a part: it rises, bends back over the part and drops into the floor duct behind the table. */
export const drapePoints = (x: number, y: number, z = 0, back = 12, rise = 9): V3[] =>
  [[x, y, z], [x + 1, y + rise * 0.7, z + 4], [x + back * 0.6, y + rise, 40], [x + back, y + rise - 6, 72], [x + back, 6, 86], [x + back, -82, 90]];

/** A flat text plate or display drawn on a canvas, facing the viewer, centred at a world point. */
export const TextPlate = memo(function TextPlate({ at, w, h, text, fg = '#d9e1ea', bg = 'rgba(0,0,0,0)', font = '600', glow = false, mono = false }: { at: V3; w: number; h: number; text: string; fg?: string; bg?: string; font?: string; glow?: boolean; mono?: boolean }) {
  const scale = 14;
  // One canvas per plate, redrawn when the text changes (a display updates on every slider step).
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    return t;
  }, [w, h]);
  useLayoutEffect(() => {
    const canvas = texture.image as HTMLCanvasElement, g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height); g.shadowBlur = 0;
    g.fillStyle = bg; g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = `${font} ${Math.round(h * scale * 0.62)}px ${mono ? 'ui-monospace, Consolas, monospace' : 'system-ui, sans-serif'}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg;
    if (glow) { g.shadowColor = fg; g.shadowBlur = scale * 1.2; }
    g.fillText(text, canvas.width / 2, canvas.height / 2 + scale * 0.3);
    texture.needsUpdate = true;
  }, [texture, text, fg, bg, font, glow, mono]);
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  return <mesh position={toThree(at)}>
    <planeGeometry args={[w, h]} />
    <meshBasicMaterial map={texture} transparent toneMapped={false} />
  </mesh>;
}, sameProps);

/** How a part the mode does not use is drawn: a faint cyan hologram that casts no shadow. */
const GHOST = new THREE.MeshBasicMaterial({ color: '#4fd2ff', transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

/**
 * A clickable part of the beamline, shown as a hologram when the mode does not use it. Each mesh keeps the material
 * React last gave it, so a part that changes (a new mirror coating, say) comes back with the right one.
 */
export function Part({ idle, children }: { idle: boolean; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    group.current?.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.material !== GHOST) mesh.userData.base = mesh.material;
      if (mesh.userData.cast === undefined) mesh.userData.cast = mesh.castShadow;
      mesh.material = idle ? GHOST : mesh.userData.base;
      mesh.castShadow = !idle && mesh.userData.cast;
    });
  });
  return <group ref={group}>{children}</group>;
}
