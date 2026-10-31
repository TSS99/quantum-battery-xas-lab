'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { AdditiveBlending, CanvasTexture, Color, type Group, type Mesh, type PointsMaterial, type ShaderMaterial } from 'three';
import type { Line2 } from 'three-stdlib';
import { atomCloud } from '@/lib/twin/atom-cloud';

/** Drawn radius of the outermost layer, and the power that squeezes radii so the innermost layer stays visible. */
const SIZE = 2.1, SQUEEZE = 0.35;
const WAVE = 0.55, BEAM_FROM = -7.5, BEAM_POINTS = 160;

/** A soft round dot for the electron points. */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** The X-ray's wave along x, from far left to `to`, at time phase `phase`. */
function wave(from: number, to: number, phase: number) {
  const out: number[] = [];
  for (let i = 0; i < BEAM_POINTS; i++) {
    const x = from + (to - from) * i / (BEAM_POINTS - 1);
    out.push(x, 0.13 * Math.sin(2 * Math.PI * x / WAVE - phase), 0);
  }
  return out;
}

const RIM_VERTEX = 'varying float rim; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); rim = 1.0 - abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }';
const RIM_FRAGMENT = 'uniform vec3 color; uniform float opacity; varying float rim; void main() { gl_FragColor = vec4(color, opacity * pow(rim, 7.0)); }';
/** Three ripples a third of a period apart. */
const RIPPLES = [0, 1 / 3, 2 / 3];

/**
 * One atom in 3D: its electrons as a cloud (atom-cloud.ts: real sizes from Slater's rules, drawn on a squeezed radius
 * so the innermost layer shows), the X-ray coming in from the left, and when it has enough energy, the electron leaving
 * the layer the edge belongs to as an outgoing wave, while that layer dims by one electron's share.
 */
export default function Atom3D({ Z, kEdge, free, label, charge = 0, beam = true }: {
  Z: number; kEdge: boolean; free: boolean; label: string; charge?: number; beam?: boolean;
}) {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    try { setWebgl(!!document.createElement('canvas').getContext('webgl2')); } catch { setWebgl(false); }
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);
  return <div className="story-stage" role="img" aria-label={label} data-still={reduced || undefined}>
    {webgl && <Canvas dpr={[1, 2]} camera={{ position: [0, 1.3, 8.2], fov: 36 }} gl={{ antialias: true, alpha: true }}>
      <AtomScene Z={Z} kEdge={kEdge} free={free} reduced={reduced} charge={charge} beam={beam} />
    </Canvas>}
    {webgl === false && <p className="spectrum-empty">This picture needs WebGL.</p>}
  </div>;
}

function AtomScene({ Z, kEdge, free, reduced, charge, beam }: { Z: number; kEdge: boolean; free: boolean; reduced: boolean; charge: number; beam: boolean }) {
  const sprite = useMemo(() => dotTexture(), []);
  const layers = useMemo(() => {
    const cloud = atomCloud(Z, Z > 60 ? 120 : 220, 7, charge);
    // Drawn on the neutral atom's scale, so an ion shows smaller.
    const outer = Math.max(...atomCloud(Z, 1).map(s => s.meanR_A));
    const edge = cloud.findIndex(s => kEdge ? s.n === 1 : s.n === 2 && s.l === 1);
    return cloud.map((s, i) => {
      const drawn = new Float32Array(s.points.length);
      for (let j = 0; j < s.points.length; j += 3) {
        const r = Math.hypot(s.points[j], s.points[j + 1], s.points[j + 2]) || 1e-9, f = SIZE * (r / outer) ** SQUEEZE / r;
        drawn[j] = s.points[j] * f; drawn[j + 1] = s.points[j + 1] * f; drawn[j + 2] = s.points[j + 2] * f;
      }
      // The edge layer: one electron's share of its points is the electron that leaves.
      const keep = i === edge ? drawn.length - 3 * Math.round(drawn.length / 3 / s.electrons) : drawn.length;
      const inner = s.n <= (kEdge ? 1 : 2);
      return { stay: drawn.slice(0, keep), leave: drawn.slice(keep), color: i === edge ? '#f0fcff' : inner ? '#bfeeff' : '#5fb8e6',
        size: i === edge ? 0.12 : inner ? 0.09 : 0.13, opacity: i === edge ? 1 : inner ? 0.75 : Math.max(0.28, 0.62 - 0.08 * s.n) };
    });
  }, [Z, kEdge, charge]);
  const spin = useRef<Group>(null), leaving = useRef<PointsMaterial>(null);
  const incoming = useRef<Line2>(null), passing = useRef<Line2>(null);
  const ripples = useRef<(Mesh | null)[]>([]), rippleMaterials = useRef<(ShaderMaterial | null)[]>([]);
  const uniforms = useMemo(() => RIPPLES.map(() => ({ color: { value: new Color('#8ce3ff') }, opacity: { value: 0 } })), []);
  useFrame((state, dt) => {
    const t = reduced ? 0 : state.clock.elapsedTime;
    if (spin.current && !reduced) spin.current.rotation.y += dt * 0.18;
    if (leaving.current) {
      const target = free ? 0 : 0.9;
      leaving.current.opacity = reduced ? target : leaving.current.opacity + (target - leaving.current.opacity) * Math.min(1, dt * 5);
    }
    const phase = 2 * Math.PI * t * 0.9;
    incoming.current?.geometry.setPositions(wave(BEAM_FROM, free ? -0.04 : 0, phase));
    passing.current?.geometry.setPositions(wave(0, -BEAM_FROM, phase));
    if (passing.current) passing.current.visible = !free;
    // The freed electron as an outgoing wave: thin shells that grow from the core and fade, one after another.
    RIPPLES.forEach((offset, i) => {
      const grow = ((reduced ? 0.2 : t / 2.4) + offset) % 1;
      ripples.current[i]?.scale.setScalar(0.2 + grow * 3.4);
      const m = rippleMaterials.current[i];
      if (m) m.uniforms.opacity.value = free ? 0.55 * (1 - grow) ** 1.5 : 0;
    });
  });
  return <>
    <group ref={spin}>
      {layers.map((layer, i) => <group key={i}>
        <points>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[layer.stay, 3]} /></bufferGeometry>
          <pointsMaterial map={sprite} color={layer.color} size={layer.size} sizeAttenuation transparent opacity={layer.opacity} depthWrite={false} blending={AdditiveBlending} />
        </points>
        {layer.leave.length > 0 && <points>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[layer.leave, 3]} /></bufferGeometry>
          <pointsMaterial ref={leaving} map={sprite} color={layer.color} size={layer.size} sizeAttenuation transparent opacity={0.9} depthWrite={false} blending={AdditiveBlending} />
        </points>}
      </group>)}
      <mesh><sphereGeometry args={[0.045, 16, 12]} /><meshBasicMaterial color="#fff6e8" /></mesh>
      <sprite scale={[0.95, 0.95, 1]}><spriteMaterial map={sprite} color="#dff7ff" transparent opacity={0.85} depthWrite={false} blending={AdditiveBlending} /></sprite>
    </group>
    {beam && <Line ref={incoming} points={wave(BEAM_FROM, 0, 0)} color="#ffc46b" lineWidth={2.6} />}
    {beam && <Line ref={passing} points={wave(0, -BEAM_FROM, 0)} color="#ffc46b" lineWidth={2.6} transparent opacity={0.4} />}
    {RIPPLES.map((_, i) => <mesh key={i} ref={el => { ripples.current[i] = el; }}>
      <sphereGeometry args={[1, 48, 32]} />
      <shaderMaterial ref={el => { rippleMaterials.current[i] = el; }} vertexShader={RIM_VERTEX} fragmentShader={RIM_FRAGMENT} uniforms={uniforms[i]} transparent depthWrite={false} blending={AdditiveBlending} />
    </mesh>)}
  </>;
}
