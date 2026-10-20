/**
 * The parts of the beamline hutch scene: the hardware the user can click, where each label
 * sits in the drawing, and which parts and beam legs every mode uses.
 *
 * Pure data and arithmetic, no React and no DOM, so it is unit tested in Node. The drawing
 * itself is in hutch-scene.tsx and uses the same coordinates (scene-kit cabinet projection:
 * X along the beam, Y up, Z into the page, already projected into the SVG box below).
 */
import type { TwinMode } from '@/lib/twin/types';

/** The viewBox of the scene SVG; label and leader positions are in these units. */
export const VIEW = { x: 0, y: -40, width: 1600, height: 400 } as const;

export type PartId =
  | 'source' | 'front-end-slits' | 'collimating-mirror' | 'monochromator' | 'first-crystal'
  | 'second-crystal' | 'focusing-mirror' | 'harmonic-rejection-mirror' | 'experiment-slits'
  | 'helium-path' | 'i0' | 'sample-stage' | 'sample-environment' | 'drain-current'
  | 'fluorescence-detector' | 'it' | 'reference-foil' | 'iref' | 'beam-stop';

export interface Part {
  id: PartId;
  /** Accessible name of the button and the heading of its card. */
  name: string;
  /** Typeset form of the name, when it contains maths. */
  tex?: string;
  /** One line on what the part does, until the physics cards land. */
  role: string;
  /** Where the label sits. */
  at: readonly [number, number];
  /** The point on the hardware its leader line reaches. */
  tip: readonly [number, number];
}

/* Labels sit on four shelves above the hardware and one on the floor below the table, far enough
   apart along the beam that neighbours on a shelf do not collide at the scene's minimum width. */
export const PARTS: readonly Part[] = [
  { id: 'source', name: 'Source', role: 'A bending magnet in the storage ring: the electrons turn and give off a white X-ray fan along the beamline.', at: [100, -22], tip: [100, 168] },
  { id: 'front-end-slits', name: 'Front-end slits', role: 'Cooled tungsten blades cut the fan down to the opening angle the optics accept.', at: [250, 12], tip: [250, 158] },
  { id: 'collimating-mirror', name: 'Collimating mirror', role: 'A grazing-incidence mirror makes the beam parallel in the vertical, which sharpens the monochromator.', at: [400, -22], tip: [398, 170] },
  { id: 'monochromator', name: 'Monochromator', role: 'A vacuum tank holding two parallel silicon crystals; it passes one energy and keeps the beam height fixed.', at: [560, 12], tip: [560, 116] },
  { id: 'first-crystal', name: 'First crystal', role: 'Takes the white beam and diffracts the chosen energy upwards at the Bragg angle.', at: [460, 46], tip: [512, 168] },
  { id: 'second-crystal', name: 'Second crystal', role: 'Turns the beam back parallel to the first; detuning it throws away harmonics.', at: [650, 80], tip: [556, 148] },
  { id: 'focusing-mirror', name: 'Focusing mirror', role: 'A bent grazing-incidence mirror brings the beam to a spot on the sample.', at: [726, -22], tip: [726, 150] },
  { id: 'harmonic-rejection-mirror', name: 'Harmonic rejection mirror', role: 'Set to an angle that still reflects the chosen energy but not its harmonics; it moves in and out of the beam.', at: [860, 12], tip: [840, 150] },
  { id: 'experiment-slits', name: 'Experiment slits', role: 'The last blades before the sample; they set the beam size and cut off scattered light.', at: [880, 80], tip: [909, 134] },
  { id: 'helium-path', name: 'Helium flight path', role: 'A helium-filled tube for tender energies, where even a short air path would absorb most of the beam.', at: [990, 46], tip: [963, 139] },
  { id: 'i0', name: 'I0 chamber', tex: 'I_0', role: 'An ion chamber that absorbs a small part of the beam to measure how many photons arrive.', at: [1050, -22], tip: [1050, 112] },
  { id: 'sample-stage', name: 'Sample stage', role: 'Motorised translations and rotations that put the chosen spot of the sample in the beam.', at: [1210, 340], tip: [1142, 199] },
  { id: 'sample-environment', name: 'Sample environment', role: 'The cell around the sample: ambient air, a cryostat, a furnace, an operando coin cell or a liquid cell.', at: [1150, 12], tip: [1150, 128] },
  { id: 'drain-current', name: 'Drain current', role: 'The current that flows back into the sample to replace the electrons that escape; it follows the absorption near the surface.', at: [1060, 340], tip: [1128, 300] },
  { id: 'fluorescence-detector', name: 'Fluorescence detector', role: 'A silicon drift detector at 90 degrees, behind Soller slits and a filter, that sorts the emitted photons by energy.', at: [1200, 46], tip: [1192, 121] },
  { id: 'it', name: 'It chamber', tex: 'I_t', role: 'The ion chamber after the sample; its ratio to the first chamber gives the absorption.', at: [1258, -22], tip: [1258, 112] },
  { id: 'reference-foil', name: 'Reference foil', role: 'A foil of known edge energy, measured with every scan so the energy scale can be fixed afterwards.', at: [1370, 12], tip: [1352, 138] },
  { id: 'iref', name: 'Iref chamber', tex: 'I_\\mathrm{ref}', role: 'The third ion chamber, after the reference foil, which carries the calibration signal.', at: [1440, -22], tip: [1420, 120] },
  { id: 'beam-stop', name: 'Beam stop', role: 'A tungsten block that absorbs what is left of the beam at the end of the table.', at: [1520, 46], tip: [1506, 132] },
];

export const partOf = (id: PartId) => PARTS.find(part => part.id === id)!;

/** Legs of the beam path, in beam order. The drawing lights the ones the mode measures along. */
export type Leg = 'upstream' | 'i0-to-sample' | 'sample-to-it' | 'it-to-iref' | 'iref-to-stop' | 'to-detector' | 'to-ammeter';

/** Parts the beam passes through whatever the mode, so they are always in use. */
export const UPSTREAM: readonly PartId[] = ['source', 'front-end-slits', 'collimating-mirror', 'monochromator',
  'first-crystal', 'second-crystal', 'focusing-mirror', 'harmonic-rejection-mirror', 'experiment-slits', 'helium-path', 'i0'];

/** Extra things a mode draws: the fluorescence cone, the drain current, the detector counting, a focused spot, the crystal rocking, a fast scan. */
export type Cue = 'cone' | 'drain' | 'spectrum' | 'focused' | 'rocking' | 'fast';

export interface ModeScene {
  /** Parts this mode uses after the I0 chamber. */
  downstream: readonly PartId[];
  /** The parts the mode is really about; they get a ring. */
  emphasis: readonly PartId[];
  legs: readonly Leg[];
  cues: readonly Cue[];
}

const TRANSMISSION_LEGS: readonly Leg[] = ['upstream', 'i0-to-sample', 'sample-to-it', 'it-to-iref', 'iref-to-stop'];
const TRANSMISSION_PARTS: readonly PartId[] = ['sample-stage', 'sample-environment', 'it', 'reference-foil', 'iref', 'beam-stop'];

export const MODE_SCENES: Record<TwinMode, ModeScene> = {
  transmission: { downstream: TRANSMISSION_PARTS, emphasis: ['i0', 'it'], legs: TRANSMISSION_LEGS, cues: [] },
  fluorescence: { downstream: ['sample-stage', 'sample-environment', 'fluorescence-detector'], emphasis: ['fluorescence-detector'], legs: ['upstream', 'i0-to-sample', 'to-detector'], cues: ['cone'] },
  'electron-yield': { downstream: ['sample-stage', 'sample-environment', 'drain-current'], emphasis: ['drain-current'], legs: ['upstream', 'i0-to-sample', 'to-ammeter'], cues: ['drain'] },
  xrf: { downstream: ['sample-stage', 'sample-environment', 'fluorescence-detector'], emphasis: ['fluorescence-detector'], legs: ['upstream', 'i0-to-sample', 'to-detector'], cues: ['cone', 'spectrum'] },
  mono: { downstream: [], emphasis: ['first-crystal', 'second-crystal'], legs: ['upstream'], cues: ['rocking'] },
  calibration: { downstream: TRANSMISSION_PARTS, emphasis: ['reference-foil', 'iref'], legs: TRANSMISSION_LEGS, cues: [] },
  'time-resolved': { downstream: ['sample-stage', 'sample-environment', 'it', 'beam-stop'], emphasis: ['sample-stage'], legs: ['upstream', 'i0-to-sample', 'sample-to-it'], cues: ['fast', 'rocking'] },
  damage: { downstream: ['sample-stage', 'sample-environment', 'it', 'beam-stop'], emphasis: ['sample-stage'], legs: ['upstream', 'i0-to-sample', 'sample-to-it'], cues: ['focused'] },
};

export const sceneFor = (mode: TwinMode) => MODE_SCENES[mode];
export const partActive = (mode: TwinMode, id: PartId) => UPSTREAM.includes(id) || MODE_SCENES[mode].downstream.includes(id);
export const legLit = (mode: TwinMode, leg: Leg) => MODE_SCENES[mode].legs.includes(leg);
export const hasCue = (mode: TwinMode, cue: Cue) => MODE_SCENES[mode].cues.includes(cue);

/**
 * Brightness of a drawn beam segment from the fraction of the photons still in it. The square
 * root keeps a strongly absorbed beam visible; zero means nothing gets through at all.
 */
export const beamGlow = (fraction: number) =>
  fraction <= 1e-6 ? 0 : 0.08 + 0.92 * Math.sqrt(Math.min(1, fraction));

/** The crystal angle is drawn inside this range so both crystals stay visible; the readout keeps the true angle. */
export const DRAWN_BRAGG_DEG: readonly [number, number] = [7, 40];

/** The Bragg angle to draw, in degrees. With no reflection, or one out of range, the crystals keep a legible angle. */
export const drawnBraggDeg = (theta_deg: number | null) =>
  theta_deg === null ? 9 : Math.min(DRAWN_BRAGG_DEG[1], Math.max(DRAWN_BRAGG_DEG[0], theta_deg));

/** The amplifier display on a chamber: volts to three decimals, or OVER once the output clips. */
export const lcdVolts = (voltage_V: number, saturated: boolean) => saturated ? 'OVER' : voltage_V.toFixed(3) + ' V';
