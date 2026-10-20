import { beforeAll, describe, expect, it } from 'vitest';

import sampleFixturesJson from '../../data/twin/sample-fixtures.json';
import { loadXrayData, muOverRho } from '../xraydata';
import {
  TEACHING_CRITICAL_DOSE_Gy,
  cryoFactor,
  damageEstimate,
  doseRate,
  photoreduction,
  sampleDoseRate,
} from './damage';
import type { SampleConfig } from './types';

interface DoseFixture {
  id: string;
  formula: string;
  density: number;
  thickness_um: number;
  energy_eV: number;
  flux: number;
  beam_um: [number, number];
  area_cm2: number;
  fluxDensity_per_s_mm2: number;
  muEnOverRho_cm2_g: number;
  photoOpticalDepth: number;
  surfaceRate_Gy_per_s: number;
  meanRate_Gy_per_s: number;
  absorbedPower_W: number;
}

const fixtures = sampleFixturesJson as unknown as {
  waterMuEnCheck: { energy_eV: number; nist_cm2_g: number; xraydb_cm2_g: number }[];
  doseChecks: DoseFixture[];
  cases: {
    id: string;
    material: { formula: string; density: number; absorber: string; edge: string };
    sample: { thickness_um: number; pinholeFraction: number; thicknessSpread: number; particle_um: number; incidence_deg: number };
    edgeEnergy_eV: number;
    dose: DoseFixture;
  }[];
};

function expectClose(actual: number, expected: number, tolerance: number, label: string) {
  expect(Math.abs(actual / expected - 1), `${label}: got ${actual}, expected ${expected}`).toBeLessThan(tolerance);
}

const WATER = {
  formula: 'H2O',
  density: 1,
  thickness_um: 1000,
  flux: 1e12,
  energy_eV: 10000,
  beam_um: [1000, 1000] as [number, number],
};

beforeAll(async () => {
  await loadXrayData();
});

describe('doseRate units', () => {
  it('gives the gray, joules per kilogram, from first principles', () => {
    // 1e12 ph/s at 10 keV is 1e12 * 1e4 * 1.602176634e-19 J/s = 1.602176634e-3 W.
    // mu_en/rho of water at 10 keV is 4.944 cm^2/g = 0.4944 m^2/kg, and the beam is 1 mm^2.
    const result = doseRate(WATER);
    const power_W = 1e12 * 1e4 * 1.602176634e-19;
    const muEnOverRho_m2_kg = muOverRho('H2O', 10000).photo * 0.1;
    expectClose(result.surfaceRate_Gy_per_s, (power_W * muEnOverRho_m2_kg) / 1e-6, 1e-12, 'surface dose rate');
    expect(result.surfaceRate_Gy_per_s).toBeGreaterThan(700);
    expect(result.surfaceRate_Gy_per_s).toBeLessThan(900);
    expectClose(result.area_cm2, 0.01, 1e-12, 'illuminated area');
    expectClose(result.fluxDensity_per_s_mm2, 1e12, 1e-12, 'flux density');
  });

  it('matches the tabulated mu_en/rho proxy within 1.2 % of NIST for water', () => {
    expect(fixtures.waterMuEnCheck.length).toBeGreaterThan(3);
    for (const row of fixtures.waterMuEnCheck) {
      const ours = muOverRho('H2O', row.energy_eV).photo;
      expectClose(ours, row.xraydb_cm2_g, 0.01, `water mu_photo at ${row.energy_eV} eV`);
      expect(Math.abs(ours / row.nist_cm2_g - 1), `NIST at ${row.energy_eV} eV`).toBeLessThan(0.012);
    }
  });

  it('reproduces the dose table of dossier 11.1', () => {
    expect(fixtures.doseChecks.length).toBeGreaterThan(4);
    for (const row of fixtures.doseChecks) {
      const result = doseRate({
        flux: row.flux,
        energy_eV: row.energy_eV,
        beam_um: row.beam_um,
        formula: row.formula,
        density: row.density,
        thickness_um: row.thickness_um,
      });
      expectClose(result.muEnOverRho_cm2_g, row.muEnOverRho_cm2_g, 0.01, `${row.id} mu_en/rho`);
      expectClose(result.area_cm2, row.area_cm2, 1e-9, `${row.id} area`);
      expectClose(result.fluxDensity_per_s_mm2, row.fluxDensity_per_s_mm2, 1e-9, `${row.id} flux density`);
      expectClose(result.photoOpticalDepth, row.photoOpticalDepth, 0.01, `${row.id} optical depth`);
      expectClose(result.surfaceRate_Gy_per_s, row.surfaceRate_Gy_per_s, 0.01, `${row.id} surface rate`);
      expectClose(result.meanRate_Gy_per_s, row.meanRate_Gy_per_s, 0.01, `${row.id} mean rate`);
      expectClose(result.absorbedPower_W, row.absorbedPower_W, 0.01, `${row.id} absorbed power`);
    }
  });

  it('matches the per-case dose of the fixtures', () => {
    for (const fixture of fixtures.cases) {
      const sample: SampleConfig = {
        ...fixture.material,
        ...fixture.sample,
        form: 'pellet',
      };
      const result = sampleDoseRate(sample, 1e11, fixture.edgeEnergy_eV + 50, [500, 500]);
      expectClose(result.surfaceRate_Gy_per_s, fixture.dose.surfaceRate_Gy_per_s, 0.01, `${fixture.id} surface rate`);
      expectClose(result.meanRate_Gy_per_s, fixture.dose.meanRate_Gy_per_s, 0.01, `${fixture.id} mean rate`);
      expect(result.provenance).toEqual(['tabulated', 'computed']);
    }
  });
});

describe('doseRate scaling', () => {
  it('scales inversely with the illuminated area', () => {
    const wide = doseRate(WATER);
    const narrow = doseRate({ ...WATER, beam_um: [500, 500] });
    // Halving both beam dimensions quarters the area, so the dose rate quadruples.
    expectClose(narrow.surfaceRate_Gy_per_s / wide.surfaceRate_Gy_per_s, 4, 1e-12, 'area scaling');
    expectClose(narrow.meanRate_Gy_per_s / wide.meanRate_Gy_per_s, 4, 1e-12, 'mean rate area scaling');
    expectClose(narrow.fluxDensity_per_s_mm2 / wide.fluxDensity_per_s_mm2, 4, 1e-12, 'flux density scaling');
  });

  it('scales linearly with flux and with the deposited fraction', () => {
    const base = doseRate(WATER);
    expectClose(doseRate({ ...WATER, flux: 3e12 }).meanRate_Gy_per_s, 3 * base.meanRate_Gy_per_s, 1e-12, 'flux scaling');
    expectClose(doseRate({ ...WATER, depositedFraction: 0.5 }).meanRate_Gy_per_s,
                0.5 * base.meanRate_Gy_per_s, 1e-12, 'deposited fraction');
  });

  it('approaches the surface rate as the sample gets thin and stays below it otherwise', () => {
    const thin = doseRate({ ...WATER, thickness_um: 0.01 });
    expect(thin.photoOpticalDepth).toBeLessThan(1e-4);
    expectClose(thin.meanRate_Gy_per_s, thin.surfaceRate_Gy_per_s, 1e-4, 'thin limit');
    const thick = doseRate({ ...WATER, thickness_um: 20000 });
    // The front face always sees more than the volume average.
    expect(thick.meanRate_Gy_per_s).toBeLessThan(thick.surfaceRate_Gy_per_s);
    expect(doseRate(WATER).meanRate_Gy_per_s).toBeLessThan(doseRate(WATER).surfaceRate_Gy_per_s);
  });

  it('absorbs more of the beam in a concentrated absorber than in water', () => {
    const water = doseRate({ ...WATER, energy_eV: 8383 });
    const nmc = doseRate({ ...WATER, formula: 'NiO', density: 6.67, energy_eV: 8383 });
    expect(nmc.muEnOverRho_cm2_g).toBeGreaterThan(10 * water.muEnOverRho_cm2_g);
    expect(nmc.surfaceRate_Gy_per_s).toBeGreaterThan(water.surfaceRate_Gy_per_s);
  });

  it('rejects a beam, flux or thickness that is not positive', () => {
    expect(() => doseRate({ ...WATER, flux: 0 })).toThrow(/Flux/);
    expect(() => doseRate({ ...WATER, beam_um: [0, 100] })).toThrow(/Horizontal beam size/);
    expect(() => doseRate({ ...WATER, thickness_um: -1 })).toThrow(/Thickness/);
    expect(() => doseRate({ ...WATER, depositedFraction: 1.5 })).toThrow(/deposited fraction/);
  });
});

describe('photoreduction kinetics', () => {
  it('is first order in dose', () => {
    const criticalDose_Gy = 1e5;
    expect(photoreduction({ dose_Gy: 0, criticalDose_Gy }).reducedFraction).toBe(0);
    expect(photoreduction({ dose_Gy: 0, criticalDose_Gy }).intactFraction).toBe(1);
    // One critical dose reduces 1 - 1/e of the absorber.
    expectClose(photoreduction({ dose_Gy: criticalDose_Gy, criticalDose_Gy }).reducedFraction,
                1 - 1 / Math.E, 1e-12, 'one critical dose');
    // Equal dose increments multiply the intact fraction by the same factor.
    const first = photoreduction({ dose_Gy: criticalDose_Gy, criticalDose_Gy }).intactFraction;
    const second = photoreduction({ dose_Gy: 2 * criticalDose_Gy, criticalDose_Gy }).intactFraction;
    expectClose(second, first * first, 1e-12, 'exponential decay');
  });

  it('saturates towards fully reduced and stays in range', () => {
    const criticalDose_Gy = 1e3;
    let previous = 0;
    for (const dose_Gy of [1, 10, 100, 1e3, 1e4, 1e6]) {
      const result = photoreduction({ dose_Gy, criticalDose_Gy });
      expect(result.reducedFraction).toBeGreaterThan(previous);
      expect(result.reducedFraction).toBeLessThanOrEqual(1);
      expect(result.intactFraction + result.reducedFraction).toBeCloseTo(1, 12);
      previous = result.reducedFraction;
    }
    expect(photoreduction({ dose_Gy: 1e6, criticalDose_Gy }).reducedFraction).toBeCloseTo(1, 12);
  });

  it('keeps its teaching label and its small-dose linearity', () => {
    const result = photoreduction({ dose_Gy: 1, criticalDose_Gy: 1e6 });
    expect(result.provenance).toBe('teaching-model');
    // For D far below D_c the reduced fraction is D/D_c to first order.
    expectClose(result.reducedFraction, 1e-6, 1e-5, 'small-dose linearity');
  });

  it('rejects a negative dose or a critical dose that is not positive', () => {
    expect(() => photoreduction({ dose_Gy: -1, criticalDose_Gy: 1e5 })).toThrow(/Dose/);
    expect(() => photoreduction({ dose_Gy: 1, criticalDose_Gy: 0 })).toThrow(/Critical dose/);
  });
});

describe('teaching critical doses and the cryogenic factor', () => {
  it('orders the sample classes the way the literature orders sensitivity', () => {
    const { solution, biological, operando, oxide } = TEACHING_CRITICAL_DOSE_Gy;
    expect(solution).toBeLessThan(biological);
    expect(biological).toBeLessThan(operando);
    expect(operando).toBeLessThan(oxide);
  });

  it('protects more at 10 K than at liquid nitrogen temperature', () => {
    expect(cryoFactor(10)).toBeGreaterThan(cryoFactor(80));
    expect(cryoFactor(80)).toBeGreaterThan(cryoFactor(300));
    expect(cryoFactor(300)).toBe(1);
    expect(() => cryoFactor(0)).toThrow(/Temperature/);
  });
});

describe('damageEstimate', () => {
  // Chosen so the sample is partly, not fully, reduced: a saturated case would hide every
  // difference a mitigation makes.
  const base = {
    ...WATER,
    flux: 1e11,
    beam_um: [500, 500] as [number, number],
    exposure_s: 60,
    damageClass: 'biological' as const,
  };

  it('lowers the dose rate by defocusing and by attenuation', () => {
    const plain = damageEstimate(base);
    // Defocus 4 spreads the beam over four times the area, so the rate falls to a quarter.
    const defocused = damageEstimate({ ...base, mitigations: { defocus: 4 } });
    expectClose(defocused.rate.area_cm2, 4 * plain.rate.area_cm2, 1e-12, 'defocused area');
    expectClose(defocused.mitigatedRate_Gy_per_s, plain.mitigatedRate_Gy_per_s / 4, 1e-12, 'defocused rate');
    const attenuated = damageEstimate({ ...base, mitigations: { attenuation: 0.1 } });
    expectClose(attenuated.mitigatedRate_Gy_per_s, plain.mitigatedRate_Gy_per_s / 10, 1e-12, 'attenuated rate');
    expect(attenuated.reduction.reducedFraction).toBeLessThan(plain.reduction.reducedFraction);
  });

  it('divides the dose per spot when the sample is translated', () => {
    const plain = damageEstimate(base);
    const translated = damageEstimate({ ...base, mitigations: { spots: 5 } });
    expectClose(translated.dose_Gy, plain.dose_Gy / 5, 1e-12, 'dose per spot');
    expect(translated.notes.join(' ')).toMatch(/5 spots/);
  });

  it('raises the critical dose in a cryostat and says it is a teaching factor', () => {
    const warm = damageEstimate(base);
    const cold = damageEstimate({ ...base, mitigations: { temperature_K: 10 } });
    expectClose(cold.criticalDose_Gy, warm.criticalDose_Gy * 10, 1e-12, 'cryogenic critical dose');
    expect(cold.reduction.reducedFraction).toBeLessThan(warm.reduction.reducedFraction);
    expect(cold.notes.join(' ')).toMatch(/teaching factor/);
    expect(cold.provenance).toContain('teaching-model');
  });

  it('labels a teaching critical dose but not a measured one', () => {
    expect(damageEstimate(base).notes.join(' ')).toMatch(/teaching value/);
    const measured = damageEstimate({ ...base, criticalDose_Gy: 2.5e5 });
    expect(measured.criticalDose_Gy).toBe(2.5e5);
    expect(measured.notes.join(' ')).not.toMatch(/teaching value/);
  });

  it('accumulates dose linearly in exposure and inverts to a time', () => {
    const ten = damageEstimate({ ...base, exposure_s: 10 });
    const hundred = damageEstimate({ ...base, exposure_s: 100 });
    expectClose(hundred.dose_Gy, 10 * ten.dose_Gy, 1e-12, 'dose in exposure');
    expect(damageEstimate({ ...base, exposure_s: 0 }).reduction.reducedFraction).toBe(0);

    // timeToFraction_s is the inverse of the kinetics: feeding it back reproduces the fraction.
    const target = 0.5;
    const time_s = ten.timeToFraction_s(target);
    const check = damageEstimate({ ...base, exposure_s: time_s });
    expectClose(check.reduction.reducedFraction, target, 1e-9, 'time to half reduced');
    expect(() => ten.timeToFraction_s(1)).toThrow(/reduced fraction/);
  });

  it('needs more time per spot when the sample is translated', () => {
    const plain = damageEstimate(base).timeToFraction_s(0.1);
    const translated = damageEstimate({ ...base, mitigations: { spots: 4 } }).timeToFraction_s(0.1);
    expectClose(translated, 4 * plain, 1e-12, 'time with four spots');
  });

  it('rejects mitigations outside their range', () => {
    expect(() => damageEstimate({ ...base, mitigations: { attenuation: 0 } })).toThrow(/Attenuation/);
    expect(() => damageEstimate({ ...base, mitigations: { attenuation: 2 } })).toThrow(/Attenuation/);
    expect(() => damageEstimate({ ...base, mitigations: { defocus: 0 } })).toThrow(/Defocus/);
    expect(() => damageEstimate({ ...base, mitigations: { spots: 1.5 } })).toThrow(/spots/);
    expect(() => damageEstimate({ ...base, exposure_s: -1 })).toThrow(/Exposure/);
  });
});
