/**
 * Grazing-incidence mirrors: per-mirror reflectivity, transmission along the beam, the
 * total-reflection cutoff energy and the angle that rejects the third harmonic.
 *
 * Reflectivity itself is tabulated (s polarization, zero roughness, bulk coating density,
 * 2 to 60 keV, 1.0 to 6.0 mrad); this module only combines and searches those values.
 *
 * The table interpolates badly in angle near the cutoff, because the cutoff energy scales as
 * 1/angle and moves by 4 to 25 % between stored angles.  Every search here therefore runs on
 * the stored 0.25 mrad angle grid, and callers should keep mirror angles on it too.
 *
 * Reference: project physics dossier section 3; Als-Nielsen and McMorrow, Elements of Modern
 * X-ray Physics, 2nd ed., chapter 3.
 */

import { mirrorAngles_mrad, mirrorEnergyRange_eV, mirrorReflectivity } from './tables';
import type { MirrorCoating, MirrorConfig } from './types';

/** Reflectivity at which `cutoffEnergy_eV` is defined by default. */
export const CUTOFF_REFLECTIVITY = 0.5;

/** `harmonicRejectionAngle` needs at least this much of the fundamental. */
export const REJECTION_KEEP_FUNDAMENTAL = 0.8;

/** `harmonicRejectionAngle` needs at most this much of the third harmonic. */
export const REJECTION_PASS_HARMONIC = 0.01;

/** Every coating the optics table carries. */
export const MIRROR_COATINGS: readonly MirrorCoating[] = ['Si', 'Rh', 'Pt', 'Ni'];

/** Photon-energy range (eV) every coating is tabulated over: the narrowest of the four. */
export function tabulatedEnergyRange_eV(): [number, number] {
  let low = -Infinity;
  let high = Infinity;
  for (const coating of MIRROR_COATINGS) {
    const [coatingLow, coatingHigh] = mirrorEnergyRange_eV(coating);
    low = Math.max(low, coatingLow);
    high = Math.min(high, coatingHigh);
  }
  return [low, high];
}

export interface MirrorReflection {
  id: string;
  coating: MirrorCoating;
  angle_mrad: number;
  reflectivity: number;
}

/** Reflectivity of every inserted mirror at one photon energy, in beam order. */
export function mirrorReflections(mirrors: readonly MirrorConfig[],
                                  energy_eV: number): MirrorReflection[] {
  return mirrors.filter(mirror => mirror.inserted).map(mirror => ({
    id: mirror.id,
    coating: mirror.coating,
    angle_mrad: mirror.angle_mrad,
    reflectivity: mirrorReflectivity(mirror.coating, mirror.angle_mrad, energy_eV),
  }));
}

/** Product of the reflectivities of the inserted mirrors; 1 when none is inserted. */
export function mirrorTransmission(mirrors: readonly MirrorConfig[], energy_eV: number): number {
  let transmission = 1;
  for (const mirror of mirrors) {
    if (mirror.inserted) transmission *= mirrorReflectivity(mirror.coating, mirror.angle_mrad, energy_eV);
  }
  return transmission;
}

/**
 * Energy (eV) at which reflectivity first drops through `level`, by bisection.
 *
 * Returns null when the coating stays above `level` over the whole tabulated range, or is
 * already below it at the low end.  Coating absorption edges put local dips in the curve, so
 * the result is the first crossing bisection finds rather than a provably unique one.
 */
export function cutoffEnergy_eV(coating: MirrorCoating, angle_mrad: number,
                                level: number = CUTOFF_REFLECTIVITY): number | null {
  if (!Number.isFinite(level) || level <= 0 || level >= 1) {
    throw new RangeError('Cutoff reflectivity level must be in (0, 1).');
  }
  const [low_eV, high_eV] = mirrorEnergyRange_eV(coating);
  if (mirrorReflectivity(coating, angle_mrad, low_eV) < level) return null;
  if (mirrorReflectivity(coating, angle_mrad, high_eV) >= level) return null;
  let low = low_eV;
  let high = high_eV;
  for (let step = 0; step < 60; step++) {
    const middle = Math.sqrt(low * high);
    if (mirrorReflectivity(coating, angle_mrad, middle) >= level) low = middle;
    else high = middle;
    if (high - low < 1e-6 * low) break;
  }
  return Math.sqrt(low * high);
}

/**
 * Largest stored angle (mrad) that keeps at least `REJECTION_KEEP_FUNDAMENTAL` of the
 * fundamental while passing at most `REJECTION_PASS_HARMONIC` of the third harmonic, in a
 * single bounce.  Null when no stored angle does both.
 *
 * A larger angle rejects harder but cuts the fundamental, so the largest angle that still
 * clears both limits is the most robust choice against the mirror drifting in pitch.
 */
export function harmonicRejectionAngle(coating: MirrorCoating, energy_eV: number): number | null {
  const [low_eV, high_eV] = mirrorEnergyRange_eV(coating);
  if (energy_eV < low_eV || 3 * energy_eV > high_eV) {
    throw new RangeError(`Harmonic rejection needs E and 3E inside the tabulated ${low_eV} to ${high_eV} eV: E = ${energy_eV} eV.`);
  }
  const angles = mirrorAngles_mrad(coating);
  for (let index = angles.length - 1; index >= 0; index--) {
    const angle_mrad = angles[index];
    if (mirrorReflectivity(coating, angle_mrad, energy_eV) < REJECTION_KEEP_FUNDAMENTAL) continue;
    if (mirrorReflectivity(coating, angle_mrad, 3 * energy_eV) > REJECTION_PASS_HARMONIC) continue;
    return angle_mrad;
  }
  return null;
}
