import { describe, expect, it } from 'vitest';
import type { TwinMode } from '@/lib/twin/types';
import { PARTS, sceneFor } from './hutch-parts';
import { CLOSE_UP, FLOOR, FOV, LABEL3, SHELF_GAP, SWAY, TIP3, BRAGG_MOTOR, ROCKING, clampToBox, focusX3, frameFor, motorStep, rockingDetune, swayAngle, toThree, type Motor } from './hutch-3d-layout';

const MODES: TwinMode[] = ['transmission', 'fluorescence', 'electron-yield', 'xrf', 'mono', 'calibration', 'time-resolved', 'damage'];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('3D hutch layout', () => {
  it('gives every part a point on its hardware and a label, above the floor', () => {
    for (const part of PARTS) {
      expect(TIP3[part.id]).toHaveLength(3);
      expect(LABEL3[part.id]).toHaveLength(3);
      expect(TIP3[part.id][1]).toBeGreaterThan(FLOOR);
      expect(LABEL3[part.id][1]).toBeGreaterThan(FLOOR);
    }
  });

  it('floats labels above their part, except the two below the table, which sit on the floor in front', () => {
    for (const part of PARTS) {
      const [x, y, z] = LABEL3[part.id];
      if (part.at[1] > 300) { expect(y).toBeLessThan(0); expect(z).toBeLessThan(-100); }
      else expect(y).toBeGreaterThanOrEqual(TIP3[part.id][1]);
    }
  });

  it('keeps the diagram shelf order and spacing for labels, top shelf highest', () => {
    const heights = [...new Set(PARTS.filter(p => p.at[1] < 300).map(p => LABEL3[p.id][1]))].sort((a, b) => b - a);
    expect(heights).toHaveLength(4);
    for (let i = 1; i < heights.length; i++) expect(heights[i - 1] - heights[i]).toBeCloseTo(SHELF_GAP, 5);
  });

  it('frames each mode on the parts it is about, from in front, above and a little to the left', () => {
    for (const mode of MODES) {
      const { target, position } = frameFor(mode, false, 2);
      expect(target[0]).toBeCloseTo(focusX3(mode), 6);
      expect(position[2]).toBeLessThan(target[2]);
      expect(position[1]).toBeGreaterThan(target[1]);
      expect(position[0]).toBeLessThan(target[0]);
      for (const id of sceneFor(mode).emphasis) expect(Math.abs(TIP3[id][0] - target[0])).toBeLessThan(280);
    }
  });

  it('fits the requested width in a wide box and the height in a tall one, and stands further back for the whole beamline', () => {
    const t = Math.tan(FOV / 2 * Math.PI / 180);
    const wide = frameFor('transmission', false, 2.5), tall = frameFor('transmission', false, 1);
    expect(dist(wide.position, wide.target)).toBeCloseTo(Math.max(CLOSE_UP.wide / 2 / (t * 2.5), CLOSE_UP.height / 2 / t), 6);
    expect(dist(tall.position, tall.target)).toBeCloseTo(CLOSE_UP.narrow / 2 / t, 6);
    const whole = frameFor('transmission', true, 2.5);
    expect(dist(whole.position, whole.target)).toBeGreaterThan(dist(wide.position, wide.target) * 1.5);
    expect(whole.target[0]).toBe(780);
  });

  it('clamps points to the box and says when it had to', () => {
    expect(clampToBox(50, 60, 400, 300)).toEqual({ x: 50, y: 60, outside: false });
    expect(clampToBox(-20, 400, 400, 300)).toEqual({ x: 14, y: 286, outside: true });
    expect(clampToBox(390, 100, 400, 300, 14, 60)).toEqual({ x: 340, y: 100, outside: true });
  });

  it('turns world coordinates into three.js ones by flipping the depth', () => {
    expect(toThree([1, 2, 3])).toEqual([1, 2, -3]);
  });

  it('sways the idle view only after a pause, easing in, never past its swing, and smoothly', () => {
    expect(swayAngle(0)).toBe(0);
    expect(swayAngle(SWAY.idle_ms)).toBe(0);
    const max = SWAY.amplitude_deg * Math.PI / 180;
    let peak = 0, last = 0;
    for (let ms = SWAY.idle_ms; ms < SWAY.idle_ms + 3 * SWAY.period_ms; ms += 1000 / 30) {
      const a = swayAngle(ms);
      expect(Math.abs(a)).toBeLessThanOrEqual(max + 1e-12);
      // At 30 frames a second the view turns well under a tenth of a degree per frame.
      expect(Math.abs(a - last)).toBeLessThan(0.1 * Math.PI / 180);
      peak = Math.max(peak, Math.abs(a)); last = a;
    }
    expect(peak).toBeCloseTo(max, 3);
    // The quarter period after the ramp is the full swing.
    expect(swayAngle(SWAY.idle_ms + SWAY.period_ms * 1.25)).toBeCloseTo(max, 9);
  });

  it('drives the Bragg axis like a motor: top speed, smooth stop on the target, no overshoot', () => {
    const deg = Math.PI / 180, { speed_rad_s: vmax, accel_rad_s2: a } = BRAGG_MOTOR;
    const run = (from: number, to: number, dt: number) => {
      let m: Motor = { position: from, velocity: 0 }, t = 0, fastest = 0;
      while ((m.position !== to || m.velocity !== 0) && t < 60) {
        m = motorStep(m, to, dt); t += dt; fastest = Math.max(fastest, Math.abs(m.velocity));
        expect(Math.sign(to - from) * (m.position - to)).toBeLessThanOrEqual(1e-12);
      }
      return { t, fastest, m };
    };
    // A 10 degree move: accelerate, cruise, brake; the trapezoid takes d/vmax + vmax/a.
    const long = run(12 * deg, 2 * deg, 1 / 60);
    expect(long.m.position).toBe(2 * deg);
    expect(long.fastest).toBeLessThanOrEqual(vmax + 1e-12);
    expect(long.t).toBeGreaterThan(10 * deg / vmax);
    expect(long.t).toBeLessThan(10 * deg / vmax + vmax / a + 0.1);
    // A scan step of a thousandth of a degree is over in a fraction of a second.
    expect(run(12 * deg, 12.001 * deg, 1 / 60).t).toBeLessThan(0.1);
    // No time, no motion; one long frame lands where many short ones do.
    expect(motorStep({ position: 1, velocity: 0 }, 0, 0)).toEqual({ position: 1, velocity: 0 });
    const one = motorStep({ position: 0, velocity: 0 }, deg, 0.5), many = Array.from({ length: 30 }).reduce<Motor>(m => motorStep(m, deg, 0.5 / 30), { position: 0, velocity: 0 });
    expect(one.position).toBeCloseTo(many.position, 9);
    // A target that jumps behind a moving motor: it brakes, turns and still lands exactly.
    let m: Motor = { position: 0, velocity: vmax };
    for (let i = 0; i < 600 && (m.position !== -deg || m.velocity !== 0); i++) m = motorStep(m, -deg, 1 / 60);
    expect(m).toEqual({ position: -deg, velocity: 0 });
  });

  it('rocks the second crystal either side of the set detune', () => {
    expect(rockingDetune(0)).toBe(0);
    expect(rockingDetune(ROCKING.period_s / 4)).toBeCloseTo(ROCKING.amplitude, 12);
    expect(rockingDetune(ROCKING.period_s * 3 / 4)).toBeCloseTo(-ROCKING.amplitude, 12);
  });
});
