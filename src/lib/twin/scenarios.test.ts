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
      expect(JSON.stringify({ ...c, state: { ...c.state, seed: 0 } })).not.toBe(JSON.stringify({ ...a, state: { ...a.state, seed: 0 } }));
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

  it('S2 hides each of its faults across seeds, each one costs real amplitude, and its fix restores it', () => {
    const s2 = scenarioOf('s2-amplitude')!;
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40 && seen.size < 2; seed++) {
      const { state, truth } = s2.setup(DEFAULT_STATE, seededRandom(seed));
      if (seen.has(truth.fault)) continue;
      seen.add(truth.fault);
      expect(state.mode).toBe('transmission');
      // The fault is visible: at least 5 % of the edge step is missing at the start.
      expect(truth.amplitude).toBeLessThan(0.95);
      expect(truth.amplitude).toBeGreaterThan(0.2);
      expect(s2.metrics({ state, truth, acquisitions: [] }).success).toBe(false);
      let fixed = state;
      if (truth.fault === 0) fixed = { ...state, sample: { ...state.sample, pinholeFraction: 0 } };
      if (truth.fault === 1) fixed = { ...state, sample: { ...state.sample, thickness_um: Math.round(state.sample.thickness_um / 3), thicknessSpread: 0.02 } };
      const after = s2.metrics({ state: fixed, truth, acquisitions: [] });
      expect(after.success, `fault ${truth.fault}`).toBe(true);
      expect(after.score).toBeGreaterThanOrEqual(85);
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });

  it('S2 measures with chamber currents, so a clipped amplifier does not change the score', () => {
    const s2 = scenarioOf('s2-amplitude')!;
    const { state, truth } = s2.setup(DEFAULT_STATE, seededRandom(2));
    const loud = { ...state, profile: { ...state.profile, chambers: state.profile.chambers.map(c => ({ ...c, gain_V_per_A: 1e11 })) } };
    expect(s2.metrics({ state: loud, truth, acquisitions: [] }).score).toBe(s2.metrics({ state, truth, acquisitions: [] }).score);
  });

  it('S3 rewards fluorescence at the dead-time limit over transmission or a swamped detector', () => {
    const s3 = scenarioOf('s3-dilute')!;
    const { state, truth } = s3.setup(DEFAULT_STATE, seededRandom(4));
    const score = (s: typeof state) => s3.metrics({ state: s, truth, acquisitions: [] });
    const sdd = (patch: object) => ({ ...state, mode: 'fluorescence' as const, profile: { ...state.profile, sdd: { ...state.profile.sdd, ...patch } } });
    expect(truth.best).toBeGreaterThan(5 * truth.transmission);
    expect(score(state).score).toBeLessThan(25);
    // Close up, the detector is swamped: past 25 % dead time the task scores nothing.
    expect(score(sdd({ distance_mm: 10 }))).toMatchObject({ score: 0, success: false });
    expect(score(sdd({ distance_mm: truth.distance_mm, peaking_us: truth.peaking_us }))).toMatchObject({ score: 100, success: true });
    expect(score(sdd({ distance_mm: 4 * truth.distance_mm, peaking_us: truth.peaking_us })).score).toBeLessThan(60);
    expect(s3.reveal(truth)).toContain(truth.best.toFixed(0));
  });

  it('S4 loses most of the white line to self absorption and gets it back by every honest route', () => {
    const s4 = scenarioOf('s4-self-absorption')!;
    const { state, truth } = s4.setup(DEFAULT_STATE, seededRandom(6));
    const score = (s: typeof state) => s4.metrics({ state: s, truth, acquisitions: [] });
    expect(truth.start).toBeGreaterThan(0.5);
    expect(score(state).score).toBe(0);
    const thin = (thickness_um: number) => ({ ...state.sample, thickness_um });
    const grazing = { ...state, profile: { ...state.profile, sdd: { ...state.profile.sdd, exitAngle_deg: 3 } } };
    // Grazing exit and a thin film each help, partly; electron yield and a thin transmission sample fix it.
    expect(score(grazing).score).toBeGreaterThan(score(state).score);
    expect(score({ ...state, sample: thin(1) }).score).toBeGreaterThan(score(grazing).score);
    expect(score({ ...state, mode: 'electron-yield' })).toMatchObject({ success: true });
    expect(score({ ...state, mode: 'transmission', sample: thin(5) })).toMatchObject({ success: true });
    // Transmission through the thick pellet is no answer: almost nothing gets through.
    expect(score({ ...state, mode: 'transmission' }).success).toBe(false);
    expect(score({ ...state, mode: 'mono' }).score).toBe(0);
  });

  it('every scenario text typesets', async () => {
    const katex = (await import('katex')).default;
    const check = (text: string) => text.split('$').forEach((part, i) => { if (i % 2) expect(() => katex.renderToString(part, { throwOnError: true, strict: 'error' }), part).not.toThrow(); });
    for (const scenario of SCENARIOS) {
      const { state, truth } = scenario.setup(DEFAULT_STATE, seededRandom(3));
      for (const text of [scenario.brief, scenario.reveal(truth), ...scenario.cues, ...scenario.metrics({ state, truth, acquisitions: [] }).details.map(d => d.value)]) {
        expect(text.split('$').length % 2, text).toBe(1);
        check(text);
      }
    }
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
