/**
 * Double crystal monochromator: Bragg angle, resolution, pass bandwidth, allowed harmonics,
 * detune throughput, calibration offset and a seeded teaching glitch map.
 *
 * Angles are radians, energies eV, bandwidths relative (dimensionless).  Darwin widths and
 * detune throughput come from the generated tables in `src/data/twin/optics.json`; this
 * module only applies Bragg's law and the quadrature resolution model to them.
 *
 * References: project physics dossier sections 2.1 to 2.6; Als-Nielsen and McMorrow,
 * Elements of Modern X-ray Physics, 2nd ed., section 6.4 (the theory xraydb implements).
 */

import { seededRandom } from '../xas';
import { allowedOrders, darwin, detuneThroughput } from './tables';
import type { Crystal, Provenance } from './types';

/** Silicon cubic lattice constant, CODATA 2018 silicon {220} lattice spacing (angstrom). */
export const SI_LATTICE_A = 5.431020511;

/** hc in eV*angstrom (CODATA; xraydb's PLANCK_HC agrees to one part in 1e16). */
export const HC_EV_ANGSTROM = 12398.419843320026;

const CRYSTAL_HKL: Record<Crystal, [number, number, number]> = {
  Si111: [1, 1, 1],
  Si311: [3, 1, 1],
  Si220: [2, 2, 0],
};

/** Energy span the seeded glitch map is generated over, so a seed gives the same list always. */
const GLITCH_SPAN_eV: [number, number] = [4000, 40000];

/** Mean glitch spacing at 10 keV (eV). Glitch density grows with energy; see `glitchList`. */
const GLITCH_SPACING_AT_10keV = 150;

/** Miller indices of a monochromator crystal. */
export function millerIndices(crystal: Crystal): [number, number, number] {
  const hkl = CRYSTAL_HKL[crystal];
  if (!hkl) throw new Error(`Unknown crystal "${crystal}".`);
  return [...hkl];
}

/** Plane spacing d = a / sqrt(h^2 + k^2 + l^2) in angstrom. */
export function dSpacing_A(crystal: Crystal): number {
  const [h, k, l] = millerIndices(crystal);
  return SI_LATTICE_A / Math.sqrt(h * h + k * k + l * l);
}

/** Lowest energy the crystal can reach, at a Bragg angle of 90 degrees (eV). */
export function backscatterEnergy_eV(crystal: Crystal): number {
  return HC_EV_ANGSTROM / (2 * dSpacing_A(crystal));
}

/** Bragg angle of the fundamental reflection (rad): E = hc / (2 d sin theta). */
export function braggAngle_rad(crystal: Crystal, energy_eV: number): number {
  if (!Number.isFinite(energy_eV) || energy_eV <= 0) {
    throw new RangeError('Photon energy (eV) must be greater than zero.');
  }
  const sinTheta = HC_EV_ANGSTROM / (2 * dSpacing_A(crystal) * energy_eV);
  if (sinTheta > 1) {
    throw new RangeError(`${crystal} cannot reach ${energy_eV} eV: its backscatter energy is ${backscatterEnergy_eV(crystal).toFixed(1)} eV.`);
  }
  return Math.asin(sinTheta);
}

/** Inverse of `braggAngle_rad`: the fundamental energy passed at a Bragg angle (eV). */
export function braggEnergy_eV(crystal: Crystal, theta_rad: number): number {
  if (!Number.isFinite(theta_rad) || theta_rad <= 0 || theta_rad > Math.PI / 2) {
    throw new RangeError('Bragg angle (rad) must be in (0, pi/2].');
  }
  return HC_EV_ANGSTROM / (2 * dSpacing_A(crystal) * Math.sin(theta_rad));
}

/** Harmonic orders the diamond structure allows for this crystal, lowest first. */
export function allowedHarmonics(crystal: Crystal): readonly number[] {
  return allowedOrders(crystal);
}

export interface MonoResolution {
  /** Harmonic order; the Bragg angle is the same for every order. */
  order: number;
  /** Photon energy of this order (eV): order times the fundamental. */
  energy_eV: number;
  thetaB_rad: number;
  /** Intrinsic angular acceptance of this order, FWHM (rad). */
  darwinTheta_fwhm_rad: number;
  /** Incident vertical divergence used in the quadrature (rad). */
  divergence_rad: number;
  /** Intrinsic energy width, E cot(theta) omega_D (eV). Equals the tabulated energy FWHM. */
  intrinsic_eV: number;
  /** Intrinsic and divergence terms in quadrature (eV). */
  deltaE_eV: number;
  /** deltaE_eV / energy_eV. */
  relative: number;
  /**
   * Relative energy band the aligned (+,-) pair passes per ray, used for flux.
   *
   * This is the tabulated intrinsic energy FWHM over the photon energy.  The exact band is
   * the integral of R1 R2 over dE/E; the FWHM is larger, because peak reflectivity is below
   * one, by a factor of 1.61 at 5 keV, 1.20 at 9 keV and 1.02 at 25 keV for Si(111), and
   * 1.80 at 5 keV for Si(311).  Harmonic fractions use the ratio of two such bands, where
   * most of that bias cancels.
   */
  bandwidth: number;
  provenance: Provenance;
}

/**
 * Energy resolution of one order: Darwin width and incident vertical divergence in
 * quadrature, deltaE = E cot(theta) sqrt(omega_D^2 + dtheta_v^2) (dossier section 2.3).
 *
 * `fundamental_eV` is the energy the monochromator is set to; `order` selects which
 * reflection of the same angle to report.
 */
export function monoResolution(crystal: Crystal, order: number, fundamental_eV: number,
                               vDiv_urad: number): MonoResolution {
  if (!Number.isFinite(vDiv_urad) || vDiv_urad < 0) {
    throw new RangeError('Vertical divergence (urad) must be zero or greater.');
  }
  const thetaB_rad = braggAngle_rad(crystal, fundamental_eV);
  const widths = darwin(crystal, order, fundamental_eV);
  const energy_eV = order * fundamental_eV;
  const cot = 1 / Math.tan(thetaB_rad);
  const divergence_rad = vDiv_urad * 1e-6;
  const omega = widths.theta_fwhm_rad;
  const intrinsic_eV = energy_eV * cot * omega;
  const deltaE_eV = energy_eV * cot * Math.hypot(omega, divergence_rad);
  return {
    order,
    energy_eV,
    thetaB_rad,
    darwinTheta_fwhm_rad: omega,
    divergence_rad,
    intrinsic_eV,
    deltaE_eV,
    relative: deltaE_eV / energy_eV,
    bandwidth: widths.energy_fwhm_eV / energy_eV,
    provenance: 'tabulated',
  };
}

/**
 * Throughput of the second crystal at a detune of `detune` times the fundamental rocking
 * curve FWHM, for one order.  Zero detune is one for every order by construction.
 *
 * The tabulated curves keep the full 1/x^2 Darwin tails, so a harmonic falls off as a power
 * law in the detune, roughly (omega_harmonic / delta)^2, not exponentially.
 */
export function detuneFactor(crystal: Crystal, order: number, fundamental_eV: number,
                             detune: number): number {
  return detuneThroughput(crystal, order, fundamental_eV, detune);
}

/** Energy the monochromator reports when the true photon energy is `trueEnergy_eV`. */
export function monoReading_eV(trueEnergy_eV: number, offset_eV: number): number {
  return trueEnergy_eV - offset_eV;
}

/** True photon energy behind a monochromator reading. Inverse of `monoReading_eV`. */
export function monoTrueEnergy_eV(reading_eV: number, offset_eV: number): number {
  return reading_eV + offset_eV;
}

export interface Glitch {
  /** Centre of the dip in true photon energy (eV). */
  energy_eV: number;
  /** Fractional intensity lost at the centre, for the part of the beam that is affected. */
  depth: number;
  /** Lorentzian FWHM (eV). */
  width_eV: number;
  /** Fraction of the beam footprint that meets the multiple-beam condition here. */
  beamFraction: number;
}

const glitchCache = new Map<string, readonly Glitch[]>();

/**
 * Seeded glitch map for one crystal set: a teaching model, not a real glitch list.
 *
 * Real glitches are multiple-beam (Umweganregung) reflections, so their positions depend on
 * the crystal azimuth and the exact cut of the two crystals installed; a given energy either
 * has one or does not, and no formula here can predict which (Sutter et al., J. Appl. Cryst.
 * 49 (2016) 1209, doi:10.1107/S1600576716009183).  What this model reproduces is the
 * behaviour that matters for teaching: dips of order the Darwin width whose density grows
 * with energy, which do not cancel in a ratio when they cover only part of the beam.
 *
 * Depths and the spacing scale are illustrative; the dossier found no published statistic
 * for either.  Positions, widths, depths and beam fractions are fixed by (crystal,
 * glitchSeed) and do not depend on the requested range.
 */
export function glitchList(crystal: Crystal, glitchSeed: number,
                           range: [number, number] = GLITCH_SPAN_eV): readonly Glitch[] {
  const key = `${crystal}:${glitchSeed}`;
  let all = glitchCache.get(key);
  if (!all) {
    if (!Number.isInteger(glitchSeed) || glitchSeed < 0 || glitchSeed > 4294967295) {
      throw new RangeError('glitchSeed must be an unsigned 32-bit integer.');
    }
    const crystalIndex = Object.keys(CRYSTAL_HKL).indexOf(crystal);
    if (crystalIndex < 0) throw new Error(`Unknown crystal "${crystal}".`);
    const random = seededRandom((glitchSeed ^ Math.imul(crystalIndex + 1, 0x9e3779b1)) >>> 0);
    const glitches: Glitch[] = [];
    let energy_eV = GLITCH_SPAN_eV[0];
    while (energy_eV < GLITCH_SPAN_eV[1]) {
      const meanSpacing = GLITCH_SPACING_AT_10keV * 10000 / energy_eV;
      energy_eV += meanSpacing * (0.3 + 1.4 * random());
      if (energy_eV >= GLITCH_SPAN_eV[1]) break;
      const darwinWidth = darwin(crystal, 1, energy_eV).energy_fwhm_eV;
      const depthDraw = random();
      glitches.push({
        energy_eV,
        depth: 0.01 + 0.29 * depthDraw * depthDraw * depthDraw,
        width_eV: darwinWidth * (0.5 + 3 * random()),
        beamFraction: 0.3 + 0.7 * random(),
      });
    }
    all = glitches;
    glitchCache.set(key, all);
  }
  const [low, high] = range;
  if (low === GLITCH_SPAN_eV[0] && high === GLITCH_SPAN_eV[1]) return all;
  return all.filter(glitch => glitch.energy_eV >= low && glitch.energy_eV <= high);
}

/**
 * Fraction of the flux that survives the glitch map at one energy.
 *
 * Each glitch removes `depth` of the intensity from `beamFraction` of the footprint, with a
 * Lorentzian profile in energy, so the whole-beam factor is 1 - p d L(E).
 */
export function glitchThroughput(glitches: readonly Glitch[], energy_eV: number): number {
  let throughput = 1;
  for (const glitch of glitches) {
    const detuned = 2 * (energy_eV - glitch.energy_eV) / glitch.width_eV;
    if (Math.abs(detuned) > 1000) continue;
    throughput *= 1 - glitch.beamFraction * glitch.depth / (1 + detuned * detuned);
  }
  return throughput;
}
