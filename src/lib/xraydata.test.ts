import { beforeAll, describe, expect, it } from 'vitest';
import fixtures from '../data/xray/test-fixtures.json';
import { COMPOUND_PRESETS } from '../data/compound-presets';
import {
  BEAMLINE_RANGES, DEFAULT_PELLET_AREA_CM2, ELEMENT_SYMBOLS, attenuationLengthUm, edgeStep, edgesInRange, edgesOf,
  elementInfo, elementMuOverRho, isXrayDataLoaded, loadXrayData, massFractions, molarMass, mu, muOverRho, parseFormula,
  recommendMode, recommendThickness, transmittance, xrayDataInfo,
} from './xraydata';

/** Fixtures come from xraydb directly (scripts/build-xray-data.py), not from the compressed table. */
const expectRelative = (actual: number, expected: number, tolerance: number) =>
  expect(Math.abs(actual / expected - 1)).toBeLessThan(tolerance);

describe('chemical formulas', () => {
  it('needs the data before mass or cross-section lookups', () => {
    expect(isXrayDataLoaded()).toBe(false);
    expect(() => molarMass('H2O')).toThrow(/await loadXrayData\(\)/);
  });

  it('parses symbols, integer and decimal counts and nested brackets', () => {
    expect(parseFormula('H2O')).toEqual({ H: 2, O: 1 });
    expect(parseFormula('CO')).toEqual({ C: 1, O: 1 });
    expect(parseFormula('Co')).toEqual({ Co: 1 });
    expect(parseFormula('Ca3(PO4)2')).toEqual({ Ca: 3, P: 2, O: 8 });
    expect(parseFormula('Mn(SO4)2(H2O)7')).toEqual({ Mn: 1, S: 2, O: 15, H: 14 });
    expect(parseFormula('[Cu(NH3)4]SO4')).toEqual({ Cu: 1, N: 4, H: 12, S: 1, O: 4 });
    expect(parseFormula('LiNi0.5Mn1.5O4')).toEqual({ Li: 1, Ni: 0.5, Mn: 1.5, O: 4 });
    expect(parseFormula('Fe0.002(SiO2)0.998')).toEqual({ Fe: 0.002, Si: 0.998, O: 1.996 });
    expect(parseFormula('2H2O')).toEqual({ H: 4, O: 2 });
  });

  it('parses hydrates written with ·, *, . and spaces', () => {
    const pentahydrate = { Cu: 1, S: 1, O: 9, H: 10 };
    for (const text of ['CuSO4·5H2O', 'CuSO4.5H2O', 'CuSO4*5H2O', 'CuSO4 · 5H2O', 'CuSO4•5H2O']) expect(parseFormula(text)).toEqual(pentahydrate);
    expect(parseFormula('CaSO4·0.5H2O')).toEqual({ Ca: 1, S: 1, O: 4.5, H: 1 });
    expect(parseFormula('CaSO4.0.5H2O')).toEqual({ Ca: 1, S: 1, O: 4.5, H: 1 });
    expect(parseFormula('Na2CO3.10H2O')).toEqual({ Na: 2, C: 1, O: 13, H: 20 });
    expect(parseFormula('MgSO4.H2O')).toEqual({ Mg: 1, S: 1, O: 5, H: 2 });
    expect(parseFormula('NaCl.2H2O')).toEqual({ Na: 1, Cl: 1, H: 4, O: 2 });
  });

  it('rejects invalid input with messages that say what is wrong', () => {
    expect(() => parseFormula('')).toThrow('Formula is empty.');
    expect(() => parseFormula('   ')).toThrow('Formula is empty.');
    expect(() => parseFormula('fe2o3')).toThrow(/"f" at position 1 cannot start an element symbol/);
    expect(() => parseFormula('Xx2')).toThrow(/Unknown element symbol "Xx" at position 1/);
    expect(() => parseFormula('Es2O3')).toThrow(/Z = 1-98/);
    expect(() => parseFormula('Fe2O3)')).toThrow(/Unexpected "\)" at position 6/);
    expect(() => parseFormula('Ca3(PO4')).toThrow(/Missing "\)" for the "\(" at position 4/);
    expect(() => parseFormula('Ca3(PO4]2')).toThrow(/Mismatched "\]" at position 8: expected "\)"/);
    expect(() => parseFormula('()')).toThrow(/Empty brackets/);
    expect(() => parseFormula('Fe0O3')).toThrow(/Count at position 3 must be greater than zero/);
    expect(() => parseFormula('CuSO4·')).toThrow(/Expected a formula unit after "·"/);
    expect(() => parseFormula('5')).toThrow(/must be followed by a formula unit/);
    expect(() => parseFormula('Fe 2O3')).toThrow(/Unexpected character " "/);
    expect(() => parseFormula('Fe2O3!')).toThrow(/Unexpected character "!"/);
    expect(() => parseFormula('(CuSO4·5H2O)')).toThrow(/not allowed inside brackets/);
  });
});

describe('tabulated X-ray data', () => {
  beforeAll(async () => { await loadXrayData(); });

  it('loads the element JSON through a dynamic import (kept until the UI imports the module)', async () => {
    const module = await import('../data/xray/elements.json');
    expect(module.default.elements).toHaveLength(98);
    expect(module.default.elements.map(element => element.symbol)).toEqual(ELEMENT_SYMBOLS);
    expect(await loadXrayData()).toBe(xrayDataInfo());
    expect(isXrayDataLoaded()).toBe(true);
    expect(xrayDataInfo().license).toMatch(/CC0/);
    expect(xrayDataInfo().source).toContain(fixtures.xraydbVersion);
    expect(xrayDataInfo().energyRange_eV).toEqual([100, 100000]);
    expect(xrayDataInfo().accuracy.awayFromEdges.maxRelativeError).toBeLessThan(0.02);
  });

  it('has the listed edge energies, jump ratios and fluorescence yields', () => {
    const energy = (symbol: string, edge: string) => elementInfo(symbol).edges.find(item => item.edge === edge)?.energy_eV;
    expect(energy('Fe', 'K')).toBe(7112);
    expect(energy('Cu', 'K')).toBe(8979);
    expect(energy('Mn', 'K')).toBe(6539);
    expect(energy('O', 'K')).toBe(543.1);
    expect(energy('Ti', 'K')).toBe(4966);
    for (const item of fixtures.edges) {
      const found = elementInfo(item.element).edges.find(edge => edge.edge === item.edge)!;
      expect(found.energy_eV).toBe(item.energy_eV);
      expectRelative(found.jumpRatio, item.jumpRatio, 1e-4);
      expectRelative(found.fluorescenceYield, item.fluorescenceYield, 1e-4);
    }
    expect(elementInfo('Fe')).toMatchObject({ Z: 26, name: 'Iron', molarMass: 55.845 });
  });

  it('reproduces xraydb mass attenuation coefficients for single elements within 1 %', () => {
    for (const item of fixtures.elementMu) {
      const value = elementMuOverRho(item.element, item.energy_eV);
      expectRelative(value.photo, item.photo, 0.01);
      expectRelative(value.total, item.total, 0.01);
    }
  });

  it('keeps edges sharp: just below and just above the Fe K edge', () => {
    expect(elementMuOverRho('Fe', 7111.9).photo).toBeLessThan(60);
    expect(elementMuOverRho('Fe', 7112.1).photo).toBeGreaterThan(400);
  });

  it('reproduces xraydb material_mu for compounds within 1 %', () => {
    for (const item of fixtures.compoundMu) {
      const value = mu(item.formula, item.density, item.energy_eV);
      expectRelative(value.photo, item.photo_cm_inv, 0.01);
      expectRelative(value.total, item.total_cm_inv, 0.01);
      expectRelative(muOverRho(item.formula, item.energy_eV).total * item.density, item.total_cm_inv, 0.01);
    }
  });

  it('computes molar masses and mass fractions', () => {
    for (const item of fixtures.molarMass) expectRelative(molarMass(item.formula), item.molarMass, 1e-9);
    const fractions = massFractions('Fe2O3');
    expect(fractions.Fe).toBeCloseTo(2 * 55.845 / 159.687, 10);
    expect(Object.values(massFractions('CuSO4·5H2O')).reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 12);
    expect(molarMass({ H: 2, O: 1 })).toBeCloseTo(molarMass('H2O'), 12);
  });

  it('lists edges of every element sorted by energy and filters beamline ranges', () => {
    const all = edgesOf('LiFePO4');
    expect(all.every((edge, i) => i === 0 || edge.energy_eV >= all[i - 1].energy_eV)).toBe(true);
    expect(new Set(all.map(edge => edge.element))).toEqual(new Set(['Li', 'Fe', 'P', 'O']));
    expect(edgesInRange('Fe2O3').map(edge => `${edge.element} ${edge.edge}`)).toEqual(['Fe K']);
    expect(edgesInRange('LiFePO4', BEAMLINE_RANGES.hard).map(edge => `${edge.element} ${edge.edge}`)).toEqual(['P K', 'Fe K']);
    const soft = edgesInRange('Fe2O3', BEAMLINE_RANGES.soft).map(edge => `${edge.element} ${edge.edge}`);
    expect(soft).toEqual(['O K', 'Fe L3', 'Fe L2', 'Fe L1']);
  });

  it('gives attenuation length and transmission consistent with Beer-Lambert', () => {
    const length = attenuationLengthUm('H2O', 0.997, 10000);
    expectRelative(length, 1e4 / fixtures.compoundMu.find(item => item.formula === 'H2O' && item.energy_eV === 10000)!.total_cm_inv, 0.01);
    expect(transmittance('H2O', 0.997, length, 10000)).toBeCloseTo(Math.exp(-1), 12);
    expect(transmittance('H2O', 0.997, 0, 10000)).toBe(1);
    expect(() => transmittance('H2O', 0.997, -1, 10000)).toThrow();
  });

  it('rejects energies, absorbers and edges outside the tables', () => {
    expect(() => muOverRho('H2O', 50)).toThrow(RangeError);
    expect(() => muOverRho('H2O', 2e5)).toThrow(/outside the tabulated range/);
    expect(() => mu('H2O', 0, 1000)).toThrow(/Density must be a positive number/);
    expect(() => edgeStep('LiFePO4', 'Li', 'K', 3.6)).toThrow(/outside the tabulated range/);
    expect(() => edgeStep('SiO2', 'Fe', 'K', 2.65)).toThrow(/Absorber "Fe" is not in the formula/);
    expect(() => edgeStep('Fe2O3', 'Fe', 'N9', 5.26)).toThrow(/tabulated edges: K, L1/);
  });
});

describe('transmission sample planning', () => {
  beforeAll(async () => { await loadXrayData(); });
  const [fe2o3, cu] = fixtures.thickness;

  it('matches the xraydb edge step and an edge step of 1 for Fe2O3 at the Fe K edge', () => {
    const step = edgeStep('Fe2O3', 'Fe', 'K', 5.26);
    expectRelative(step.deltaMuOverRho, fe2o3.deltaMuOverRho, 0.005);
    expectRelative(step.muOverRhoAbove, fe2o3.muOverRhoAbove, 0.005);
    const plan = recommendThickness('Fe2O3', 'Fe', 'K', 5.26);
    expect(plan.limitedBy).toBe('edge-step');
    expect(plan.achievedEdgeStep).toBeCloseTo(1, 10);
    expectRelative(plan.thickness_um, fe2o3.thickness_um, 0.01);
    expectRelative(plan.totalAbsorptionAbove, fe2o3.totalAbsorptionAbove, 0.01);
    expect(plan.totalAbsorptionAbove).toBeLessThan(3);
    expect(plan.pelletArea_cm2).toBeCloseTo(DEFAULT_PELLET_AREA_CM2, 12);
    expectRelative(plan.sampleMass_mg, fe2o3.sampleMass_mg, 0.01);
    // Independent xraydb estimate (polynomial pre-edge extrapolation, 50 eV above the edge).
    expectRelative(recommendMode('Fe2O3', 'Fe', 'K').stepToTotalRatio, fe2o3.xraydbStepPerTotalAt50eV, 0.02);
  });

  it('asks for a few micrometres of Cu foil at the Cu K edge', () => {
    const plan = recommendThickness('Cu', 'Cu', 'K', 8.96);
    expectRelative(plan.thickness_um, cu.thickness_um, 0.01);
    expect(plan.thickness_um).toBeGreaterThan(3);
    expect(plan.thickness_um).toBeLessThan(8);
    expect(plan.totalAbsorptionAbove).toBeLessThan(3);
    expectRelative(recommendMode('Cu', 'Cu', 'K').stepToTotalRatio, cu.xraydbStepPerTotalAt50eV, 0.02);
  });

  it('adds diluent absorption and scales the mass with the pellet area', () => {
    const plain = recommendThickness('Fe2O3', 'Fe', 'K', 5.26, { pelletArea_cm2: 2 });
    const mixed = recommendThickness('Fe2O3', 'Fe', 'K', 5.26, { pelletArea_cm2: 2, diluent: { material: 'BN', mass_mg: 100 } });
    expectRelative(plain.sampleMass_mg, fe2o3.deltaMuOverRho ** -1 * 2000, 0.01);
    expect(mixed.diluent?.formula).toBe('BN');
    const expected = muOverRho('BN', 7112).total * 0.1 / 2;
    expectRelative(mixed.diluent!.totalAbsorptionAbove, expected, 1e-9);
    expect(mixed.totalAbsorptionWithDiluent).toBeCloseTo(plain.totalAbsorptionAbove + expected, 12);
    expect(recommendThickness('Fe2O3', 'Fe', 'K', 5.26, { diluent: { material: 'cellulose', mass_mg: 50 } }).diluent?.formula).toBe('C6H10O5');
    expect(() => recommendThickness('Fe2O3', 'Fe', 'K', 5.26, { pelletArea_cm2: 0 })).toThrow();
  });

  it('is limited by total absorption for a dilute absorber and then recommends fluorescence', () => {
    const plan = recommendThickness('Fe0.002(SiO2)0.998', 'Fe', 'K', 2.65);
    expect(plan.limitedBy).toBe('total-absorption');
    expect(plan.totalAbsorptionAbove).toBeCloseTo(3, 10);
    expect(plan.achievedEdgeStep).toBeLessThan(0.3);
    expect(plan.notes.join(' ')).toMatch(/fluorescence is likely better/);
    expect(recommendMode('Fe0.002(SiO2)0.998', 'Fe', 'K').mode).toBe('fluorescence');
  });

  it('recommends transmission for concentrated hard edges and fluorescence for soft edges', () => {
    expect(recommendMode('Fe2O3', 'Fe', 'K')).toMatchObject({ mode: 'transmission', achievableEdgeStep: 1, selfAbsorptionRisk: true });
    const water = recommendMode('H2O', 'O', 'K');
    expect(water.mode).toBe('fluorescence');
    expect(water.reason).toMatch(/Soft X-ray edge/);
    expect(water.reason).toMatch(/electron yield/);
    expect(recommendThickness('H2O', 'O', 'K', 0.997).notes.join(' ')).toMatch(/Soft X-ray edge/);
  });
});

describe('compound presets', () => {
  beforeAll(async () => { await loadXrayData(); });

  it('are valid formulas with a measurable absorber edge and a sourced density', () => {
    expect(COMPOUND_PRESETS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(COMPOUND_PRESETS.map(preset => preset.id)).size).toBe(COMPOUND_PRESETS.length);
    for (const preset of COMPOUND_PRESETS) {
      const composition = parseFormula(preset.formula);
      expect(composition[preset.absorber]).toBeGreaterThan(0);
      expect(preset.density).toBeGreaterThan(preset.phase === 'gas' ? 1e-4 : 0.5);
      expect(preset.density).toBeLessThan(preset.phase === 'gas' ? 0.01 : 25);
      expect(preset.densitySource.length).toBeGreaterThan(10);
      expect(edgeStep(preset.formula, preset.absorber, preset.edge, preset.density).deltaMu_cm_inv).toBeGreaterThan(0);
      expect(['transmission', 'fluorescence']).toContain(recommendMode(preset.formula, preset.absorber, preset.edge).mode);
    }
  });
});
