import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from './xraydata';
import { DEFAULT_STATE, scenarioFromJSON, scenarioToJSON, scenarioFromURL, scenarioToURL } from './scenario';
import { validateSample, resolveSample, sampleScan, samplePlan } from './sample';
import { parseSpectrum, spectrumToJSON } from './spectra';
beforeAll(async () => { await loadXrayData(); });
const iron = { formula: 'Fe2O3', density: 5.26, absorber: 'Fe', edge: 'K', preset: null };
describe('general sample integration', () => {
  it('round trips formula, density, absorber and edge in JSON and URL', () => {
    const state = { ...DEFAULT_STATE, sample: iron, energy: 7112 };
    expect(scenarioFromJSON(scenarioToJSON(state))).toEqual(state);
    expect(scenarioFromURL(scenarioToURL(state))).toEqual(state);
  });
  it('rejects invalid formulas, density, absent absorbers and unknown shells', () => {
    expect(() => validateSample({ ...iron, formula: 'Fe2(' })).toThrow();
    expect(() => validateSample({ ...iron, formula: 'Xx2' })).toThrow('Unknown');
    expect(() => validateSample({ ...iron, density: 0 })).toThrow('Density');
    expect(() => validateSample({ ...iron, density: Infinity })).toThrow('Density');
    expect(() => validateSample({ ...iron, absorber: 'Mn' })).toThrow('absorber');
    expect(() => validateSample({ ...iron, edge: 'K7' })).toThrow('edge');
    expect(() => resolveSample({ ...iron, edge: 'P5' })).toThrow('has no');
  });
  it('changes the window and reference when the absorber changes', () => {
    const fe = sampleScan({ ...DEFAULT_STATE, sample: iron });
    const oxygen = sampleScan({ ...DEFAULT_STATE, sample: { ...iron, absorber: 'O' } });
    expect(fe.energy_eV[0]).toBeGreaterThan(7000);
    expect(oxygen.energy_eV.at(-1)).toBeLessThan(1000);
    expect(fe.calibration?.reference).toContain('Fe K');
    expect(oxygen.calibration?.reference).toContain('O K');
    expect(fe.provenance).toBe('tabulated');
  });
  it('uses density for attenuation and keeps the model separate', () => {
    const state = { ...DEFAULT_STATE, sample: iron };
    const atomic = sampleScan(state);
    const dense = sampleScan({ ...state, sample: { ...iron, density: iron.density * 2 } });
    expect(dense.mu_cm_inv[100]).toBeCloseTo(atomic.mu_cm_inv[100] * 2, 9);
    expect(sampleScan(state, true).provenance).toBe('synthetic');
    expect(sampleScan(state).mu_cm_inv).toEqual(atomic.mu_cm_inv);
    expect(samplePlan(iron).plan?.achievedEdgeStep).toBeCloseTo(1, 9);
  });
  it('retains tabulated origin when exported and imported', () => {
    const imported = parseSpectrum(spectrumToJSON(sampleScan({ ...DEFAULT_STATE, sample: iron })), 'fe.json');
    expect(imported.provenance).toBe('imported');
    expect(imported.declaredProvenance).toBe('tabulated');
  });
  it('describes the independent battery model accurately in exported metadata', () => {
    const model = sampleScan(DEFAULT_STATE, true);
    const denser = sampleScan({ ...DEFAULT_STATE, sample: { ...DEFAULT_STATE.sample, density: 8.6 } }, true);
    expect(denser.mu_cm_inv).toEqual(model.mu_cm_inv);
    const exported = parseSpectrum(spectrumToJSON(model), 'battery.json');
    expect(exported.declaredProvenance).toBe('synthetic');
    expect(exported.notes).toContain('independent of the tabulated background and sample density');
    expect(exported.notes).not.toContain('Total attenuation includes scattering');
    expect(sampleScan(DEFAULT_STATE).notes).toContain('Total attenuation includes scattering');
  });
  it('keeps out-of-range edges inspectable without extrapolating absorption', () => {
    const hydrogen = { formula: 'H2', density: .0001, absorber: 'H', edge: 'K', preset: null };
    expect(resolveSample(hydrogen).inRange).toBe(false);
    const curve = sampleScan({ ...DEFAULT_STATE, sample: hydrogen });
    expect(curve.energy_eV[0]).toBe(100);
    expect(curve.energy_eV.at(-1)).toBe(100000);
    expect(samplePlan(hydrogen).plan).toBeNull();
  });
  it('migrates a legacy scenario without a sample', () => {
    const { sample, ...legacy } = DEFAULT_STATE;
    expect(scenarioFromJSON(JSON.stringify({ schema: 'quantum-battery-xas-lab', version: 1, parameters: legacy })).sample).toEqual(sample);
  });
});
