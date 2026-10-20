import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { seededRandom } from '../xas';
import { loadOptics } from './tables';
import { absorbedFraction } from './chambers';
import { gaussian, poisson, runScan, simulatePoint, XDI_COLUMNS, type PointOptions } from './acquire';
import { muComponents, transmission } from './sample';
import { defaultPlan } from './scan';
import { deadTime, inputRate } from './sdd';
import { DEFAULT_TWIN } from '../../components/twin/twin-state';
import type { ChamberConfig, ScanPlan, TwinState } from './types';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

const chamber = (state: TwinState, id: ChamberConfig['id']) => state.profile.chambers.find(c => c.id === id)!;
const noRandom = () => { throw new Error('educational mode must not draw random numbers'); };
const FLUX = 1e9;

/** ln(I0/It) the chambers alone add: gains, absorbed fractions and W, and the I0 chamber's own transmission. */
function chamberOffset(state: TwinState, orders: { energy_eV: number; flux: number }[], sampleT: (E: number) => number) {
  const i0 = chamber(state, 'I0'), it = chamber(state, 'It');
  let s0 = 0, st = 0;
  for (const { energy_eV, flux } of orders) {
    const a0 = absorbedFraction(i0.gas, i0.length_cm, energy_eV), at = absorbedFraction(it.gas, it.length_cm, energy_eV);
    s0 += flux * a0.absorbed * energy_eV / a0.W_eV;
    st += flux * a0.transmitted * sampleT(energy_eV) * at.absorbed * energy_eV / at.W_eV;
  }
  return Math.log(i0.gain_V_per_A * s0 / (it.gain_V_per_A * st));
}

const pointAt = (state: TwinState, energy_eV: number, orders: PointOptions['orders']) => simulatePoint(state, energy_eV, noRandom, { orders });

describe('acquisition', () => {
  it('golden: with no harmonics and an ideal sample, ln(I0/It) is mu x from sample.ts plus the chamber terms', () => {
    for (const energy_eV of [8800, 8979, 9000, 9400]) {
      const orders = [{ order: 1, energy_eV, flux: FLUX }];
      const p = pointAt(DEFAULT_TWIN, energy_eV, orders);
      expect(p.saturated).toEqual([]);
      const muX = transmission(DEFAULT_TWIN.sample, DEFAULT_TWIN.environment, energy_eV).apparentMuX;
      const fixed = chamberOffset(DEFAULT_TWIN, orders, () => 1);
      expect(Math.abs(Math.log(p.i0 / p.it) - fixed - muX)).toBeLessThan(1e-9);
    }
  });

  it('golden: a 10 % harmonic shrinks the edge step as the mixture formula predicts', () => {
    const e0 = 8979, below = e0 - 50, above = e0 + 50;
    const sampleT = (E: number) => Math.exp(-muComponents(DEFAULT_TWIN.sample, E).total_cm_inv * DEFAULT_TWIN.sample.thickness_um * 1e-4);
    const mixture = (E: number, h: number) => [{ order: 1, energy_eV: E, flux: FLUX * (1 - h) }, { order: 3, energy_eV: 3 * E, flux: FLUX * h }];
    const measured = (E: number, h: number) => { const p = pointAt(DEFAULT_TWIN, E, mixture(E, h)); return Math.log(p.i0 / p.it); };
    // Expected ln(I0/It) from the chamber and sample terms summed over the two orders (chamberOffset with the sample inside).
    const expected = (E: number, h: number) => chamberOffset(DEFAULT_TWIN, mixture(E, h), sampleT);
    for (const E of [below, above]) expect(Math.abs(measured(E, 0.1) - expected(E, 0.1))).toBeLessThan(1e-9);
    const clean = measured(above, 0) - measured(below, 0), mixed = measured(above, 0.1) - measured(below, 0.1);
    expect(mixed).toBeLessThan(clean);
    expect(mixed / clean).toBeLessThan(0.98);
  });

  it('golden: pinholes reduce the edge step to -ln((1 - a) exp(-mu x) + a)', () => {
    const a = 0.05, state = { ...DEFAULT_TWIN, sample: { ...DEFAULT_TWIN.sample, pinholeFraction: a } };
    for (const E of [8900, 9100]) {
      const orders = [{ order: 1, energy_eV: E, flux: FLUX }];
      const p = pointAt(state, E, orders);
      const muX = muComponents(state.sample, E).total_cm_inv * state.sample.thickness_um * 1e-4;
      const expected = -Math.log((1 - a) * Math.exp(-muX) + a);
      expect(Math.abs(Math.log(p.i0 / p.it) - chamberOffset(state, orders, () => 1) - expected)).toBeLessThan(1e-9);
    }
  });

  it('dead-time correction of the output rate recovers the input rate within 0.5 %', () => {
    // A far detector keeps the input rate on the low-rate branch of the paralyzable model.
    const state = { ...DEFAULT_TWIN, mode: 'fluorescence' as const, profile: { ...DEFAULT_TWIN.profile, sdd: { ...DEFAULT_TWIN.profile.sdd, distance_mm: 3000 } } };
    const p = simulatePoint(state, 9000, noRandom);
    expect(p.deadFraction).toBeGreaterThan(0.05);
    expect(p.icr * deadTime(state.profile.sdd.peaking_us)).toBeLessThan(1);
    expect(Math.abs(inputRate(p.ocr, deadTime(state.profile.sdd.peaking_us)) / p.icr - 1)).toBeLessThan(0.005);
    expect(p.ifluor).toBeGreaterThan(0);
  });

  it('the default chambers read on scale across the Cu K scan', () => {
    for (const E of [8779, 8979, 9000, 9400, 9527]) expect(simulatePoint(DEFAULT_TWIN, E, noRandom).saturated).toEqual([]);
  });

  it('a mono offset moves the true energy: the edge appears at the reading minus the offset', () => {
    const state = { ...DEFAULT_TWIN, profile: { ...DEFAULT_TWIN.profile, mono: { ...DEFAULT_TWIN.profile.mono, offset_eV: 3 } } };
    const p = simulatePoint(state, 9000, noRandom);
    expect(p.trueEnergy_eV).toBeCloseTo(9003, 9);
  });

  it('a whole scan has the XDI columns, ratios and hidden truth, and the same seed repeats it exactly', () => {
    const plan: ScanPlan = { ...defaultPlan(8979), repeats: 2 };
    const realistic = { ...DEFAULT_TWIN, realistic: true };
    const a = runScan(realistic, plan, seededRandom(7)), b = runScan(realistic, plan, seededRandom(7)), c = runScan(realistic, plan, seededRandom(8));
    expect(Object.keys(a.columns)).toEqual([...XDI_COLUMNS]);
    expect(a.columns).toEqual(b.columns);
    expect(a.columns.i0).not.toEqual(c.columns.i0);
    const n = a.columns.energy.length;
    for (const name of XDI_COLUMNS) expect(a.columns[name]).toHaveLength(n);
    const i = 100;
    expect(a.columns.mutrans[i]).toBeCloseTo(Math.log(a.columns.i0[i] / a.columns.itrans[i]), 12);
    expect(a.columns.murefer[i]).toBeCloseTo(Math.log(a.columns.itrans[i] / a.columns.irefer[i]), 12);
    expect(a.metadata['Element.symbol']).toBe('Cu');
    expect(a.metadata['Mono.d_spacing']).toBe('3.135601');  // 5.431020511 / sqrt(3)
    expect(a.truth!.dose_Gy).toBeGreaterThan(0);
    expect(a.truth!.drift_eV).toBeGreaterThan(0);
  });

  it('educational scans are expected values: mutrans is mu x from sample.ts plus the chamber terms at every point', () => {
    const scan = runScan(DEFAULT_TWIN, defaultPlan(8979), noRandom);
    const { energy, mutrans } = scan.columns;
    for (let i = 0; i < energy.length; i += 37) {
      const E = energy[i];
      const muX = transmission(DEFAULT_TWIN.sample, DEFAULT_TWIN.environment, E).apparentMuX;
      // The real beam carries about 1e-5 of harmonics, which is the whole of the difference.
      expect(Math.abs(mutrans[i] - chamberOffset(DEFAULT_TWIN, [{ energy_eV: E, flux: 1 }], () => 1) - muX)).toBeLessThan(1e-3);
    }
  });

  it('random helpers: Poisson and normal deviates have the right mean and spread', () => {
    const random = seededRandom(3);
    const draws = Array.from({ length: 20000 }, () => poisson(4, random));
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
    const variance = draws.reduce((s, v) => s + (v - mean) ** 2, 0) / draws.length;
    expect(mean).toBeCloseTo(4, 1);
    expect(variance).toBeCloseTo(4, 0);
    const normal = Array.from({ length: 20000 }, () => gaussian(random));
    expect(normal.reduce((s, v) => s + v * v, 0) / normal.length).toBeCloseTo(1, 1);
  });

  it('benchmark: 600 points in well under a second (target 150 ms warm)', () => {
    const plan: ScanPlan = { kind: 'step', repeats: 1, settle_s: 0.2, regions: [{ space: 'E', start: -200, end: 399, step: 1, dwell_s: 1 }] };
    runScan(DEFAULT_TWIN, plan, noRandom);  // warm the JIT
    const start = performance.now();
    const scan = runScan({ ...DEFAULT_TWIN, realistic: true }, plan, seededRandom(1));
    const elapsed = performance.now() - start;
    expect(scan.columns.energy).toHaveLength(600);
    expect(elapsed).toBeLessThan(450);
  });
});
