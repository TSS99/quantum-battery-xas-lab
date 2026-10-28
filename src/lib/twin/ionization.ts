/**
 * What an absorbed X-ray leaves behind in a gas, for the 3D hutch's ion chambers: a photoelectron that slows down over
 * its range, freeing one electron-ion pair per W of energy (src/lib/twin/chambers.ts holds W per gas).
 */
import { gas } from './tables';
import type { GasMix } from './chambers';

/**
 * Range of an electron, g/cm^2: R = 0.412 E^(1.265 - 0.0954 ln E), E in MeV (Katz and Penfold, Rev. Mod. Phys. 24, 28,
 * 1952). Stated for 0.01 to 2.5 MeV; below 10 keV it is an estimate, which is all the drawing needs.
 */
export function electronRange_g_cm2(energy_eV: number): number {
  if (!(energy_eV > 0)) throw new RangeError('Electron energy must be greater than zero eV.');
  const E = energy_eV / 1e6;
  return 0.412 * Math.pow(E, 1.265 - 0.0954 * Math.log(E));
}

/** Density of a chamber fill at the gas table's conditions, g/cm^3: each gas at its partial pressure. */
export function fillDensity_g_cm3(mix: GasMix): number {
  const list = Object.entries(mix).filter(([, f]) => (f ?? 0) > 0) as [Parameters<typeof gas>[0], number][];
  const total = list.reduce((sum, [, f]) => sum + f, 0);
  return list.reduce((sum, [name, f]) => sum + f / total * gas(name).density_g_cm3, 0);
}

/** Range of an electron of this energy in the fill, cm. */
export const electronRangeInGas_cm = (energy_eV: number, mix: GasMix) => electronRange_g_cm2(energy_eV) / fillDensity_g_cm3(mix);
