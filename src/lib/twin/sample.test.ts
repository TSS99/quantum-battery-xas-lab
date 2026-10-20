import { beforeAll, describe, expect, it } from 'vitest';

import sampleFixturesJson from '../../data/twin/sample-fixtures.json';
import { loadXrayData, mu, muOverRho } from '../xraydata';
import {
  DEFAULT_EXIT_ANGLE_DEG,
  TEACHING_ESCAPE_DEPTH_NM,
  THICKNESS_QUADRATURE_ORDER,
  electronYield,
  fluorescence,
  fluorescenceFromMu,
  fluorescenceLine,
  gaussHermite,
  muComponents,
  sampleElectronYield,
  selfAbsorptionAlpha,
  sharpEdge,
  teachingFineStructure,
  thickFluorescence,
  thinFluorescence,
  transmission,
  windowTransmission,
  type FluorescenceMuInput,
} from './sample';
import { loadOptics } from './tables';
import type { EnvironmentConfig, SampleConfig } from './types';

interface TransmissionFixture {
  muTotal_cm_inv: number;
  muPhoto_cm_inv: number;
  muAbsorber_cm_inv: number;
  muX: number;
  sampleTransmission: number;
  windowTransmission: number;
  transmission: number;
  apparentMuX: number;
}

interface FluorescenceFixture {
  lineEnergy_eV: number;
  fluorescenceYield: number;
  lineFraction: number;
  prefactor: number;
  muAbsorber_cm_inv: number;
  muTotalIn_cm_inv: number;
  muTotalOut_cm_inv: number;
  geometryRatio: number;
  alpha_cm_inv: number;
  depthIntegralExponent: number;
  ratio: number;
  thinLimit: number;
  thickLimit: number;
  dampingFactor: number;
  windowTransmissionIn: number;
  windowTransmissionOut: number;
}

interface ElectronYieldFixture {
  escapeDepth_nm: number;
  yield: number;
  linearYield: number;
  saturation: number;
  attenuationDepth_nm: number;
}

interface CaseFixture {
  id: string;
  material: { formula: string; density: number; absorber: string; edge: string };
  environment: EnvironmentConfig;
  sample: {
    thickness_um: number;
    pinholeFraction: number;
    thicknessSpread: number;
    particle_um: number;
    incidence_deg: number;
  };
  exit_deg: number;
  edgeEnergy_eV: number;
  fluoCorrAlpha: number | null;
  points: {
    offset_eV: number;
    energy_eV: number;
    transmission: TransmissionFixture;
    fluorescence: FluorescenceFixture;
    electronYield: ElectronYieldFixture;
  }[];
}

const fixtures = sampleFixturesJson as unknown as {
  constants: { solidAngleFraction: number; detectorEfficiency: number; yieldOffset_eV: number };
  cases: CaseFixture[];
};

/** Within `tolerance` in relative terms, treating a pair that is both negligible as equal. */
function expectClose(actual: number, expected: number, tolerance: number, label: string) {
  if (Math.abs(expected) < 1e-300) {
    expect(Math.abs(actual), label).toBeLessThan(1e-300);
    return;
  }
  expect(Math.abs(actual / expected - 1), `${label}: got ${actual}, expected ${expected}`).toBeLessThan(tolerance);
}

function sampleConfig(fixture: CaseFixture): SampleConfig {
  return {
    formula: fixture.material.formula,
    density: fixture.material.density,
    absorber: fixture.material.absorber,
    edge: fixture.material.edge,
    form: 'pellet',
    ...fixture.sample,
  };
}

/** The fixtures hold the bare tabulated edge, so the teaching fine structure is switched off. */
function sharpOptions(fixture: CaseFixture) {
  return { fineStructure: sharpEdge(fixture.edgeEnergy_eV) };
}

const FE_SOLUTION: SampleConfig = {
  formula: 'H111.017O55.508Fe0.002',
  density: 1,
  absorber: 'Fe',
  edge: 'K',
  form: 'solution',
  thickness_um: 1000,
  pinholeFraction: 0,
  thicknessSpread: 0,
  particle_um: 0,
  incidence_deg: 45,
};

const AMBIENT: EnvironmentConfig = { kind: 'ambient', temperature_K: 300, windows: [] };

beforeAll(async () => {
  await loadXrayData();
  await loadOptics();
});

describe('muComponents', () => {
  it('splits the tabulated total into the chosen edge and the rest', () => {
    const sample = { ...FE_SOLUTION, formula: 'Fe2O3', density: 5.24, thickness_um: 10 };
    const above = muComponents(sample, 7200, sharpOptions({ edgeEnergy_eV: 7112 } as CaseFixture));
    expect(above.rest_cm_inv + above.absorber_cm_inv).toBeCloseTo(above.total_cm_inv, 12);
    // With no fine structure the total is exactly the tabulated mu, above and below the edge.
    expectClose(above.total_cm_inv, above.tabulated_cm_inv, 1e-12, 'total above the edge');
    const below = muComponents(sample, 7000, sharpOptions({ edgeEnergy_eV: 7112 } as CaseFixture));
    expectClose(below.total_cm_inv, below.tabulated_cm_inv, 1e-12, 'total below the edge');
    expect(below.absorber_cm_inv).toBe(0);
    // The rest is continuous across the edge: removing the jump leaves no step behind.
    const justUnder = muComponents(sample, 7111.9, sharpOptions({ edgeEnergy_eV: 7112 } as CaseFixture));
    const justOver = muComponents(sample, 7112.1, sharpOptions({ edgeEnergy_eV: 7112 } as CaseFixture));
    expectClose(justOver.rest_cm_inv, justUnder.rest_cm_inv, 0.002, 'rest across the edge');
    // The tabulated total itself jumps by a factor of several there.
    expect(justOver.tabulated_cm_inv / justUnder.tabulated_cm_inv).toBeGreaterThan(3);
    expect(above.sharpStep_cm_inv).toBeGreaterThan(above.rest_cm_inv);
  });

  const CU_FOIL_FOR_EDGE: SampleConfig = { formula: 'Cu', density: 8.96, thickness_um: 7, absorber: 'Cu', edge: 'K', form: 'foil', pinholeFraction: 0, thicknessSpread: 0, particle_um: 0, incidence_deg: 45 };

  it('stays positive and continuous at the edge record, where the table jumps a fraction of an eV away', () => {
    // Fe K: the table jumps just above 7112.0 eV; Cu K: just below 8979.0 eV.
    const fe: SampleConfig = { ...CU_FOIL_FOR_EDGE, formula: 'Fe', absorber: 'Fe', density: 7.874 };
    for (const [sample, e0] of [[fe, 7112], [CU_FOIL_FOR_EDGE, 8979]] as const) {
      const values = [-0.1, -1e-4, 0, 1e-4, 0.1].map(d => muComponents(sample, e0 + d).total_cm_inv);
      for (const v of values) expect(v).toBeGreaterThan(0);
      // The broadened teaching edge rises about 6 % per 0.1 eV here; the side mix-up this guards against was a factor of 2 or a sign flip.
      for (let i = 1; i < values.length; i++) expect(Math.abs(values[i] / values[i - 1] - 1)).toBeLessThan(0.15);
    }
  });

  it('rejects an absorber that is not in the formula', () => {
    expect(() => muComponents({ ...FE_SOLUTION, absorber: 'Ni' }, 8400)).toThrow(/not in the formula/);
  });

  it('carries the provenance of the fine-structure model', () => {
    const teaching = muComponents(FE_SOLUTION, 7200);
    expect(teaching.provenance).toEqual(['tabulated', 'teaching-model']);
    expect(teaching.fineStructureLabel).toMatch(/teaching model/);
    const sharp = muComponents(FE_SOLUTION, 7200, sharpOptions({ edgeEnergy_eV: 7112 } as CaseFixture));
    expect(sharp.provenance).toEqual(['tabulated']);
  });
});

describe('teachingFineStructure', () => {
  it('is flat below the edge region and approaches one far above it', () => {
    const { factor, provenance } = teachingFineStructure(7112);
    expect(provenance).toBe('teaching-model');
    expect(factor(6500)).toBeLessThan(1e-3);
    // The arctangent step is exactly 0.5 at the edge; the default extra features add a little.
    expect(factor(7112)).toBeGreaterThan(0.5);
    expect(factor(7112)).toBeLessThan(0.6);
    // Far above the edge the oscillation is damped out and the step has saturated.
    expect(factor(9000)).toBeCloseTo(1, 2);
  });

  it('puts a white line above the edge and a pre-edge peak below it', () => {
    const features = { preEdgeHeight: 0.2, preEdgeOffset_eV: 15, preEdgeWidth_eV: 2, whiteLineHeight: 0.6, whiteLineOffset_eV: 8, whiteLineWidth_eV: 4, oscillation: 0, distance_A: 2.5, sigma2_A2: 0.005 };
    const { factor } = teachingFineStructure(7112, features);
    expect(factor(7120)).toBeGreaterThan(factor(7200));
    expect(factor(7097)).toBeGreaterThan(factor(7085));
  });
});

describe('gaussHermite', () => {
  it('has weights summing to sqrt(pi) and integrates a Gaussian moment exactly', () => {
    const { nodes, weights } = gaussHermite(THICKNESS_QUADRATURE_ORDER);
    const total = weights.reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(Math.sqrt(Math.PI), 12);
    // integral exp(-x^2) x^2 dx = sqrt(pi)/2
    let second = 0;
    for (let i = 0; i < nodes.length; i++) second += weights[i] * nodes[i] ** 2;
    expect(second).toBeCloseTo(Math.sqrt(Math.PI) / 2, 11);
  });

  it('rejects an order outside the supported range', () => {
    expect(() => gaussHermite(1)).toThrow(/between 2 and 200/);
    expect(() => gaussHermite(2.5)).toThrow(/between 2 and 200/);
  });
});

describe('transmission distortions', () => {
  const uniform: SampleConfig = { ...FE_SOLUTION, formula: 'Cu', density: 8.96, thickness_um: 10,
                                  form: 'foil', absorber: 'Cu', edge: 'K' };

  it('reproduces the pinhole formula of dossier 5.2 item 1', () => {
    const clean = transmission(uniform, AMBIENT, 9200, sharpOptions({ edgeEnergy_eV: 8979 } as CaseFixture));
    const holey = transmission({ ...uniform, pinholeFraction: 0.05 }, AMBIENT, 9200,
                               sharpOptions({ edgeEnergy_eV: 8979 } as CaseFixture));
    expectClose(holey.sampleTransmission, 0.95 * clean.sampleTransmission + 0.05, 1e-12, 'pinhole transmission');
    expect(holey.apparentMuX).toBeLessThan(clean.apparentMuX);
    expect(holey.amplitudeFactor).toBeLessThan(1);
  });

  it('reproduces the analytic Gaussian thickness average of dossier 5.2 item 2', () => {
    const spread = 0.1;
    const spreadSample = { ...uniform, thicknessSpread: spread };
    const result = transmission(spreadSample, AMBIENT, 9200, sharpOptions({ edgeEnergy_eV: 8979 } as CaseFixture));
    const muX = result.muX;
    expectClose(result.sampleTransmission, Math.exp(-muX + 0.5 * (muX * spread) ** 2), 1e-9,
                'Gaussian thickness average');
    // A = 1 - mu sigma_x^2 / xbar = 1 - muX * spread^2, dossier 5.2 item 2.
    expectClose(result.amplitudeFactor, 1 - muX * spread ** 2, 1e-5, 'Gaussian amplitude factor');
  });

  it('reproduces the particle-size amplitude factor exp(-mu t) of dossier 5.2 item 5', () => {
    const grain_um = 8;
    const grains = { ...uniform, thickness_um: 30, particle_um: grain_um };
    const result = transmission(grains, AMBIENT, 9200, sharpOptions({ edgeEnergy_eV: 8979 } as CaseFixture));
    const muTotal = result.components.total_cm_inv;
    const muT = muTotal * grain_um * 1e-4;
    expectClose(result.apparentMuX, (30 / grain_um) * -Math.expm1(-muT), 1e-12, 'particle apparent muX');
    expectClose(result.amplitudeFactor, Math.exp(-muT), 1e-5, 'particle amplitude factor');
    expect(result.apparentMuX).toBeLessThan(result.muX);
  });

  it('leaves a uniform hole-free sample undistorted', () => {
    const result = transmission(uniform, AMBIENT, 9200, sharpOptions({ edgeEnergy_eV: 8979 } as CaseFixture));
    expectClose(result.apparentMuX, result.muX, 1e-12, 'ideal apparent muX');
    expectClose(result.amplitudeFactor, 1, 1e-6, 'ideal amplitude factor');
    expect(result.windowTransmission).toBe(1);
  });

  it('multiplies in every environment window', () => {
    const environment: EnvironmentConfig = {
      kind: 'liquid-cell',
      temperature_K: 300,
      windows: [{ formula: 'C22H10N2O5', density: 1.42, thickness_um: 50 },
                { formula: 'C22H10N2O5', density: 1.42, thickness_um: 50 }],
    };
    const one = windowTransmission({ windows: [environment.windows[0]] }, 9200);
    expectClose(windowTransmission(environment, 9200), one * one, 1e-12, 'two identical windows');
    const result = transmission(uniform, environment, 9200, sharpOptions({ edgeEnergy_eV: 8979 } as CaseFixture));
    expectClose(result.transmission, result.sampleTransmission * one * one, 1e-12, 'sample times windows');
  });

  it('carries the sample temperature through for the EXAFS damping of T3a', () => {
    const cryo: EnvironmentConfig = { kind: 'cryostat', temperature_K: 80, windows: [] };
    expect(transmission(uniform, cryo, 9200).temperature_K).toBe(80);
  });
});

describe('fluorescenceLine', () => {
  it('matches the xraydb yield, mean line energy and line probability of the fixtures', () => {
    for (const fixture of fixtures.cases) {
      const point = fixture.points[0];
      const line = fluorescenceLine(fixture.material.absorber, fixture.material.edge, 'Ka');
      expectClose(line.energy_eV, point.fluorescence.lineEnergy_eV, 0.01, `${fixture.id} line energy`);
      expectClose(line.lineFraction, point.fluorescence.lineFraction, 0.01, `${fixture.id} line fraction`);
      expectClose(line.fluorescenceYield, point.fluorescence.fluorescenceYield, 0.01, `${fixture.id} yield`);
      expect(line.provenance).toBe('tabulated');
    }
  });

  it('defaults to the strongest group and rejects an unknown one', () => {
    expect(fluorescenceLine('Ni', 'K').group).toBe('Ka');
    expect(() => fluorescenceLine('Ni', 'K', 'Lb')).toThrow(/has no "Lb" lines/);
  });
});

describe('fluorescenceFromMu limits', () => {
  const base: FluorescenceMuInput = {
    muAbsorber_cm_inv: 200,
    muTotalIn_cm_inv: 600,
    muTotalOut_cm_inv: 400,
    thickness_um: 20,
    incidence_deg: 45,
    exit_deg: 45,
    prefactor: 0.003,
  };

  it('reduces to the thin limit for a vanishing thickness', () => {
    const thin = { ...base, thickness_um: 1e-4 };
    const result = fluorescenceFromMu(thin);
    expect(result.depthIntegralExponent).toBeLessThan(1e-4);
    expectClose(result.ratio, result.thinLimit, 1e-4, 'thin limit');
    expectClose(thinFluorescence(thin), result.thinLimit, 1e-12, 'thinFluorescence helper');
  });

  it('reduces to the thick limit for a large thickness', () => {
    const thick = { ...base, thickness_um: 5000 };
    const result = fluorescenceFromMu(thick);
    expect(result.depthIntegralExponent).toBeGreaterThan(50);
    expectClose(result.ratio, result.thickLimit, 1e-12, 'thick limit');
    expectClose(thickFluorescence(thick), result.thickLimit, 1e-12, 'thickFluorescence helper');
  });

  it('sits between the two limits at an intermediate thickness', () => {
    const result = fluorescenceFromMu(base);
    expect(result.ratio).toBeLessThan(result.thinLimit);
    expect(result.ratio).toBeLessThan(result.thickLimit);
    expect(result.ratio).toBeGreaterThan(0);
  });

  it('uses g = sin(phi)/sin(psi) and damps less at grazing exit', () => {
    const normal = fluorescenceFromMu({ ...base, thickness_um: 5000 });
    const grazing = fluorescenceFromMu({ ...base, thickness_um: 5000, exit_deg: 5 });
    expectClose(grazing.geometryRatio, Math.sin(Math.PI / 4) / Math.sin((5 * Math.PI) / 180), 1e-12, 'geometry ratio');
    expect(grazing.dampingFactor).toBeGreaterThan(normal.dampingFactor);
    expect(normal.dampingFactor).toBeCloseTo(1 - base.muAbsorber_cm_inv / normal.alpha_cm_inv, 12);
  });

  it('is strictly proportional to mu_a in the thin limit but not in the thick limit', () => {
    const thin = (muA: number) => fluorescenceFromMu({ ...base, thickness_um: 1e-4, muAbsorber_cm_inv: muA, muTotalIn_cm_inv: 400 + muA }).ratio;
    const thick = (muA: number) => fluorescenceFromMu({ ...base, thickness_um: 5000, muAbsorber_cm_inv: muA, muTotalIn_cm_inv: 400 + muA }).ratio;
    expectClose(thin(400) / thin(200), 2, 1e-3, 'thin proportionality');
    expect(thick(400) / thick(200)).toBeLessThan(1.8);
  });

  it('gives no signal below the edge, where mu_a is zero', () => {
    expect(fluorescenceFromMu({ ...base, muAbsorber_cm_inv: 0 }).ratio).toBe(0);
  });

  it('rejects angles outside the open range to 90 degrees', () => {
    expect(() => fluorescenceFromMu({ ...base, exit_deg: 0 })).toThrow(/Exit angle/);
    expect(() => fluorescenceFromMu({ ...base, incidence_deg: 120 })).toThrow(/Incidence angle/);
  });
});

describe('electronYield', () => {
  it('is proportional to mu_a while the attenuation depth is far above the escape depth', () => {
    const weak = electronYield({ muAbsorber_cm_inv: 100, muTotal_cm_inv: 300, incidence_deg: 45, escapeDepth_nm: 2 });
    expect(weak.saturation).toBeGreaterThan(0.999);
    expectClose(weak.yield, weak.linearYield, 1e-3, 'unsaturated yield');
  });

  it('saturates towards mu_a / mu_T as the escape depth grows', () => {
    const muA = 100;
    const muT = 300;
    const saturated = electronYield({ muAbsorber_cm_inv: muA, muTotal_cm_inv: muT, incidence_deg: 90, escapeDepth_nm: 1e9 });
    expectClose(saturated.yield, muA / muT, 1e-3, 'fully saturated yield');
    expect(saturated.saturation).toBeLessThan(0.01);
  });

  it('saturates more at grazing incidence', () => {
    const input = { muAbsorber_cm_inv: 2000, muTotal_cm_inv: 6000, escapeDepth_nm: 2000 };
    const normal = electronYield({ ...input, incidence_deg: 90 });
    const grazing = electronYield({ ...input, incidence_deg: 5 });
    expect(grazing.saturation).toBeLessThan(normal.saturation);
    expect(grazing.attenuationDepth_nm).toBeLessThan(normal.attenuationDepth_nm);
    expect(normal.provenance).toBe('teaching-model');
  });

  it('defaults to the teaching escape depth', () => {
    const result = sampleElectronYield(FE_SOLUTION, 7200);
    expect(result.escapeDepth_nm).toBe(TEACHING_ESCAPE_DEPTH_NM);
    expect(result.provenance).toBe('teaching-model');
  });
});

describe('selfAbsorptionAlpha', () => {
  it('matches the Larch fluo_corr alpha of the fixtures', () => {
    let compared = 0;
    for (const fixture of fixtures.cases) {
      const call = () => selfAbsorptionAlpha(fixture.material.formula, fixture.material.absorber,
                                             fixture.material.edge, fixture.sample.incidence_deg,
                                             fixture.exit_deg, 'Ka');
      if (fixture.fluoCorrAlpha === null) {
        // The reference records null where the +/-10 eV difference does not resolve the step.
        expect(call, `${fixture.id} should refuse an unresolved step`).toThrow(/does not resolve/);
        continue;
      }
      expectClose(call(), fixture.fluoCorrAlpha, 0.01, `${fixture.id} fluo_corr alpha`);
      compared++;
    }
    expect(compared).toBeGreaterThan(5);
  });

  it('is large for a dilute sample and small for a concentrated one', () => {
    // 1 wt% Fe in silica is the dilute example of dossier 6.2, which lists alpha = 38.75.
    const dilute = selfAbsorptionAlpha('Si33.0O66.0Fe0.182', 'Fe', 'K', 45, 45, 'Ka');
    const concentrated = selfAbsorptionAlpha('Fe2O3', 'Fe', 'K', 45, 45, 'Ka');
    expect(dilute).toBeGreaterThan(20);
    expect(concentrated).toBeLessThan(1);
    // Dossier 6.2 gives 0.401 for Fe2O3 with the same algorithm.
    expectClose(concentrated, 0.401, 0.05, 'Fe2O3 fluo_corr alpha');
  });
});

describe('sample fixtures from scripts/twin/reference_sample.py', () => {
  it('covers ten cases at five energies each', () => {
    expect(fixtures.cases).toHaveLength(10);
    for (const fixture of fixtures.cases) expect(fixture.points).toHaveLength(5);
  });

  for (const fixture of fixtures.cases) {
    describe(fixture.id, () => {
      const sample = sampleConfig(fixture);
      const options = sharpOptions(fixture);
      const geometry = {
        solidAngleFraction: fixtures.constants.solidAngleFraction,
        efficiency: fixtures.constants.detectorEfficiency,
        exit_deg: fixture.exit_deg,
        line: 'Ka',
      };

      it('reproduces mu, transmission, fluorescence and electron yield within 1 %', () => {
        for (const point of fixture.points) {
          const where = `${fixture.id} at ${point.offset_eV} eV`;

          const components = muComponents(sample, point.energy_eV, options);
          expectClose(components.edgeEnergy_eV, fixture.edgeEnergy_eV, 1e-6, `${where} edge energy`);
          expectClose(components.total_cm_inv, point.transmission.muTotal_cm_inv, 0.01, `${where} mu_T`);
          expectClose(components.absorber_cm_inv, point.transmission.muAbsorber_cm_inv, 0.01, `${where} mu_a`);

          const t = transmission(sample, fixture.environment, point.energy_eV, options);
          expectClose(t.muX, point.transmission.muX, 0.01, `${where} muX`);
          // A ratio test on exp(-mu x) is meaningless once the sample is opaque: at muX = 86
          // a 0.03 % difference in mu already moves T by 2 %. Compare the optical depth there.
          if (point.transmission.sampleTransmission > 1e-10) {
            expectClose(t.sampleTransmission, point.transmission.sampleTransmission, 0.01, `${where} sample transmission`);
          } else {
            expectClose(-Math.log(t.sampleTransmission), -Math.log(point.transmission.sampleTransmission),
                        0.01, `${where} sample optical depth`);
          }
          expectClose(t.windowTransmission, point.transmission.windowTransmission, 0.01, `${where} window transmission`);
          if (point.transmission.transmission > 1e-10) {
            expectClose(t.transmission, point.transmission.transmission, 0.01, `${where} transmission`);
          } else {
            expectClose(-Math.log(t.transmission), -Math.log(point.transmission.transmission),
                        0.01, `${where} total optical depth`);
          }
          expectClose(t.apparentMuX, point.transmission.apparentMuX, 0.01, `${where} apparent muX`);
          expect(t.temperature_K).toBe(fixture.environment.temperature_K);

          const f = fluorescence(sample, fixture.environment, point.energy_eV, geometry, options);
          expectClose(f.muTotalOut_cm_inv, point.fluorescence.muTotalOut_cm_inv, 0.01, `${where} mu_T(E_f)`);
          expectClose(f.geometryRatio, point.fluorescence.geometryRatio, 1e-9, `${where} geometry ratio`);
          expectClose(f.alpha_cm_inv, point.fluorescence.alpha_cm_inv, 0.01, `${where} alpha`);
          expectClose(f.depthIntegralExponent, point.fluorescence.depthIntegralExponent, 0.01, `${where} depth exponent`);
          expectClose(f.prefactor, point.fluorescence.prefactor, 0.01, `${where} prefactor`);
          expectClose(f.windowTransmissionIn, point.fluorescence.windowTransmissionIn, 0.01, `${where} windows in`);
          expectClose(f.windowTransmissionOut, point.fluorescence.windowTransmissionOut, 0.01, `${where} windows out`);
          expectClose(f.ratio, point.fluorescence.ratio, 0.01, `${where} fluorescence ratio`);
          expectClose(f.thinLimit, point.fluorescence.thinLimit, 0.01, `${where} thin limit`);
          expectClose(f.thickLimit, point.fluorescence.thickLimit, 0.01, `${where} thick limit`);
          expectClose(f.dampingFactor, point.fluorescence.dampingFactor, 0.01, `${where} damping`);

          const y = sampleElectronYield(sample, point.energy_eV,
                                        { ...options, escapeDepth_nm: point.electronYield.escapeDepth_nm });
          expectClose(y.yield, point.electronYield.yield, 0.01, `${where} electron yield`);
          expectClose(y.linearYield, point.electronYield.linearYield, 0.01, `${where} linear yield`);
          expectClose(y.saturation, point.electronYield.saturation, 0.01, `${where} saturation`);
          expectClose(y.attenuationDepth_nm, point.electronYield.attenuationDepth_nm, 0.01, `${where} attenuation depth`);
        }
      });

      it('has no fluorescence and no electron yield below the edge', () => {
        const below = fixture.points.find(point => point.offset_eV < 0);
        expect(below).toBeDefined();
        const f = fluorescence(sample, fixture.environment, below!.energy_eV, geometry, options);
        expect(f.ratio).toBe(0);
        expect(f.components.absorber_cm_inv).toBe(0);
        // The sample still absorbs below the edge, so transmission is not one.
        expect(transmission(sample, fixture.environment, below!.energy_eV, options).sampleTransmission)
          .toBeLessThan(1);
      });
    });
  }

  it('suppresses the NiO edge jump in the thick case relative to the thin case', () => {
    const read = (id: string) => {
      const fixture = fixtures.cases.find(item => item.id === id)!;
      const sample = sampleConfig(fixture);
      const options = sharpOptions(fixture);
      const geometry = {
        solidAngleFraction: fixtures.constants.solidAngleFraction,
        efficiency: fixtures.constants.detectorEfficiency,
        exit_deg: fixture.exit_deg,
        line: 'Ka',
      };
      const at = (offset: number) => {
        const point = fixture.points.find(item => item.offset_eV === offset)!;
        return fluorescence(sample, fixture.environment, point.energy_eV, geometry, options);
      };
      const top = at(50);
      const far = at(1000);
      return {
        // How much of the mu_a step above the edge survives in the measured signal.
        compression: (top.ratio / far.ratio) / (top.components.absorber_cm_inv / far.components.absorber_cm_inv),
        damping: top.dampingFactor,
        exponent: top.depthIntegralExponent,
      };
    };

    const thin = read('nio-pellet-thin-45-45');
    const thick = read('nio-pellet-thick-45-45');
    const grazing = read('nio-pellet-thick-grazing');

    expect(thin.exponent).toBeLessThan(1);
    expect(thick.exponent).toBeGreaterThan(50);
    // The thin sample follows mu_a closely; the thick one compresses the step.
    expect(thin.compression).toBeGreaterThan(0.9);
    expect(thick.compression).toBeLessThan(0.85);
    expect(thick.compression).toBeLessThan(thin.compression);
    // Grazing exit lets the thick sample recover part of the step (dossier 6.2).
    expect(grazing.damping).toBeGreaterThan(thick.damping);
    expect(grazing.compression).toBeGreaterThan(thick.compression);
  });

  it('keeps the dilute solution almost undistorted', () => {
    const fixture = fixtures.cases.find(item => item.id === 'fe-solution-45-45')!;
    const point = fixture.points.find(item => item.offset_eV === 50)!;
    expect(point.fluorescence.dampingFactor).toBeGreaterThan(0.99);
    const f = fluorescence(sampleConfig(fixture), fixture.environment, point.energy_eV, {
      solidAngleFraction: fixtures.constants.solidAngleFraction,
      efficiency: fixtures.constants.detectorEfficiency,
      exit_deg: fixture.exit_deg,
      line: 'Ka',
    }, sharpOptions(fixture));
    expect(f.dampingFactor).toBeGreaterThan(0.99);
  });
});

describe('fluorescence of a configured sample', () => {
  it('defaults the exit angle and rejects an impossible geometry', () => {
    const geometry = { solidAngleFraction: 0.01, efficiency: 0.85 };
    const withDefault = fluorescence(FE_SOLUTION, AMBIENT, 7200, geometry);
    const explicit = fluorescence(FE_SOLUTION, AMBIENT, 7200, { ...geometry, exit_deg: DEFAULT_EXIT_ANGLE_DEG });
    expectClose(withDefault.ratio, explicit.ratio, 1e-12, 'default exit angle');
    expect(() => fluorescence(FE_SOLUTION, AMBIENT, 7200, { ...geometry, efficiency: 1.5 }))
      .toThrow(/Detector efficiency/);
  });

  it('feeds the fine structure into the signal through mu_a and mu_T', () => {
    const geometry = { solidAngleFraction: 0.01, efficiency: 0.85 };
    const teaching = fluorescence(FE_SOLUTION, AMBIENT, 7112, geometry);
    const sharp = fluorescence(FE_SOLUTION, AMBIENT, 7112, geometry, { fineStructure: sharpEdge(7112) });
    // At the edge the arctangent onset has reached only about half the tabulated step.
    expect(teaching.ratio).toBeLessThan(sharp.ratio);
    // Nearly, but not exactly, proportional: mu_T carries mu_a too, so the self absorption
    // of even a 2 mM solution moves the ratio by a few parts in ten thousand.
    expectClose(teaching.ratio / sharp.ratio, teaching.components.fineStructureFactor, 2e-3,
                'fine structure scales the dilute signal');
    expect(teaching.provenance).toContain('teaching-model');
  });

  it('uses the tabulated mu at the line energy', () => {
    const result = fluorescence(FE_SOLUTION, AMBIENT, 7200, { solidAngleFraction: 0.01, efficiency: 0.85 });
    expectClose(result.muTotalOut_cm_inv, mu(FE_SOLUTION.formula, FE_SOLUTION.density, result.line.energy_eV).total,
                1e-12, 'mu at the line energy');
    expectClose(muOverRho(FE_SOLUTION.formula, result.line.energy_eV).total * FE_SOLUTION.density,
                result.muTotalOut_cm_inv, 1e-12, 'mu/rho times density');
  });
});
