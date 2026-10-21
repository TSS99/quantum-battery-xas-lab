import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { loadOptics } from './tables';
import { edgeEnergy, runScan } from './acquire';
import { beamAtSample } from './beam';
import { PROFILE_PRESETS, SAMPLE_PRESETS, resolveSamplePreset, thicknessFor } from './presets';
import { muComponents } from './sample';
import { defaultPlan } from './scan';
import { DEFAULT_STATE, applyCommand, energyRange, fromSession, rockingCurve, status, toSession, validateState, xrfSpectrum } from './twin';
import { handleScanRequest, type ScanMessage } from './worker';
import { seededRandom } from '../xas';
import type { ScanPlan } from './types';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

const SHORT: ScanPlan = { kind: 'step', repeats: 2, settle_s: 0, regions: [{ space: 'E', start: -20, end: 20, step: 2, dwell_s: 0.5 }] };

describe('presets', () => {
  it('every profile reaches the edge of its own sample preset with a positive flux', () => {
    for (const preset of PROFILE_PRESETS) {
      const sample = SAMPLE_PRESETS.find(s => s.id === preset.sample)!;
      const e0 = edgeEnergy(sample.sample);
      expect(e0).toBeGreaterThan(preset.range_eV[0]);
      expect(e0).toBeLessThan(preset.range_eV[1]);
      expect(beamAtSample(preset.profile, e0 + 50).flux, preset.id).toBeGreaterThan(0);
      expect(preset.name).not.toMatch(/ESRF|APS|SPring|Diamond|SLS|PETRA|NSLS|SSRL|ALS|SOLEIL|ELETTRA|BESSY/i);
    }
  });

  it('every profile reads on scale, between 0.1 and 9 V, with its own sample just above the edge', () => {
    for (const preset of PROFILE_PRESETS) {
      const state = applyCommand({ ...DEFAULT_STATE, profile: preset.profile }, { type: 'samplePreset', id: preset.sample }).state;
      const s = status(state);
      for (const reading of [s.i0, s.it, s.iref]) {
        expect(reading!.voltage_V, `${preset.id} ${reading!.voltage_V}`).toBeGreaterThan(0.1);
        expect(reading!.voltage_V, `${preset.id} ${reading!.voltage_V}`).toBeLessThan(9);
      }
    }
  });

  it('thickness rules give the edge step or total mu x they ask for, 50 eV above the edge', () => {
    for (const preset of SAMPLE_PRESETS) {
      const { sample, reference } = resolveSamplePreset(preset);
      const above = muComponents(sample, edgeEnergy(sample) + 50);
      if (typeof preset.thickness !== 'number') {
        const got = 'edgeStep' in preset.thickness ? above.sharpStep_cm_inv : above.total_cm_inv;
        const want = 'edgeStep' in preset.thickness ? preset.thickness.edgeStep : preset.thickness.muX;
        expect(got * sample.thickness_um * 1e-4, preset.id).toBeCloseTo(want, 2);
      }
      if (reference) expect(reference.thickness_um, preset.id).toBeGreaterThan(1);
    }
    // A Cu foil with an edge step of 1 is about 4.7 um thick (sharp step about 2120 per cm 50 eV above the edge).
    expect(thicknessFor({ ...SAMPLE_PRESETS[0].sample }, { edgeStep: 1 })).toBeCloseTo(4.71, 2);
  });
});

describe('status', () => {
  it('reports the beam, chambers, sample and detector at the current energy, all on scale', () => {
    const s = status(DEFAULT_STATE);
    expect(s.theta_deg).toBeCloseTo(12.6897, 3);
    expect(s.deltaE_eV).toBeGreaterThan(0.5);
    expect(s.flux).toBeGreaterThan(1e11);
    for (const chamber of [s.i0, s.it, s.iref]) expect(chamber!.saturated).toBe(false);
    expect(s.edgeStep).toBeCloseTo(1.5, 1);
    expect(s.muX).toBeGreaterThan(s.edgeStep!);
    expect(s.deadFraction).toBeGreaterThan(0);
    expect(s.afterFoil).toBeLessThan(s.afterIt);
  });

  it('a mono offset changes the true energy, not the reading', () => {
    const shifted = { ...DEFAULT_STATE, profile: { ...DEFAULT_STATE.profile, mono: { ...DEFAULT_STATE.profile.mono, offset_eV: -2 } } };
    const s = status(shifted);
    expect(s.energy_eV).toBe(9000);
    expect(s.trueEnergy_eV).toBe(8998);
  });
});

describe('XRF spectrum and rocking curve', () => {
  it('a thick Cu foil saturates a close detector completely', () => {
    expect(xrfSpectrum(DEFAULT_STATE)!.deadFraction).toBeGreaterThan(0.99);
  });

  it('with the detector 3 m back the Cu foil spectrum peaks at Cu Ka (8040 eV) inside the window', () => {
    const far = { ...DEFAULT_STATE, profile: { ...DEFAULT_STATE.profile, sdd: { ...DEFAULT_STATE.profile.sdd, distance_mm: 3000 } } };
    const mca = xrfSpectrum(far)!;
    expect(mca.deadFraction).toBeLessThan(0.9);
    let top = 0;
    for (let i = 1; i < mca.counts.length; i++) if (mca.counts[i] > mca.counts[top]) top = i;
    expect(Math.abs(mca.energies_eV[top] - 8040)).toBeLessThan(60);
    const [lo, hi] = DEFAULT_STATE.profile.sdd.roi_eV;
    expect(mca.energies_eV[top]).toBeGreaterThan(lo);
    expect(mca.energies_eV[top]).toBeLessThan(hi);
    expect(mca.roiCounts).toBeGreaterThan(0);
  });

  it('the third-harmonic rocking curve is narrower than the fundamental', () => {
    const curve = rockingCurve(DEFAULT_STATE);
    const centre = curve.detune.findIndex(d => Math.abs(d) < 1e-9);
    expect(curve.fundamental[centre]).toBeCloseTo(1, 9);
    const at = curve.detune.findIndex(d => d >= 0.5);
    expect(curve.third[at] / curve.third[centre]).toBeLessThan(curve.fundamental[at] / curve.fundamental[centre]);
  });
});

describe('commands', () => {
  it('set the energy within the reach of the profile and crystal', () => {
    expect(applyCommand(DEFAULT_STATE, { type: 'energy', energy_eV: 8979 }).state.energy_eV).toBe(8979);
    expect(applyCommand(DEFAULT_STATE, { type: 'energy', energy_eV: 1e6 }).state.energy_eV).toBe(30000);
    const r = applyCommand(DEFAULT_STATE, { type: 'energy', energy_eV: 100 });
    expect(r.state.energy_eV).toBe(4500);
    expect(r.change).toBe('energy');
    expect(energyRange({ ...DEFAULT_STATE, profile: PROFILE_PRESETS[2].profile })[0]).toBeGreaterThan(1977);
  });

  it('detune, crystal, gas and gain change only what they name, clamped', () => {
    expect(applyCommand(DEFAULT_STATE, { type: 'detune', detune: 2 }).state.profile.mono.detune).toBe(1);
    expect(applyCommand(DEFAULT_STATE, { type: 'crystal', crystal: 'Si311' }).state.profile.mono.crystal).toBe('Si311');
    const gas = applyCommand(DEFAULT_STATE, { type: 'gas', chamber: 'It', gas: { Ar: 2, N2: 2 } }).state.profile.chambers.find(c => c.id === 'It')!;
    expect(gas.gas).toEqual({ Ar: 0.5, N2: 0.5 });
    const gain = applyCommand(DEFAULT_STATE, { type: 'gain', chamber: 'I0', gain_V_per_A: 3e6 }).state;
    expect(gain.profile.chambers.find(c => c.id === 'I0')!.gain_V_per_A).toBe(1e6);
    expect(gain.profile.chambers.find(c => c.id === 'It')).toEqual(DEFAULT_STATE.profile.chambers.find(c => c.id === 'It'));
    expect(applyCommand(DEFAULT_STATE, { type: 'gain', chamber: 'I0', gain_V_per_A: 1 }).state.profile.chambers[0].gain_V_per_A).toBe(1e3);
  });

  it('auto gain puts every chamber between 0.5 and 5 V', () => {
    const clipped = applyCommand(DEFAULT_STATE, { type: 'gain', chamber: 'It', gain_V_per_A: 1e9 }).state;
    expect(status(clipped).it!.saturated).toBe(true);
    const fixed = applyCommand(clipped, { type: 'autoGain' }).state;
    for (const reading of [status(fixed).i0!, status(fixed).it!, status(fixed).iref!]) {
      expect(reading.voltage_V).toBeGreaterThan(0.5);
      expect(reading.voltage_V).toBeLessThan(5);
    }
  });

  it('inserting the harmonic rejection mirror sets an angle that keeps E and rejects 3E', () => {
    const r = applyCommand(DEFAULT_STATE, { type: 'mirror', id: 'M3', inserted: true });
    const m3 = r.state.profile.mirrors.find(m => m.id === 'M3')!;
    expect(m3.inserted).toBe(true);
    expect(status(r.state).harmonicFraction!).toBeLessThan(status(DEFAULT_STATE).harmonicFraction!);
    expect(r.note).toMatch(/inserted/);
    expect(() => applyCommand(DEFAULT_STATE, { type: 'mirror', id: 'M9', inserted: true })).toThrow(/M9/);
  });

  it('a sample preset brings its environment, foil, energy and fluorescence window', () => {
    const r = applyCommand(DEFAULT_STATE, { type: 'samplePreset', id: 'fe-2mm-water' });
    expect(r.state.sample.absorber).toBe('Fe');
    expect(r.state.environment.kind).toBe('liquid-cell');
    expect(r.state.reference!.formula).toBe('Fe');
    expect(r.state.energy_eV).toBeCloseTo(edgeEnergy(r.state.sample) + 20, 9);
    const [lo, hi] = r.state.profile.sdd.roi_eV;
    expect(lo).toBeLessThan(6404);  // Fe Ka1 6403.8 eV
    expect(hi).toBeGreaterThan(6404);
  });

  it('switching to the tender profile swaps in a sample whose edge it can reach', () => {
    const r = applyCommand(DEFAULT_STATE, { type: 'profile', id: 'tender' });
    expect(r.state.profile.preset).toBe('tender');
    expect(r.state.sample.absorber).toBe('S');
    expect(r.state.reference).toBeUndefined();
    const [lo, hi] = energyRange(r.state);
    expect(r.state.energy_eV).toBeGreaterThanOrEqual(lo);
    expect(r.state.energy_eV).toBeLessThanOrEqual(hi);
    // Back to the bending magnet the S K edge is out of range, so the Cu foil returns.
    expect(applyCommand(r.state, { type: 'profile', id: 'bm3' }).state.sample.absorber).toBe('Cu');
  });

  it('any formula: a new absorber moves the energy, the window and the reference foil', () => {
    const r = applyCommand(DEFAULT_STATE, { type: 'sample', patch: { formula: 'Fe2O3', density: 5.26, absorber: 'Fe', edge: 'K', form: 'pellet' } });
    expect(r.state.sample.formula).toBe('Fe2O3');
    expect(r.state.energy_eV).toBeCloseTo(edgeEnergy(r.state.sample) + 20, 9);
    expect(r.state.reference?.formula).toBe('Fe');
    expect(r.note).toMatch(/Fe K edge/);
    expect(() => applyCommand(DEFAULT_STATE, { type: 'sample', patch: { formula: 'NiO', absorber: 'Cu' } })).toThrow(/Cu is not in NiO/);
    // Changing only the pinholes leaves the energy alone.
    expect(applyCommand(DEFAULT_STATE, { type: 'sample', patch: { pinholeFraction: 0.1 } }).state.energy_eV).toBe(DEFAULT_STATE.energy_eV);
  });

  it('environment, detector, scan and source commands clamp to their ranges', () => {
    const cell = applyCommand(DEFAULT_STATE, { type: 'environment', kind: 'liquid-cell' }).state.environment;
    expect(cell.windows).toHaveLength(2);
    const furnace = applyCommand(DEFAULT_STATE, { type: 'environment', kind: 'furnace' }).state.environment;
    expect(furnace.temperature_K).toBe(300);
    expect(furnace.windows).toEqual([]);
    expect(applyCommand(DEFAULT_STATE, { type: 'sdd', patch: { distance_mm: 1 } }).state.profile.sdd.distance_mm).toBe(5);
    expect(applyCommand(DEFAULT_STATE, { type: 'sdd', patch: { exitAngle_deg: 0 } }).state.profile.sdd.exitAngle_deg).toBe(1);
    expect(applyCommand(DEFAULT_STATE, { type: 'sdd', patch: { exitAngle_deg: 3 } }).state.profile.sdd.exitAngle_deg).toBe(3);
    const roi = (roi_eV: [number, number]) => applyCommand(DEFAULT_STATE, { type: 'sdd', patch: { roi_eV } });
    expect(roi([7900.4, 8150.6]).state.profile.sdd.roi_eV).toEqual([7900, 8151]);
    expect(roi([8200, 7900]).state.profile.sdd.roi_eV).toEqual([7900, 8200]);
    expect(roi([8000, 8005]).state.profile.sdd.roi_eV).toEqual([8000, 8020]);
    expect(roi([-50, 200_000]).state.profile.sdd.roi_eV).toEqual([0, 100_000]);
    expect(roi([7900, 8200]).note).toContain('7900');
    expect(applyCommand(DEFAULT_STATE, { type: 'scan', plan: { ...DEFAULT_STATE.scan, repeats: 99 } }).state.scan.repeats).toBe(50);
    expect(() => applyCommand(DEFAULT_STATE, { type: 'scan', plan: { ...DEFAULT_STATE.scan, regions: [{ space: 'E', start: 10, end: 0, step: 1, dwell_s: 1 }] } })).toThrow();
    expect(applyCommand(DEFAULT_STATE, { type: 'source', current_mA: 900 }).state.profile.source.current_mA).toBe(500);
  });

  it('temperature follows the range of the environment', () => {
    const cryo = { ...DEFAULT_STATE, environment: { ...DEFAULT_STATE.environment, kind: 'cryostat' as const } };
    expect(applyCommand(cryo, { type: 'temperature', temperature_K: 4 }).state.environment.temperature_K).toBe(10);
    expect(applyCommand(DEFAULT_STATE, { type: 'thickness', thickness_um: -5 }).state.sample.thickness_um).toBe(0.01);
  });
});

describe('validateState', () => {
  it('clamps out-of-range numbers and says which ones moved', () => {
    const bad = { ...DEFAULT_STATE, energy_eV: 50, sample: { ...DEFAULT_STATE.sample, pinholeFraction: 3 } };
    const { state, issues } = validateState(bad);
    expect(state.energy_eV).toBe(4500);
    expect(state.sample.pinholeFraction).toBe(1);
    expect(issues).toHaveLength(2);
    expect(validateState(DEFAULT_STATE).issues).toEqual([]);
  });
});

describe('session files', () => {
  it('round-trip the state and acquisitions, NaN values included', () => {
    const acquisition = runScan(DEFAULT_STATE, SHORT, seededRandom(1));
    acquisition.name = 'Copper check';
    acquisition.columns.mutrans[0] = NaN;
    const back = fromSession(toSession(DEFAULT_STATE, [acquisition]));
    expect(back.state).toEqual(DEFAULT_STATE);
    expect(back.acquisitions[0].columns.energy).toEqual(acquisition.columns.energy);
    expect(back.acquisitions[0].columns.mutrans[0]).toBeNull();
    expect(back.acquisitions[0].name).toBe('Copper check');
  });

  it('reject malformed files with a plain message', () => {
    expect(() => fromSession('not json')).toThrow(/not valid JSON/);
    expect(() => fromSession('{"format":"other"}')).toThrow(/xaslab-twin-session\/1/);
    const state = JSON.parse(toSession(DEFAULT_STATE));
    state.state.mode = 'teleport';
    expect(() => fromSession(JSON.stringify(state))).toThrow(/teleport/);
    const columns = JSON.parse(toSession(DEFAULT_STATE, [{ id: 'a', kind: 'transmission', columns: { energy: [1, 2], i0: [1] }, metadata: {}, provenance: [] }]));
    expect(() => fromSession(JSON.stringify(columns))).toThrow(/i0/);
    const metadata = JSON.parse(toSession(DEFAULT_STATE, [runScan(DEFAULT_STATE, SHORT, seededRandom(1))]));
    metadata.acquisitions[0].metadata['Element.symbol'] = 29;
    expect(() => fromSession(JSON.stringify(metadata))).toThrow(/metadata/);
  });
});

describe('worker messages', () => {
  it('stream one point per point and repeat, then done, and the same seed gives the same acquisition', async () => {
    const run = async (seed: number) => {
      const messages: ScanMessage[] = [];
      await handleScanRequest({ type: 'scan', id: 4, state: { ...DEFAULT_STATE, realistic: true }, plan: SHORT, seed }, m => messages.push(m));
      return messages;
    };
    const a = await run(9), b = await run(9);
    const n = 21 * 2;
    expect(a.filter(m => m.type === 'point')).toHaveLength(n);
    const last = a[a.length - 1];
    expect(last.type).toBe('done');
    expect(a.every(m => m.id === 4)).toBe(true);
    if (last.type === 'done' && b[b.length - 1].type === 'done') expect(last.acquisition.columns).toEqual((b[b.length - 1] as typeof last).acquisition.columns);
  });

  it('report errors as a message instead of throwing', async () => {
    const messages: ScanMessage[] = [];
    const broken = { ...DEFAULT_STATE, sample: { ...DEFAULT_STATE.sample, absorber: 'Zz' } };
    await handleScanRequest({ type: 'scan', id: 1, state: broken, plan: defaultPlan(8979), seed: 1 }, m => messages.push(m));
    expect(messages).toEqual([{ type: 'error', id: 1, message: expect.any(String) }]);
  });
});
