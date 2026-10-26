/**
 * The guided tour of the 3D hutch: the camera flies from the source down the beamline to the detectors and stops at
 * each part with a short caption. Pure data and arithmetic, so it is unit tested in Node; hutch-3d drives the camera.
 *
 * A stop is a point to look at, how much of the scene to fit across (centimetres) and the camera's direction from that
 * point, in the same world coordinates and direction convention as frameFor in hutch-3d-layout.
 */
import { YB, type V3 } from '../scene-kit';
import { FOV } from './hutch-3d-layout';
import { C1, MIRROR_X, SOURCE_X, XS, YB0 } from './hutch-parts';

export interface TourStop { id: string; title: string; caption: string; target: V3; width: number; azimuth_deg: number; elevation_deg: number }

/** What the drawn beamline has, which changes the stops and what they say. */
export interface TourBeamline { collimating: boolean; harmonicRejectionIn: boolean }

const OVERVIEW: V3 = [760, 30, 10];

export function tourStops({ collimating, harmonicRejectionIn }: TourBeamline): TourStop[] {
  const stops: (TourStop | false)[] = [
    { id: 'overview', title: 'The beamline', target: OVERVIEW, width: 1450, azimuth_deg: -12, elevation_deg: 15,
      caption: 'About 35 m from source to sample, shortened here so it fits. The hardware is drawn at real size, and each dot is a packet of X-ray photons.' },
    { id: 'source', title: 'The source', target: [SOURCE_X + 30, YB0, 0], width: 340, azimuth_deg: -28, elevation_deg: 20,
      caption: 'Electrons circling at almost the speed of light bend in a magnet and throw off a flat fan of X-rays at every energy at once.' },
    { id: 'front-end', title: 'Front end', target: [285, YB0, 0], width: 300, azimuth_deg: -20, elevation_deg: 14,
      caption: 'Slits trim the fan to what the optics accept. Then the beam passes the photon shutter in the thick shielding wall of the ring tunnel.' },
    collimating && { id: 'collimating-mirror', title: 'Collimating mirror', target: [MIRROR_X.collimating, YB0, 0], width: 230, azimuth_deg: -8, elevation_deg: 22,
      caption: 'At a grazing angle of a few milliradians this mirror reflects X-rays below its cutoff energy and makes the beam parallel for the crystals.' },
    { id: 'monochromator', title: 'Monochromator', target: [C1 + 33, (YB0 + YB) / 2, 0], width: 240, azimuth_deg: 10, elevation_deg: 18,
      caption: 'Two silicon crystals pick one energy by Bragg\'s law, nλ = 2d sin θ. Turning them scans the energy, and the second crystal sends the beam on parallel, a little higher.' },
    { id: 'focusing-mirror', title: 'Focusing mirror', target: [MIRROR_X.focusing, YB, 0], width: 230, azimuth_deg: -10, elevation_deg: 22,
      caption: 'A bent mirror at a grazing angle focuses the beam down to a small spot on the sample.' },
    { id: 'harmonic-rejection', title: 'Harmonic rejection', target: [MIRROR_X['harmonic-rejection'], YB, 0], width: 200, azimuth_deg: 6, elevation_deg: 18,
      caption: harmonicRejectionIn
        ? 'The crystals also pass multiples of the chosen energy. This flat mirror reflects the chosen energy and drops those harmonics, which sit above its cutoff.'
        : 'The crystals also pass multiples of the chosen energy. This flat mirror can drop them, but at these settings it is out of the beam.' },
    { id: 'into-air', title: 'Into the air', target: [1030, YB - 6, 0], width: 200, azimuth_deg: -24, elevation_deg: 16,
      caption: 'The vacuum ends at a thin Kapton window. Slits set the beam size, and a helium tube keeps air from soaking up the low energy X-rays.' },
    { id: 'i0', title: 'I₀ chamber', target: [1106, YB, 0], width: 150, azimuth_deg: -6, elevation_deg: 14,
      caption: 'Gas between two charged plates absorbs a small share of the beam. The current it makes measures how many photons go in.' },
    { id: 'sample', title: 'The sample', target: [XS, YB + 2, 34], width: 210, azimuth_deg: -8, elevation_deg: 22,
      caption: 'Above the edge, photons knock out core electrons and the atoms answer with fluorescence. The detector sits at 90° in the ring plane, where the polarised beam scatters least.' },
    { id: 'transmission', title: 'Transmission', target: [1240, YB, 0], width: 210, azimuth_deg: 18, elevation_deg: 16,
      caption: 'The next chamber counts what got through, so μx = ln(I₀/Iₜ). A metal foil before the reference chamber checks the energy in every scan.' },
    { id: 'scan', title: 'One scan', target: OVERVIEW, width: 1500, azimuth_deg: 10, elevation_deg: 16,
      caption: 'A scan steps the crystals through the edge and records the chambers and the detector at each energy. That is the spectrum in the results.' },
  ];
  return stops.filter((s): s is TourStop => !!s);
}

/** Seconds to fly between stops, the camera's turn and push in while it holds, and the share of the width it pushes. */
export const TRAVEL_S = 2.2, DRIFT_DEG = 6, PUSH = 0.05;
/** Seconds to hold a stop: long enough to read its caption at a calm pace. */
export const holdFor = (caption: string) => Math.max(3.5, 1.5 + caption.split(/\s+/).length * 0.22);

export interface TourItem { stop: TourStop; start: number; travel: number; hold: number }
export interface TourTimeline { items: TourItem[]; length: number; reduced: boolean }

/** When each stop starts. With reduced motion the camera cuts from stop to stop and holds still. */
export function tourTimeline(stops: TourStop[], reduced: boolean): TourTimeline {
  let start = 0;
  const items = stops.map((stop, i) => {
    const item = { stop, start, travel: i === 0 || reduced ? 0 : TRAVEL_S, hold: holdFor(stop.caption) };
    start += item.travel + item.hold;
    return item;
  });
  return { items, length: start, reduced };
}

interface Look { target: V3; width: number; az: number; el: number }

/** A stop's look at u from 0 (arrived) to 1 (leaving): a slow turn and push in, or none with reduced motion. */
function lookAt(stop: TourStop, u: number, reduced: boolean): Look {
  const drift = reduced ? 0 : u - 0.5;
  return { target: stop.target, width: stop.width * (1 - (reduced ? 0 : PUSH * u)), az: (stop.azimuth_deg + DRIFT_DEG * drift) * Math.PI / 180, el: stop.elevation_deg * Math.PI / 180 };
}

/** Smooth start and stop: zero speed and acceleration at both ends. */
const ease = (u: number) => u * u * u * (u * (6 * u - 15) + 10);
const mix = (a: number, b: number, e: number) => a + (b - a) * e;

/** The camera's place and aim at time t (seconds), which stop it is on, and whether the tour has ended. */
export function tourPose(timeline: TourTimeline, t: number, aspect: number): { position: V3; target: V3; index: number; done: boolean } {
  const { items, length, reduced } = timeline;
  const time = Math.min(Math.max(t, 0), length);
  let index = items.findIndex(item => time < item.start + item.travel + item.hold);
  if (index < 0) index = items.length - 1;
  const item = items[index], local = time - item.start;
  let look: Look;
  if (local < item.travel) {
    // Fly from the last stop's leaving look to this one's arriving look: the aim moves straight, the framed width
    // changes by the same ratio each moment, and the direction turns evenly.
    const from = lookAt(items[index - 1].stop, 1, reduced), to = lookAt(item.stop, 0, reduced), e = ease(local / item.travel);
    look = { target: from.target.map((v, k) => mix(v, to.target[k], e)) as V3, width: from.width * (to.width / from.width) ** e, az: mix(from.az, to.az, e), el: mix(from.el, to.el, e) };
  } else look = lookAt(item.stop, (local - item.travel) / item.hold, reduced);
  // The distance fits the width across the view, and a little over half of it up and down.
  const tan = Math.tan(FOV / 2 * Math.PI / 180), d = Math.max(look.width / 2 / (tan * Math.max(aspect, 0.3)), look.width * 0.31 / tan);
  const dir: V3 = [Math.sin(look.az) * Math.cos(look.el), Math.sin(look.el), -Math.cos(look.az) * Math.cos(look.el)];
  return { position: look.target.map((v, k) => v + d * dir[k]) as V3, target: look.target, index, done: t >= length };
}
