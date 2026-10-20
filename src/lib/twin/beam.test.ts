import { beforeAll, describe, expect, it } from 'vitest';

import beamFixturesJson from '../../data/twin/beam-fixtures.json';
import { loadXrayData } from '../xraydata';
import { beamAtSample } from './beam';
import {
  CUTOFF_REFLECTIVITY,
  REJECTION_KEEP_FUNDAMENTAL,
  REJECTION_PASS_HARMONIC,
  cutoffEnergy_eV,
  harmonicRejectionAngle,
  mirrorTransmission,
  tabulatedEnergyRange_eV,
} from './mirrors';
import {
  HC_EV_ANGSTROM,
  SI_LATTICE_A,
  allowedHarmonics,
  backscatterEnergy_eV,
  braggAngle_rad,
  braggEnergy_eV,
  dSpacing_A,
  detuneFactor,
  glitchList,
  glitchThroughput,
  monoReading_eV,
  monoResolution,
  monoTrueEnergy_eV,
} from './mono';
import {
  besselJ,
  criticalEnergy_eV,
  spectralFlux,
  tuneSource,
  tuneUndulator,
  undulatorF,
  undulatorHarmonicEnergy_eV,
  undulatorQ,
} from './source';
import { darwin, loadOptics, mirrorAngles_mrad, mirrorReflectivity } from './tables';
import type { Crystal, MirrorCoating, MirrorConfig, SourceConfig, TwinProfile } from './types';

interface OrderFixture {
  order: number;
  energy_eV: number;
  bandwidth: number;
  intrinsicDeltaE_eV: number;
  deltaE_eV: number;
  darwinTheta_fwhm_rad: number;
  acceptance: number;
  detuneFactor: number;
  mirrorTransmission: number;
  sourceFlux: number;
  flux: number;
}

interface PointFixture {
  energy_eV: number;
  thetaB_rad: number;
  bandwidth: number;
  deltaE_eV: number;
  flux: number;
  harmonicFlux: number;
  harmonicFraction: number;
  mirrorTransmission: number;
  omittedOrders: number[];
  orders: OrderFixture[];
}

interface ConfigFixture {
  name: string;
  crystal: Crystal;
  detune: number;
  mirrorsInserted: boolean;
  source: SourceConfig;
  mirrors: MirrorConfig[];
  points: PointFixture[];
}

const fixtures = beamFixturesJson as unknown as {
  constants: { siLattice_A: number; hc_eV_angstrom: number; mirrorEnergyRange_eV: [number, number] };
  resolution: {
    crystal: Crystal; energy_eV: number; thetaB_rad: number; energy_fwhm_eV: number;
    relativeBandwidth: number; theta_fwhm_rad: number;
  }[];
  mirrors: { coating: MirrorCoating; angle_mrad: number; energy_eV: number; reflectivity: number }[];
  configurations: ConfigFixture[];
};

const relativeError = (actual: number, expected: number) => Math.abs(actual / expected - 1);

// The fixtures store 12 significant digits, so "exact" means exact to their precision.
const EXACT = 1e-11;

function profileOf(config: ConfigFixture): TwinProfile {
  return {
    format: 'xaslab-twin-profile/1',
    name: config.name,
    preset: 'reference-beam',
    source: config.source,
    mirrors: config.mirrors,
    mono: { crystal: config.crystal, offset_eV: 0, detune: config.detune, glitchSeed: 1 },
    chambers: [{ id: 'I0', length_cm: 15, gas: { N2: 1 }, gain_V_per_A: 1e7, dark_A: 1e-12 }],
    sdd: {
      elements: 4, distance_mm: 60, area_mm2: 50, peaking_us: 1,
      roi_eV: [7800, 8300], soller: false, exitAngle_deg: 45,
    },
    beam_um: [500, 200],
    stability: { i0Noise: 0, drift_eV_per_h: 0 },
  };
}

describe('mono geometry', () => {
  beforeAll(async () => {
    await loadOptics();
  });

  it('uses the exact silicon lattice constant and hc', () => {
    expect(SI_LATTICE_A).toBe(fixtures.constants.siLattice_A);
    expect(HC_EV_ANGSTROM).toBe(fixtures.constants.hc_eV_angstrom);
    expect(dSpacing_A('Si111')).toBeCloseTo(3.1356012, 6);
    expect(dSpacing_A('Si220')).toBeCloseTo(1.9201557, 6);
    expect(dSpacing_A('Si311')).toBeCloseTo(1.6375143, 6);
  });

  it('inverts the Bragg law and refuses energies below backscatter', () => {
    for (const crystal of ['Si111', 'Si311', 'Si220'] as const) {
      for (const energy_eV of [4200, 8979, 25000]) {
        const theta = braggAngle_rad(crystal, energy_eV);
        expect(braggEnergy_eV(crystal, theta)).toBeCloseTo(energy_eV, 9);
      }
      const lowest = backscatterEnergy_eV(crystal);
      expect(braggAngle_rad(crystal, lowest)).toBeCloseTo(Math.PI / 2, 6);
      expect(() => braggAngle_rad(crystal, lowest * 0.999)).toThrow(/backscatter/);
    }
  });

  it('reports the diamond-allowed harmonics: Si(111) passes 3E but not 2E', () => {
    expect(allowedHarmonics('Si111')).toEqual([1, 3, 4, 5]);
    expect(allowedHarmonics('Si311')).toEqual([1, 3, 4, 5]);
    expect(allowedHarmonics('Si220')).toEqual([1, 2, 3, 4, 5]);
  });

  it('converts between the monochromator reading and the true energy', () => {
    expect(monoReading_eV(8979, 1.5)).toBe(8977.5);
    expect(monoTrueEnergy_eV(monoReading_eV(8979, 1.5), 1.5)).toBeCloseTo(8979, 12);
  });
});

describe('mono resolution', () => {
  beforeAll(async () => {
    await loadOptics();
  });

  it('matches xraydb Bragg angles and Darwin energy widths within 1%', () => {
    for (const row of fixtures.resolution) {
      const resolution = monoResolution(row.crystal, 1, row.energy_eV, 0);
      expect(relativeError(resolution.thetaB_rad, row.thetaB_rad)).toBeLessThan(EXACT);
      expect(relativeError(resolution.intrinsic_eV, row.energy_fwhm_eV)).toBeLessThan(0.01);
      expect(relativeError(resolution.bandwidth, row.relativeBandwidth)).toBeLessThan(0.01);
      expect(relativeError(resolution.darwinTheta_fwhm_rad, row.theta_fwhm_rad)).toBeLessThan(0.01);
    }
  });

  it('gives Si(111) at the Cu K edge an intrinsic width of 1.28 eV', () => {
    const resolution = monoResolution('Si111', 1, 8979, 0);
    expect(resolution.intrinsic_eV).toBeCloseTo(1.2766, 2);
    expect(resolution.deltaE_eV).toBeCloseTo(resolution.intrinsic_eV, 12);
    expect(resolution.bandwidth).toBeCloseTo(1.42e-4, 6);
  });

  it('keeps the intrinsic term equal to the tabulated energy FWHM of every order', () => {
    for (const crystal of ['Si111', 'Si311', 'Si220'] as const) {
      for (const order of allowedHarmonics(crystal)) {
        for (const energy_eV of [5000, 8979, 20000]) {
          const resolution = monoResolution(crystal, order, energy_eV, 0);
          const widths = darwin(crystal, order, energy_eV);
          expect(relativeError(resolution.intrinsic_eV, widths.energy_fwhm_eV)).toBeLessThan(0.01);
          expect(resolution.energy_eV).toBe(order * energy_eV);
        }
      }
    }
  });

  it('adds the vertical divergence term in quadrature', () => {
    // Dossier section 2.3: Cu K, Si(111), 50 urad gives a 1.99 eV divergence term.  Its
    // quadrature total of 2.32 eV uses the classic Darwin width; this module uses the FWHM,
    // which is sqrt(9/8) larger and is the width the tabulated energy FWHM belongs to, so
    // the total comes out at 2.36 eV instead.
    const resolution = monoResolution('Si111', 1, 8979, 50);
    expect(8979 * resolution.divergence_rad / Math.tan(resolution.thetaB_rad)).toBeCloseTo(1.99, 2);
    expect(resolution.deltaE_eV).toBeCloseTo(2.363, 2);
    expect(resolution.deltaE_eV).toBeGreaterThan(resolution.intrinsic_eV);
    // Si(311) at Pt L3 with 200 urad is divergence dominated, so the two widths agree there.
    expect(monoResolution('Si311', 1, 11564, 200).deltaE_eV).toBeCloseTo(6.68, 1);
  });
});

describe('second-crystal detune', () => {
  beforeAll(async () => {
    await loadOptics();
  });

  it('leaves about 1.4e-3 of the Si(333) harmonic at a half-width detune at Cu K', () => {
    expect(detuneFactor('Si111', 1, 8979, 0)).toBeCloseTo(1, 4);
    expect(detuneFactor('Si111', 1, 8979, 0.5)).toBeGreaterThan(0.45);
    const harmonic = detuneFactor('Si111', 3, 8979, 0.5);
    expect(harmonic).toBeGreaterThan(1.2e-3);
    expect(harmonic).toBeLessThan(1.7e-3);
  });

  it('decays as a power law, not exponentially, in the harmonic tail', () => {
    // A 1/x^2 tail halves twice when the detune doubles; an exponential tail would collapse.
    const half = detuneFactor('Si111', 3, 8979, 0.4);
    const full = detuneFactor('Si111', 3, 8979, 0.8);
    expect(half / full).toBeGreaterThan(2);
    expect(half / full).toBeLessThan(6);
  });
});

describe('mirrors', () => {
  beforeAll(async () => {
    await loadOptics();
  });

  it('matches xraydb reflectivity on the stored angle grid within 1%', () => {
    for (const row of fixtures.mirrors) {
      const actual = mirrorReflectivity(row.coating, row.angle_mrad, row.energy_eV);
      expect(relativeError(actual, row.reflectivity)).toBeLessThan(0.01);
    }
  });

  it('puts the Rh cutoff where the dossier does', () => {
    expect(mirrorReflectivity('Rh', 3, 20000)).toBeCloseTo(0.93, 2);
    expect(mirrorReflectivity('Rh', 3, 27000)).toBeCloseTo(0.074, 3);
    const cutoff = cutoffEnergy_eV('Rh', 3);
    expect(cutoff).not.toBeNull();
    expect(relativeError(cutoff as number, 22100)).toBeLessThan(0.02);
    expect(mirrorReflectivity('Rh', 3, cutoff as number)).toBeCloseTo(CUTOFF_REFLECTIVITY, 4);
    expect(cutoffEnergy_eV('Si', 3)).not.toBeNull();
    expect(relativeError(cutoffEnergy_eV('Si', 3) as number, 10600)).toBeLessThan(0.02);
  });

  it('multiplies only the inserted mirrors', () => {
    const mirrors: MirrorConfig[] = [
      { id: 'M1', role: 'collimating', coating: 'Rh', angle_mrad: 3, inserted: true },
      { id: 'M2', role: 'focusing', coating: 'Pt', angle_mrad: 3, inserted: false },
    ];
    expect(mirrorTransmission(mirrors, 10000)).toBeCloseTo(mirrorReflectivity('Rh', 3, 10000), 12);
    expect(mirrorTransmission([], 10000)).toBe(1);
  });

  it('finds the largest angle that keeps the fundamental and kills the third harmonic', () => {
    for (const coating of ['Si', 'Rh', 'Pt', 'Ni'] as const) {
      for (const energy_eV of [6000, 8979, 12000]) {
        const angle = harmonicRejectionAngle(coating, energy_eV);
        if (angle === null) continue;
        expect(mirrorAngles_mrad(coating)).toContain(angle);
        expect(mirrorReflectivity(coating, angle, energy_eV))
          .toBeGreaterThanOrEqual(REJECTION_KEEP_FUNDAMENTAL);
        expect(mirrorReflectivity(coating, angle, 3 * energy_eV))
          .toBeLessThanOrEqual(REJECTION_PASS_HARMONIC);
      }
    }
    // Silicon at 3 mrad keeps 0.948 of 7112 eV and 0.0045 of 21336 eV (dossier section 3.3),
    // so a rejection angle exists there.
    expect(harmonicRejectionAngle('Si', 7112)).toBeGreaterThanOrEqual(3);
    // Rhodium at 5 keV cannot: 15 keV is still under its cutoff at every angle that keeps
    // the fundamental.  Platinum at 12 keV cannot either, because its own L3 edge at
    // 11.56 keV eats the fundamental at the angle that would reject 36 keV.
    expect(harmonicRejectionAngle('Rh', 5000)).toBeNull();
    expect(harmonicRejectionAngle('Pt', 12000)).toBeNull();
  });

  it('refuses a harmonic-rejection search outside the tabulated range', () => {
    const [, high_eV] = tabulatedEnergyRange_eV();
    expect(high_eV).toBe(fixtures.constants.mirrorEnergyRange_eV[1]);
    expect(() => harmonicRejectionAngle('Rh', high_eV / 2)).toThrow(/tabulated/);
  });
});

describe('bending-magnet and undulator source', () => {
  beforeAll(async () => {
    await loadOptics();
  });

  it('places the critical energy where the X-ray Data Booklet does', () => {
    expect(criticalEnergy_eV(3, 1.4)).toBeCloseTo(8379, 0);
    expect(criticalEnergy_eV(6, 0.86)).toBeCloseTo(20588.4, 1);
  });

  it('reproduces the generic ring flux table of the dossier within 1%', () => {
    // 3.0 GeV, 1.4 T, 0.3 A, 1 mrad of horizontal fan, all vertical angles.
    const source: SourceConfig = {
      kind: 'bending-magnet', ring_GeV: 3, current_mA: 300, field_T: 1.4,
      hAccept_mrad: 1, vDiv_urad: 25,
    };
    const expected: [number, number][] = [
      [5000, 1.84e13], [9000, 1.37e13], [12000, 1.05e13], [20000, 4.8e12], [30000, 1.7e12],
    ];
    for (const [energy_eV, flux] of expected) {
      expect(relativeError(spectralFlux(source, energy_eV), flux)).toBeLessThan(0.01);
    }
    expect(spectralFlux({ ...source, hAccept_mrad: 2.5 }, 9000) / spectralFlux(source, 9000))
      .toBeCloseTo(2.5, 9);
  });

  it('matches the tabulated Bessel values used by the undulator flux functions', () => {
    expect(besselJ(0, 1)).toBeCloseTo(0.7651976866, 9);
    expect(besselJ(1, 1)).toBeCloseTo(0.4400505857, 9);
    expect(besselJ(2, 5)).toBeCloseTo(0.0465651163, 9);
    expect(besselJ(3, 2.5)).toBeCloseTo(0.2166003910, 9);
  });

  it('reproduces the dossier F_n(K) and Q_n(K) table', () => {
    const table: [number, number, number, number, number, number, number][] = [
      // K, F1, F3, F5, Q1, Q3, Q5
      [0.5, 0.186, 0.011, 0.000, 0.210, 0.004, 0.000],
      [1.0, 0.368, 0.179, 0.055, 0.552, 0.090, 0.016],
      [1.5, 0.361, 0.382, 0.264, 0.767, 0.270, 0.112],
      [2.0, 0.290, 0.423, 0.413, 0.871, 0.423, 0.248],
      [3.0, 0.171, 0.308, 0.382, 0.941, 0.566, 0.420],
    ];
    for (const [K, f1, f3, f5, q1, q3, q5] of table) {
      expect(undulatorF(1, K)).toBeCloseTo(f1, 3);
      expect(undulatorF(3, K)).toBeCloseTo(f3, 3);
      expect(undulatorF(5, K)).toBeCloseTo(f5, 3);
      expect(undulatorQ(1, K)).toBeCloseTo(q1, 3);
      expect(undulatorQ(3, K)).toBeCloseTo(q3, 3);
      expect(undulatorQ(5, K)).toBeCloseTo(q5, 3);
    }
    expect(() => undulatorF(2, 1)).toThrow(/odd/);
  });

  it('tunes the gap to the lowest odd harmonic that reaches the energy', () => {
    // Dossier example device: 6 GeV, 2.7 cm period, 148 periods.
    expect(undulatorHarmonicEnergy_eV(6, 27, 3.25, 1)).toBeCloseTo(2017, 0);
    expect(undulatorHarmonicEnergy_eV(6, 27, 1.75, 1)).toBeCloseTo(5004, 0);
    expect(undulatorHarmonicEnergy_eV(6, 27, 1.75, 5))
      .toBeCloseTo(5 * undulatorHarmonicEnergy_eV(6, 27, 1.75, 1), 9);

    const first = tuneUndulator(6, 27, 5000, 3.5);
    expect(first?.harmonic).toBe(1);
    expect(undulatorHarmonicEnergy_eV(6, 27, first?.K as number, 1)).toBeCloseTo(5000, 6);
    // The fundamental tops out at 12.67 keV with the gap wide open, so 20 keV needs the
    // third harmonic and 40 keV the fifth.
    expect(tuneUndulator(6, 27, 20000, 3.5)?.harmonic).toBe(3);
    expect(tuneUndulator(6, 27, 40000, 2)?.harmonic).toBe(5);
    // A gap that only reaches K = 1 leaves a hole: the third harmonic cannot come down to
    // 20 keV and the first cannot go up to it.
    expect(tuneUndulator(6, 27, 20000, 1)).toBeNull();
    expect(tuneUndulator(6, 27, 200000, 3.5)).toBeNull();
  });

  it('keeps one undulator gap for a fundamental and its harmonics', () => {
    const source: SourceConfig = {
      kind: 'undulator', ring_GeV: 6, current_mA: 200, hAccept_mrad: 1, vDiv_urad: 15,
      undulator: { period_mm: 27, periods: 148, K: 3.5 },
    };
    const tuned = tuneSource(source, 5000);
    expect(tuned.tuning?.harmonic).toBe(1);
    expect(tuned.provenance).toBe('teaching-model');
    // On the first and third harmonic peaks of the same gap.
    expect(relativeError(tuned.fluxAt(5000), 3.51e15)).toBeLessThan(0.01);
    expect(relativeError(tuned.fluxAt(15000), 1.50e15)).toBeLessThan(0.01);
    // The natural relative width is 1/(n N), so the line is 1/148 wide and 5 % off the
    // peak there is nothing left: a fixed-gap EXAFS scan would see I0 collapse.
    expect(tuned.fluxAt(5000 * (1 + 0.5 / 148)) / tuned.fluxAt(5000)).toBeCloseTo(0.5, 2);
    expect(tuned.fluxAt(5250)).toBeLessThan(tuned.fluxAt(5000) * 1e-6);
    expect(tuneSource(source, 200000).fluxAt(200000)).toBe(0);
  });
});

describe('beam at the sample', () => {
  beforeAll(async () => {
    await Promise.all([loadOptics(), loadXrayData()]);
  });

  it('matches the Python reference for every configuration', () => {
    expect(fixtures.configurations).toHaveLength(12);
    for (const config of fixtures.configurations) {
      const profile = profileOf(config);
      for (const expected of config.points) {
        const beam = beamAtSample(profile, expected.energy_eV);
        const where = `${config.name} at ${expected.energy_eV} eV`;
        expect(relativeError(beam.thetaB_rad, expected.thetaB_rad), where).toBeLessThan(EXACT);
        expect(relativeError(beam.deltaE_eV, expected.deltaE_eV), where).toBeLessThan(0.01);
        expect(relativeError(beam.bandwidth, expected.bandwidth), where).toBeLessThan(0.01);
        expect(relativeError(beam.mirrorTransmission, expected.mirrorTransmission), where)
          .toBeLessThan(0.01);
        expect(beam.omittedOrders.map(entry => entry.order), where)
          .toEqual(expected.omittedOrders);
        expect(beam.orders.map(entry => entry.order), where)
          .toEqual(expected.orders.map(entry => entry.order));
        if (expected.harmonicFraction > 0) {
          expect(relativeError(beam.harmonicFraction, expected.harmonicFraction), where)
            .toBeLessThan(0.05);
        } else {
          expect(beam.harmonicFraction, where).toBe(0);
        }
        expect(relativeError(beam.flux, expected.flux), where).toBeLessThan(0.05);
        for (const order of expected.orders) {
          const actual = beam.orders.find(entry => entry.order === order.order);
          const row = `${where} order ${order.order}`;
          expect(actual, row).toBeDefined();
          expect(relativeError((actual as { sourceFlux: number }).sourceFlux, order.sourceFlux), row)
            .toBeLessThan(0.01);
          expect(relativeError((actual as { mirrorTransmission: number }).mirrorTransmission,
                               order.mirrorTransmission), row).toBeLessThan(0.01);
          expect(relativeError((actual as { acceptance: number }).acceptance, order.acceptance), row)
            .toBeLessThan(0.02);
        }
      }
    }
  });

  it('drops the harmonic fraction by orders of magnitude at a half-width detune', () => {
    const config = fixtures.configurations.find(entry => entry.name.startsWith('Si111 bm3'));
    const aligned = profileOf(config as ConfigFixture);
    aligned.mono = { ...aligned.mono, detune: 0 };
    const detuned = { ...aligned, mono: { ...aligned.mono, detune: 0.5 } };
    const alignedBeam = beamAtSample(aligned, 8979);
    const detunedBeam = beamAtSample(detuned, 8979);
    expect(detunedBeam.flux / alignedBeam.flux).toBeGreaterThan(0.4);
    expect(alignedBeam.harmonicFraction / detunedBeam.harmonicFraction).toBeGreaterThan(100);
  });

  it('leaves out the orders the crystal forbids and the ones above the table', () => {
    const si111 = profileOf(fixtures.configurations
      .find(entry => entry.name.startsWith('Si111 bm3')) as ConfigFixture);
    const si220 = profileOf(fixtures.configurations
      .find(entry => entry.name.startsWith('Si220 bm3')) as ConfigFixture);
    expect(beamAtSample(si111, 8979).orders.map(entry => entry.order)).toEqual([1, 3, 4, 5]);
    expect(beamAtSample(si220, 8979).orders.map(entry => entry.order)).toEqual([1, 2, 3, 4, 5]);
    // At 25 keV only 2E stays inside the tabulated 60 keV ceiling.
    expect(beamAtSample(si111, 25000).orders.map(entry => entry.order)).toEqual([1]);
    expect(beamAtSample(si220, 25000).orders.map(entry => entry.order)).toEqual([1, 2]);
    expect(beamAtSample(si111, 25000).omittedOrders.map(entry => entry.order)).toEqual([3, 4, 5]);
  });

  it('absorbs the fundamental in an optional air flight path', () => {
    const profile = profileOf(fixtures.configurations[0]);
    const dry = beamAtSample(profile, 8979);
    const inAir = beamAtSample(profile, 8979, { airPath_cm: 100 });
    expect(dry.flightPathTransmission).toBe(1);
    // One metre of air at the Cu K edge passes a bit over 40 %.
    expect(inAir.flightPathTransmission).toBeGreaterThan(0.3);
    expect(inAir.flightPathTransmission).toBeLessThan(0.6);
    expect(inAir.flux / dry.flux).toBeCloseTo(inAir.flightPathTransmission, 9);
  });
});

describe('glitch map', () => {
  beforeAll(async () => {
    await loadOptics();
  });

  it('is reproducible per crystal and seed and labelled a teaching model', () => {
    const first = glitchList('Si111', 7);
    const again = glitchList('Si111', 7);
    expect(again).toBe(first);
    expect(glitchList('Si111', 8)[0].energy_eV).not.toBe(first[0].energy_eV);
    expect(glitchList('Si311', 7)[0].energy_eV).not.toBe(first[0].energy_eV);
    expect(first.length).toBeGreaterThan(100);
    for (const glitch of first) {
      expect(glitch.depth).toBeGreaterThan(0);
      expect(glitch.depth).toBeLessThanOrEqual(0.3);
      expect(glitch.beamFraction).toBeGreaterThanOrEqual(0.3);
      expect(glitch.beamFraction).toBeLessThanOrEqual(1);
      const darwinWidth = darwin('Si111', 1, glitch.energy_eV).energy_fwhm_eV;
      expect(glitch.width_eV).toBeGreaterThan(0.4 * darwinWidth);
      expect(glitch.width_eV).toBeLessThan(3.6 * darwinWidth);
    }
  });

  it('grows denser with energy, as multiple-beam conditions do', () => {
    const glitches = glitchList('Si111', 7);
    const low = glitches.filter(glitch => glitch.energy_eV < 10000).length;
    const high = glitches.filter(glitch => glitch.energy_eV > 30000).length;
    expect(high).toBeGreaterThan(2 * low);
  });

  it('dips only at a glitch and leaves the flux alone in between', () => {
    const glitches = glitchList('Si111', 7, [8000, 10000]);
    expect(glitches.length).toBeGreaterThan(5);
    const centre = glitches[0];
    expect(glitchThroughput(glitches, centre.energy_eV))
      .toBeCloseTo(1 - centre.beamFraction * centre.depth, 3);
    const between = (glitches[0].energy_eV + glitches[1].energy_eV) / 2;
    expect(glitchThroughput(glitches, between)).toBeGreaterThan(0.99);
    expect(glitchThroughput([], 8979)).toBe(1);
  });

  it('cancels in a transmission ratio, because it scales I0 and It together', () => {
    const profile = profileOf(fixtures.configurations[0]);
    const clean = beamAtSample(profile, 8979);
    const withGlitches = beamAtSample(profile, 8979, { includeGlitches: true });
    expect(withGlitches.glitchThroughput).toBeLessThanOrEqual(1);
    expect(withGlitches.flux / clean.flux).toBeCloseTo(withGlitches.glitchThroughput, 9);
    expect(withGlitches.provenance).toContain('teaching-model');
  });
});
