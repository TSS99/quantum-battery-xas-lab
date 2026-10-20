/**
 * The beam that arrives at the sample: flux of the fundamental, flux of every harmonic the
 * crystal passes, the harmonic fraction, bandwidth, resolution and losses along the way.
 *
 * Flux is in photons per second, energies eV, bandwidths relative.  The chain for one order n
 * is source flux at nE (per 0.1 % bandwidth) times the band the monochromator passes at that
 * order, times the mirror reflectivities at nE, times the order's angular acceptance relative
 * to the fundamental, times the second-crystal detune throughput of that order.
 *
 * Reference: project physics dossier sections 1.2, 2.5 and 3.3.
 */

import { mu } from '../xraydata';
import { mirrorReflections, mirrorTransmission, tabulatedEnergyRange_eV } from './mirrors';
import type { MirrorReflection } from './mirrors';
import { detuneFactor, glitchList, glitchThroughput, monoResolution } from './mono';
import type { Glitch } from './mono';
import { allowedOrders, gas, harmonicAcceptance } from './tables';
import { tuneSource } from './source';
import type { Provenance, TwinProfile } from './types';

/** Reference bandwidth of the tabulated source flux: 0.1 %. */
const SOURCE_BANDWIDTH = 1e-3;

export interface BeamOrder {
  /** Harmonic order; 1 is the fundamental. */
  order: number;
  /** Photon energy of this order (eV). */
  energy_eV: number;
  /** Photons per second at the sample in this order. */
  flux: number;
  /** Relative energy band the monochromator passes in this order. */
  bandwidth: number;
  /** Source flux at this order's energy, ph/s per 0.1 % bandwidth. */
  sourceFlux: number;
  /** Angular acceptance relative to the fundamental; 1 for the fundamental. */
  acceptance: number;
  /** Second-crystal throughput at the current detune. */
  detuneFactor: number;
  /** Product of the inserted mirror reflectivities at this order's energy. */
  mirrorTransmission: number;
  /** Flight-path transmission at this order's energy; 1 when no path is given. */
  flightPathTransmission: number;
}

export interface BeamAtSample {
  /** Fundamental photon energy the monochromator is set to (eV). */
  energy_eV: number;
  thetaB_rad: number;
  /** Relative band the aligned pair passes in the fundamental. */
  bandwidth: number;
  /** Fundamental energy resolution, Darwin width and vertical divergence in quadrature (eV). */
  deltaE_eV: number;
  /** Photons per second at the sample in the fundamental. */
  flux: number;
  /** Fundamental plus every included harmonic. */
  orders: BeamOrder[];
  /** Photons per second at the sample summed over harmonics above the fundamental. */
  harmonicFlux: number;
  /** harmonicFlux / (flux + harmonicFlux). */
  harmonicFraction: number;
  /** Product of the inserted mirror reflectivities at the fundamental. */
  mirrorTransmission: number;
  /** Reflectivity of each inserted mirror at the fundamental, in beam order. */
  mirrors: MirrorReflection[];
  /** Flight-path transmission at the fundamental. */
  flightPathTransmission: number;
  /** Glitch-map throughput at the fundamental; 1 when glitches are off. */
  glitchThroughput: number;
  /** Orders the crystal passes that were left out, with the reason. */
  omittedOrders: { order: number; reason: string }[];
  provenance: Provenance[];
  notes: string[];
}

export interface BeamOptions {
  /**
   * Length of unpurged air between the monochromator and the sample (cm).  Needs
   * `loadXrayData()`; omit it for a windowless, evacuated or helium-purged path.
   */
  airPath_cm?: number;
  /** Apply the seeded glitch map of the crystal set (realistic mode). Default false. */
  includeGlitches?: boolean;
  /** Supply a glitch list instead of the one `profile.mono.glitchSeed` generates. */
  glitches?: readonly Glitch[];
}

/**
 * Beam at the sample for one monochromator setting.
 *
 * Model assumptions, stated in the returned notes as well:
 * - The fundamental fills the first crystal's angular acceptance, so a harmonic with a
 *   narrower Darwin width accepts only `harmonicAcceptance` of the same incident beam.
 * - The source flux is the one the device gives at a single setting, so an undulator gap
 *   tuned to the fundamental also sets the flux at 3E and 5E.
 * - Harmonics are only included while their energy stays inside the tabulated mirror range,
 *   2 to 60 keV; higher orders appear in `omittedOrders`.
 */
export function beamAtSample(profile: TwinProfile, energy_eV: number,
                             options: BeamOptions = {}): BeamAtSample {
  const { crystal, detune } = profile.mono;
  const fundamental = monoResolution(crystal, 1, energy_eV, profile.source.vDiv_urad);
  const source = tuneSource(profile.source, energy_eV);
  const [, highestMirrorEnergy_eV] = tabulatedEnergyRange_eV();

  const airPath_cm = options.airPath_cm;
  const air = airPath_cm === undefined ? null : gas('air');
  const flightPath = (atEnergy_eV: number) => {
    if (!air || airPath_cm === undefined) return 1;
    return Math.exp(-mu(air.formula, air.density_g_cm3, atEnergy_eV).total * airPath_cm);
  };

  const glitches = options.glitches
    ?? (options.includeGlitches ? glitchList(crystal, profile.mono.glitchSeed) : []);
  const glitchFactor = glitchThroughput(glitches, energy_eV);

  const omittedOrders: { order: number; reason: string }[] = [];
  const orders: BeamOrder[] = [];
  for (const order of allowedOrders(crystal)) {
    const orderEnergy_eV = order * energy_eV;
    if (orderEnergy_eV > highestMirrorEnergy_eV) {
      omittedOrders.push({
        order,
        reason: `${Math.round(orderEnergy_eV)} eV is above the tabulated mirror and source range (${Math.round(highestMirrorEnergy_eV)} eV).`,
      });
      continue;
    }
    const resolution = order === 1 ? fundamental : monoResolution(crystal, order, energy_eV, profile.source.vDiv_urad);
    const acceptance = order === 1 ? 1 : harmonicAcceptance(crystal, order, energy_eV);
    const sourceFlux = source.fluxAt(orderEnergy_eV);
    const mirrors = mirrorTransmission(profile.mirrors, orderEnergy_eV);
    const transmission = flightPath(orderEnergy_eV);
    const throughput = detuneFactor(crystal, order, energy_eV, detune);
    // The glitch map is the one of the fundamental reflection, so only the fundamental dips.
    // Harmonic content therefore changes inside a glitch, which is why glitches do not
    // divide out of I_t/I_0 (dossier section 2.6).
    const flux = sourceFlux * (resolution.bandwidth / SOURCE_BANDWIDTH) * acceptance * throughput
      * mirrors * transmission * (order === 1 ? glitchFactor : 1);
    orders.push({
      order,
      energy_eV: orderEnergy_eV,
      flux,
      bandwidth: resolution.bandwidth,
      sourceFlux,
      acceptance,
      detuneFactor: throughput,
      mirrorTransmission: mirrors,
      flightPathTransmission: transmission,
    });
  }

  const first = orders.find(entry => entry.order === 1);
  if (!first) throw new Error(`No fundamental in range for ${crystal} at ${energy_eV} eV.`);
  const harmonicFlux = orders.reduce((sum, entry) => entry.order === 1 ? sum : sum + entry.flux, 0);
  const total = first.flux + harmonicFlux;

  const notes = [...source.notes];
  notes.push('The fundamental is assumed to fill the angular acceptance of the first crystal, so a harmonic takes only its relative acceptance of the same beam.');
  if (glitches.length > 0) {
    notes.push('Glitch dips are a seeded teaching model, not the glitch map of a real crystal pair, and only the fundamental reflection dips.');
  }
  if (omittedOrders.length > 0) {
    notes.push(`Orders left out above the tabulated range: ${omittedOrders.map(entry => entry.order).join(', ')}.`);
  }

  const provenance: Provenance[] = ['tabulated', source.provenance];
  if (glitches.length > 0) provenance.push('teaching-model');

  return {
    energy_eV,
    thetaB_rad: fundamental.thetaB_rad,
    bandwidth: fundamental.bandwidth,
    deltaE_eV: fundamental.deltaE_eV,
    flux: first.flux,
    orders,
    harmonicFlux,
    harmonicFraction: total > 0 ? harmonicFlux / total : 0,
    mirrorTransmission: first.mirrorTransmission,
    mirrors: mirrorReflections(profile.mirrors, energy_eV),
    flightPathTransmission: first.flightPathTransmission,
    glitchThroughput: glitchFactor,
    omittedOrders,
    provenance: [...new Set(provenance)],
    notes,
  };
}
