/**
 * Lazy access to the generated beamline-twin optics tables.
 *
 * Call `await loadOptics()` once, then use the synchronous accessors.  This module only
 * selects and interpolates tabulated values; physical models belong in the downstream
 * source, monochromator, mirror and detector modules.
 */

import type { Crystal, MirrorCoating } from './types';

export type GasName = 'N2' | 'He' | 'Ar' | 'Kr' | 'air';

export interface OpticsDataInfo {
  format: string;
  generator: string;
  xraydbVersion: string;
  xraydbDatabase: string;
}

export interface DarwinPoint {
  theta_B_rad: number;
  energy_fwhm_eV: number;
  theta_fwhm_rad: number;
  rocking_theta_fwhm_rad: number;
}

export interface EmissionLine {
  name: string;
  energy_eV: number;
  intensity: number;
  initialLevel: string;
  finalLevel: string;
}

export interface GasProperties {
  name: GasName;
  /** Formula passed to src/lib/xraydata.ts for attenuation cross sections. */
  formula: string;
  /** Ideal-gas density at 295 K and 1 atm. */
  density_g_cm3: number;
  /** Mean energy to form an electron-ion pair. */
  W_eV: number;
  molarMass_g_mol: number;
}

type DarwinRow = [number, number, number, number, number];
type DetuneRow = number[];
type RawCrystal = [
  Crystal,
  [number, number, number],
  number,
  number[],
  number[],
  [number, DarwinRow[]][],
  [number, DetuneRow[]][],
];
type RawMirror = [MirrorCoating, number, number[], [number, number[]][]];
type RawEmissionLine = [string, number, number, string, string];
type RawEmissionElement = [string, number, RawEmissionLine[]];
type RawGas = [GasName, string, number, number, number];

interface RawOpticsFile extends OpticsDataInfo {
  detuneFractions: number[];
  crystals: RawCrystal[];
  mirrors: RawMirror[];
  emissionLines: RawEmissionElement[];
  g1: [number[], number[]];
  gases: RawGas[];
}

interface OpticsDatabase {
  info: OpticsDataInfo;
  detuneFractions: number[];
  crystals: Map<Crystal, RawCrystal>;
  mirrors: Map<MirrorCoating, RawMirror>;
  emissionLines: Map<string, RawEmissionLine[]>;
  g1: [number[], number[]];
  gases: Map<GasName, RawGas>;
}

let database: OpticsDatabase | null = null;
let loading: Promise<OpticsDataInfo> | null = null;

function buildDatabase(raw: RawOpticsFile): OpticsDatabase {
  const { format, generator, xraydbVersion, xraydbDatabase } = raw;
  return {
    info: { format, generator, xraydbVersion, xraydbDatabase },
    detuneFractions: raw.detuneFractions,
    crystals: new Map(raw.crystals.map(item => [item[0], item])),
    mirrors: new Map(raw.mirrors.map(item => [item[0], item])),
    emissionLines: new Map(raw.emissionLines.map(item => [item[0], item[2]])),
    g1: raw.g1,
    gases: new Map(raw.gases.map(item => [item[0], item])),
  };
}

/** Load and cache the generated optics table as a separate dynamic-import chunk. */
export function loadOptics(): Promise<OpticsDataInfo> {
  loading ??= import('../../data/twin/optics.json')
    .then(module => {
      database = buildDatabase(module.default as unknown as RawOpticsFile);
      return database.info;
    })
    .catch(error => {
      loading = null;
      throw error;
    });
  return loading;
}

export function isOpticsLoaded(): boolean {
  return database !== null;
}

function data(): OpticsDatabase {
  if (!database) throw new Error('Beamline optics data is not loaded yet: await loadOptics() first.');
  return database;
}

function crystalTable(crystal: Crystal): RawCrystal {
  const found = data().crystals.get(crystal);
  if (!found) throw new Error(`Unknown crystal "${crystal}".`);
  return found;
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}

/** Return [lower, upper, fraction] on an ascending grid; exact knots use one row. */
function bracket(grid: readonly number[], value: number, label: string): [number, number, number] {
  requireFinite(value, label);
  if (value < grid[0] || value > grid[grid.length - 1]) {
    throw new RangeError(`${label} ${value} is outside the tabulated range ${grid[0]} to ${grid[grid.length - 1]}.`);
  }
  if (value === grid[grid.length - 1]) return [grid.length - 1, grid.length - 1, 0];
  let lo = 0;
  let hi = grid.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (grid[mid] <= value) lo = mid;
    else hi = mid;
  }
  if (value === grid[lo]) return [lo, lo, 0];
  return [lo, hi, (value - grid[lo]) / (grid[hi] - grid[lo])];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function logXFraction(a: number, b: number, value: number): number {
  return (Math.log(value) - Math.log(a)) / (Math.log(b) - Math.log(a));
}

function positiveLogLerp(a: number, b: number, t: number): number {
  return Math.exp(lerp(Math.log(a), Math.log(b), t));
}

function orderRows<T>(tables: [number, T[]][], order: number, crystal: Crystal): T[] {
  if (!Number.isInteger(order) || order < 1 || order > 5) {
    throw new RangeError('Harmonic order must be an integer from 1 to 5.');
  }
  const found = tables.find(item => item[0] === order);
  if (!found) throw new RangeError(`Order ${order} is forbidden for ${crystal}.`);
  return found[1];
}

function energyRows<T extends number[]>(rows: T[], energy_eV: number): [T, T, number] {
  const energies = rows.map(row => row[0]);
  const [lo, hi] = bracket(energies, energy_eV, 'Energy (eV)');
  const fraction = lo === hi ? 0 : logXFraction(energies[lo], energies[hi], energy_eV);
  return [rows[lo], rows[hi], fraction];
}

/** Interpolate xraydb Darwin widths at the fundamental energy for one allowed order. */
export function darwin(crystal: Crystal, order: number, energy_eV: number): DarwinPoint {
  const rows = orderRows(crystalTable(crystal)[5], order, crystal);
  const [left, right, t] = energyRows(rows, energy_eV);
  return {
    theta_B_rad: lerp(left[1], right[1], t),
    energy_fwhm_eV: positiveLogLerp(left[2], right[2], t),
    theta_fwhm_rad: positiveLogLerp(left[3], right[3], t),
    rocking_theta_fwhm_rad: positiveLogLerp(left[4], right[4], t),
  };
}

/** Double-crystal throughput, normalized to this order's own value at zero detune. */
export function detuneThroughput(crystal: Crystal, order: number, energy_eV: number,
                                 detuneFraction: number): number {
  const rows = orderRows(crystalTable(crystal)[6], order, crystal);
  const [left, right, energyT] = energyRows(rows, energy_eV);
  const fractions = data().detuneFractions;
  const [fLo, fHi, fT] = bracket(fractions, detuneFraction, 'Detune fraction');
  const atEnergy = (index: number) => lerp(left[index + 2], right[index + 2], energyT);
  return lerp(atEnergy(fLo), atEnergy(fHi), fT);
}

/** Zero-detune angular acceptance relative to order 1 at the same fundamental energy. */
export function harmonicAcceptance(crystal: Crystal, order: number, energy_eV: number): number {
  const rows = orderRows(crystalTable(crystal)[6], order, crystal);
  const [left, right, t] = energyRows(rows, energy_eV);
  return positiveLogLerp(left[1], right[1], t);
}

export function allowedOrders(crystal: Crystal): readonly number[] {
  return [...crystalTable(crystal)[3]];
}

/**
 * Bilinear interpolation in grazing angle and ln(photon energy), as generated.
 *
 * Accurate to about 0.3% on the stored angles, which run from 1.0 to 6.0 mrad in 0.25 mrad
 * steps.  Between two stored angles it is only a rough guide: the total-reflection cutoff
 * energy scales as 1/angle, so it moves by 4 to 25% from one row to the next, and linear
 * interpolation across that shift is wrong by tens of percent near the cutoff.  Keep mirror
 * angles on the 0.25 mrad grid, or compute reflectivity from the optical constants.
 */
export function mirrorReflectivity(coating: MirrorCoating, angle_mrad: number,
                                   energy_eV: number): number {
  const table = data().mirrors.get(coating);
  if (!table) throw new Error(`Unknown mirror coating "${coating}".`);
  const energies = table[2];
  const angleRows = table[3];
  const angles = angleRows.map(row => row[0]);
  const [eLo, eHi] = bracket(energies, energy_eV, 'Energy (eV)');
  const energyT = eLo === eHi ? 0 : logXFraction(energies[eLo], energies[eHi], energy_eV);
  const [aLo, aHi, angleT] = bracket(angles, angle_mrad, 'Mirror angle (mrad)');
  const atAngle = (index: number) => lerp(angleRows[index][1][eLo], angleRows[index][1][eHi], energyT);
  return lerp(atAngle(aLo), atAngle(aHi), angleT);
}

export function emissionLines(symbol: string): readonly EmissionLine[] {
  const rows = data().emissionLines.get(symbol);
  if (!rows) throw new Error(`No emission-line table for element "${symbol}" (available: Li to Cf).`);
  return rows.map(([name, energy_eV, intensity, initialLevel, finalLevel]) => ({
    name, energy_eV, intensity, initialLevel, finalLevel,
  }));
}

/**
 * Universal bending-magnet function G1(y).
 *
 * The table is log-log interpolated.  Outside it, use the leading small-y term
 * 2^(2/3) Gamma(2/3) y^(1/3), and the first corrected large-y expansion
 * sqrt(pi*y/2) exp(-y) [1 + 55/(72y)] of y integral_y^infinity K_(5/3)(x) dx.
 */
export function g1(y: number): number {
  requireFinite(y, 'y');
  if (y <= 0) throw new RangeError('y must be greater than zero.');
  const [ys, values] = data().g1;
  if (y < ys[0]) return 2.1495282415344786 * Math.cbrt(y);
  if (y > ys[ys.length - 1]) {
    return Math.sqrt(Math.PI * y / 2) * Math.exp(-y) * (1 + 55 / (72 * y));
  }
  const [lo, hi] = bracket(ys, y, 'y');
  if (lo === hi) return values[lo];
  return positiveLogLerp(values[lo], values[hi], logXFraction(ys[lo], ys[hi], y));
}

export function gas(name: GasName): GasProperties {
  const row = data().gases.get(name);
  if (!row) throw new Error(`Unknown gas "${name}".`);
  return { name: row[0], formula: row[1], density_g_cm3: row[2], W_eV: row[3], molarMass_g_mol: row[4] };
}
