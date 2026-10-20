import { describe, expect, it } from 'vitest';
import { KAPPA, defaultPlan, energyOfK, kOf, planDuration, planPoints, xanesStep_eV } from './scan';
import type { ScanPlan } from './types';

describe('scan plans', () => {
  it('uses 2 m_e / hbar^2 from CODATA 2018 for k', () => {
    // m_e c^2 = 510998.95 eV, hbar c = 1973.269804 eV Å.
    expect(KAPPA).toBeCloseTo(0.26246842, 8);
    expect(kOf(8979 + 100, 8979)).toBeCloseTo(Math.sqrt(100 * KAPPA), 12);
    expect(energyOfK(kOf(9500, 8979), 8979)).toBeCloseTo(9500, 9);
    expect(kOf(8900, 8979)).toBe(0);
  });

  it('follows the Larch XANES step: 0.35 eV at Cu K, 0.25 at Fe K, 0.45 at Pt L3', () => {
    expect(xanesStep_eV(8979)).toBeCloseTo(0.35, 12);
    expect(xanesStep_eV(7112)).toBeCloseTo(0.25, 12);
    expect(xanesStep_eV(11564)).toBeCloseTo(0.45, 12);
  });

  it('builds the default Cu K plan region by region, energies rising, dwell growing as k', () => {
    const plan = defaultPlan(8979), points = planPoints(plan, 8979);
    const counts = [0, 1, 2].map(r => points.region.filter(i => i === r).length);
    expect(counts[0]).toBe(17);   // -200 to -40 in 10 eV steps
    expect(counts[1]).toBe(200);  // -30 to +39.65 in 0.35 eV steps
    const k0 = kOf(8979 + 40, 8979);
    // Every k below 12 on the 0.05 grid; 12 itself is off the grid, so it is not added.
    expect(counts[2]).toBe(Math.ceil((12 - k0) / 0.05 - 1e-9));
    for (let i = 1; i < points.energy_eV.length; i++) expect(points.energy_eV[i]).toBeGreaterThan(points.energy_eV[i - 1]);
    const last = points.energy_eV.length - 1;
    expect(points.dwell_s[0]).toBe(1);
    expect(points.dwell_s[last]).toBeCloseTo(kOf(points.energy_eV[last], 8979) / k0, 9);
    expect(points.energy_eV[17]).toBeCloseTo(8979 - 30, 9);
  });

  it('keeps the end of the last region when it falls on the grid', () => {
    const plan: ScanPlan = { kind: 'step', repeats: 1, settle_s: 0, regions: [{ space: 'E', start: -10, end: 10, step: 5, dwell_s: 2 }] };
    expect(Array.from(planPoints(plan, 1000).energy_eV)).toEqual([990, 995, 1000, 1005, 1010]);
  });

  it('adds motor settling to step scans only', () => {
    const regions = [{ space: 'E' as const, start: 0, end: 9, step: 1, dwell_s: 0.5 }];
    const step = planDuration({ kind: 'step', repeats: 3, settle_s: 0.2, regions }, 5000);
    expect(step.points).toBe(10);
    expect(step.perSpectrum_s).toBeCloseTo(10 * 0.7, 9);
    expect(step.total_s).toBeCloseTo(21, 9);
    expect(planDuration({ kind: 'continuous', repeats: 1, settle_s: 0.2, regions }, 5000).perSpectrum_s).toBeCloseTo(5, 9);
  });

  it('rejects overlapping regions and empty steps', () => {
    const overlap: ScanPlan = { kind: 'step', repeats: 1, settle_s: 0, regions: [
      { space: 'E', start: -50, end: 50, step: 1, dwell_s: 1 }, { space: 'E', start: 0, end: 60, step: 1, dwell_s: 1 }] };
    expect(() => planPoints(overlap, 8979)).toThrow(/overlap/);
    expect(() => planPoints({ ...overlap, regions: [{ space: 'E', start: 0, end: 10, step: 0, dwell_s: 1 }] }, 8979)).toThrow(/step/);
  });
});
