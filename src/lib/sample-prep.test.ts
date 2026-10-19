import { beforeAll, describe, expect, it } from 'vitest';
import { COMPOUND_PRESETS } from '../data/compound-presets';
import { DEFAULT_PELLET_AREA_CM2, MAX_TOTAL_ABSORPTION, SOFT_EDGE_eV, loadXrayData, muOverRho, recommendThickness } from './xraydata';
import { samplePlan, type Sample } from './sample';
import { PELLET_MASS_MG, phaseOf, samplePreparation } from './sample-prep';

beforeAll(async () => { await loadXrayData(); });
const preset = (id: string): Sample => {
  const p = COMPOUND_PRESETS.find(p => p.id === id)!;
  return { formula: p.formula, density: p.density, absorber: p.absorber, edge: p.edge, preset: p.id };
};
const custom = (formula: string, density: number, absorber: string, edge: string): Sample => ({ formula, density, absorber, edge, preset: null });

describe('sample preparation', () => {
  it('makes hematite up to a 100 mg, 13 mm pellet with BN and keeps the plan', () => {
    const prep = samplePreparation(preset('fe2o3-hematite'))!;
    const plain = recommendThickness('Fe2O3', 'Fe', 'K', 5.26);
    expect(prep.form).toBe('pellet');
    expect(prep.diameter_mm).toBeCloseTo(13, 9);
    expect(prep.plan.sampleMass_mg).toBeCloseTo(plain.sampleMass_mg, 9);
    expect(prep.plan.thickness_um).toBeCloseTo(plain.thickness_um, 9);
    expect(prep.plan.diluent?.formula).toBe('BN');
    expect(prep.plan.diluent!.mass_mg).toBeCloseTo(PELLET_MASS_MG - plain.sampleMass_mg, 9);
    expect(prep.pelletMass_mg).toBeCloseTo(PELLET_MASS_MG, 9);
    expect(prep.plan.totalAbsorptionWithDiluent).toBeLessThan(MAX_TOTAL_ABSORPTION);
    expect(prep.light).toBe(false);
  });

  it('adds only as much BN as total absorption allows near 4 keV', () => {
    const prep = samplePreparation(custom('CaCO3', 2.71, 'Ca', 'K'))!;
    expect(prep.form).toBe('pellet');
    expect(prep.plan.diluent!.mass_mg).toBeGreaterThan(1);
    expect(prep.plan.totalAbsorptionWithDiluent).toBeCloseTo(MAX_TOTAL_ABSORPTION, 9);
    expect(prep.pelletMass_mg).toBeLessThan(PELLET_MASS_MG);
    expect(prep.light).toBe(true);
  });

  it('adds no BN when the sample alone reaches the total-absorption limit', () => {
    const prep = samplePreparation(custom('Fe0.002(SiO2)0.998', 2.65, 'Fe', 'K'))!;
    expect(prep.plan.limitedBy).toBe('total-absorption');
    expect(prep.plan.diluent).toBeNull();
    expect(prep.pelletMass_mg).toBeCloseTo(prep.plan.sampleMass_mg, 9);
    expect(prep.light).toBe(true);
  });

  it('keeps foils as foils and puts gases and liquids in a cell', () => {
    expect(samplePreparation(preset('cu-foil'))).toMatchObject({ form: 'foil', light: false, plan: { diluent: null } });
    expect(samplePreparation(preset('pt-foil'))?.form).toBe('foil');
    expect(samplePreparation(preset('water'))).toMatchObject({ form: 'cell', phase: 'liquid', soft: true });
    expect(samplePreparation(preset('n2-gas'))).toMatchObject({ form: 'cell', phase: 'gas', soft: true });
    // A typed-in gas has no preset; its density gives it away.
    expect(phaseOf(custom('N2', 0.001145, 'N', 'K'))).toBe('gas');
    expect(samplePreparation(custom('Kr', 0.003425, 'Kr', 'K'))).toMatchObject({ form: 'cell', phase: 'gas', soft: false });
  });

  it('makes soft-edge solids a thin film with the planned thickness', () => {
    const quartz = preset('sio2-quartz'), prep = samplePreparation(quartz)!;
    expect(prep).toMatchObject({ form: 'film', soft: true, plan: { diluent: null } });
    expect(prep.plan.thickness_um).toBeCloseTo(samplePlan(quartz).plan!.thickness_um, 9);
    expect(samplePreparation(custom('Fe2O3', 5.26, 'O', 'K'))?.form).toBe('film');
  });

  it('has no preparation when the edge has no thickness plan', () => {
    expect(samplePreparation(custom('H2', 0.0001, 'H', 'K'))).toBeNull();
  });

  it('uses the filler that absorbs less: BN beats cellulose at every hard-edge preset', () => {
    for (const p of COMPOUND_PRESETS) {
      const energy = samplePlan(preset(p.id)).edge.energy_eV;
      if (energy < SOFT_EDGE_eV) continue;
      expect(muOverRho('BN', energy).total, p.id).toBeLessThan(muOverRho('C6H10O5', energy).total);
    }
    expect(samplePreparation(preset('zno'))!.plan.pelletArea_cm2).toBeCloseTo(DEFAULT_PELLET_AREA_CM2, 12);
  });
});
