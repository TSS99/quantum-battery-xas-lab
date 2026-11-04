'use client';
/**
 * The problem's atoms in 3D, from the coordinates the problem was built from (a crystal site's first shell, or a
 * molecule). Bonds join a nonmetal to a neighbour closer than 1.15 times the sum of their covalent radii (two metals
 * in these clusters are never bonded, though their large radii would say so); the absorbing oxygen glows.
 */
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useMemo } from 'react';

// Covalent radii (Cordero et al. 2008, A) for bonds; drawn radii are smaller so the bonds show.
const ELEMENTS: Record<string, { colour: string; covalent: number; drawn: number }> = {
  H: { colour: '#eef1f5', covalent: 0.31, drawn: 0.24 },
  Li: { colour: '#7fdca4', covalent: 1.28, drawn: 0.42 },
  C: { colour: '#9aa3ad', covalent: 0.76, drawn: 0.36 },
  O: { colour: '#ff6b6b', covalent: 0.66, drawn: 0.38 },
  Mn: { colour: '#b79cff', covalent: 1.39, drawn: 0.5 },
};
const element = (symbol: string) => ELEMENTS[symbol] ?? { colour: '#c0c7d1', covalent: 1, drawn: 0.4 };
const NONMETALS = new Set(['H', 'C', 'N', 'O', 'F', 'S', 'Cl']);

function Bond({ from, to }: { from: number[]; to: number[] }) {
  const mid = from.map((x, i) => (x + to[i]) / 2);
  const d = to.map((x, i) => x - from[i]);
  const length = Math.hypot(d[0], d[1], d[2]);
  // Rotate the cylinder's y axis onto the bond direction; a bond along y needs no turn (a cylinder is symmetric).
  const axis = [d[2], 0, -d[0]];
  const angle = Math.acos(Math.max(-1, Math.min(1, d[1] / length)));
  const norm = Math.hypot(axis[0], axis[2]);
  const turn: [number, number, number, number] = norm < 1e-9 ? [0, 0, 0, 1]
    : [axis[0] / norm * Math.sin(angle / 2), 0, axis[2] / norm * Math.sin(angle / 2), Math.cos(angle / 2)];
  return <mesh position={mid as [number, number, number]} quaternion={turn}>
    <cylinderGeometry args={[0.07, 0.07, length, 16]} />
    <meshStandardMaterial color="#8aa0b8" roughness={0.45} metalness={0.2} />
  </mesh>;
}

export default function Cluster3D({ atoms, absorber, label }: { atoms: [string, number[]][]; absorber: number; label: string }) {
  const bonds = useMemo(() => {
    const out: [number, number][] = [];
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
      const [a, pa] = atoms[i], [b, pb] = atoms[j];
      const r = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      if ((NONMETALS.has(a) || NONMETALS.has(b)) && r < 1.15 * (element(a).covalent + element(b).covalent)) out.push([i, j]);
    }
    return out;
  }, [atoms]);
  const centre = useMemo(() => [0, 1, 2].map(k => atoms.reduce((s, [, p]) => s + p[k], 0) / atoms.length), [atoms]);
  const span = Math.max(1.4, ...atoms.map(([, p]) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])));
  return <Canvas camera={{ position: [0, span * 0.9, span * 2.6], fov: 40 }} dpr={[1, 2]} aria-label={label} role="img">
    <color attach="background" args={['#0d1424']} />
    <ambientLight intensity={0.45} />
    <directionalLight position={[4, 6, 5]} intensity={1.6} />
    <directionalLight position={[-5, -2, -4]} intensity={0.5} color="#8ce3ff" />
    <group position={centre.map(x => -x) as [number, number, number]}>
      {bonds.map(([i, j]) => <Bond key={`${i}-${j}`} from={atoms[i][1]} to={atoms[j][1]} />)}
      {atoms.map(([symbol, p], i) => {
        const e = element(symbol);
        return <mesh key={i} position={p as [number, number, number]}>
          <sphereGeometry args={[e.drawn, 48, 32]} />
          <meshPhysicalMaterial color={e.colour} roughness={0.32} metalness={0.05} clearcoat={0.6} clearcoatRoughness={0.3}
            emissive={i === absorber ? '#ffc46b' : '#000000'} emissiveIntensity={i === absorber ? 0.55 : 0} />
        </mesh>;
      })}
    </group>
    <OrbitControls enablePan={false} autoRotate autoRotateSpeed={0.6} />
  </Canvas>;
}
