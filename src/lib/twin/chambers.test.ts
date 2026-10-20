import { beforeAll, describe, expect, it } from 'vitest';

import fixturesJson from '../../data/twin/fixtures.json';
import { loadXrayData } from '../xraydata';
import {
  AMPLIFIER_NOISE_V,
  ELEMENTARY_CHARGE,
  FILL_TARGETS,
  GAS_TABLE_TEMPERATURE_K,
  absorbedFraction,
  chamberNoise,
  chamberReadout,
  gasAttenuation,
  suggestGas,
  type GasMix,
} from './chambers';
import { loadOptics } from './tables';
import type { ChamberConfig } from './types';

interface IonChamberFixture {
  name: string;
  energy_eV: number;
  length_cm: number;
  gas: string | Record<string, number>;
  with_compton: boolean;
  oneCarrier: { incident_Hz: number; transmitted_Hz: number; photo_Hz: number; incoherent_Hz: number };
  twoCarrier: { incident_Hz: number };
}

const fixtures = fixturesJson as unknown as { ionChambers: IonChamberFixture[]; calls: Record<string, string> };

/**
 * The fixtures were generated with XrayDB's built-in gas densities, which are values at
 * about 273 K, while optics.json stores ideal-gas densities at 295 K (src/data/twin/
 * README.md). Scaling the stored densities to 273.15 K reproduces XrayDB's to better than
 * 0.3 % for all four gases; the residual is krypton, whose real STP density is 0.3 % above
 * the ideal-gas value.
 */
const FIXTURE_CONDITIONS = { temperature_K: 273.15 };

/** The fixtures use volts = 1 with a 1 uA/V amplifier sensitivity, so the current is 1 uA. */
const FIXTURE_CURRENT_A = 1e-6;

const relativeError = (actual: number, expected: number) => Math.abs(actual / expected - 1);
const asMix = (gas: string | Record<string, number>): GasMix =>
  (typeof gas === 'string' ? { [gas]: 1 } : gas) as GasMix;

const chamber = (overrides: Partial<ChamberConfig> = {}): ChamberConfig => ({
  id: 'I0', length_cm: 15, gas: { N2: 1 }, gain_V_per_A: 1e7, dark_A: 0, ...overrides,
});

describe('ion chamber gas attenuation', () => {
  beforeAll(async () => {
    await Promise.all([loadOptics(), loadXrayData()]);
  });

  it('matches the xraydb absorbed and transmitted fractions within 1%', () => {
    expect(fixtures.ionChambers).toHaveLength(8);
    for (const fixture of fixtures.ionChambers) {
      const expectedAbsorbed = fixture.oneCarrier.photo_Hz / fixture.oneCarrier.incident_Hz;
      const expectedTransmitted = fixture.oneCarrier.transmitted_Hz / fixture.oneCarrier.incident_Hz;
      const actual = absorbedFraction(asMix(fixture.gas), fixture.length_cm, fixture.energy_eV, FIXTURE_CONDITIONS);
      expect(relativeError(actual.absorbed, expectedAbsorbed), fixture.name).toBeLessThan(0.01);
      expect(relativeError(actual.transmitted, expectedTransmitted), fixture.name).toBeLessThan(0.01);
      expect(actual.absorbed + actual.transmitted).toBeLessThanOrEqual(1);
    }
  });

  it('reproduces the xraydb one-carrier current within 1%', () => {
    for (const fixture of fixtures.ionChambers) {
      const config = chamber({ gas: asMix(fixture.gas), length_cm: fixture.length_cm, gain_V_per_A: 1 });
      const readout = chamberReadout(config, fixture.oneCarrier.incident_Hz, fixture.energy_eV, {
        conditions: FIXTURE_CONDITIONS, fullScale_V: Infinity,
      });
      expect(relativeError(readout.signalCurrent_A, FIXTURE_CURRENT_A), fixture.name).toBeLessThan(0.01);
      // Feeding back the same voltage must return the flux the fixture started from.
      expect(relativeError(readout.transmittedFlux / fixture.oneCarrier.incident_Hz,
                           fixture.oneCarrier.transmitted_Hz / fixture.oneCarrier.incident_Hz)).toBeLessThan(0.01);
    }
  });

  it('keeps the one-charge-per-pair convention that the fixtures record', () => {
    // xraydb's default both_carriers=True halves the inferred flux for the same current.
    for (const fixture of fixtures.ionChambers) {
      expect(fixture.with_compton).toBe(false);
      expect(fixture.oneCarrier.incident_Hz / fixture.twoCarrier.incident_Hz).toBeCloseTo(2, 9);
    }
    expect(fixtures.calls.ionChamber).toContain('both_carriers=False');
  });

  it('weights W by mole fraction and scales density with pressure and temperature', () => {
    const half = gasAttenuation({ N2: 0.5, Ar: 0.5 }, 10_000);
    expect(half.W_eV).toBeCloseTo((34.8 + 26.4) / 2, 10);
    // Unnormalised fractions are renormalised, so 1:1 and 2:2 are the same fill.
    expect(gasAttenuation({ N2: 2, Ar: 2 }, 10_000).photo).toBeCloseTo(half.photo, 12);

    const base = gasAttenuation({ N2: 1 }, 10_000);
    const hot = gasAttenuation({ N2: 1 }, 10_000, { temperature_K: 2 * GAS_TABLE_TEMPERATURE_K });
    expect(hot.total).toBeCloseTo(base.total / 2, 12);
    const pressurised = gasAttenuation({ N2: 1 }, 10_000, { pressure_atm: 3 });
    expect(pressurised.total).toBeCloseTo(3 * base.total, 12);
    expect(() => gasAttenuation({}, 10_000)).toThrow(/at least one gas/);
  });
});

describe('ion chamber readout', () => {
  beforeAll(async () => {
    await Promise.all([loadOptics(), loadXrayData()]);
  });

  it('scales the current with flux, gain and the ion-pair energy', () => {
    const config = chamber();
    const low = chamberReadout(config, 1e9, 9000, { fullScale_V: Infinity });
    const high = chamberReadout(config, 2e9, 9000, { fullScale_V: Infinity });
    expect(high.signalCurrent_A / low.signalCurrent_A).toBeCloseTo(2, 12);
    expect(low.rawVoltage_V).toBeCloseTo(low.current_A * config.gain_V_per_A, 15);
    // I = N_abs * E * e / W, written out.
    expect(low.signalCurrent_A).toBeCloseTo(low.absorbedRate * 9000 * ELEMENTARY_CHARGE / low.W_eV, 25);
    expect(low.W_eV).toBeCloseTo(34.8, 10);
  });

  it('clips at full scale and flags nonlinearity before it', () => {
    const config = chamber({ gain_V_per_A: 1e10 });
    const dim = chamberReadout(config, 1e7, 9000);
    expect(dim.saturated).toBe(false);
    expect(dim.nonlinear).toBe(false);
    expect(dim.voltage_V).toBeCloseTo(dim.rawVoltage_V, 12);

    const bright = chamberReadout(config, 1e12, 9000);
    expect(bright.saturated).toBe(true);
    expect(bright.nonlinear).toBe(true);
    expect(bright.voltage_V).toBe(10);
    expect(bright.rawVoltage_V).toBeGreaterThan(10);
    // The V2F output follows the clipped voltage, so it flat-tops too.
    expect(bright.frequency_Hz).toBeCloseTo(1e6, 6);

    // Between the linearity limit and full scale the reading is on scale but not trusted.
    const scale = 9.5 / bright.rawVoltage_V;
    const edge = chamberReadout(config, 1e12 * scale, 9000);
    expect(edge.saturated).toBe(false);
    expect(edge.nonlinear).toBe(true);
  });

  it('adds the dark current and offsets the V2F output', () => {
    const config = chamber({ dark_A: 1e-11 });
    const dark = chamberReadout(config, 0, 9000, { v2fOffset_Hz: 1000 });
    expect(dark.signalCurrent_A).toBe(0);
    expect(dark.current_A).toBe(1e-11);
    expect(dark.frequency_Hz).toBeCloseTo(1e6 * (1e-11 * 1e7) / 10 + 1000, 9);
  });

  it('propagates the transmitted beam to the next chamber', () => {
    const i0 = chamber({ id: 'I0', length_cm: 15, gas: { N2: 1 } });
    const readout = chamberReadout(i0, 1e11, 9000);
    expect(readout.transmittedFlux).toBeCloseTo(1e11 * (1 - readout.attenuatedFraction), 3);
    expect(readout.transmittedFlux).toBeLessThan(1e11);
  });
});

describe('ion chamber noise', () => {
  beforeAll(async () => {
    await Promise.all([loadOptics(), loadXrayData()]);
  });

  it('falls as the square root of flux and dwell', () => {
    const config = chamber();
    const readout = chamberReadout(config, 1e11, 9000, { fullScale_V: Infinity });
    const short = chamberNoise(readout, 1, config, { amplifierNoise_V: 0 });
    const long = chamberNoise(readout, 4, config, { amplifierNoise_V: 0 });
    expect(long.shot_V / short.shot_V).toBeCloseTo(0.5, 10);
    expect(short.shot_V).toBeCloseTo(
      readout.signalCurrent_A * config.gain_V_per_A / Math.sqrt(readout.absorbedRate), 15,
    );

    const brighter = chamberReadout(config, 4e11, 9000, { fullScale_V: Infinity });
    expect(chamberNoise(brighter, 1, config, { amplifierNoise_V: 0 }).relative / short.relative)
      .toBeCloseTo(0.5, 10);
  });

  it('adds the amplifier floor and the dark-current shot noise in quadrature', () => {
    const config = chamber({ dark_A: 1e-10 });
    const readout = chamberReadout(config, 1e11, 9000, { fullScale_V: Infinity });
    const noise = chamberNoise(readout, 2, config);
    expect(noise.amplifier_V).toBeCloseTo(AMPLIFIER_NOISE_V / Math.SQRT2, 15);
    expect(noise.dark_V).toBeCloseTo(config.gain_V_per_A * Math.sqrt(ELEMENTARY_CHARGE * 1e-10 / 2), 15);
    expect(noise.total_V).toBeCloseTo(Math.hypot(noise.shot_V, noise.dark_V, noise.amplifier_V), 15);
    expect(noise.absorbedPhotons).toBeCloseTo(readout.absorbedRate * 2, 3);
  });

  it('reports infinite relative noise with no beam', () => {
    const config = chamber();
    const dark = chamberReadout(config, 0, 9000);
    expect(chamberNoise(dark, 1, config).relative).toBe(Infinity);
    expect(() => chamberNoise(dark, 0, config)).toThrow(/Dwell time/);
  });
});

describe('fill suggestion', () => {
  beforeAll(async () => {
    await Promise.all([loadOptics(), loadXrayData()]);
  });

  it('puts I0 in the 10 to 20% band with a nitrogen-dominated fill at 9 keV', () => {
    for (const length_cm of [10, 15, 30]) {
      const suggestion = suggestGas(9000, 'I0', length_cm);
      expect(suggestion.inBand, `${length_cm} cm`).toBe(true);
      expect(suggestion.absorbed).toBeGreaterThanOrEqual(FILL_TARGETS.I0.min);
      expect(suggestion.absorbed).toBeLessThanOrEqual(FILL_TARGETS.I0.max);
      expect(suggestion.mix.N2 ?? 0, `${length_cm} cm`).toBeGreaterThanOrEqual(0.9);
      expect(suggestion.mix.Kr ?? 0).toBe(0);
    }
  });

  it('suggests an argon and nitrogen mix for It at 9 keV', () => {
    const suggestion = suggestGas(9000, 'It', 30);
    expect(suggestion.inBand).toBe(true);
    expect(suggestion.mix.Ar ?? 0).toBeGreaterThan(0);
    expect(suggestion.mix.N2 ?? 0).toBeGreaterThan(0);
    expect(suggestion.absorbed).toBeGreaterThan(FILL_TARGETS.It.min);
    expect(suggestion.absorbed).toBeLessThan(FILL_TARGETS.It.max);
    // It absorbs far more than I0 at the same energy and length.
    expect(suggestion.absorbed).toBeGreaterThan(suggestGas(9000, 'I0', 30).absorbed * 3);
  });

  it('reaches for helium in the tender range and for the heavy gases high up', () => {
    // At 2.5 keV even pure helium absorbs more than I0 wants over a long chamber.
    const tender = suggestGas(2500, 'I0', 30);
    expect(tender.mix.He ?? 0).toBeGreaterThan(0.9);
    const high = suggestGas(30_000, 'It', 30);
    expect((high.mix.Ar ?? 0) + (high.mix.Kr ?? 0)).toBeGreaterThan(0.5);
  });

  it('returns the closest fill and says so when no mix reaches the band', () => {
    // A 1 cm chamber at 30 keV cannot absorb half the beam with any of these gases.
    const suggestion = suggestGas(30_000, 'It', 1);
    expect(suggestion.inBand).toBe(false);
    expect(suggestion.absorbed).toBeLessThan(FILL_TARGETS.It.min);
    expect(suggestion.absorbed).toBeGreaterThan(0);
  });

  it('agrees with the absorbed fraction it reports', () => {
    const suggestion = suggestGas(12_000, 'I0', 15);
    expect(absorbedFraction(suggestion.mix, 15, 12_000).absorbed).toBeCloseTo(suggestion.absorbed, 12);
  });
});
