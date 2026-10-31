'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { DataTexture, DoubleSide, LinearFilter, RGBAFormat, type Group } from 'three';
import { slicePlane, wavePhasor, type WaveCurves } from '@/lib/twin/wave-field';
import { ATOMS } from '../atoms';

const GRID = 160;
const CREST = [140, 227, 255], TROUGH = [255, 150, 80];
/** One drawn wave period every two seconds: the electron's real frequency is far beyond any drawing. */
const DRAWN_HZ = 0.5;
/** Atom colours (Jmol's scheme where it reads on the dark stage); the absorber is white. */
const COLOR: Record<string, string> = { O: '#ff5a4a', S: '#f2d24b', Cu: '#d0875a', Ni: '#9fc7a1', Co: '#8fa8e6', Fe: '#e0915a', Mn: '#b08ad8', Pt: '#dcdcdc', Au: '#e8c25a', Zn: '#8f93c9', Ti: '#c0c5cc', Cr: '#93a6c9', Li: '#c88ff0', P: '#ff9a3c', C: '#9aa0a6' };

export interface Neighbour { element: string; xyz: [number, number, number] }

/**
 * The photoelectron wave in 3D: the real neighbours of the absorber (the FEFF cluster), and the computed wave
 * (wave-field.ts, FEFF's amplitude, phases and mean free path) on a see-through sheet through the absorber and as many
 * neighbours as share a plane, like ripples on a pond. Neighbours above and below the sheet echo onto it from their
 * true distance. With `ring`, a ring round the absorber shows how the echoes meet it: cyan in step, orange out of step.
 */
export default function Wave3D({ absorber, neighbours, k, curves, echoes, ring, label }: {
  absorber: string; neighbours: Neighbour[]; k: number; curves: WaveCurves; echoes: boolean; ring: number | null; label: string;
}) {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    try { setWebgl(!!document.createElement('canvas').getContext('webgl2')); } catch { setWebgl(false); }
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);
  const reach = Math.max(1.5, ...neighbours.map(n => Math.hypot(...n.xyz))) * 1.75;
  return <div className="story-stage" role="img" aria-label={label} data-still={reduced || undefined}>
    {webgl && <Canvas dpr={[1, 2]} camera={{ position: [0, reach * 1.15, reach * 1.95], fov: 40 }} gl={{ antialias: true, alpha: true }}
      onCreated={({ camera }) => camera.lookAt(0, -reach * 0.08, 0)}>
      <hemisphereLight args={['#e6eeff', '#1a2233', 1.2]} />
      <directionalLight position={[3, 8, 5]} intensity={2.4} />
      <Pond absorber={absorber} neighbours={neighbours} k={k} curves={curves} echoes={echoes} ring={ring} reach={reach} reduced={reduced} />
    </Canvas>}
    {webgl === false && <p className="spectrum-empty">This picture needs WebGL.</p>}
  </div>;
}

function Pond({ absorber, neighbours, k, curves, echoes, ring, reach, reduced }: {
  absorber: string; neighbours: Neighbour[]; k: number; curves: WaveCurves; echoes: boolean; ring: number | null; reach: number; reduced: boolean;
}) {
  // The sheet's axes, and every neighbour in them: x, y in the sheet, z its height off it.
  const placed = useMemo(() => {
    const { u, v, n } = slicePlane(neighbours.map(a => a.xyz));
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return neighbours.map(a => ({ element: a.element, x: dot(a.xyz, u), y: dot(a.xyz, v), z: dot(a.xyz, n) }));
  }, [neighbours]);
  const texture = useMemo(() => {
    const t = new DataTexture(new Uint8Array(GRID * GRID * 4), GRID, GRID, RGBAFormat);
    t.magFilter = t.minFilter = LinearFilter;
    return t;
  }, []);
  // The field's two parts on the grid, once per k: the frame only mixes them.
  const parts = useMemo(() => {
    const phasor = wavePhasor(k, echoes ? placed : [], curves);
    const cos = new Float32Array(GRID * GRID), sin = new Float32Array(GRID * GRID), fade = new Float32Array(GRID * GRID);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const x = -reach + (i + 0.5) / GRID * 2 * reach, y = -reach + (j + 0.5) / GRID * 2 * reach, [c, s] = phasor(x, y);
      cos[j * GRID + i] = c; sin[j * GRID + i] = s;
      // A round sheet that fades out over its last quarter, like the edge of a pond.
      fade[j * GRID + i] = Math.min(1, Math.max(0, (reach - Math.hypot(x, y)) / (0.25 * reach)));
    }
    // Brightness set by the outgoing wave halfway to the neighbours: the core saturates, the echoes stay visible.
    const R = Math.min(...placed.map(p => Math.hypot(p.x, p.y, p.z))), half = R / 2;
    return { cos, sin, fade, gain: 1.3 * half / Math.exp(-half / curves.lambda) };
  }, [k, echoes, placed, curves, reach]);
  const spin = useRef<Group>(null);
  const start = useRef<number | null>(null);
  useFrame(({ clock }, dt) => {
    if (start.current === null) start.current = clock.elapsedTime;
    const wt = reduced ? 0 : 2 * Math.PI * DRAWN_HZ * (clock.elapsedTime - start.current);
    if (spin.current && !reduced) spin.current.rotation.y += dt * 0.08;
    const data = texture.image.data as Uint8Array, cw = Math.cos(wt), sw = Math.sin(wt);
    for (let p = 0; p < GRID * GRID; p++) {
      const value = Math.tanh((parts.cos[p] * cw + parts.sin[p] * sw) * parts.gain), to = value > 0 ? CREST : TROUGH, q = 4 * p;
      data[q] = to[0]; data[q + 1] = to[1]; data[q + 2] = to[2]; data[q + 3] = Math.round(235 * parts.fade[p] * Math.abs(value) ** 0.85);
    }
    texture.needsUpdate = true;
  });
  const radius = (el: string) => 0.3 * (ATOMS[el]?.radius_A ?? 1.3);
  const ringColor = ring === null ? null : ring > 0.3 ? '#8ce3ff' : ring < -0.3 ? '#ff9650' : '#a7b1c1';
  return <group ref={spin}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[2 * reach, 2 * reach]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} side={DoubleSide} />
    </mesh>
    <mesh>
      <sphereGeometry args={[radius(absorber) * 1.1, 32, 20]} />
      <meshStandardMaterial color="#f3f6fa" roughness={0.3} metalness={0.2} emissive="#8ce3ff" emissiveIntensity={0.35} />
    </mesh>
    {ringColor && <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius(absorber) * 1.1 + 0.3, 0.09, 12, 64]} />
      <meshBasicMaterial color={ringColor} />
    </mesh>}
    {echoes && placed.map((p, i) => <mesh key={i} position={[p.x, p.z, -p.y]}>
      <sphereGeometry args={[radius(p.element), 28, 18]} />
      <meshStandardMaterial color={COLOR[p.element] ?? '#b0b8c4'} roughness={0.35} metalness={0.35} />
    </mesh>)}
  </group>;
}
