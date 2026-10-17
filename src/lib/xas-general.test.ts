import { beforeAll, describe, expect, it } from 'vitest';
import fixtures from '../data/xray/test-fixtures.json';
import { edgeStep, loadXrayData, mu, muAcrossEdge } from './xraydata';
import { GENERAL_XAS_PROVENANCE, defaultEdgeWidth, defaultNearEdgeFeatures, modelSpectrum, modelableEdges } from './xas-general';

const at = (energies: number[], target: number) => energies.findIndex(energy => Math.abs(energy - target) < 1e-6);
const nearest = (energies: number[], target: number) =>
  energies.reduce((best, energy, i) => (Math.abs(energy - target) < Math.abs(energies[best] - target) ? i : best), 0);

describe('general model spectrum', () => {
  beforeAll(async () => { await loadXrayData(); });

  it('is labelled as a tabulated background plus a parametric model', () => {
    const spectrum = modelSpectrum({ formula: 'Fe2O3', density: 5.26, absorber: 'Fe', edge: 'K' });
    expect(spectrum.provenance).toBe('tabulated-background + parametric-model');
    expect(GENERAL_XAS_PROVENANCE).toBe(spectrum.provenance);
    expect(spectrum.disclosure).toMatch(/illustrative parametric shapes, not predictions/);
    expect(spectrum.metadata).toMatchObject({ absorber: 'Fe', edge: 'K', tabulatedEdge_eV: 7112, modelEdge_eV: 7112 });
    expect(spectrum.metadata.dataSource).toMatch(/XrayDB/);
    expect(spectrum.metadata.features).toEqual(defaultNearEdgeFeatures(7112));
  });

  it('without features is the tabulated edge broadened around E0, with the tabulated jump', () => {
    const spectrum = modelSpectrum({ formula: 'Fe2O3', density: 5.26, absorber: 'Fe', edge: 'K', features: false, start_eV: 6900, end_eV: 7700, step_eV: 0.5 });
    const { energy_eV: energy, mu_cm_inv: model, tabulated_cm_inv: table } = spectrum;
    // The tabulated curve is the real atomic table, including its sharp edge.
    expect(table[at(energy, 7000)]).toBeCloseTo(mu('Fe2O3', 5.26, 7000).total, 10);
    expect(Math.abs(table[at(energy, 7000)] / fixtures.compoundMu[0].total_cm_inv - 1)).toBeLessThan(0.01);
    // Far from the edge the model follows the table; the arctan tail leaves a small offset below.
    expect(Math.abs(model[0] / table[0] - 1)).toBeLessThan(0.02);
    expect(Math.abs(model.at(-1)! / table.at(-1)! - 1)).toBeLessThan(0.002);
    // At E0 the model is halfway up the tabulated jump.
    const step = edgeStep('Fe2O3', 'Fe', 'K', 5.26);
    expect(model[at(energy, 7112)] / ((step.muBelow_cm_inv + step.muAbove_cm_inv) / 2)).toBeCloseTo(1, 2);
    expect(spectrum.metadata.edgeStep_cm_inv).toBeCloseTo(step.deltaMu_cm_inv, 10);
  });

  it('moves the model edge by the chemical shift', () => {
    const shifted = modelSpectrum({ formula: 'Fe2O3', density: 5.26, absorber: 'Fe', edge: 'K', features: false, edgeShift_eV: 3, start_eV: 7000, end_eV: 7200, step_eV: 0.5 });
    const i = at(shifted.energy_eV, 7115);
    const below = muAcrossEdge('Fe2O3', 5.26, 'Fe', 'K', 7115, 'below');
    const above = muAcrossEdge('Fe2O3', 5.26, 'Fe', 'K', 7115, 'above');
    expect(shifted.mu_cm_inv[i]).toBeCloseTo((below + above) / 2, 6);
    expect(shifted.metadata.modelEdge_eV).toBe(7115);
  });

  it('places the white line above the edge and the pre-edge peak below it', () => {
    const base = { formula: 'Fe2O3', density: 5.26, absorber: 'Fe', edge: 'K', start_eV: 7050, end_eV: 7200, step_eV: 0.25 } as const;
    const plain = modelSpectrum({ ...base, features: false });
    const full = modelSpectrum({ ...base, features: { oscillation: 0 } });
    const f = defaultNearEdgeFeatures(7112);
    const peak = full.energy_eV[full.mu_cm_inv.indexOf(Math.max(...full.mu_cm_inv))];
    expect(Math.abs(peak - (7112 + f.whiteLineOffset_eV))).toBeLessThan(3);
    const pre = nearest(full.energy_eV, 7112 - f.preEdgeOffset_eV);
    expect(full.mu_cm_inv[pre]).toBeGreaterThan(plain.mu_cm_inv[pre] * 1.05);
  });

  it('works for soft and hard edges of any element, staying finite and positive', () => {
    const cases = [
      ['H2O', 0.997, 'O', 'K'], ['N2', 0.001145, 'N', 'K'], ['CO', 0.001145, 'C', 'K'], ['SiO2', 2.65, 'Si', 'K'],
      ['TiO2', 3.89, 'Ti', 'K'], ['CuSO4·5H2O', 2.286, 'Cu', 'K'], ['LiNi0.5Mn1.5O4', 4.45, 'Mn', 'K'],
      ['LiNi0.5Mn1.5O4', 4.45, 'Ni', 'K'], ['Pt', 21.45, 'Pt', 'L3'], ['PbO', 9.5, 'Pb', 'L3'], ['UO2', 10.97, 'U', 'M5'],
    ] as const;
    for (const [formula, density, absorber, edge] of cases) {
      const spectrum = modelSpectrum({ formula, density, absorber, edge, features: { oscillation: 0.5, whiteLineHeight: 3, preEdgeHeight: 3 } });
      const { energy_eV: energy, mu_cm_inv: model } = spectrum;
      expect(energy.length).toBeGreaterThan(100);
      expect(energy.every((value, i) => i === 0 || value > energy[i - 1])).toBe(true);
      expect(model.every(value => Number.isFinite(value) && value > 0)).toBe(true);
      expect(energy[0]).toBeLessThan(spectrum.metadata.tabulatedEdge_eV);
      expect(energy.at(-1)!).toBeGreaterThan(spectrum.metadata.tabulatedEdge_eV);
      const head = model.slice(0, 10).reduce((a, b) => a + b) / 10;
      const tail = model.slice(-10).reduce((a, b) => a + b) / 10;
      expect(tail).toBeGreaterThan(head);
    }
  });

  it('scales default widths and offsets with the edge energy', () => {
    const fe = defaultNearEdgeFeatures(7112), pb = defaultNearEdgeFeatures(2 * 7112);
    expect(pb.whiteLineOffset_eV).toBeCloseTo(2 * fe.whiteLineOffset_eV, 10);
    expect(pb.preEdgeOffset_eV).toBeCloseTo(2 * fe.preEdgeOffset_eV, 10);
    expect(pb.whiteLineWidth_eV).toBeCloseTo(2 * fe.whiteLineWidth_eV, 10);
    expect(defaultEdgeWidth(2 * 7112)).toBeCloseTo(2 * defaultEdgeWidth(7112), 10);
    expect(defaultNearEdgeFeatures(543.1).preEdgeOffset_eV).toBeGreaterThanOrEqual(2);
    expect(defaultEdgeWidth(284.2)).toBeGreaterThanOrEqual(0.3);
  });

  it('lists only edges inside the tabulated energy range', () => {
    expect(modelableEdges('Fe')).toEqual(['K', 'L1', 'L2', 'L3']);
    expect(modelableEdges('Li')).toEqual([]);
  });

  it('rejects invalid requests with clear errors', () => {
    const base = { formula: 'Fe2O3', density: 5.26, absorber: 'Fe', edge: 'K' };
    expect(() => modelSpectrum({ ...base, absorber: 'Cu' })).toThrow(/not in the formula/);
    expect(() => modelSpectrum({ ...base, formula: 'LiFePO4', absorber: 'Li' })).toThrow(/outside the tabulated range/);
    expect(() => modelSpectrum({ ...base, edge: 'M9' })).toThrow(/tabulated edges/);
    expect(() => modelSpectrum({ ...base, features: { oscillation: 2 } })).toThrow(/Oscillation amplitude/);
    expect(() => modelSpectrum({ ...base, start_eV: 7200, end_eV: 7100 })).toThrow(/Scan end must be above scan start/);
    expect(() => modelSpectrum({ ...base, start_eV: 7000, end_eV: 9000, step_eV: 0.01 })).toThrow(/at most 20000 points/);
    expect(() => modelSpectrum({ ...base, edgeShift_eV: 500 })).toThrow(/Edge shift/);
    expect(() => modelSpectrum({ ...base, density: -1 })).toThrow(/Density/);
  });
});
