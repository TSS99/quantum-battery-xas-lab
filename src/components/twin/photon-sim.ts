/**
 * Photons for the 3D hutch: a small Monte Carlo of photon packets whose fates come from the twin's own physics, so
 * what the dots do is what the numbers say. X-rays are invisible and travel at the speed of light; here each dot is a
 * packet of many photons, coloured on a false energy scale and slowed about a hundred million times.
 *
 * - The source emits a white beam (the bending magnet or undulator spectrum of src/lib/twin/source.ts) across its
 *   fan; the front-end slits keep the accepted angle, the collimating mirror reflects each energy with its tabulated
 *   reflectivity, and the first crystal passes only the energies of its Bragg orders. Everything else is absorbed,
 *   which is why real first crystals are cooled. A crystal is a filter, not a converter: the packets it will pass
 *   are drawn at the source with their own energy and keep their colour all the way.
 * - After the monochromator a packet is the fundamental or one harmonic, in the shares beam.ts computes; at every
 *   mirror, chamber, sample and foil it is removed with the probability the twin's models give at its own energy,
 *   so harmonics punch through thick samples just as they do in the data.
 * - A photon absorbed by the probed edge emits its fluorescence line in a random direction (fluorescence is
 *   isotropic), from a depth that follows the beam's attenuation, and gets out only if it crosses the sample on its
 *   way out: the self absorption that flattens thick concentrated samples.
 * - A scattered photon is Compton (incoherent) scattered in the tabulated share for the sample (src/lib/twin/compton.ts):
 *   it leaves along the polarised Klein-Nishina pattern and loses energy with angle, so it is drawn a little redder.
 *   The rest scatter elastically with the dipole pattern of a horizontally polarised beam (Thomson; the atomic form
 *   factor, which bends real Rayleigh scattering forwards, is not drawn). Either way almost none reach the detector at
 *   90 degrees in the horizontal plane.
 *
 * Pure data and arithmetic: no React and no DOM, unit tested in Node once the X-ray and optics tables are loaded.
 */
import type { MirrorConfig, TwinState } from '@/lib/twin/types';
import type { TwinStatus } from '@/lib/twin/twin';
import { beamAtSample } from '@/lib/twin/beam';
import { tuneSource } from '@/lib/twin/source';
import { darwin, mirrorReflectivity } from '@/lib/twin/tables';
import { absorbedFraction } from '@/lib/twin/chambers';
import { fluorescenceLine, muComponents, sharpEdge, transmission } from '@/lib/twin/sample';
import { edgeEnergy, foilTransmission } from '@/lib/twin/acquire';
import { monoTrueEnergy_eV } from '@/lib/twin/mono';
import { solidAngle } from '@/lib/twin/sdd';
import { mu } from '@/lib/xraydata';
import { comptonShare, comptonShifted, kleinNishinaDirection } from '@/lib/twin/compton';
import { YB } from '../scene-kit';
import { C1, CHAMBERS, FOIL_X, MIRROR_X, SLITS_X, SOURCE_X, STOP_X, XS, YB0 } from './hutch-parts';

export type V3 = [number, number, number];
export type Random = () => number;

/** Packet speed in scene units (about a centimetre each) per second: light is about 10^8 times faster. */
export const SPEED = 260;
/** White packets emitted per second, and the share of them the drawing lets through the crystals. */
export const WHITE_RATE = 260, SELECTED_SHARE = 0.5;
/** Fluorescence and scatter packets per second the drawing aims for, by boosting their weight; see `boost`. */
const FLUORESCENCE_TARGET = 14, SCATTER_TARGET = 4;
/** Opening of the bending-magnet fan drawn before the front-end slits, mrad. */
export const FAN_MRAD = 4;
/** How far fluorescence and scatter packets fly before they fade, scene units. */
const FLIGHT = 260;
/** The detector's entrance in scene coordinates: the snout faces the sample along +Z. */
export const DETECTOR_FACE_Z = 31.4, DETECTOR_APERTURE = 2.6;

/* ---------- False energy colours ---------- */

/** The energy scale of the colours, eV: low energies red, high ones violet, like visible light. */
export const COLOR_RANGE_eV: readonly [number, number] = [2000, 45000];

/** An energy as linear RGB on the false scale (hue from red at 2 keV to violet at 45 keV, log spaced). */
export function energyColor(energy_eV: number): V3 {
  const t = Math.min(1, Math.max(0, Math.log(energy_eV / COLOR_RANGE_eV[0]) / Math.log(COLOR_RANGE_eV[1] / COLOR_RANGE_eV[0])));
  const hue = 0.78 * t, s = 1, l = 0.55;
  const k = (n: number) => (n + hue * 12) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/* ---------- The beam's size along the line ---------- */

/** Scene X to distance from the source in metres. The scene shortens the beamline; sizes follow the real distances. */
const REAL_M: readonly [number, number][] = [[SOURCE_X, 0], [SLITS_X, 14], [MIRROR_X.collimating, 20], [C1, 24], [MIRROR_X.focusing, 28], [MIRROR_X['harmonic-rejection'], 30], [1006, 32], [XS, 35], [STOP_X + 30, 38]];
export function realDistance_m(x: number): number {
  if (x <= REAL_M[0][0]) return 0;
  for (let i = 1; i < REAL_M.length; i++) {
    const [x0, d0] = REAL_M[i - 1], [x1, d1] = REAL_M[i];
    if (x <= x1) return d0 + (d1 - d0) * (x - x0) / (x1 - x0);
  }
  const [xa, da] = REAL_M[REAL_M.length - 2], [xb, db] = REAL_M[REAL_M.length - 1];
  return db + (db - da) * (x - xb) / (xb - xa);
}

/** Widths are drawn this many times their real size, so a beam a few millimetres wide stays visible. */
export const WIDTH_SCALE = 3;
/** Smallest drawn width and height, scene units: real heights are a fraction of a millimetre. */
const MIN_W = 0.9, MIN_H = 0.5;

export interface Envelope {
  /** Full drawn width and height at scene X (signed: negative past a focus, where the rays have crossed). */
  width(x: number): number;
  height(x: number): number;
  /** Real full width and height in millimetres at scene X. */
  real(x: number): { width_mm: number; height_mm: number };
  focusX: number | null;
}

/**
 * The beam's full width and height from the source: the fan opens at the accepted horizontal angle and the vertical
 * divergence; a collimating mirror stops the vertical growth; a focusing mirror brings both down to the profile's
 * beam size at the sample, after which the rays cross and the beam opens again.
 */
export function beamEnvelope(state: TwinState): Envelope {
  const { source, mirrors, beam_um } = state.profile;
  const has = (role: MirrorConfig['role']) => mirrors.some(m => m.role === role && m.inserted);
  const source_mm = source.kind === 'undulator' ? [0.06, 0.012] : [0.25, 0.06];
  const hDiv = source.kind === 'undulator' ? 0.03 : source.hAccept_mrad, vDiv = source.vDiv_urad / 1000;
  const collimateAt = has('collimating') ? realDistance_m(MIRROR_X.collimating) : null;
  const focusFrom = has('focusing') ? realDistance_m(MIRROR_X.focusing) : null, focus = realDistance_m(XS);
  const raw = (L: number): [number, number] => {
    const w = (L: number) => source_mm[0] + hDiv * L;
    const h = (L: number) => source_mm[1] + vDiv * (collimateAt === null ? L : Math.min(L, collimateAt));
    if (focusFrom === null || L <= focusFrom) return [w(L), h(L)];
    const [w0, h0] = [w(focusFrom), h(focusFrom)], [wf, hf] = [beam_um[0] / 1000, beam_um[1] / 1000];
    // Converging to the focus, then the same angle out the other side with the rays crossed (negative size).
    const along = (L - focusFrom) / (focus - focusFrom);
    const signed = (start: number, end: number) => L <= focus ? start + (end - start) * along : -(end + (start - end) * (L - focus) / (focus - focusFrom));
    return [signed(w0, wf), signed(h0, hf)];
  };
  const drawn = (value_mm: number, min: number, scale: number) => Math.sign(value_mm || 1) * Math.max(min, Math.abs(value_mm) / 10 * scale);
  return {
    width: x => drawn(raw(realDistance_m(x))[0], MIN_W, WIDTH_SCALE),
    height: x => drawn(raw(realDistance_m(x))[1], MIN_H, WIDTH_SCALE),
    real: x => { const [w, h] = raw(realDistance_m(x)); return { width_mm: Math.abs(w), height_mm: Math.abs(h) }; },
    focusX: focusFrom === null ? null : XS,
  };
}

/* ---------- What happens where ---------- */

/** One thing on the line after the monochromator, with what it does to each Bragg order. */
export interface Stage {
  id: string;
  kind: 'crystal' | 'mirror' | 'path' | 'chamber' | 'sample' | 'foil' | 'stop';
  /** The stretch of the line it occupies, scene X. */
  x0: number;
  x1: number;
  /** Probability that a packet of each order is taken out of the beam here. */
  remove: number[];
  /** Of the packets taken out, the share that is photoabsorbed (the rest scatter). */
  photo: number[];
}

export interface Order { order: number; energy_eV: number; color: V3 }

export interface PhotonSetup {
  /** Fundamental first, then each harmonic that reaches the line. */
  orders: Order[];
  /** Probability that a packet the crystals pass is each order, and the running total for drawing one. */
  orderShare: number[];
  orderCdf: number[];
  /** The same running total at the source, before the collimating mirror has taken its share of each order. */
  sourceCdf: number[];
  /** The monochromator, for the second crystal's throughput as it rocks. */
  crystal: TwinState['profile']['mono']['crystal'];
  fundamental_eV: number;
  /** Full width of the fundamental's rocking curve, radians: a few arcseconds. */
  rockingFwhm_rad: number;
  stages: Stage[];
  /** White spectrum to sample from: log-spaced energies and their cumulative probability. */
  white: { energy: Float64Array; cdf: Float64Array };
  /** Reflectivity of the collimating mirror (before the crystals) at an energy; 1 without one. */
  collimating: ((energy_eV: number) => number) | null;
  /** Opening of the drawn fan before the slits (mrad) and the share of it the front-end slits accept. */
  fanMrad: number;
  slitShare: number;
  c2x: number;
  twoTheta: number;
  envelope: Envelope;
  sample: {
    /** Fluorescence line photons per photoabsorption in the sample, for each order. */
    fluorescence: number[];
    line: { energy_eV: number; group: string; color: V3 } | null;
    /** Compton share of the sample's scattering at each order's energy. */
    compton: number[];
    /** Packets emitted per fluorescence or scatter event in the drawing, from `boost`. */
    fluorescenceBoost: number;
    scatterBoost: number;
    /** Sample plane rotation about the vertical, radians from facing the beam: the incidence angle in fluorescence. */
    rotation: number;
    /** The sample as a slab: its thickness, and its total attenuation (1/cm) at each order and at the fluorescence line. */
    slab: { thickness_cm: number; muIn: number[]; muLine: number };
  };
  detector: { halfAngle: number; fraction: number };
  /** For the legend: photons each fundamental packet stands for, and how many white photons it takes to make one. */
  photonsPerPacket: number;
  whitePerSelected: number;
}

/** Fluorescence and electron-yield geometries tilt the sample to its incidence angle; transmission faces the beam. */
const TILTED = new Set<TwinState['mode']>(['fluorescence', 'xrf', 'electron-yield']);

/** Second crystal position along the beam for a Bragg angle: the fixed-exit offset YB - YB0 over tan 2 theta. */
export const secondCrystalX = (theta_rad: number) => C1 + (YB - YB0) / Math.tan(2 * theta_rad);

/** Everything the Monte Carlo needs for one state of the twin, or null when no beam reaches the sample. */
export function photonSetup(state: TwinState, live: TwinStatus, drawnTheta_rad: number): PhotonSetup | null {
  const { profile, sample, environment } = state;
  const energy = monoTrueEnergy_eV(state.energy_eV, profile.mono.offset_eV);
  let beam;
  try { beam = beamAtSample(profile, energy); } catch { return null; }
  const pre = beam.orders.map(o => o.sourceFlux * o.bandwidth * o.acceptance);
  const keep = beam.orders.map((o, i) => i === 0 || o.flux > 0 && pre[i] > 0);
  const orders = beam.orders.filter((_, i) => keep[i]);
  const collimatingMirror = profile.mirrors.find(m => m.role === 'collimating' && m.inserted);
  const collimating = collimatingMirror ? (e: number) => mirrorReflectivity(collimatingMirror.coating, collimatingMirror.angle_mrad, e) : null;
  const shares = orders.map(o => pre[beam.orders.indexOf(o)] * (collimating ? collimating(o.energy_eV) : 1));
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  const per = <T,>(f: (energy_eV: number, index: number) => T) => orders.map((o, i) => f(o.energy_eV, i));

  const c2x = secondCrystalX(drawnTheta_rad);
  const stages: Stage[] = [{ id: 'second-crystal', kind: 'crystal', x0: c2x, x1: c2x, remove: per((_, i) => 1 - orders[i].detuneFactor), photo: per(() => 1) }];
  for (const mirror of profile.mirrors) {
    if (!mirror.inserted || mirror.role === 'collimating') continue;
    const x = MIRROR_X[mirror.role];
    stages.push({ id: mirror.id, kind: 'mirror', x0: x, x1: x, remove: per(e => 1 - mirrorReflectivity(mirror.coating, mirror.angle_mrad, e)), photo: per(() => 1) });
  }
  if (orders.some(o => o.flightPathTransmission < 1)) stages.push({ id: 'helium-path', kind: 'path', x0: 1018, x1: 1082, remove: per((_, i) => 1 - orders[i].flightPathTransmission), photo: per(() => 1) });
  const chamber = (id: 'I0' | 'It' | 'Iref') => {
    const config = profile.chambers.find(c => c.id === id), box = CHAMBERS[id];
    if (!config) return;
    const fractions = per(e => absorbedFraction(config.gas, config.length_cm, e));
    stages.push({ id, kind: 'chamber', x0: box.x0 + 10, x1: box.x1 - 10, remove: fractions.map(f => f.attenuated), photo: fractions.map(f => f.attenuated > 0 ? f.absorbed / f.attenuated : 1) });
  };
  chamber('I0');
  const through = per(e => transmission(sample, environment, e).transmission);
  const muAt = per(e => mu(sample.formula, sample.density, e));
  stages.push({ id: 'sample', kind: 'sample', x0: XS, x1: XS, remove: through.map(t => 1 - t), photo: muAt.map(m => m.total > 0 ? m.photo / m.total : 1) });
  chamber('It');
  if (state.reference) {
    const reference = state.reference;
    stages.push({ id: 'reference-foil', kind: 'foil', x0: FOIL_X, x1: FOIL_X, remove: per(e => 1 - foilTransmission(reference, sample, e)), photo: per(() => 1) });
  }
  chamber('Iref');
  stages.push({ id: 'beam-stop', kind: 'stop', x0: STOP_X, x1: STOP_X, remove: per(() => 1), photo: per(() => 1) });

  // Fluorescence: the probed edge's share of the photoabsorption, times the yield and the line's share.
  let line: PhotonSetup['sample']['line'] = null, fluorescence = per(() => 0);
  try {
    const l = fluorescenceLine(sample.absorber, sample.edge), edge = edgeEnergy(sample);
    line = { energy_eV: l.energy_eV, group: l.group, color: energyColor(l.energy_eV) };
    fluorescence = per((e, i) => {
      const photo = muAt[i].photo;
      if (photo <= 0) return 0;
      const edgePart = muComponents(sample, e, { fineStructure: sharpEdge(edge) }).absorber_cm_inv;
      return Math.min(1, edgePart / photo) * l.fluorescenceYield * l.lineFraction;
    });
  } catch { /* an edge without a tabulated line: no fluorescence drawn */ }

  // White spectrum from 2 keV (what the front-end beryllium window lets through) to 60 keV, on a log grid that is fine
  // around undulator harmonics, weighted by flux per relative bandwidth.
  const tuned = tuneSource(profile.source, energy);
  const grid: number[] = [];
  for (let i = 0; i <= 260; i++) grid.push(2000 * Math.pow(30, i / 260));
  if (tuned.tuning) {
    const first = orders[0].energy_eV / tuned.tuning.harmonic;
    for (let n = 1; n <= 15; n += 2) for (let k = -40; k <= 40; k++) { const e = n * first * (1 + k * 0.0006); if (e > 2000 && e < 60000) grid.push(e); }
  }
  grid.sort((a, b) => a - b);
  const energyGrid = new Float64Array(grid), cdf = new Float64Array(grid.length);
  let acc = 0;
  for (let i = 0; i < grid.length; i++) {
    const width = Math.log(grid[Math.min(i + 1, grid.length - 1)] / grid[Math.max(i - 1, 0)]) / 2;
    const w = Math.max(0, tuned.fluxAt(grid[i])) * width;
    acc += w; cdf[i] = acc;
  }
  const whiteFlux = acc / 1e-3, monoFlux = beam.orders.reduce((sum, o) => sum + o.sourceFlux * o.bandwidth * o.acceptance, 0) / 1e-3;
  for (let i = 0; i < cdf.length; i++) cdf[i] /= acc || 1;

  // Packets per second the drawing passes through the crystals: the share of the emitted rate drawn at an order's
  // energy, less the slits, and less what the collimating mirror takes at that energy.
  const fanMrad = profile.source.kind === 'undulator' ? 0.03 : FAN_MRAD;
  const slitShare = Math.min(1, profile.source.kind === 'undulator' ? 1 : profile.source.hAccept_mrad / FAN_MRAD);
  const sourceShares = orders.map(o => pre[beam.orders.indexOf(o)]), sourceTotal = sourceShares.reduce((a, b) => a + b, 0) || 1;
  const selectedRate = WHITE_RATE * slitShare * SELECTED_SHARE * total / sourceTotal;
  // How often the drawing sees each event at the sample, before any boost.
  let reachSample = per(() => 1);
  for (const s of stages) { if (s.kind === 'sample') break; reachSample = reachSample.map((r, i) => r * (1 - s.remove[i])); }
  const sampleStage = stages.find(s => s.kind === 'sample')!;
  const rate = (f: (i: number) => number) => orders.reduce((sum, _, i) => sum + selectedRate * (shares[i] / total) * reachSample[i] * sampleStage.remove[i] * f(i), 0);
  const fluorescenceRate = rate(i => sampleStage.photo[i] * fluorescence[i]);
  const scatterRate = rate(i => 1 - sampleStage.photo[i]);

  const fundamentalAtI0 = selectedRate * (shares[0] / total) * stages.filter(s => s.x1 < CHAMBERS.I0.x0).reduce((r, s) => r * (1 - s.remove[0]), 1);
  const detector = solidAngle(profile.sdd).fraction;
  return {
    orders: orders.map(o => ({ order: o.order, energy_eV: o.energy_eV, color: energyColor(o.energy_eV) })),
    orderShare: shares.map(s => s / total),
    orderCdf: shares.map((_, i) => shares.slice(0, i + 1).reduce((a, b) => a + b, 0) / total),
    sourceCdf: sourceShares.map((_, i) => sourceShares.slice(0, i + 1).reduce((a, b) => a + b, 0) / sourceTotal),
    crystal: profile.mono.crystal, fundamental_eV: energy, rockingFwhm_rad: darwin(profile.mono.crystal, 1, energy).rocking_theta_fwhm_rad,
    stages,
    white: { energy: energyGrid, cdf },
    collimating,
    fanMrad, slitShare,
    c2x, twoTheta: 2 * drawnTheta_rad,
    envelope: beamEnvelope(state),
    sample: {
      fluorescence, line,
      compton: per(e => { try { return comptonShare(sample.formula, e); } catch { return 0; } }),
      fluorescenceBoost: boost(fluorescenceRate, FLUORESCENCE_TARGET),
      scatterBoost: boost(scatterRate, SCATTER_TARGET),
      rotation: TILTED.has(state.mode) ? Math.PI / 2 - sample.incidence_deg * Math.PI / 180 : 0,
      slab: { thickness_cm: sample.thickness_um * 1e-4, muIn: muAt.map(m => m.total), muLine: line ? mu(sample.formula, sample.density, line.energy_eV).total : 0 },
    },
    detector: { halfAngle: Math.acos(1 - 2 * detector), fraction: detector },
    photonsPerPacket: live.flux && fundamentalAtI0 > 0 ? live.flux / fundamentalAtI0 : 0,
    whitePerSelected: monoFlux > 0 ? whiteFlux / monoFlux : 0,
  };
}

/** How many times rarer events are multiplied so the drawing shows a few per second: 1, 2, 5, 10, 20, ... up to 1000. */
export function boost(rate: number, target: number): number {
  if (!(rate > 0) || rate >= target) return 1;
  const want = Math.min(1000, target / rate), steps = [1, 2, 5];
  let best = 1;
  for (let decade = 1; decade <= 1000; decade *= 10) for (const s of steps) if (s * decade <= want * (1 + 1e-9)) best = s * decade;
  return best;
}

/* ---------- The Monte Carlo ---------- */

export type Species = 'white' | 'beam' | 'fluorescence' | 'scatter';
export type FlashKind = 'heat' | 'ion' | 'absorb' | 'count';

export interface Packet {
  species: Species;
  energy_eV: number;
  color: V3;
  /** Main-line packets: scene X along the line and the transverse fractions; free packets: origin and direction. */
  x: number;
  u: number;
  v: number;
  /** The Bragg order a packet the crystals will pass belongs to (drawn at the source); -1 for the rest of the white beam. */
  order: number;
  /** Where and how it ends on the line, decided when it is made. */
  endX: number;
  end: { kind: FlashKind; stage: string; secondary: 'fluorescence' | 'scatter' | null; count: number; depth_cm?: number } | null;
  origin: V3;
  dir: V3;
  travelled: number;
  /** Free packets that head into the detector stop at this distance. */
  limit: number;
}

export interface Flash { at: V3; kind: FlashKind; age: number; color: V3 }

/**
 * Depth below the front face (cm, along the normal) where a beam photon absorbed in a slab was absorbed: the path
 * along the beam is exponential with the total attenuation and stops at the back face; cosIn is the cosine of the
 * beam to the normal.
 */
export function absorptionDepth(random: Random, mu_cm_inv: number, thickness_cm: number, cosIn: number): number {
  const along = thickness_cm / cosIn;
  if (!(mu_cm_inv * along > 1e-9)) return random() * thickness_cm;
  const s = -Math.log(1 - random() * (1 - Math.exp(-mu_cm_inv * along))) / mu_cm_inv;
  return Math.min(thickness_cm, s * cosIn);
}

/**
 * Chance that a photon leaving `depth_cm` below the front face gets out of the slab: out of the front when it heads
 * outwards (cosOut, its direction on the outward normal, above zero), else out of the back, through the sample in
 * between at the attenuation of its own energy. A photon along the plane never gets out.
 */
export function escapeChance(depth_cm: number, thickness_cm: number, cosOut: number, mu_cm_inv: number): number {
  if (Math.abs(cosOut) < 1e-9) return 0;
  const path = cosOut > 0 ? depth_cm / cosOut : (thickness_cm - depth_cm) / -cosOut;
  return Math.exp(-mu_cm_inv * path);
}

/** A direction drawn uniformly over the sphere. */
function isotropic(random: Random): V3 {
  const z = 2 * random() - 1, phi = 2 * Math.PI * random(), r = Math.sqrt(1 - z * z);
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

/** A scattering direction for a beam along X polarised along Z (horizontal): intensity proportional to 1 - (k.e)^2. */
export function dipoleScatter(random: Random): V3 {
  for (;;) { const d = isotropic(random); if (random() <= 1 - d[2] * d[2]) return d; }
}

/** Index of the first cumulative weight at or above r. */
function pick(cdf: ArrayLike<number>, r: number): number {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
  return lo;
}

export class PhotonSim {
  readonly packets: Packet[] = [];
  readonly flashes: Flash[] = [];
  /** Fluorescence and scatter packets the sample itself absorbed on their way out, since the start. */
  selfAbsorbed = 0;
  /** While the second crystal rocks: its throughput for each order right now, in place of the set detune's. */
  secondCrystalPass: number[] | null = null;
  private debt = 0;
  constructor(public setup: PhotonSetup, private random: Random) {}

  /** Position of a packet in scene coordinates. */
  position(p: Packet): V3 {
    if (p.species === 'fluorescence' || p.species === 'scatter') return [p.origin[0] + p.dir[0] * p.travelled, p.origin[1] + p.dir[1] * p.travelled, p.origin[2] + p.dir[2] * p.travelled];
    return this.linePoint(p.x, p.u, p.v);
  }

  /** A point on the main line at scene X, offset across the beam by fractions of its width and height. */
  linePoint(x: number, u: number, v: number): V3 {
    const { c2x, twoTheta, envelope } = this.setup;
    // Before the slits u spans the whole fan; after them only the accepted middle is left, at the beam's width.
    const across = x <= SLITS_X ? u * Math.max(MIN_W, realDistance_m(x) * this.setup.fanMrad / 10 * WIDTH_SCALE) : u / this.setup.slitShare * envelope.width(x);
    const rising = x > C1 && x < c2x, y = x <= C1 ? YB0 : x >= c2x ? YB : YB0 + (x - C1) * Math.tan(twoTheta);
    const h = envelope.height(x) * v;
    // Across the beam vertically: straight up on the level legs, perpendicular to the rising leg between the crystals.
    return rising ? [x - h * Math.sin(twoTheta), y + h * Math.cos(twoTheta), across] : [x, y + h, across];
  }

  /** Direction of travel of a packet. */
  direction(p: Packet): V3 {
    if (p.species === 'fluorescence' || p.species === 'scatter') return p.dir;
    return p.x > C1 && p.x < this.setup.c2x ? [Math.cos(this.setup.twoTheta), Math.sin(this.setup.twoTheta), 0] : [1, 0, 0];
  }

  /**
   * A new white packet at the source, with its whole history on the line decided now. A share of them sit at the
   * energy of a Bragg order (those are the ones the crystals will pass); the rest are anywhere in the white spectrum
   * and end as heat at the slits, the collimating mirror or the first crystal.
   */
  private emit(x = SOURCE_X) {
    const { setup, random } = this;
    const u = random() - 0.5, v = random() - 0.5, selected = random() < SELECTED_SHARE;
    const order = selected ? pick(setup.sourceCdf, random()) : -1;
    const energy = selected ? setup.orders[order].energy_eV : setup.white.energy[pick(setup.white.cdf, random())];
    const p: Packet = { species: 'white', energy_eV: energy, color: selected ? setup.orders[order].color : energyColor(energy), x, u, v, order, endX: 0, end: null, origin: [0, 0, 0], dir: [1, 0, 0], travelled: 0, limit: Infinity };
    // The front-end slits take the middle of the fan.
    if (Math.abs(p.u) > setup.slitShare / 2) { p.endX = SLITS_X; p.end = { kind: 'heat', stage: 'front-end-slits', secondary: null, count: 0 }; }
    else if (setup.collimating && random() > setup.collimating(energy)) { p.endX = MIRROR_X.collimating; p.end = { kind: 'heat', stage: 'collimating-mirror', secondary: null, count: 0 }; }
    else if (!selected) { p.endX = C1; p.end = { kind: 'heat', stage: 'first-crystal', secondary: null, count: 0 }; }
    else { p.endX = C1; p.end = null; }
    this.packets.push(p);
  }

  /**
   * At the first crystal a passed packet gets its fate on the rest of the line. It keeps its energy; only while the
   * mono is turning, when the order it was drawn for has moved on, does it take the energy the crystal passes now.
   */
  private diffract(p: Packet) {
    const { setup, random } = this;
    if (!(p.order >= 0 && p.order < setup.orders.length)) p.order = pick(setup.orderCdf, random());
    const order = setup.orders[p.order];
    p.species = 'beam';
    if (p.energy_eV !== order.energy_eV) { p.energy_eV = order.energy_eV; p.color = order.color; }
    p.endX = STOP_X; p.end = { kind: 'heat', stage: 'beam-stop', secondary: null, count: 0 };
    for (const stage of setup.stages) {
      const remove = stage.kind === 'crystal' && this.secondCrystalPass ? 1 - (this.secondCrystalPass[p.order] ?? 1) : stage.remove[p.order];
      if (!(random() < remove)) continue;
      const photo = random() < stage.photo[p.order];
      // Depth of the interaction: exponential through a chamber's gas, at the face for thin things.
      const depth = stage.x1 > stage.x0 && remove < 1 ? Math.log(1 - random() * remove) / Math.log(1 - remove) : 0;
      p.endX = stage.x0 + (stage.x1 - stage.x0) * Math.min(1, depth);
      let secondary: 'fluorescence' | 'scatter' | null = null, count = 0, depth_cm: number | undefined;
      if (stage.kind === 'sample') {
        const s = setup.sample;
        const expected = photo ? s.fluorescence[p.order] * s.fluorescenceBoost : s.scatterBoost;
        count = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
        secondary = count ? (photo ? 'fluorescence' : 'scatter') : null;
        if (count) depth_cm = absorptionDepth(random, s.slab.muIn[p.order], s.slab.thickness_cm, Math.cos(s.rotation));
      }
      // In a chamber both photoabsorption and Compton recoil electrons make ion pairs.
      p.end = { kind: stage.kind === 'chamber' ? 'ion' : stage.kind === 'sample' ? 'absorb' : 'heat', stage: stage.id, secondary, count, depth_cm };
      return;
    }
  }

  /**
   * Fluorescence or scatter packets leaving the sample spot from `depth_cm` below its face; each one the sample
   * absorbs on its way out (at the line's attenuation, or the beam's for scatter) is not drawn.
   */
  private emitFrom(at: V3, kind: 'fluorescence' | 'scatter', energy_eV: number, count: number, depth_cm: number, order: number) {
    const { setup, random } = this, { slab, rotation } = setup.sample;
    const line = kind === 'fluorescence' ? setup.sample.line : null;
    // The front face's outward normal: towards the source, turned towards the detector by the sample rotation.
    const normal: V3 = [-Math.cos(rotation), 0, Math.sin(rotation)];
    // Scatter is taken out at the beam's attenuation: a Compton loss of a few percent in energy barely changes it.
    const muOut = kind === 'fluorescence' ? slab.muLine : slab.muIn[order] ?? 0;
    for (let n = 0; n < count; n++) {
      const compton = kind === 'scatter' && random() < (setup.sample.compton[order] ?? 0);
      let dir = kind === 'fluorescence' ? isotropic(random) : compton ? kleinNishinaDirection(random, energy_eV) : dipoleScatter(random);
      let limit = FLIGHT;
      // Inside the detector's acceptance (its real solid angle): fly into the entrance and stop there.
      if (dir[2] > Math.cos(setup.detector.halfAngle)) {
        const r = DETECTOR_APERTURE * Math.sqrt(random()), a = 2 * Math.PI * random();
        const target: V3 = [XS + r * Math.cos(a), YB + r * Math.sin(a), DETECTOR_FACE_Z];
        const d: V3 = [target[0] - at[0], target[1] - at[1], target[2] - at[2]], len = Math.hypot(...d);
        dir = [d[0] / len, d[1] / len, d[2] / len]; limit = len;
      }
      const cosOut = dir[0] * normal[0] + dir[1] * normal[1] + dir[2] * normal[2];
      if (!(random() < escapeChance(depth_cm, slab.thickness_cm, cosOut, muOut))) { this.selfAbsorbed++; continue; }
      // A Compton photon's energy follows the direction it finally takes (beam along X, so cos theta is dir[0]).
      const e = line?.energy_eV ?? (compton ? comptonShifted(energy_eV, dir[0]) : energy_eV);
      this.packets.push({ species: kind, energy_eV: e, color: line?.color ?? energyColor(e), x: XS, u: 0, v: 0, order: -1, endX: 0, end: null, origin: at, dir, travelled: 0, limit });
    }
  }

  private flash(at: V3, kind: FlashKind, color: V3) { this.flashes.push({ at, kind, age: 0, color }); }

  /**
   * Advance the drawing by dt seconds, to `now_s` on the scene's clock when given. With `pulse` set, the source
   * shines only as an electron bunch passes, so the packets leave in bursts at the bunch rate, as synchrotron light
   * does; the average rate is the same.
   */
  step(dt: number, now_s = this.time + dt) {
    const { setup } = this;
    const before = now_s - dt;
    this.time = now_s;
    this.debt += dt * WHITE_RATE;
    if (this.pulse) {
      const { hz, phase_s } = this.pulse;
      if (Math.floor((now_s - phase_s) * hz) > Math.floor((before - phase_s) * hz)) {
        // A bunch is a few centimetres long in the drawing (tens of picoseconds, slowed like the light).
        while (this.debt >= 1) { this.debt -= 1; this.emit(SOURCE_X + BUNCH_LENGTH * this.random()); }
      }
    } else while (this.debt >= 1) { this.debt -= 1; this.emit(); }
    const travel = SPEED * dt;
    for (let i = this.packets.length - 1; i >= 0; i--) {
      const p = this.packets[i];
      if (p.species === 'fluorescence' || p.species === 'scatter') {
        p.travelled += travel;
        if (p.travelled >= p.limit) {
          if (p.limit < FLIGHT) this.flash(this.position({ ...p, travelled: p.limit }), 'count', p.color);
          this.packets.splice(i, 1);
        }
        continue;
      }
      const rising = p.x > C1 && p.x < setup.c2x;
      p.x += rising ? travel * Math.cos(setup.twoTheta) : travel;
      if (p.x < p.endX) continue;
      p.x = p.endX;
      if (p.species === 'white' && !p.end) { this.diffract(p); continue; }
      const at = this.position(p);
      if (p.end) {
        this.flash(at, p.end.kind, p.color);
        if (p.end.secondary && p.end.count) this.emitFrom(at, p.end.secondary, p.energy_eV, p.end.count, p.end.depth_cm ?? 0, p.order);
      }
      this.packets.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) if ((this.flashes[i].age += dt) > FLASH_LIFE) this.flashes.splice(i, 1);
  }

  /** Run the drawing forward without showing it, so the line is full when it first appears. */
  prewarm(seconds: number, dt = 1 / 30) { for (let t = 0; t < seconds; t += dt) this.step(dt); }

  /** Bunch passages: how many a second and the time of one, on the clock `step` is given. Null for a steady source. */
  pulse: { hz: number; phase_s: number } | null = null;
  private time = 0;
}

/** Length of a drawn electron bunch's light along the line, scene units. */
const BUNCH_LENGTH = 3;

/** How long an absorption flash lasts, seconds. */
export const FLASH_LIFE = 0.35;
