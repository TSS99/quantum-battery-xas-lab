import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { loadOptics, gas } from './tables';
import { electronRange_g_cm2, electronRangeInGas_cm, fillDensity_g_cm3 } from './ionization';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

describe('ionization in the chamber gas', () => {
  it('gives the Katz and Penfold electron range: 0.412 g/cm^2 at 1 MeV, about 0.0135 at 100 keV', () => {
    expect(electronRange_g_cm2(1e6)).toBeCloseTo(0.412, 12);
    expect(electronRange_g_cm2(1e5)).toBeCloseTo(0.412 * Math.pow(0.1, 1.265 + 0.0954 * Math.log(10)), 12);
    expect(electronRange_g_cm2(1e5)).toBeGreaterThan(0.013);
    expect(electronRange_g_cm2(1e5)).toBeLessThan(0.014);
    expect(electronRange_g_cm2(20000)).toBeGreaterThan(electronRange_g_cm2(10000));
  });

  it('weights the fill density by mole fraction, so a 9 keV photoelectron runs about a millimetre in argon', () => {
    expect(fillDensity_g_cm3({ Ar: 1 })).toBeCloseTo(gas('Ar').density_g_cm3, 12);
    expect(fillDensity_g_cm3({ Ar: 1, N2: 1 })).toBeCloseTo((gas('Ar').density_g_cm3 + gas('N2').density_g_cm3) / 2, 12);
    const range = electronRangeInGas_cm(9000, { Ar: 1 });
    expect(range).toBeGreaterThan(0.04);
    expect(range).toBeLessThan(0.15);
    // Helium is about ten times less dense than argon, so the track is about ten times longer.
    expect(electronRangeInGas_cm(9000, { He: 1 }) / range).toBeGreaterThan(8);
  });
});
