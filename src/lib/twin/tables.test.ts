import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

import fixturesJson from '../../data/twin/fixtures.json';
import { loadXrayData, mu } from '../xraydata';
import {
  allowedOrders,
  darwin,
  detuneThroughput,
  emissionLines,
  g1,
  gas,
  harmonicAcceptance,
  isOpticsLoaded,
  loadOptics,
  mirrorReflectivity,
} from './tables';
import type { Crystal, MirrorCoating } from './types';

interface DarwinFixture {
  crystal: Crystal;
  order: number;
  energy_eV: number;
  theta_B_rad: number;
  energy_fwhm_eV: number;
  theta_fwhm_rad: number;
  rocking_theta_fwhm_rad: number;
}

interface MirrorFixture {
  coating: MirrorCoating;
  angle_mrad: number;
  energy_eV: number;
  reflectivity: number;
  rapidWithin2Percent: boolean;
}

interface G1Fixture { y: number; value: number }
interface DetuneFixture {
  crystal: Crystal;
  order: number;
  energy_eV: number;
  detuneFraction: number;
  throughput: number;
  acceptanceRelativeToFundamental: number;
}
interface IonChamberFixture {
  with_compton: boolean;
  oneCarrier: { incident_Hz: number };
  twoCarrier: { incident_Hz: number };
}
interface DetectorFixture {
  energy_eV: number;
  be12_5umTransmission: number;
  si450umAbsorption: number;
}

const fixtures = fixturesJson as unknown as {
  darwin: DarwinFixture[];
  mirrors: MirrorFixture[];
  detune: DetuneFixture[];
  g1: G1Fixture[];
  emissionLines: Record<string, [string, number, number, string, string][]>;
  detector: DetectorFixture[];
  ionChambers: IonChamberFixture[];
  ionChamberConvention: { twinUses: string; withCompton: boolean };
  calls: Record<string, string>;
};

const relativeError = (actual: number, expected: number) => Math.abs(actual / expected - 1);

describe('beamline optics table loading', () => {
  it('requires the dynamic table to be loaded before synchronous access', () => {
    expect(isOpticsLoaded()).toBe(false);
    expect(() => allowedOrders('Si111')).toThrow(/await loadOptics/);
  });

  it('loads and caches the generated table', async () => {
    const first = await loadOptics();
    const second = await loadOptics();
    expect(second).toBe(first);
    expect(first.xraydbVersion).toBe('4.5.8');
    expect(first.format).toBe('xaslab-twin-optics/1');
  });
});

describe('beamline optics accessors', () => {
  beforeAll(async () => {
    await Promise.all([loadOptics(), loadXrayData()]);
  });

  it('interpolates Darwin angles and widths within 2% of off-grid xraydb fixtures', () => {
    for (const fixture of fixtures.darwin) {
      const actual = darwin(fixture.crystal, fixture.order, fixture.energy_eV);
      expect(relativeError(actual.theta_B_rad, fixture.theta_B_rad)).toBeLessThan(0.02);
      expect(relativeError(actual.energy_fwhm_eV, fixture.energy_fwhm_eV)).toBeLessThan(0.02);
      expect(relativeError(actual.theta_fwhm_rad, fixture.theta_fwhm_rad)).toBeLessThan(0.02);
      expect(relativeError(actual.rocking_theta_fwhm_rad, fixture.rocking_theta_fwhm_rad)).toBeLessThan(0.02);
    }
  });

  it('omits forbidden orders and records every allowed diamond reflection', () => {
    expect(allowedOrders('Si111')).toEqual([1, 3, 4, 5]);
    expect(allowedOrders('Si311')).toEqual([1, 3, 4, 5]);
    expect(allowedOrders('Si220')).toEqual([1, 2, 3, 4, 5]);
    expect(() => darwin('Si111', 2, 10_000)).toThrow(/forbidden/);
  });

  it('keeps double-crystal detune throughput monotonic on the stored offset sequence', () => {
    const offsets = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.2, 1.5];
    for (const crystal of ['Si111', 'Si311', 'Si220'] as const) {
      for (const order of allowedOrders(crystal)) {
        for (const energy of [6_000, 12_000, 30_000]) {
          // Some crystal tables begin above 6 keV only in the low-energy tail; 6 keV is
          // within all three requested ranges.
          const values = offsets.map(offset => detuneThroughput(crystal, order, energy, offset));
          expect(values[0]).toBeCloseTo(1, 4);
          for (let index = 1; index < values.length; index++) {
            expect(values[index]).toBeLessThanOrEqual(values[index - 1] + 1e-4);
          }
          expect(harmonicAcceptance(crystal, order, energy)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('matches the extended-tail detune fixtures and retains the physical harmonic tails', () => {
    for (const fixture of fixtures.detune) {
      const throughput = detuneThroughput(
        fixture.crystal, fixture.order, fixture.energy_eV, fixture.detuneFraction,
      );
      const acceptance = harmonicAcceptance(fixture.crystal, fixture.order, fixture.energy_eV);
      expect(relativeError(throughput, fixture.throughput)).toBeLessThan(0.1);
      expect(relativeError(acceptance, fixture.acceptanceRelativeToFundamental)).toBeLessThan(0.02);
    }
    const si333 = fixtures.detune.find(row => row.crystal === 'Si111' && row.order === 3);
    expect(si333?.throughput).toBeGreaterThan(1e-3);
    expect(si333?.throughput).toBeLessThan(2e-3);
  });

  it('interpolates mirror reflectivity within the fixture tolerance', () => {
    for (const fixture of fixtures.mirrors) {
      const actual = mirrorReflectivity(fixture.coating, fixture.angle_mrad, fixture.energy_eV);
      const tolerance = fixture.rapidWithin2Percent ? 0.05 : 0.01;
      expect(relativeError(actual, fixture.reflectivity)).toBeLessThan(tolerance);
    }
  });

  it('interpolates G1 within 0.5% and applies the documented outside-table limits', () => {
    for (const fixture of fixtures.g1) {
      expect(relativeError(g1(fixture.y), fixture.value)).toBeLessThan(0.005);
    }
    const small = 1e-7;
    expect(g1(small)).toBeCloseTo(2.1495282415344786 * Math.cbrt(small), 14);
    const large = 45;
    expect(g1(large)).toBeCloseTo(
      Math.sqrt(Math.PI * large / 2) * Math.exp(-large) * (1 + 55 / (72 * large)),
      14,
    );
    expect(() => g1(0)).toThrow(/greater than zero/);
  });

  it('returns the filtered Fe, Cu and Pt emission lines exactly as generated', () => {
    for (const symbol of ['Fe', 'Cu', 'Pt']) {
      const rows = emissionLines(symbol).map(line => [
        line.name, line.energy_eV, line.intensity, line.initialLevel, line.finalLevel,
      ]);
      expect(rows).toEqual(fixtures.emissionLines[symbol]);
    }
  });

  it('matches xraydb Be-window transmission and Si-sensor absorption within 1%', () => {
    for (const fixture of fixtures.detector) {
      const beMu = mu('Be', 1.848, fixture.energy_eV).total;
      const siMu = mu('Si', 2.329, fixture.energy_eV).total;
      const beTransmission = Math.exp(-beMu * 12.5e-4);
      const siAbsorption = 1 - Math.exp(-siMu * 450e-4);
      expect(relativeError(beTransmission, fixture.be12_5umTransmission)).toBeLessThan(0.01);
      expect(relativeError(siAbsorption, fixture.si450umAbsorption)).toBeLessThan(0.01);
    }
  });

  it('exposes ideal-gas records and reproducible ion-chamber fixtures', () => {
    expect(gas('N2')).toMatchObject({ formula: 'N2', W_eV: 34.8 });
    expect(gas('air').density_g_cm3).toBeGreaterThan(0.001);
    expect(fixtures.ionChambers).toHaveLength(8);
    expect(fixtures.ionChamberConvention).toMatchObject({ twinUses: 'oneCarrier', withCompton: false });
    expect(fixtures.calls.ionChamber).toContain('both_carriers=False');
    for (const fixture of fixtures.ionChambers) {
      expect(fixture.with_compton).toBe(false);
      expect(fixture.oneCarrier.incident_Hz / fixture.twoCarrier.incident_Hz).toBeCloseTo(2, 9);
    }
  });

  it('keeps optics.json within the 150 KiB gzip budget', () => {
    const bytes = readFileSync(new URL('../../data/twin/optics.json', import.meta.url));
    expect(gzipSync(bytes, { level: 9 }).byteLength).toBeLessThanOrEqual(150 * 1024);
  });
});
