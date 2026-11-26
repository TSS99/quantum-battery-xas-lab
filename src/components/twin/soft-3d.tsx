'use client';
/**
 * The soft X-ray beamline in 3D (step 11 of docs/PLAN-quantum.md): undulator, collimating mirror, plane grating
 * monochromator, focusing mirror, exit slit, refocusing mirrors, gold mesh and the ultra high vacuum end station with
 * its two detectors, at the positions of soft-parts.ts (9 m, compressed from a real line's 30 to 50 m). The grating and
 * its plane mirror turn to the energy, the exit slit jaws open to the resolving power, and the detector the
 * measurement reads is lit. Every label is a button that opens the part's card.
 */
import { Suspense, memo, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Blk, CylX, CylY, Part, Tube, useMaterials, type Mats } from './hutch-3d-kit';
import { SOFT_PARTS, SOFT_Y, exitSlitGap_um, gratingAngles, placeLabels, softActive, type LabelSpot, type SoftPartId, type SoftSettings } from './soft-parts';

const FLOOR = -70;
const Y = SOFT_Y;
const R = 40;  // end station sphere radius, cm
/** Where each label's button floats, cm: in three tiers so that a wide view names every part without overlaps. */
const LOW = Y + 38, MID = Y + 84, HIGH = Y + 130;
const LABEL: Record<SoftPartId, [number, number, number]> = {
  undulator: [90, LOW, 0], 'front-end': [260, MID, 0], m1: [340, LOW, 0], pgm: [470, MID, 0], m3: [600, LOW, 0],
  'exit-slit': [680, MID, 0], kb: [760, LOW, 0], mesh: [820, MID, 0], chamber: [900, HIGH, 0],
  sample: [880, Y + 6, 60], drain: [961, FLOOR + 58, 41], sdd: [800, Y - 35, 110],
};
const glow = new THREE.MeshBasicMaterial({ color: '#ffc46b', transparent: true, opacity: 0.9 });

function Stand({ m, x, top }: { m: Mats; x: number; top: number }) {
  return <CylY x={x} y0={FLOOR} y1={top} r={3} m={m.paint} />;
}

/** A vacuum tank with its ion pump underneath. */
function Tank({ m, x0, x1, h, z = 24 }: { m: Mats; x0: number; x1: number; h: number; z?: number }) {
  const c = (x0 + x1) / 2;
  return <group>
    <Blk x0={x0} x1={x1} y0={Y - h} y1={Y + h} z0={-z} z1={z} m={m.steel} />
    <Blk x0={c - 9} x1={c + 9} y0={Y - h - 28} y1={Y - h} z0={-9} z1={9} m={m.dark} />
    <Stand m={m} x={c} top={Y - h - 28} />
  </group>;
}

const World = memo(function World({ settings }: { settings: SoftSettings }) {
  const m = useMaterials(false);
  const { alpha_deg, mirror_grazing_deg } = useMemo(() => gratingAngles(settings.energy_eV), [settings.energy_eV]);
  // The exit slit is tens of micrometres: its jaws are drawn a thousand times wider apart so the change shows.
  const gap = exitSlitGap_um(settings.resolvingPower) * 1e-4 * 1000;
  const lit = (id: SoftPartId) => softActive(id, settings.detection);
  return <group>
    <Environment map={m.pano} environmentIntensity={0.5} />
    <hemisphereLight args={['#dfe8ff', '#2a2f38', 0.7]} />
    <directionalLight position={[500, 800, 600]} intensity={1.6} castShadow />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[480, FLOOR, 0]} receiveShadow material={m.floor}><planeGeometry args={[1400, 700]} /></mesh>
    <mesh position={[480, FLOOR + 200, -300]} material={m.wall}><planeGeometry args={[1400, 400]} /></mesh>
    <Part idle={false}>
      <Blk x0={0} x1={200} y0={Y + 2} y1={Y + 16} z0={-12} z1={12} m={m.magnet} />
      <Blk x0={0} x1={200} y0={Y - 16} y1={Y - 2} z0={-12} z1={12} m={m.magnet} />
      <Blk x0={-10} x1={210} y0={Y - 44} y1={Y - 16} z0={-18} z1={18} m={m.paint} />
      <Stand m={m} x={30} top={Y - 44} /><Stand m={m} x={170} top={Y - 44} />
    </Part>
    <CylX x0={210} x1={900 - R + 2} y={Y} r={3} m={m.steel} />
    {[230, 640, 800].map(x => <Blk key={x} x0={x - 5} x1={x + 5} y0={Y - 10} y1={Y + 16} z0={-8} z1={8} m={m.alu} />)}
    <Blk x0={250} x1={270} y0={Y - 14} y1={Y + 14} z0={-14} z1={14} m={m.steel} />
    <Tank m={m} x0={320} x1={360} h={20} />
    {/* The monochromator: the plane mirror and the grating on its lid, turned to the energy. */}
    <Tank m={m} x0={420} x1={520} h={28} z={34} />
    <mesh position={[445, Y + 30, 0]} rotation={[0, 0, -mirror_grazing_deg * Math.PI / 180]} material={m.silicon} castShadow><boxGeometry args={[40, 3, 18]} /></mesh>
    <mesh position={[495, Y + 30, 0]} rotation={[0, 0, (90 - alpha_deg) * Math.PI / 180]} material={m.coatings.Pt} castShadow><boxGeometry args={[40, 3, 18]} /></mesh>
    <Tank m={m} x0={580} x1={620} h={20} />
    <Blk x0={670} x1={690} y0={Y - 18} y1={Y + 18} z0={-16} z1={16} m={m.alu} />
    <Blk x0={674} x1={686} y0={Y + gap / 2} y1={Y + gap / 2 + 9} z0={-17} z1={17} m={m.tungsten} />
    <Blk x0={674} x1={686} y0={Y - gap / 2 - 9} y1={Y - gap / 2} z0={-17} z1={17} m={m.tungsten} />
    <Stand m={m} x={680} top={Y - 18} />
    <Tank m={m} x0={745} x1={775} h={16} />
    <Blk x0={818} x1={822} y0={Y - 9} y1={Y + 9} z0={-9} z1={9} m={m.brass} />
    {/* The end station: the sphere under ultra high vacuum, the manipulator from the top, the load lock behind. */}
    <mesh position={[900, Y, 0]} castShadow material={m.steel}><sphereGeometry args={[R, 48, 32]} /></mesh>
    <CylY x={900} y0={Y + R - 4} y1={Y + R + 70} r={6} m={m.steel} />
    <CylX x0={900 + R - 4} x1={1010} y={Y} r={9} m={m.alu} />
    <Stand m={m} x={900} top={Y - R} />
    <Part idle={!lit('sdd')}>
      <mesh position={[900, Y, 75]} rotation={[Math.PI / 2, 0, 0]} material={m.alu} castShadow><cylinderGeometry args={[7, 7, 70, 24]} /></mesh>
      <Blk x0={888} x1={912} y0={Y - 12} y1={Y + 12} z0={110} z1={128} m={m.dark} />
    </Part>
    <Part idle={!lit('drain')}>
      <Tube points={[[900, Y - R + 4, 10], [930, Y - 70, 30], [960, FLOOR + 32, 40]]} r={1} m={m.cable} />
      <Blk x0={946} x1={976} y0={FLOOR + 20} y1={FLOOR + 42} z0={30} z1={52} m={m.dark} />
    </Part>
    <mesh position={[455, Y, 0]} rotation={[0, 0, Math.PI / 2]} material={glow}><cylinderGeometry args={[1.6, 1.6, 890, 12]} /></mesh>
  </group>;
});

const TARGET = new THREE.Vector3(470, 30, 0);
const VIEW_FROM = new THREE.Vector3(-30, 220, 880).normalize();

/** Back the camera off until the 10 m of hardware fit the canvas width, so a phone sees the whole line too. */
function Frame() {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const halfWidth = Math.tan(perspective.fov * Math.PI / 360) * size.width / size.height;
    camera.position.copy(TARGET).addScaledVector(VIEW_FROM, 560 / halfWidth);
    camera.lookAt(TARGET);
    invalidate();
  }, [camera, size.width, size.height, invalidate]);
  return null;
}

/**
 * Moves each label button to its part's place on the screen after every frame drawn, as the hard hutch does. Labels
 * stay inside the view, and one that would cover another becomes a marker dot (placeLabels in soft-parts.ts).
 */
function Projector({ labels, open, detection }: { labels: MutableRefObject<Partial<Record<SoftPartId, HTMLButtonElement | null>>>; open: SoftPartId | null; detection: SoftSettings['detection'] }) {
  const { camera, size, invalidate } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  const widths = useRef(new Map<SoftPartId, number>());
  useEffect(() => { invalidate(); }, [open, detection, invalidate]);
  useFrame(() => {
    const spots: LabelSpot[] = [];
    for (const p of SOFT_PARTS) {
      const el = labels.current[p.id];
      if (!el) continue;
      v.set(...LABEL[p.id]).project(camera);
      if (v.z > 1) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = 'visible';
      // Measured once with the name showing; a marker is narrower, so it would be measured wrong later.
      if (!widths.current.has(p.id) && !el.hasAttribute('data-marker')) widths.current.set(p.id, el.offsetWidth);
      spots.push({ id: p.id, x: (v.x + 1) / 2 * size.width, y: (1 - v.y) / 2 * size.height, half: (widths.current.get(p.id) ?? 60) / 2 });
    }
    for (const [id, at] of placeLabels(spots, size.width, size.height, open, detection)) {
      const el = labels.current[id]!;
      el.style.transform = `translate(-50%, -50%) translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      el.toggleAttribute('data-marker', at.marker);
    }
  });
  return null;
}

export default function Soft3D({ settings, open, onPart }: { settings: SoftSettings; open: SoftPartId | null; onPart: (id: SoftPartId | null) => void }) {
  const labels = useRef<Partial<Record<SoftPartId, HTMLButtonElement | null>>>({});
  return <div className="soft-canvas" role="group" aria-label="Soft X-ray beamline in 3D: pick a part for its card">
    <Canvas shadows dpr={[1, 2]} frameloop="demand" camera={{ fov: 40, near: 10, far: 9000, position: [440, 250, 880] }}>
      <Suspense fallback={null}><World settings={settings} /></Suspense>
      <Frame />
      <Projector labels={labels} open={open} detection={settings.detection} />
      <OrbitControls target={[470, 30, 0]} enableDamping={false} minDistance={250} maxDistance={2600} maxPolarAngle={Math.PI / 2 - 0.05} />
    </Canvas>
    {SOFT_PARTS.map(p => <button key={p.id} ref={el => { labels.current[p.id] = el; }} type="button" title={p.name}
      className={'soft-label' + (open === p.id ? ' is-open' : '') + (softActive(p.id, settings.detection) ? '' : ' is-idle')}
      aria-label={p.name} aria-expanded={open === p.id} aria-controls={open === p.id ? 'soft-card' : undefined}
      onClick={() => onPart(open === p.id ? null : p.id)}>{p.short}</button>)}
  </div>;
}
