/**
 * Where things sit in the 3D hutch: the point on each part its label points at, where the label floats,
 * and where the camera looks for each mode. Pure data and arithmetic, so it is unit tested in Node.
 *
 * World coordinates are the diagram's (scene-kit): X along the beam, Y up from the table top (the floor is
 * at Y = -90), Z away from the viewer. three.js has Z towards the viewer, so a point sits at (X, Y, -Z).
 */
import type { TwinMode } from '@/lib/twin/types';
import { YB, type V3 } from '../scene-kit';
import { PARTS, XS, YB0, sceneFor, type PartId } from './hutch-parts';

export type { V3 };
export const FLOOR = -90;

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
  'experiment-slits': [909, YB + 14, -14],
  'helium-path': [963, YB + 9, -9],
  i0: [1050, 102, -10],
  'sample-stage': [XS - 8, 14, -22],
  'sample-environment': [XS, 86, 0],
  'drain-current': [1136, -66, -80],
  'fluorescence-detector': [XS, YB + 13, 160],
  it: [1258, 102, -10],
  'reference-foil': [1352, 76, 0],
  iref: [1420, 94, -10],
  'beam-stop': [1504, 82, -12],
};

/** Labels float above their part on the diagram's four shelves, packed closer so the top shelf stays in a close-up;
    the two parts below the table have theirs on the floor in front. */
export const LABEL3: Record<PartId, V3> = Object.fromEntries(PARTS.map(p => [p.id,
  p.at[1] > 300 ? [p.at[0], FLOOR + 30, -130] : [p.at[0], 120 + (80 - p.at[1]) * 0.9, 0]])) as Record<PartId, V3>;

export interface Frame { target: V3; position: V3 }

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
  const target: V3 = whole ? [780, 10, 20] : [focusX3(mode), 52, 10];
  const width = whole ? 1700 : aspect < 1.6 ? 400 : 560, height = whole ? 380 : 340;
  const t = Math.tan(FOV / 2 * Math.PI / 180);
  const d = Math.max(width / 2 / (t * Math.max(aspect, 0.3)), height / 2 / t);
  const dir: V3 = [Math.sin(AZIMUTH) * Math.cos(ELEVATION), Math.sin(ELEVATION), -Math.cos(AZIMUTH) * Math.cos(ELEVATION)];
  return { target, position: [target[0] + d * dir[0], target[1] + d * dir[1], target[2] + d * dir[2]] };
}

/** Keeps a projected point inside the box (a label by its half width), so a part out of view is still a button at the nearest edge. */
export function clampToBox(x: number, y: number, w: number, h: number, margin = 14, mx = margin): { x: number; y: number; outside: boolean } {
  const cx = Math.min(w - mx, Math.max(mx, x)), cy = Math.min(h - margin, Math.max(margin, y));
  return { x: cx, y: cy, outside: cx !== x || cy !== y };
}
