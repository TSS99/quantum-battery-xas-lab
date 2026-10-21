import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { defaultEdgeWidth } from '../xas-general';
import { loadOptics } from './tables';
import { ETOK, chiSum, loadPaths, sigma2Einstein } from './exafs';
import { SAMPLE_PRESETS, thicknessFor } from './presets';
import {
  LIBRARY_S02, ROOM_TEMPERATURE_K, defaultFineStructure, einsteinTemperature_K, libraryFineStructure, libraryMaterialId,
  loadLibraryFineStructure, muComponents, teachingFineStructure, transmission,
} from './sample';
import { handleScanRequest, type ScanMessage } from './worker';
import { DEFAULT_STATE } from './twin';
import type { ExafsPathParameters, FeffMaterial, SampleConfig } from './types';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

const preset = (id: string) => SAMPLE_PRESETS.find(p => p.id === id)!.sample;
const cuSample: SampleConfig = DEFAULT_STATE.sample;
const E0 = 8979;
const energyAt = (k: number) => E0 + k * k / ETOK;
const step = (e: number) => 0.5 + Math.atan((e - E0) / defaultEdgeWidth(E0)) / Math.PI;

/** The path sum of the library model at the given k, with the same S0^2 and per-path Einstein sigma^2. */
function libraryChi(material: FeffMaterial, k: number[], temperature_K: number): number[] {
  const paths: Record<string, ExafsPathParameters> = {};
  for (const site of material.sites) for (const path of site.paths) {
    paths[`${site.id}/${path.id}`] = { sigma2_A2: sigma2Einstein(path, einsteinTemperature_K(material.id), temperature_K) };
  }
  return chiSum(material, { s02: LIBRARY_S02, paths }, k).chi;
}

describe('FEFF library fine structure', () => {
  // Recorded before any paths load, to check that loading them does not move a preset's thickness.
  let thicknessBefore = 0;

  it('matches a sample to a library material by formula, absorber and edge only', () => {
    expect(libraryMaterialId(preset('cu-foil'))).toBe('cu');
    expect(libraryMaterialId(preset('limn2o4-pellet'))).toBe('limn2o4');
    expect(libraryMaterialId(preset('nio-pellet'))).toBe('nio');
    // Iron in water is not bcc iron, and platinum particles on alumina are not the bulk metal.
    expect(libraryMaterialId(preset('fe-2mm-water'))).toBeNull();
    expect(libraryMaterialId(preset('pt-alumina'))).toBeNull();
    expect(libraryMaterialId({ formula: 'Cu', absorber: 'Cu', edge: 'L3' })).toBeNull();
    thicknessBefore = thicknessFor(preset('limn2o4-pellet'), { muX: 2 });
  });

  it('stays the teaching model until the paths load, then sums the FEFF paths above k = 3.5', async () => {
    expect(defaultFineStructure(cuSample, E0).provenance).toBe('teaching-model');
    expect(await loadLibraryFineStructure(cuSample)).toBe(true);
    expect(await loadLibraryFineStructure(preset('fe-2mm-water'))).toBe(false);
    const model = defaultFineStructure(cuSample, E0);
    expect(model.provenance).toEqual(['computed', 'teaching-model']);
    expect(model.label).toMatch(/FEFF paths of Cu/);
    expect(muComponents(cuSample, E0 + 200).provenance).toEqual(['tabulated', 'computed', 'teaching-model']);

    const cu = await loadPaths('cu');
    const near = teachingFineStructure(E0, { oscillation: 0 });
    const ks = [4, 5.55, 7.3, 9.81, 11.1, 14.2];
    const expected = libraryChi(cu, ks, ROOM_TEMPERATURE_K);
    const largest = Math.max(...expected.map(Math.abs));
    ks.forEach((k, i) => {
      const e = energyAt(k);
      // On the 0.0025 per angstrom grid, linear interpolation stays within 1e-4 of the largest chi.
      expect(Math.abs((model.factor(e) - near.factor(e)) / step(e) - expected[i])).toBeLessThan(1e-4 * largest);
    });
    // Below the fade the near edge is untouched.
    expect(model.factor(energyAt(1.9))).toBe(near.factor(energyAt(1.9)));
    expect(model.factor(E0 - 20)).toBe(near.factor(E0 - 20));
  });

  it('follows the environment temperature: a cold sample has more EXAFS at high k than a hot one', async () => {
    const cu = await loadPaths('cu');
    const rms = (temperature_K: number) => {
      const model = libraryFineStructure(E0, cu, temperature_K), near = teachingFineStructure(E0, { oscillation: 0 });
      const values = Array.from({ length: 41 }, (_, i) => energyAt(10 + i * 0.1)).map(e => model.factor(e) - near.factor(e));
      return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
    };
    expect(rms(20)).toBeGreaterThan(2 * rms(600));
    // transmission() takes the temperature from the environment it is given.
    const cold = transmission(cuSample, { kind: 'cryostat', temperature_K: 20, windows: [] }, energyAt(12));
    const hot = transmission(cuSample, { kind: 'furnace', temperature_K: 600, windows: [] }, energyAt(12));
    expect(cold.components.fineStructureFactor).not.toBeCloseTo(hot.components.fineStructureFactor, 4);
    expect(cold.components.fineStructureLabel).toContain('20 K');
  });

  it('leaves preset thicknesses alone and labels scans with the fine structure they used', async () => {
    expect(await loadLibraryFineStructure(preset('limn2o4-pellet'))).toBe(true);
    expect(thicknessFor(preset('limn2o4-pellet'), { muX: 2 })).toBe(thicknessBefore);
    const messages: ScanMessage[] = [];
    const plan = { ...DEFAULT_STATE.scan, regions: [{ space: 'E' as const, start: -20, end: 40, step: 2, dwell_s: 1 }] };
    await handleScanRequest({ type: 'scan', id: 1, state: DEFAULT_STATE, plan, seed: 3 }, m => messages.push(m));
    const done = messages.find(m => m.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.acquisition.metadata['Sample.fine_structure']).toMatch(/FEFF paths of Cu/);
      expect(done.acquisition.metadata['Sample.temperature']).toBe(`${DEFAULT_STATE.environment.temperature_K} K`);
    }
  });
});
