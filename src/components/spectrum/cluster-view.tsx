'use client';
import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { useReducedMotion } from 'motion/react';
import type { ClusterAtom } from '@/lib/twin/shells';
import { ATOMS } from './atoms';

/** Drawn radius as a share of the covalent radius, so neighbours a bond apart stay clearly separate. */
const RADIUS_SCALE = 0.28;
const ABSORBER = '#f3f6fa', UNUSED = '#59636f';

interface Props {
  atoms: ClusterAtom[];
  colors: Record<string, string>;
  /** Shells drawn faint until they are active: the farther atoms, which would hide the near shells. */
  faint: string[];
  /** The shell being pointed at or chosen; its atoms stay lit and the rest fade. */
  active: string | null;
  /** Polylines to draw for the active shell: absorber to each atom, or the strongest multiple scattering paths. */
  legs: [number, number, number][][];
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  label: string;
}

/** The atoms FEFF used around the absorber, coloured by the shell their paths belong to. */
export default function ClusterView({ atoms, colors, faint, active, legs, onHover, onSelect, label }: Props) {
  const reduced = useReducedMotion();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => {
    try { setWebgl(!!document.createElement('canvas').getContext('webgl2')); } catch { setWebgl(false); }
  }, []);
  const reach = Math.max(4, ...atoms.map(a => a.r_A));
  const activeColor = active ? colors[active] : undefined;
  if (webgl === false) return <p className="spectrum-empty">This view needs WebGL. The table and the plots show the same shells.</p>;
  return <div className="spectrum-cluster" role="img" aria-label={label}>
    {webgl && <Canvas dpr={[1, 2]} camera={{ position: [0, reach * 0.9, reach * 2.6], fov: 40 }} gl={{ antialias: true, alpha: true }}
      onPointerMissed={() => onHover(null)}>
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 6, 8]} intensity={2.4} />
      <directionalLight position={[-6, -2, -4]} intensity={0.6} />
      {atoms.map((a, i) => {
        const absorber = i === 0;
        const lit = absorber || (active ? a.shellId === active : !!a.shellId && !faint.includes(a.shellId));
        const color = absorber ? ABSORBER : a.shellId && colors[a.shellId] ? colors[a.shellId] : UNUSED;
        const radius = RADIUS_SCALE * (ATOMS[a.element]?.radius_A ?? 1.4) * (absorber ? 1.15 : 1);
        return <mesh key={i} position={a.xyz}
          onPointerOver={e => { e.stopPropagation(); if (!absorber) onHover(a.shellId); }}
          onPointerOut={() => onHover(null)}
          onClick={e => { e.stopPropagation(); if (!absorber && a.shellId) onSelect(a.shellId); }}>
          <sphereGeometry args={[radius, 28, 18]} />
          <meshStandardMaterial color={color} roughness={0.38} metalness={0.15} transparent opacity={lit ? 1 : active ? 0.08 : a.shellId ? 0.3 : 0.15}
            emissive={absorber ? '#8ce3ff' : color} emissiveIntensity={absorber ? 0.35 : lit && active ? 0.25 : 0.05} depthWrite={lit} />
        </mesh>;
      })}
      {activeColor && legs.map((points, i) => <Line key={i} points={points} color={activeColor} lineWidth={1.6} transparent opacity={0.75} />)}
      <OrbitControls enablePan={false} minDistance={reach * 1.2} maxDistance={reach * 5} autoRotate={!reduced && !active} autoRotateSpeed={0.5} />
    </Canvas>}
  </div>;
}
