import { describe, expect, it } from 'vitest';
import type { TwinMode } from '@/lib/twin/types';
import { PARTS, sceneFor } from './hutch-parts';
import { CLOSE_UP, FLOOR, FOV, LABEL3, SHELF_GAP, TIP3, clampToBox, focusX3, frameFor, toThree } from './hutch-3d-layout';

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
      expect(x).toBe(part.at[0]);
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
});
