import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { seededRandom } from '../xas';
import { edgeEnergy, glitchResidual, simulatePoint } from './acquire';
import { CHAMBER_FILLS, FILL_TARGETS, absorbedFraction } from './chambers';
import { defaultPlan, planDuration, planPoints } from './scan';
import { PLAN_BUDGET_S, chamberFill, chiNoiseAt, glitchSpike, scanDamage, scenarioOf } from './scenarios';
import { loadOptics } from './tables';
import { DEFAULT_STATE, applyCommand } from './twin';
import type { TwinState } from './types';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const setupOf = (id: string, seed: number) => scenarioOf(id)!.setup({ ...DEFAULT_STATE, seed }, seededRandom(seed));
const score = (id: string, state: TwinState, truth: Record<string, number>) => scenarioOf(id)!.metrics({ state, truth, acquisitions: [] });

describe('S5 plan the beamtime', () => {
  it('starts short of k = 14, and the plan that just reaches the target in the fewest hours scores full marks', () => {
    for (const seed of SEEDS) {
      const { state, truth } = setupOf('s5-beamtime', seed);
      expect(truth.optimum_s).toBeGreaterThanOrEqual(2 * 3600);
      expect(truth.optimum_s).toBeLessThanOrEqual(5 * 3600);
      // The starting k = 12 plan cannot be scored at k = 14.
      expect(chiNoiseAt(state, 14)).toBe(Infinity);
      expect(score('s5-beamtime', state, truth)).toMatchObject({ score: 0, success: false });
      // The optimum: the k = 15 plan, continuous, with dwell times repeats just enough.
      const e0 = edgeEnergy(state.sample), base = { ...defaultPlan(e0), regions: defaultPlan(e0).regions.map(r => r.space === 'k' ? { ...r, end: 15 } : r) };
      const weights = planPoints(base, e0).dwell_s.reduce((a, b) => a + b, 0), needed = truth.optimum_s / weights;
      const repeats = Math.ceil(needed / 10), dwell_s = Math.ceil(needed / repeats * 10) / 10;
      const plan = { ...base, kind: 'continuous' as const, repeats, regions: base.regions.map(r => ({ ...r, dwell_s })) };
      const best = applyCommand(state, { type: 'scan', plan }).state;
      expect(chiNoiseAt(best, 14)).toBeLessThanOrEqual(truth.target * 1.0001);
      const result = score('s5-beamtime', best, truth);
      expect(result.success, JSON.stringify(result.details)).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(90);
      // Twice the dwell is twice the time for the same goal: half marks or so, and not a success.
      const slow = applyCommand(best, { type: 'scan', plan: { ...plan, regions: plan.regions.map(r => ({ ...r, dwell_s: 2 * dwell_s })) } }).state;
      expect(score('s5-beamtime', slow, truth).success).toBe(false);
      expect(score('s5-beamtime', slow, truth).score).toBeLessThan(60);
      // Too little dwell misses the target.
      const quick = applyCommand(best, { type: 'scan', plan: { ...plan, repeats: 1, regions: plan.regions.map(r => ({ ...r, dwell_s: 0.5 })) } }).state;
      expect(chiNoiseAt(quick, 14)).toBeGreaterThan(truth.target);
      expect(score('s5-beamtime', quick, truth).success).toBe(false);
      expect(planDuration(best.scan, e0).total_s).toBeLessThan(PLAN_BUDGET_S);
    }
  });
});

describe('S6 ion chamber gases', () => {
  it('starts with a wrong fill, every fault occurs, and the best fills on offer pass', () => {
    const faults = new Set<number>();
    for (const seed of SEEDS) {
      const { state, truth } = setupOf('s6-gases', seed);
      faults.add(truth.fault);
      const start = score('s6-gases', state, truth);
      expect(start.success).toBe(false);
      expect(start.score).toBeLessThan(80);
      let fixed = state;
      for (const role of ['I0', 'It'] as const) {
        const c = state.profile.chambers.find(x => x.id === role)!;
        const gap = (gas: (typeof CHAMBER_FILLS)[number]['gas']) => { const a = absorbedFraction(gas, c.length_cm, truth.energy_eV).absorbed, b = FILL_TARGETS[role]; return a < b.min ? b.min - a : a > b.max ? a - b.max : 0; };
        const best = CHAMBER_FILLS.reduce((a, f) => gap(f.gas) < gap(a.gas) ? f : a);
        fixed = applyCommand(fixed, { type: 'gas', chamber: role, gas: best.gas }).state;
      }
      const result = score('s6-gases', fixed, truth);
      expect(result).toMatchObject({ score: 100, success: true });
      // The fills on offer reach each band, or come within 2 points of it at the lowest energies.
      for (const f of chamberFill(fixed, truth.energy_eV)) { expect(f.gap, `seed ${seed} ${f.role}`).toBe(f.bestGap); expect(f.bestGap).toBeLessThanOrEqual(0.02); }
    }
    expect(faults).toEqual(new Set([0, 1, 2]));
  });
});

describe('S7 beam damage', () => {
  it('reduces most of the Cu(II) at the start; only a larger beam, fresh spots and a cryostat together save it, without losing signal', () => {
    for (const seed of SEEDS) {
      const { state, truth } = setupOf('s7-damage', seed);
      expect(truth.reduced).toBeGreaterThan(0.5);
      expect(score('s7-damage', state, truth).success).toBe(false);
      const beam = (s: TwinState) => applyCommand(s, { type: 'beam', beam_um: [2000, 2000] }).state;
      const spots = (s: TwinState) => applyCommand(s, { type: 'scan', plan: { ...s.scan, spots: 50 } }).state;
      const cold = (s: TwinState) => applyCommand(applyCommand(s, { type: 'environment', kind: 'cryostat' }).state, { type: 'temperature', temperature_K: 10 }).state;
      const result = score('s7-damage', cold(spots(beam(state))), truth);
      expect(result.success, JSON.stringify(result.details)).toBe(true);
      expect(result.score).toBe(100);
      // Any two of the three are not enough.
      for (const pair of [[beam, spots], [beam, cold], [spots, cold]]) expect(score('s7-damage', pair[1](pair[0](state)), truth).success).toBe(false);
      // Each lever lowers the dose on its own.
      expect(scanDamage(beam(state), truth.criticalDose_Gy).dose_Gy).toBeLessThan(scanDamage(state, truth.criticalDose_Gy).dose_Gy / 100);
      expect(scanDamage(spots(state), truth.criticalDose_Gy).dose_Gy).toBeLessThan(scanDamage(state, truth.criticalDose_Gy).dose_Gy);
      // Fewer photons also protect the sample, but the score asks for the signal back.
      const short = applyCommand(state, { type: 'scan', plan: { ...state.scan, regions: state.scan.regions.map(r => ({ ...r, dwell_s: 0.1 })) } }).state;
      expect(score('s7-damage', short, truth).success).toBe(false);
    }
  });
});

describe('S8 glitch hunt', () => {
  it('hides a non-uniform foil whose glitches spike ln(I0/It), and a uniform foil removes the spikes', () => {
    const faults = new Set<number>();
    for (const seed of SEEDS) {
      const { state, truth } = setupOf('s8-glitches', seed);
      faults.add(truth.fault);
      expect(truth.spike).toBeGreaterThanOrEqual(0.02);
      expect(state.realistic).toBe(true);
      expect(score('s8-glitches', state, truth)).toMatchObject({ score: 0, success: false });
      const uniform = applyCommand(state, { type: 'sample', patch: { pinholeFraction: 0, thicknessSpread: 0 } }).state;
      expect(glitchSpike(uniform)).toBeLessThan(1e-9);
      expect(score('s8-glitches', uniform, truth)).toMatchObject({ score: 100, success: true });
    }
    expect(faults).toEqual(new Set([0, 1]));
  });
});

describe('model pieces the new scenarios use', () => {
  it('divides the dose per spot by the scan spots, and clamps the beam size and the spots', () => {
    const point = (state: TwinState) => simulatePoint(state, 9000, () => 0.5, { dwell_s: 1 }).dose_Gy;
    const spread = applyCommand(DEFAULT_STATE, { type: 'scan', plan: { ...DEFAULT_STATE.scan, spots: 4 } }).state;
    expect(point(spread)).toBeCloseTo(point(DEFAULT_STATE) / 4, 10);
    expect(applyCommand(DEFAULT_STATE, { type: 'scan', plan: { ...DEFAULT_STATE.scan, spots: 500 } }).state.scan.spots).toBe(50);
    const big = applyCommand(DEFAULT_STATE, { type: 'beam', beam_um: [0, 9000] });
    expect(big.state.profile.beam_um).toEqual([1, 5000]);
    expect(big.note).toContain('area');
    // The same photons over a larger area: the dose rate falls with the area, the flux does not.
    const wide = applyCommand(DEFAULT_STATE, { type: 'beam', beam_um: [DEFAULT_STATE.profile.beam_um[0] * 2, DEFAULT_STATE.profile.beam_um[1] * 2] }).state;
    expect(point(wide)).toBeCloseTo(point(DEFAULT_STATE) / 4, 6);
    expect(simulatePoint(wide, 9000, () => 0.5).i0).toBeCloseTo(simulatePoint(DEFAULT_STATE, 9000, () => 0.5).i0, 6);
  });

  it('lets a glitch cancel on a uniform sample and leaves the dip times the mu x gap on an uneven one', () => {
    expect(glitchResidual(0.3, { muX: 2, apparentMuX: 2 })).toBe(0);
    expect(glitchResidual(0, { muX: 2, apparentMuX: 1 })).toBe(0);
    expect(glitchResidual(0.2, { muX: 2, apparentMuX: 1.5 })).toBeCloseTo(0.1, 12);
  });
});
