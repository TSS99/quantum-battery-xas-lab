import { describe, expect, it } from 'vitest';
import { CFF, GRATING_LINES_PER_MM, SOFT_PARTS, exitSlitGap_um, gratingAngles, placeLabels, relativeFlux, softActive } from './soft-parts';

const rad = (d: number) => d * Math.PI / 180;

describe('soft X-ray beamline', () => {
  it('puts the grating where the grating equation and the fixed focus constant both hold', () => {
    for (const e of [400, 530, 640, 900]) {
      const { alpha_deg, beta_deg, mirror_grazing_deg } = gratingAngles(e);
      const k = GRATING_LINES_PER_MM * 1239.84198e-6 / e;
      expect(Math.sin(rad(alpha_deg)) + Math.sin(rad(beta_deg)) - k).toBeCloseTo(0, 12);
      expect(Math.cos(rad(beta_deg)) / Math.cos(rad(alpha_deg))).toBeCloseTo(CFF, 10);
      expect(beta_deg).toBeLessThan(0);  // inside order
      expect(mirror_grazing_deg).toBeGreaterThan(0);
      expect(mirror_grazing_deg).toBeLessThan(10);  // soft X-rays reflect only at grazing angles
    }
    // Higher energy, shorter wavelength: the beam meets the grating closer to grazing.
    expect(gratingAngles(900).alpha_deg).toBeGreaterThan(gratingAngles(400).alpha_deg);
  });

  it('trades resolving power for flux at the exit slit', () => {
    expect(exitSlitGap_um(5000)).toBe(25);
    expect(exitSlitGap_um(10000)).toBe(12.5);
    expect(relativeFlux(1000)).toBe(5);
  });

  it('lists every part once along the beam, with one detector reading in each mode', () => {
    expect(new Set(SOFT_PARTS.map(p => p.id)).size).toBe(SOFT_PARTS.length);
    const xs = SOFT_PARTS.map(p => p.x);
    expect(xs.slice(0, 9)).toEqual([...xs.slice(0, 9)].sort((a, b) => a - b));
    expect([softActive('drain', 'tey'), softActive('sdd', 'tey')]).toEqual([true, false]);
    expect([softActive('drain', 'fy'), softActive('sdd', 'fy')]).toEqual([false, true]);
  });

  it('keeps named labels inside the view and apart, turning the rest into markers', () => {
    // Every part asks for the same crowded strip of a phone sized view, one past its right edge.
    const spots = SOFT_PARTS.map((p, i) => ({ id: p.id, x: 20 + i * 30, y: 2, half: 40 }));
    for (const open of [null, 'm1'] as const) {
      const placed = placeLabels(spots, 358, 260, open, 'tey');
      expect(placed.size).toBe(SOFT_PARTS.length);
      const named = [...placed].filter(([, at]) => !at.marker);
      for (const [, at] of named) {
        expect(at.x - 40).toBeGreaterThanOrEqual(0); expect(at.x + 40).toBeLessThanOrEqual(358);
        expect(at.y - 12).toBeGreaterThanOrEqual(0);
      }
      for (const [a, p] of named) for (const [b, q] of named) if (a !== b) expect(Math.abs(p.x - q.x) >= 84 || Math.abs(p.y - q.y) >= 26).toBe(true);
      // The open part always keeps its name; otherwise the monochromator comes first.
      expect(placed.get(open ?? 'pgm')!.marker).toBe(false);
    }
    // With room for everyone nothing becomes a marker.
    const wide = SOFT_PARTS.map((p, i) => ({ id: p.id, x: 50 + i * 100, y: 100, half: 40 }));
    expect([...placeLabels(wide, 1300, 400, null, 'fy').values()].every(at => !at.marker)).toBe(true);
  });
});
