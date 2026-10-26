/**
 * Where things sit in the 3D hutch: the point on each part its label points at, where the label floats,
 * and where the camera looks for each mode. Pure data and arithmetic, so it is unit tested in Node.
 *
 * World coordinates are the diagram's (scene-kit): X along the beam, Y up from the table top (the floor is
 * at Y = -70, so the beam axis at Y = 66 is 1.36 m above the floor), Z away from the viewer. One unit is a centimetre. three.js has Z towards the viewer, so a point sits at (X, Y, -Z).
 */
import type { TwinMode } from '@/lib/twin/types';
import { YB, type V3 } from '../scene-kit';
import { PARTS, XS, YB0, sceneFor, type PartId } from './hutch-parts';

export type { V3 };
export const FLOOR = -70;
/** The experiment table, centimetres: 3.6 m by 1.2 m. */
export const TABLE = { x0: 990, x1: 1350, z: 60 } as const;

/** A world point in three.js coordinates. */
export const toThree = ([x, y, z]: V3): V3 => [x, y, -z];

/** The point on the hardware each label's leader line reaches, on a face the camera sees. */
export const TIP3: Record<PartId, V3> = {
  source: [100, YB0 + 30, -30],
  'front-end-slits': [250, YB0 + 10, -16],
  'collimating-mirror': [398, YB0 - 2, -34],
  monochromator: [560, 98, -40],
  'first-crystal': [512, YB0, 0],
  'second-crystal': [556, YB, 0],
  'focusing-mirror': [726, YB - 2, -34],
  'harmonic-rejection-mirror': [840, YB - 2, -30],
  'experiment-slits': [1006, YB + 9, -9],
  'helium-path': [1050, YB + 3, -3],
  i0: [1106.5, 76, -9],
  'sample-stage': [XS, 6, -9],
  'sample-environment': [XS, YB + 3.5, -3],
  'drain-current': [1136, FLOOR + 24, -80],
  'fluorescence-detector': [XS, YB + 9, 72],
  it: [1196, 76, -9],
  'reference-foil': [1228, YB + 8, -8],
  iref: [1258, 76, -9],
  'beam-stop': [1295, YB + 5, -5],
};

/** Labels float above their part on the diagram's four shelves, packed closer so the top shelf stays in a close-up of
    the real-size hardware; the two parts below the table have theirs on the floor in front. */
export const SHELF_GAP = 20.4;
/** The experiment parts sit closer together on the 3D table than in the diagram, so their labels follow them. */
const LABEL_X3: Partial<Record<PartId, number>> = { 'experiment-slits': 1006, 'helium-path': 1050, i0: 1106, it: 1196, 'reference-foil': 1228, iref: 1258, 'beam-stop': 1300 };
export const LABEL3: Record<PartId, V3> = Object.fromEntries(PARTS.map(p => { const x = LABEL_X3[p.id] ?? p.at[0]; return [p.id,
  p.at[1] > 300 ? [x, FLOOR + 30, -130] : [x, 104 + (80 - p.at[1]) * SHELF_GAP / 34, 0]]; })) as Record<PartId, V3>;

export interface Frame { target: V3; position: V3 }

/** The close-up of a mode: what width and height of the scene it fits (centimetres), and where it looks. */
export const CLOSE_UP = { wide: 450, narrow: 330, height: 280, y: 56 } as const;

/** The camera's vertical field of view, degrees. A long lens keeps the hardware from looking distorted. */
export const FOV = 30;
/** Camera direction from the target: a little to the left of square on, and looking slightly down. */
const AZIMUTH = -12 * Math.PI / 180, ELEVATION = 17 * Math.PI / 180;

/** Mean X of the parts a mode is about. */
export const focusX3 = (mode: TwinMode) => { const xs = sceneFor(mode).emphasis.map(id => TIP3[id][0]); return xs.reduce((a, b) => a + b, 0) / xs.length; };

/**
 * Where the camera stands, in world coordinates: a close-up wide enough for the mode's parts and their
 * neighbours (narrower in a tall box, such as a phone's, so the labels keep their spacing), or the whole
 * beamline. The distance fits both the width and the height of the box.
 */
export function frameFor(mode: TwinMode, whole: boolean, aspect: number): Frame {
  const target: V3 = whole ? [780, 20, 20] : [focusX3(mode), CLOSE_UP.y, 10];
  const width = whole ? 1700 : aspect < 1.6 ? CLOSE_UP.narrow : CLOSE_UP.wide, height = whole ? 380 : CLOSE_UP.height;
  const t = Math.tan(FOV / 2 * Math.PI / 180);
  const d = Math.max(width / 2 / (t * Math.max(aspect, 0.3)), height / 2 / t);
  const dir: V3 = [Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), -Math.cos(AZIMUTH) * Math.cos(ELEVATION)];
  return { target, position: [target[0] + d * dir[0], target[1] + d * dir[1], target[2] + d * dir[2]] };
}

/** The idle sway: after a few seconds without input the view swings slowly left and right about its target, easing in. */
export const SWAY = { idle_ms: 5000, ramp_ms: 3000, amplitude_deg: 6, period_ms: 20000 } as const;

/** The sway angle, radians, after idle_ms without input: zero at first, then a slow sine that grows to its full swing. */
export function swayAngle(idle_ms: number): number {
  const t = idle_ms - SWAY.idle_ms; if (t <= 0) return 0;
  const r = Math.min(1, t / SWAY.ramp_ms), grow = r * r * (3 - 2 * r);
  return SWAY.amplitude_deg * Math.PI / 180 * grow * Math.sin(2 * Math.PI * t / SWAY.period_ms);
}

/** Keeps a projected point inside the box (a label by its half width), so a part out of view is still a button at the nearest edge. */
export function clampToBox(x: number, y: number, w: number, h: number, margin = 14, mx = margin): { x: number; y: number; outside: boolean } {
  const cx = Math.min(w - mx, Math.max(mx, x)), cy = Math.min(h - margin, Math.max(margin, y));
  return { x: cx, y: cy, outside: cx !== x || cy !== y };
}
