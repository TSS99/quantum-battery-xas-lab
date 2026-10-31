'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { AdditiveBlending, CanvasTexture, type InstancedMesh, Object3D } from 'three';

/** The look of each story sample's surface. */
const SURFACE: Record<string, { color: string; metalness: number; roughness: number }> = {
  cu: { color: '#c87f4f', metalness: 0.85, roughness: 0.32 },
  cuo: { color: '#1f1d1c', metalness: 0.1, roughness: 0.85 },
  pt: { color: '#d6d4d0', metalness: 0.9, roughness: 0.25 },
  fe2o3: { color: '#7a3020', metalness: 0.05, roughness: 0.9 },
  licoo2: { color: '#3a3d42', metalness: 0.2, roughness: 0.7 },
  mno2: { color: '#2a2826', metalness: 0.15, roughness: 0.8 },
  au: { color: '#e2b75a', metalness: 0.95, roughness: 0.25 },
};
/** Other samples: a grey metal for a pure element, a dark pressed powder for a compound. */
const METAL = { color: '#b9bec5', metalness: 0.85, roughness: 0.3 }, POWDER = { color: '#3a3d42', metalness: 0.2, roughness: 0.7 };
/** The holder's four bars round the sample: y, z, height, depth. */
const HOLDER = [[0.68, 0, 0.26, 1.62], [-0.68, 0, 0.26, 1.62], [0, 0.68, 1.1, 0.26], [0, -0.68, 1.1, 0.26]];
const PHOTONS = 36, SPEED = 3.2, FROM = -5.2, FOIL = 0, TO = 4.1;

/** A soft glow for the photons. */
function glow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,200,1)'); grad.addColorStop(0.3, 'rgba(255,196,107,.6)'); grad.addColorStop(1, 'rgba(255,196,107,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/**
 * The measurement in 3D: the beam leaves the beamline pipe, crosses the sample in its holder and enters the detector.
 * Each photon draws a random number when it reaches the sample and is absorbed there if it falls above the share that
 * gets through, so the stream after the sample thins by exactly the fraction the counter shows.
 */
export default function Setup3D({ material, through, label }: { material: string; through: number; label: string }) {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    try { setWebgl(!!document.createElement('canvas').getContext('webgl2')); } catch { setWebgl(false); }
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);
  return <div className="story-stage is-wide" role="img" aria-label={label} data-still={reduced || undefined}>
    {webgl && <Canvas dpr={[1, 2]} camera={{ position: [2.6, 3.0, 9.6], fov: 34 }} gl={{ antialias: true, alpha: true }} onCreated={({ camera }) => camera.lookAt(0.5, -0.35, 0)}>
      <hemisphereLight args={['#dfe9ff', '#1a2233', 1.1]} />
      <directionalLight position={[3, 6, 5]} intensity={2.6} />
      <directionalLight position={[-5, 2, -3]} intensity={0.9} color="#9fb6ff" />
      <pointLight position={[0.6, 0.4, 1.2]} intensity={4} distance={4} color="#ffc46b" />
      <Bench material={material} through={through} reduced={reduced} />
    </Canvas>}
    {webgl === false && <p className="spectrum-empty">This picture needs WebGL.</p>}
  </div>;
}

function Bench({ material, through, reduced }: { material: string; through: number; reduced: boolean }) {
  const surface = SURFACE[material] ?? (/^[a-z]{1,2}$|-bcc$/.test(material) ? METAL : POWDER);
  const sprite = useMemo(() => glow(), []);
  const photons = useRef<InstancedMesh>(null);
  // Each photon's place along the beam (0 to 1 of a lap) and its draw at the sample.
  const state = useMemo(() => Array.from({ length: PHOTONS }, (_, i) => ({ at: i / PHOTONS, draw: Math.random() })), []);
  const dummy = useMemo(() => new Object3D(), []);
  useFrame(({ camera }, dt) => {
    const mesh = photons.current;
    if (!mesh) return;
    state.forEach((p, i) => {
      if (!reduced) {
        p.at += dt * SPEED / (TO - FROM);
        if (p.at >= 1) { p.at -= 1; p.draw = Math.random(); }
      }
      const x = FROM + p.at * (TO - FROM);
      const gone = x > FOIL + 0.05 && p.draw > through;
      dummy.position.set(x, 0, 0);
      dummy.quaternion.copy(camera.quaternion);
      dummy.scale.setScalar(gone ? 0 : 0.42);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <group>
    {/* The beamline pipe, with its flange */}
    <mesh position={[FROM - 0.9, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.32, 0.32, 1.8, 40]} />
      <meshStandardMaterial color="#9aa3ad" metalness={0.8} roughness={0.35} />
    </mesh>
    <mesh position={[FROM, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.5, 0.5, 0.12, 40]} />
      <meshStandardMaterial color="#b9c1ca" metalness={0.85} roughness={0.3} />
    </mesh>
    {/* The beam: a faint glowing rod, brighter before the sample than after it */}
    <mesh position={[(FROM + FOIL) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.035, 0.035, FOIL - FROM, 12]} />
      <meshBasicMaterial color="#ffc46b" transparent opacity={0.55} />
    </mesh>
    <mesh position={[(FOIL + TO) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.035, 0.035, TO - FOIL, 12]} />
      <meshBasicMaterial color="#ffc46b" transparent opacity={0.1 + 0.45 * through} />
    </mesh>
    <instancedMesh ref={photons} args={[undefined, undefined, PHOTONS]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={sprite} transparent depthWrite={false} blending={AdditiveBlending} />
    </instancedMesh>
    {/* The sample: a thin square in an aluminium holder on a post */}
    <group position={[FOIL, 0, 0]}>
      <mesh><boxGeometry args={[0.03, 1.1, 1.1]} /><meshStandardMaterial {...surface} /></mesh>
      {HOLDER.map(([y, z, height, depth], i) => <mesh key={i} position={[0, y, z]}>
        <boxGeometry args={[0.1, height, depth]} /><meshStandardMaterial color="#aeb6bf" metalness={0.7} roughness={0.4} />
      </mesh>)}
      <mesh position={[0, -1.55, 0]}><cylinderGeometry args={[0.07, 0.07, 1.5, 16]} /><meshStandardMaterial color="#8d959e" metalness={0.8} roughness={0.35} /></mesh>
    </group>
    {/* The detector: a gas filled chamber with thin windows at each end */}
    <RoundedBox args={[2.2, 1.15, 1.15]} radius={0.08} position={[TO + 1.1, 0, 0]}>
      <meshStandardMaterial color="#2c3440" metalness={0.6} roughness={0.45} />
    </RoundedBox>
    <mesh position={[TO - 0.01, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <circleGeometry args={[0.24, 32]} />
      <meshStandardMaterial color="#c9a46a" metalness={0.3} roughness={0.5} emissive="#ffc46b" emissiveIntensity={0.25 * through} />
    </mesh>
    {/* The table */}
    <mesh position={[0, -2.32, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[40, 20]} />
      <meshStandardMaterial color="#1b2333" metalness={0.2} roughness={0.8} />
    </mesh>
  </group>;
}
