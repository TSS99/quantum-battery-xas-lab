'use client';
import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { DoubleSide, type Group } from 'three';
import { ATOMS } from '../atoms';

export interface CrystalAtom { element: string; xyz: [number, number, number]; ring: number }

/**
 * The real crystal round the absorber in 3D (the FEFF cluster), ring by ring: the rings added so far in their colours,
 * the rest faint, and the newest ring as a see-through sphere through its atoms.
 */
export default function Crystal3D({ atoms, colors, added, radius, label }: {
  atoms: CrystalAtom[]; colors: string[]; added: number; radius: number | null; label: string;
}) {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    try { setWebgl(!!document.createElement('canvas').getContext('webgl2')); } catch { setWebgl(false); }
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);
  const reach = Math.max(3, ...atoms.map(a => Math.hypot(...a.xyz)));
  return <div className="story-stage" role="img" aria-label={label} data-still={reduced || undefined}>
    {webgl && <Canvas dpr={[1, 2]} camera={{ position: [0, reach * 0.9, reach * 2.7], fov: 38 }} gl={{ antialias: true, alpha: true }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}>
      <hemisphereLight args={['#e6eeff', '#1a2233', 1.2]} />
      <directionalLight position={[4, 7, 6]} intensity={2.4} />
      <Atoms atoms={atoms} colors={colors} added={added} radius={radius} reduced={reduced} />
    </Canvas>}
    {webgl === false && <p className="spectrum-empty">This picture needs WebGL.</p>}
  </div>;
}

function Atoms({ atoms, colors, added, radius, reduced }: { atoms: CrystalAtom[]; colors: string[]; added: number; radius: number | null; reduced: boolean }) {
  const spin = useRef<Group>(null);
  useFrame((_, dt) => { if (spin.current && !reduced) spin.current.rotation.y += dt * 0.12; });
  const size = (el: string) => 0.3 * (ATOMS[el]?.radius_A ?? 1.3);
  return <group ref={spin} rotation={[0.35, 0, 0]}>
    <mesh>
      <sphereGeometry args={[size(atoms[0]?.element ?? 'Cu') * 1.1, 32, 20]} />
      <meshStandardMaterial color="#f3f6fa" roughness={0.3} metalness={0.2} emissive="#8ce3ff" emissiveIntensity={0.35} />
    </mesh>
    {atoms.slice(1).map((a, i) => {
      const lit = a.ring < added;
      return <mesh key={i} position={a.xyz}>
        <sphereGeometry args={[size(a.element) * (lit ? 1 : 0.6), 24, 16]} />
        <meshStandardMaterial color={lit ? colors[a.ring] : '#59636f'} roughness={0.35} metalness={0.3} transparent={!lit} opacity={lit ? 1 : 0.22} depthWrite={lit} />
      </mesh>;
    })}
    {radius !== null && <mesh>
      <sphereGeometry args={[radius, 48, 32]} />
      <meshBasicMaterial color={colors[added - 1]} transparent opacity={0.08} depthWrite={false} side={DoubleSide} />
    </mesh>}
  </group>;
}
