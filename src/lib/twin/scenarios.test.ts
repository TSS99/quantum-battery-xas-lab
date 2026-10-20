import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { seededRandom } from '../xas';
import { loadOptics } from './tables';
import { SCENARIOS, scenarioOf } from './scenarios';
import { Recorder, TELEMETRY_FORMAT, validateTelemetry } from './telemetry';
import { DEFAULT_STATE, status } from './twin';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

describe('training scenarios', () => {
  it('the same seed gives the same hidden truth and starting state; another seed differs', () => {
    for (const scenario of SCENARIOS) {
      const a = scenario.setup({ ...DEFAULT_STATE, seed: 7 }, seededRandom(7));
      const b = scenario.setup({ ...DEFAULT_STATE, seed: 7 }, seededRandom(7));
      const c = scenario.setup({ ...DEFAULT_STATE, seed: 8 }, seededRandom(8));
      expect(a).toEqual(b);
      expect(a.state.seed).toBe(7);
      expect(JSON.stringify(c.truth) + c.state.energy_eV).not.toBe(JSON.stringify(a.truth) + a.state.energy_eV);
    }
  });

  it('S0 scores 100 at the edge, nothing 10 eV or more away', () => {
    const s0 = scenarioOf('s0-find-the-edge')!;
    const { state, truth } = s0.setup(DEFAULT_STATE, seededRandom(3));
    expect(Math.abs(state.energy_eV - truth.edge_eV)).toBeGreaterThan(100);
    expect(truth.edge_eV).toBeCloseTo(8979, 6);
    const at = (energy_eV: number) => s0.metrics({ state: { ...state, energy_eV }, truth, acquisitions: [] });
    expect(at(8979)).toMatchObject({ score: 100, success: true });
    expect(at(8984).score).toBe(50);
    expect(at(8990)).toMatchObject({ score: 0, success: false });
  });

  it('S1 hides an offset of 1 to 6 eV that really shifts the edge, and scores the residual', () => {
    const s1 = scenarioOf('s1-calibrate')!;
    for (let seed = 1; seed < 30; seed++) {
      const { truth } = s1.setup(DEFAULT_STATE, seededRandom(seed));
      expect(Math.abs(truth.offset_eV)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(truth.offset_eV)).toBeLessThanOrEqual(6);
    }
    const { state, truth } = s1.setup(DEFAULT_STATE, seededRandom(5));
    expect(state.mode).toBe('calibration');
    expect(status(state).trueEnergy_eV - state.energy_eV).toBeCloseTo(truth.offset_eV, 9);
    expect(s1.metrics({ state, truth, acquisitions: [], answer: truth.offset_eV })).toMatchObject({ score: 100, success: true });
    expect(s1.metrics({ state, truth, acquisitions: [], answer: truth.offset_eV + 1.5 }).score).toBe(50);
    expect(s1.metrics({ state, truth, acquisitions: [] })).toMatchObject({ score: 0, success: false });
    expect(s1.reveal(truth)).toContain(Math.abs(truth.offset_eV).toFixed(1));
  });
});

describe('telemetry', () => {
  it('records in the xaslab-twin-telemetry/1 format, in time order', () => {
    const recorder = new Recorder('abc', { id: 's0-find-the-edge', seed: 7 }, 'some', new Date('2026-10-21T00:00:00Z'));
    recorder.add({ t: 0.2, type: 'change', key: 'energy', from: '9000.0', to: '8979.0', source: 'ui' });
    recorder.add({ t: 0.5, type: 'snap', energy_eV: 8979, mode: 'transmission', score: 100 });
    recorder.add({ t: 0.9, type: 'judge', rating: 4, cues: ['x'], note: '' });
    recorder.add({ t: 1, type: 'end', score: 100, success: true });
    const log = JSON.parse(recorder.toJSON());
    expect(log.format).toBe(TELEMETRY_FORMAT);
    expect(log.started).toBe('2026-10-21T00:00:00.000Z');
    expect(validateTelemetry(log)).toEqual([]);
    expect(recorder.snapshots()).toHaveLength(1);
    expect(() => recorder.add({ t: 0.1, type: 'acquire' })).toThrow(/time order/);
    expect(validateTelemetry({ ...log, format: 'other', events: [{ t: -1, type: 'nope' }] })).toHaveLength(3);
  });
});
