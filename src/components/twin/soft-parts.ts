/**
 * The soft X-ray beamline of the twin (step 11 of docs/PLAN-quantum.md): the parts the user can click, where they sit
 * along the beam, and the optics that follow the energy and the resolving power. Pure data and arithmetic, no React,
 * so it is unit tested in Node. The measurement itself is src/lib/quantum/measure.ts (step 5); this file is the
 * hardware it runs on.
 *
 * Positions are centimetres along the beam from the source, as in the hard X-ray hutch (hutch-parts.ts), compressed
 * to 9 m: a real soft X-ray line is 30 to 50 m long.
 */
import { AIR_LENGTH_MM, type Detection } from '@/lib/quantum/measure';

export type SoftPartId =
  | 'undulator' | 'front-end' | 'm1' | 'pgm' | 'm3' | 'exit-slit' | 'kb' | 'mesh' | 'chamber' | 'sample' | 'drain' | 'sdd';

/** `short` is the label on the drawing; `name` heads the card and names the button. */
export interface SoftPart { id: SoftPartId; name: string; short: string; x: number; role: string }

/** The beam axis height above the table, cm (as YB in the hard line). */
export const SOFT_Y = 66;
/** The settings this file turns into geometry. */
export interface SoftSettings { energy_eV: number; resolvingPower: number; detection: Detection }

export const GRATING_LINES_PER_MM = 1200;
/** The fixed focus constant cos beta / cos alpha of the plane grating monochromator (collimated light). */
export const CFF = 2.25;
/** Exit slit gap for the beamline's resolving power of 5000 (src/lib/quantum/measure.ts BEAMLINE), um. */
const GAP_AT_5000_UM = 25;

/** The resolving power E / dE set by the exit slit when the slit, not the source size, limits it: inverse in the gap. */
export const exitSlitGap_um = (resolvingPower: number) => GAP_AT_5000_UM * 5000 / resolvingPower;
/** Flux through the exit slit relative to the 25 um gap: in proportion to the gap. */
export const relativeFlux = (resolvingPower: number) => exitSlitGap_um(resolvingPower) / GAP_AT_5000_UM;

/**
 * Angles of incidence and diffraction on the grating, from its normal, in degrees: sin a + sin b = m N lambda with
 * cos b / cos a = cff, in the inside first order (b < 0), found by bisection on a. Also the grazing angle of the
 * plane mirror that sends the beam onto the grating at a, half the included angle a - b.
 */
export function gratingAngles(energy_eV: number, lines_per_mm = GRATING_LINES_PER_MM, cff = CFF, order = 1) {
  const k = order * lines_per_mm * 1239.84198e-6 / energy_eV;  // m N lambda with lambda in mm
  const beta = (a: number) => -Math.acos(Math.min(1, cff * Math.cos(a)));
  const f = (a: number) => Math.sin(a) + Math.sin(beta(a)) - k;
  // cff cos a <= 1 sets the smallest angle, where f is positive; at grazing incidence it is -k.
  let lo = Math.acos(1 / cff) + 1e-12, hi = Math.PI / 2 - 1e-12;
  if (f(lo) < 0 || f(hi) > 0) throw new Error(`No first order at ${energy_eV} eV for ${lines_per_mm} lines/mm`);
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  const a = (lo + hi) / 2, b = beta(a), deg = 180 / Math.PI;
  return { alpha_deg: a * deg, beta_deg: b * deg, mirror_grazing_deg: (90 - (a - b) * deg / 2) };
}

export const SOFT_PARTS: readonly SoftPart[] = [
  { id: 'undulator', name: 'Undulator', short: 'Undulator', x: 100, role: 'Rows of magnets that wiggle the electrons a few hundred times, so their light adds up in a narrow cone at the energies the gap sets: the bright soft X-ray source.' },
  { id: 'front-end', name: 'Front end apertures', short: 'Apertures', x: 260, role: 'Define the beam the optics take and stop the rest, with the valves that keep the storage ring vacuum safe.' },
  { id: 'm1', name: 'Collimating mirror M1', short: 'M1', x: 340, role: 'A gold coated mirror at grazing incidence, about 2 degrees, that makes the beam parallel for the grating and takes the heat. Soft X-rays reflect only at grazing angles.' },
  { id: 'pgm', name: 'Plane grating monochromator', short: 'Monochromator', x: 470, role: 'A plane mirror and a ruled grating in one vacuum tank. The grating sends each energy out at its own angle; turning grating and mirror together keeps the chosen energy on the exit slit at a fixed cff.' },
  { id: 'm3', name: 'Focusing mirror M3', short: 'M3', x: 600, role: 'Focuses the dispersed beam onto the exit slit, so that position on the slit means energy.' },
  { id: 'exit-slit', name: 'Exit slit', short: 'Exit slit', x: 680, role: 'A gap of tens of micrometres that lets one narrow band of energies through: narrower gives a sharper spectrum and fewer photons.' },
  { id: 'kb', name: 'Refocusing mirrors (KB)', short: 'KB mirrors', x: 760, role: 'Two bent mirrors, one for each direction, that image the exit slit onto the sample as a spot of about 100 by 50 um.' },
  { id: 'mesh', name: 'Gold mesh I0', short: 'I0 mesh', x: 820, role: 'A fine gold grid in the beam whose photoelectron current measures the incoming flux, I0, without blocking it.' },
  { id: 'chamber', name: 'End station', short: 'End station', x: 900, role: `An ultra high vacuum chamber, about 10⁻⁹ mbar. Soft X-rays at the oxygen K edge are halved in a few millimetres of air (1/e in ${AIR_LENGTH_MM.toFixed(1)} mm at 530 eV), so the whole path from the ring to the sample is evacuated.` },
  { id: 'sample', name: 'Sample', short: 'Sample', x: 900, role: 'Pressed powder or a cathode film on a manipulator, turned to the beam. Electron yield sees its top few nanometres, fluorescence about 100 nm.' },
  { id: 'drain', name: 'Drain current (electron yield)', short: 'Electron yield', x: 940, role: 'The sample is wired to a picoammeter: every absorbed photon knocks out electrons, and the current that flows back to replace them is total electron yield.' },
  { id: 'sdd', name: 'Fluorescence detector', short: 'Fluorescence', x: 900, role: 'A silicon drift detector at 90 degrees counts the oxygen K alpha photons, total fluorescence yield: deeper than electron yield, but it saturates in a concentrated oxide.' },
];

export const softPart = (id: SoftPartId) => SOFT_PARTS.find(p => p.id === id)!;

/** Which detector reads the sample in each detection mode; the other is drawn idle. */
export const softActive = (id: SoftPartId, detection: SoftSettings['detection']) =>
  id === 'drain' ? detection === 'tey' : id === 'sdd' ? detection === 'fy' : true;

/** Which labels keep their names first when the view is too small for all of them. */
const LABEL_ORDER: readonly SoftPartId[] = ['pgm', 'exit-slit', 'chamber', 'undulator', 'sample', 'drain', 'sdd', 'kb', 'm1', 'm3', 'mesh', 'front-end'];

/** A label's wanted centre on the screen and its half width, px. */
export interface LabelSpot { id: SoftPartId; x: number; y: number; half: number }

/**
 * Places the labels on a w by h view: each is kept inside it, and one that would overlap a label placed before it
 * becomes a marker (a dot, still a button) at its spot. The open part goes first, then the parts in LABEL_ORDER with
 * the idle detector last, so a phone keeps the names that matter.
 */
export function placeLabels(spots: readonly LabelSpot[], w: number, h: number, open: SoftPartId | null, detection: Detection, tall = 24) {
  const rank = (id: SoftPartId) => id === open ? -1 : LABEL_ORDER.indexOf(id) + (softActive(id, detection) ? 0 : LABEL_ORDER.length);
  const done: LabelSpot[] = [];
  const out = new Map<SoftPartId, { x: number; y: number; marker: boolean }>();
  for (const s of [...spots].sort((a, b) => rank(a.id) - rank(b.id))) {
    const x = Math.min(Math.max(s.x, s.half + 4), w - s.half - 4), y = Math.min(Math.max(s.y, tall / 2 + 4), h - tall / 2 - 4);
    const marker = done.some(d => Math.abs(d.x - x) < d.half + s.half + 4 && Math.abs(d.y - y) < tall + 2);
    if (!marker) done.push({ ...s, x, y });
    out.set(s.id, { x, y, marker });
  }
  return out;
}
