import { describe, expect, it } from 'vitest';
import { TWIN_MODES } from '@/lib/twin/types';
import { MODE_SCENES, PARTS, UPSTREAM, VIEW, beamGlow, drawnBraggDeg, lcdVolts, partActive } from './hutch-parts';

// The scene's minimum width in CSS pixels (.hutch-stage in twin.css) and a generous width per label character.
const MIN_WIDTH_PX = 1140, CHAR_PX = 6.6, PADDING_PX = 20, CHIP_PX = 24;

describe('hutch parts', () => {
  it('has one entry per part, each label and tip inside the drawing', () => {
    expect(new Set(PARTS.map(p => p.id)).size).toBe(PARTS.length);
    for (const { at, tip } of PARTS) for (const [x, y] of [at, tip]) {
      expect(x).toBeGreaterThanOrEqual(VIEW.x);
      expect(x).toBeLessThanOrEqual(VIEW.x + VIEW.width);
      expect(y).toBeGreaterThanOrEqual(VIEW.y);
      expect(y).toBeLessThanOrEqual(VIEW.y + VIEW.height);
    }
  });

  it('labels on one shelf do not overlap at the minimum scene width', () => {
    const unitsPerPx = VIEW.width / MIN_WIDTH_PX;
    const shelves = new Map<number, { name: string; x0: number; x1: number }[]>();
    for (const p of PARTS) {
      const half = (p.name.length * CHAR_PX + PADDING_PX) * unitsPerPx / 2;
      shelves.set(p.at[1], [...shelves.get(p.at[1]) ?? [], { name: p.name, x0: p.at[0] - half, x1: p.at[0] + half }]);
    }
    for (const row of shelves.values()) {
      row.sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < row.length; i++) expect(row[i].x0, `${row[i - 1].name} and ${row[i].name}`).toBeGreaterThan(row[i - 1].x1);
    }
    // Shelves are at least one 24 px target apart.
    const ys = [...shelves.keys()].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect((ys[i] - ys[i - 1]) / unitsPerPx).toBeGreaterThanOrEqual(CHIP_PX);
  });

  it('every mode names real parts, and the parts it emphasises are in use', () => {
    const ids = new Set(PARTS.map(p => p.id));
    for (const mode of TWIN_MODES) {
      const scene = MODE_SCENES[mode];
      for (const id of [...scene.downstream, ...scene.emphasis]) expect(ids.has(id), `${mode}: ${id}`).toBe(true);
      for (const id of scene.emphasis) expect(partActive(mode, id), `${mode}: ${id}`).toBe(true);
      expect(scene.legs).toContain('upstream');
    }
    for (const id of UPSTREAM) expect(ids.has(id)).toBe(true);
  });

  it('transmission uses the chambers after the sample, fluorescence the detector instead', () => {
    expect(partActive('transmission', 'it')).toBe(true);
    expect(partActive('transmission', 'fluorescence-detector')).toBe(false);
    expect(partActive('fluorescence', 'fluorescence-detector')).toBe(true);
    expect(partActive('fluorescence', 'it')).toBe(false);
    expect(partActive('electron-yield', 'drain-current')).toBe(true);
  });

  it('beam glow is zero for no beam, one for the full beam and rises with the fraction', () => {
    expect(beamGlow(0)).toBe(0);
    expect(beamGlow(1)).toBeCloseTo(1, 12);
    expect(beamGlow(2)).toBeCloseTo(1, 12);
    const glows = [1e-4, 0.01, 0.1, 0.5].map(beamGlow);
    for (let i = 1; i < glows.length; i++) expect(glows[i]).toBeGreaterThan(glows[i - 1]);
  });

  it('draws the Bragg angle inside the legible range and keeps the true one inside it', () => {
    expect(drawnBraggDeg(12.68)).toBe(12.68);
    expect(drawnBraggDeg(3)).toBe(7);
    expect(drawnBraggDeg(70)).toBe(40);
    expect(drawnBraggDeg(null)).toBe(9);
  });

  it('shows volts on the amplifier display, or OVER once it clips', () => {
    expect(lcdVolts(1.23456, false)).toBe('1.235 V');
    expect(lcdVolts(10, true)).toBe('OVER');
  });
});
