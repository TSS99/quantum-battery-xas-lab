import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { seededRandom } from '../xas';
import { loadOptics } from './tables';
import { LIVE_DWELL_S, liveSample, scopeTop } from './live-feed';
import { status } from './twin';
import { DEFAULT_TWIN } from '../../components/twin/twin-state';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

describe('live feed', () => {
  it('reads the amplifier voltages the 3D displays show, without noise in clarity mode', () => {
    const state = { ...DEFAULT_TWIN, realistic: false }, s = status(state), sample = liveSample(state, 0, seededRandom(1));
    expect(sample.i0_V / s.i0!.voltage_V).toBeCloseTo(1, 5);
    expect(sample.it_V / s.it!.voltage_V).toBeCloseTo(1, 4);
    // The status readout and the scan work out the reference foil's path separately; they agree to a few parts in 10^4.
    expect(sample.iref_V / s.iref!.voltage_V).toBeCloseTo(1, 3);
    expect(liveSample(state, 3, seededRandom(2))).toEqual({ ...sample, t: 3 });
  });

  it('scatters about the same values in realistic mode, and follows a change at once', () => {
    const state = { ...DEFAULT_TWIN, realistic: true }, s = status({ ...state, realistic: false }), random = seededRandom(7);
    const samples = Array.from({ length: 400 }, (_, i) => liveSample(state, i * LIVE_DWELL_S, random));
    const mean = samples.reduce((a, b) => a + b.it_V, 0) / samples.length;
    expect(new Set(samples.map(x => x.it_V)).size).toBeGreaterThan(300);
    expect(mean / s.it!.voltage_V).toBeGreaterThan(0.97);
    expect(mean / s.it!.voltage_V).toBeLessThan(1.03);
    // A thicker sample passes less: the next sample already shows it.
    const thick = { ...state, realistic: false, sample: { ...state.sample, thickness_um: state.sample.thickness_um * 2 } };
    expect(liveSample(thick, 0, random).it_V).toBeLessThan(s.it!.voltage_V * 0.9);
  });

  it('counts fluorescence as a rate in the counting window', () => {
    const state = { ...DEFAULT_TWIN, realistic: false };
    const short = liveSample(state, 0, seededRandom(1), 0.1), long = liveSample(state, 0, seededRandom(1), 1);
    expect(short.if_cps).toBeCloseTo(long.if_cps, 6);
  });

  it('rounds the scope axis up to a 1, 2 or 5 step, never past full scale', () => {
    expect(scopeTop(0)).toBe(1);
    expect(scopeTop(0.8)).toBe(1);
    expect(scopeTop(1.2)).toBe(2);
    expect(scopeTop(3.1)).toBe(5);
    expect(scopeTop(0.031)).toBe(0.05);
    expect(scopeTop(9.5)).toBe(10);
    expect(scopeTop(10)).toBe(10);
  });
});
