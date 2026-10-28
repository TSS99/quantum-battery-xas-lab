import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { loadOptics } from './tables';
import { edgeEnergy } from './acquire';
import { PROFILE_PRESETS, SAMPLE_PRESETS } from './presets';
import { defaultFineStructure, libraryMaterialId, loadLibraryFineStructure, muComponents, transmission } from './sample';
import { planPoints } from './scan';
import { DEFAULT_STATE, applyCommand, status } from './twin';
import type { TwinState } from './types';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

/** Every sample on every beamline whose energy range holds its whole scan. */
const cases = () => SAMPLE_PRESETS.flatMap(preset => PROFILE_PRESETS.flatMap(profile => {
  const state = applyCommand({ ...DEFAULT_STATE, profile: profile.profile }, { type: 'samplePreset', id: preset.id }).state;
  const { energy_eV } = planPoints(state.scan, edgeEnergy(state.sample));
  const fits = energy_eV[0] >= profile.range_eV[0] && energy_eV[energy_eV.length - 1] <= profile.range_eV[1];
  return fits ? [{ preset, profile, state, energies: [...energy_eV] }] : [];
}));

describe('every sample in the live view', () => {
  it('runs on at least one beamline, and the eight library references are among them', () => {
    const all = cases();
    for (const preset of SAMPLE_PRESETS) expect(all.some(c => c.preset.id === preset.id), preset.id).toBe(true);
    for (const id of ['fe-foil', 'ni-foil', 'pt-foil', 'licoo2-pellet', 'lifepo4-pellet', 'fe3o4-pellet', 'zno-pellet', 'ceo2-pellet']) expect(SAMPLE_PRESETS.some(p => p.id === id), id).toBe(true);
  });

  it('sets gains when chosen so no chamber clips anywhere in its scan, and I0 and It read above 0.5 V at their largest', () => {
    for (const { preset, profile, state, energies } of cases()) {
      const readings = energies.map(e => status({ ...state, energy_eV: e }));
      for (const id of ['i0', 'it', 'iref'] as const) {
        expect(readings.some(r => r[id]?.saturated), `${preset.id} on ${profile.id}: ${id} clips`).toBe(false);
      }
      for (const id of ['i0', 'it'] as const) expect(Math.max(...readings.map(r => r[id]!.voltage_V)), `${preset.id} on ${profile.id}: ${id}`).toBeGreaterThan(0.5);
    }
  });

  it('reads each sample mu x in ln(I0/It) once a blank divides out the chambers, at every scan point', () => {
    for (const { preset, profile, state, energies } of cases()) {
      // The same beamline with almost no sample: the chambers' efficiencies and the windows cancel in the difference.
      const blank = applyCommand(state, { type: 'thickness', thickness_um: 0.01 }).state;
      const lnRatio = (s: TwinState, e: number) => { const r = status({ ...s, energy_eV: e }); return Math.log(r.i0!.current_A / r.it!.current_A); };
      const muX = (s: TwinState, e: number) => -Math.log(transmission(s.sample, s.environment, e).transmission);
      for (const e of energies.filter((_, i) => i % 25 === 0)) {
        const read = lnRatio(state, e) - lnRatio(blank, e), expected = muX(state, e) - muX(blank, e);
        // Harmonics passing a thick sample are the only difference; they are a small fraction on these profiles.
        expect(Math.abs(read - expected), `${preset.id} on ${profile.id} at ${e.toFixed(0)} eV`).toBeLessThan(0.02 * expected + 0.01);
      }
    }
  });

  it('uses the FEFF paths for every sample whose material is in the library', async () => {
    let computed = 0;
    for (const preset of SAMPLE_PRESETS) {
      const state: TwinState = applyCommand(DEFAULT_STATE, { type: 'samplePreset', id: preset.id }).state;
      if (!libraryMaterialId(state.sample)) continue;
      expect(await loadLibraryFineStructure(state.sample)).toBe(true);
      expect(defaultFineStructure(state.sample, edgeEnergy(state.sample)).label, preset.id).toMatch(/FEFF paths/);
      computed++;
    }
    expect(computed).toBeGreaterThanOrEqual(38);
  });

  it('moves the whole edge by the chemical shift: the derivative peak, the scan window and the EXAFS reference', async () => {
    for (const id of ['cu2o-pellet', 'cuo-pellet', 'mno2-pellet', 'na2so4-pellet']) {
      const state = applyCommand(DEFAULT_STATE, { type: 'samplePreset', id }).state;
      const shift = state.sample.edgeShift_eV!;
      expect(shift, id).toBeGreaterThan(1);
      await loadLibraryFineStructure(state.sample);
      const unshifted = { ...state.sample, edgeShift_eV: undefined };
      // The steepest rise of mu(E) near the edge, with and without the shift.
      const steepest = (sample: TwinState['sample']) => {
        const e0 = edgeEnergy(unshifted); let best = e0, slope = -Infinity;
        for (let e = e0 - 15; e <= e0 + 30; e += 0.05) {
          const d = muComponents(sample, e + 0.05).total_cm_inv - muComponents(sample, e).total_cm_inv;
          if (d > slope) { slope = d; best = e; }
        }
        return best;
      };
      expect(Math.abs(steepest(state.sample) - steepest(unshifted) - shift), id).toBeLessThan(0.15);
      expect(edgeEnergy(state.sample) - edgeEnergy(unshifted)).toBeCloseTo(shift, 12);
      expect(state.energy_eV).toBeCloseTo(edgeEnergy(state.sample) + 20, 6);
    }
  });

  it('sends each sample to a beamline that reaches its scan, and keeps every valence series in order', () => {
    for (const preset of SAMPLE_PRESETS) {
      const state = applyCommand(DEFAULT_STATE, { type: 'samplePreset', id: preset.id }).state;
      const { energy_eV } = planPoints(state.scan, edgeEnergy(state.sample));
      const [lo, hi] = PROFILE_PRESETS.find(p => p.id === state.profile.preset)!.range_eV;
      expect(energy_eV[0] >= lo && energy_eV[energy_eV.length - 1] <= hi, preset.id).toBe(true);
    }
    // Higher oxidation state, higher edge, within each element.
    const shift = (id: string) => SAMPLE_PRESETS.find(p => p.id === id)!.sample.edgeShift_eV ?? 0;
    expect(shift('cu-foil')).toBeLessThan(shift('cu2o-pellet'));
    expect(shift('cu2o-pellet')).toBeLessThan(shift('cuo-pellet'));
    expect(shift('mn2o3-pellet')).toBeLessThan(shift('limn2o4-pellet'));
    expect(shift('limn2o4-pellet')).toBeLessThan(shift('mno2-pellet'));
    expect(shift('coo-pellet')).toBeLessThan(shift('co3o4-pellet'));
    expect(shift('co3o4-pellet')).toBeLessThan(shift('licoo2-pellet'));
    expect(shift('as3-water')).toBeLessThan(shift('as5-water'));
    expect(shift('s8-pellet')).toBeLessThan(shift('na2so4-pellet'));
  });

  it('gives every sample a colour for the 3D hutch', () => {
    for (const preset of SAMPLE_PRESETS) expect(preset.look.color, preset.id).toMatch(/^#[0-9a-f]{6}$/);
  });
});
