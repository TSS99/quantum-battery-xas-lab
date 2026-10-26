import { describe, expect, it } from 'vitest';
import { FLOOR } from './hutch-3d-layout';
import { SOURCE_X, XS } from './hutch-parts';
import { DRIFT_DEG, TRAVEL_S, holdFor, tourPose, tourStops, tourTimeline } from './hutch-tour';

const FULL = { collimating: true, harmonicRejectionIn: true };
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('guided tour of the hutch', () => {
  it('starts and ends on the whole beamline and visits the parts in beam order', () => {
    const stops = tourStops(FULL);
    expect(stops[0].id).toBe('overview');
    expect(stops.at(-1)!.id).toBe('scan');
    const parts = stops.slice(1, -1).map(s => s.target[0]);
    expect(parts[0]).toBeCloseTo(SOURCE_X + 30, 5);
    for (let i = 1; i < parts.length; i++) expect(parts[i]).toBeGreaterThan(parts[i - 1]);
    expect(stops.some(s => s.target[0] === XS)).toBe(true);
  });

  it('skips the collimating mirror when the beamline has none, and says when the harmonic mirror is out', () => {
    expect(tourStops(FULL).map(s => s.id)).toContain('collimating-mirror');
    expect(tourStops({ ...FULL, collimating: false }).map(s => s.id)).not.toContain('collimating-mirror');
    const hrm = (on: boolean) => tourStops({ ...FULL, harmonicRejectionIn: on }).find(s => s.id === 'harmonic-rejection')!.caption;
    expect(hrm(false)).toContain('out of the beam');
    expect(hrm(true)).not.toContain('out of the beam');
  });

  it('holds each stop long enough to read its caption', () => {
    expect(holdFor('one two')).toBe(3.5);
    expect(holdFor('word '.repeat(30).trim())).toBeCloseTo(1.5 + 30 * 0.22, 9);
    const { items, length } = tourTimeline(tourStops(FULL), false);
    expect(items[0].travel).toBe(0);
    for (const item of items.slice(1)) expect(item.travel).toBe(TRAVEL_S);
    expect(length).toBeCloseTo(items.reduce((s, i) => s + i.travel + i.hold, 0), 9);
    expect(length).toBeGreaterThan(50);
    expect(length).toBeLessThan(110);
  });

  it('arrives exactly on each stop and moves without jumps', () => {
    const timeline = tourTimeline(tourStops(FULL), false);
    for (const item of timeline.items) {
      const at = tourPose(timeline, item.start + item.travel, 1.6);
      at.target.forEach((v, k) => expect(v).toBeCloseTo(item.stop.target[k], 6));
      expect(at.index).toBe(timeline.items.indexOf(item));
    }
    // At 60 frames a second the camera never moves more than a fraction of the scene in one frame.
    let last = tourPose(timeline, 0, 1.6);
    for (let t = 1 / 60; t < timeline.length; t += 1 / 60) {
      const now = tourPose(timeline, t, 1.6);
      expect(dist(now.position, last.position)).toBeLessThan(40);
      expect(dist(now.target, last.target)).toBeLessThan(10);
      last = now;
    }
  });

  it('keeps the camera above the floor, in front of the beamline and inside the orbit limits', () => {
    for (const aspect of [0.46, 1.6, 2.4]) {
      const timeline = tourTimeline(tourStops(FULL), false);
      for (let t = 0; t < timeline.length; t += 0.25) {
        const { position, target } = tourPose(timeline, t, aspect);
        expect(position[1]).toBeGreaterThan(FLOOR + 40);
        expect(position[2]).toBeLessThan(target[2]);
        const d = dist(position, target), polar = Math.acos((position[1] - target[1]) / d);
        const azimuth = Math.atan2(position[0] - target[0], target[2] - position[2]);
        expect(polar).toBeGreaterThanOrEqual(0.25);
        expect(polar).toBeLessThanOrEqual(1.47);
        expect(Math.abs(azimuth)).toBeLessThanOrEqual(1.1);
        expect(d).toBeGreaterThanOrEqual(120);
      }
    }
  });

  it('fits more distance in a tall box, so a phone still sees the whole part', () => {
    const timeline = tourTimeline(tourStops(FULL), false), t = timeline.items[3].start + timeline.items[3].travel;
    const far = tourPose(timeline, t, 0.46), near = tourPose(timeline, t, 1.6);
    expect(dist(far.position, far.target)).toBeGreaterThan(dist(near.position, near.target) * 2);
  });

  it('turns slowly while it holds a stop, and cuts and holds still with reduced motion', () => {
    const moving = tourTimeline(tourStops(FULL), false), item = moving.items[2];
    const a = tourPose(moving, item.start + item.travel, 1.6), b = tourPose(moving, item.start + item.travel + item.hold - 1e-6, 1.6);
    const angle = (p: number[], q: number[]) => Math.atan2(p[0] - q[0], q[2] - p[2]) * 180 / Math.PI;
    expect(angle(b.position, b.target) - angle(a.position, a.target)).toBeCloseTo(DRIFT_DEG, 3);

    const still = tourTimeline(tourStops(FULL), true);
    expect(still.items.every(i => i.travel === 0)).toBe(true);
    const s = still.items[2], first = tourPose(still, s.start, 1.6), end = tourPose(still, s.start + s.hold - 1e-6, 1.6);
    expect(end.position).toEqual(first.position);
    expect(tourPose(still, s.start - 1e-6, 1.6).index).toBe(1);
  });

  it('says when it has ended', () => {
    const timeline = tourTimeline(tourStops(FULL), false);
    expect(tourPose(timeline, timeline.length - 0.01, 1.6).done).toBe(false);
    const end = tourPose(timeline, timeline.length + 5, 1.6);
    expect(end.done).toBe(true);
    expect(end.index).toBe(timeline.items.length - 1);
  });
});
