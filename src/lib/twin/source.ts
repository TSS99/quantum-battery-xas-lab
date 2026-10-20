/**
 * Synchrotron source spectra: bending magnet (X-ray Data Booklet) and a simplified
 * teaching undulator.
 *
 * All flux values are photons per second per 0.1 % relative bandwidth.  The bending-magnet
 * flux is integrated over all vertical angles and multiplied by the beamline's horizontal
 * acceptance, so it is an upper bound: no vertical aperture, no slope errors, no windows.
 * The undulator is a zero-emittance, zero-energy-spread central-cone model and is labelled
 * `teaching-model` everywhere it appears.
 *
 * Sources
 * - Bending magnet: X-ray Data Booklet section 2.1 (K.-J. Kim), https://xdb.lbl.gov/Section2/Sec_2-1.html.
 *   Prefactors re-derived from CODATA constants in the project physics dossier section 1.1.
 * - Undulator: same booklet section; harmonic flux Q_n(K) expression, dossier section 1.3.
 */

import { g1 } from './tables';
import type { Provenance, SourceConfig } from './types';

/** eps_c[keV] = 0.665 * E[GeV]^2 * B[T] (X-ray Data Booklet 2.1; re-derived 0.66503). */
const CRITICAL_ENERGY_keV = 0.665;

/** dF/dtheta = 2.457e13 * E[GeV] * I[A] * G1(y), in ph/s/mrad/(0.1 % BW) (re-derived 2.4571e13). */
const BENDING_MAGNET_FLUX = 2.457e13;

/** eps_1[keV] = 0.950 * E[GeV]^2 / (lambda_u[cm] * (1 + K^2/2)) (re-derived 0.9496). */
const UNDULATOR_ENERGY_keV = 0.950;

/** F_n = 1.431e14 * N * Q_n(K) * I[A], in ph/s/(0.1 % BW) (re-derived 1.4309e14). */
const UNDULATOR_FLUX = 1.431e14;

/** Highest odd harmonic the undulator model evaluates; above this the model is meaningless. */
export const MAX_UNDULATOR_HARMONIC = 15;

/** FWHM of a Gaussian divided by its standard deviation. */
const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.LN2);

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be greater than zero.`);
  return value;
}

/** Critical photon energy of a bending magnet (eV) from ring energy (GeV) and field (T). */
export function criticalEnergy_eV(ring_GeV: number, field_T: number): number {
  requirePositive(ring_GeV, 'Ring energy (GeV)');
  requirePositive(field_T, 'Bending-magnet field (T)');
  return 1000 * CRITICAL_ENERGY_keV * ring_GeV * ring_GeV * field_T;
}

/**
 * Bending-magnet flux in ph/s per mrad of horizontal fan per 0.1 % bandwidth, integrated
 * over vertical angle.  Needs `loadOptics()` for the tabulated G1.
 */
export function bendingMagnetFluxPerMrad(ring_GeV: number, current_A: number, field_T: number,
                                         energy_eV: number): number {
  requirePositive(current_A, 'Ring current (A)');
  requirePositive(energy_eV, 'Photon energy (eV)');
  const y = energy_eV / criticalEnergy_eV(ring_GeV, field_T);
  return BENDING_MAGNET_FLUX * ring_GeV * current_A * g1(y);
}

/**
 * Bessel function of the first kind, integer order, from the ascending power series
 * J_m(x) = sum_k (-1)^k (x/2)^(2k+m) / (k! (k+m)!).
 *
 * The undulator argument Y = n K^2 / (4 (1 + K^2/2)) is below n/2, so x stays under 8 for
 * every harmonic this module evaluates and the series is accurate to near machine precision.
 */
export function besselJ(order: number, x: number): number {
  if (!Number.isInteger(order) || order < 0) throw new RangeError('Bessel order must be a non-negative integer.');
  if (!Number.isFinite(x)) throw new RangeError('Bessel argument must be finite.');
  const half = x / 2;
  let term = 1;
  for (let i = 1; i <= order; i++) term *= half / i;
  let sum = term;
  for (let k = 1; k < 80; k++) {
    term *= -(half * half) / (k * (k + order));
    sum += term;
    if (Math.abs(term) <= 1e-18 * Math.abs(sum)) break;
  }
  return sum;
}

function requireOddHarmonic(harmonic: number): number {
  if (!Number.isInteger(harmonic) || harmonic < 1 || harmonic % 2 === 0) {
    throw new RangeError('On-axis undulator harmonics are odd integers.');
  }
  if (harmonic > MAX_UNDULATOR_HARMONIC) {
    throw new RangeError(`Undulator harmonic ${harmonic} is above the modelled limit ${MAX_UNDULATOR_HARMONIC}.`);
  }
  return harmonic;
}

/** Dimensionless on-axis flux function F_n(K) of the X-ray Data Booklet. */
export function undulatorF(harmonic: number, K: number): number {
  requireOddHarmonic(harmonic);
  requirePositive(K, 'Deflection parameter K');
  const kk = 1 + K * K / 2;
  const argument = harmonic * K * K / (4 * kk);
  const difference = besselJ((harmonic - 1) / 2, argument) - besselJ((harmonic + 1) / 2, argument);
  return harmonic * harmonic * K * K / (kk * kk) * difference * difference;
}

/** Central-cone flux function Q_n(K) = (1 + K^2/2) F_n(K) / n. */
export function undulatorQ(harmonic: number, K: number): number {
  return (1 + K * K / 2) * undulatorF(harmonic, K) / harmonic;
}

/** On-axis energy of an odd undulator harmonic (eV). */
export function undulatorHarmonicEnergy_eV(ring_GeV: number, period_mm: number, K: number,
                                           harmonic: number): number {
  requireOddHarmonic(harmonic);
  requirePositive(ring_GeV, 'Ring energy (GeV)');
  requirePositive(period_mm, 'Undulator period (mm)');
  requirePositive(K, 'Deflection parameter K');
  const period_cm = period_mm / 10;
  return 1000 * harmonic * UNDULATOR_ENERGY_keV * ring_GeV * ring_GeV / (period_cm * (1 + K * K / 2));
}

/** Central-cone flux of one odd harmonic in ph/s per 0.1 % bandwidth, on the harmonic peak. */
export function undulatorCentralConeFlux(periods: number, current_A: number, K: number,
                                         harmonic: number): number {
  requirePositive(periods, 'Number of undulator periods');
  requirePositive(current_A, 'Ring current (A)');
  return UNDULATOR_FLUX * periods * undulatorQ(harmonic, K) * current_A;
}

export interface UndulatorTuning {
  /** Odd harmonic used to reach the requested energy. */
  harmonic: number;
  /** Deflection parameter the gap is set to, never above `maxK`. */
  K: number;
}

/**
 * Gap tuning: the lowest odd harmonic that reaches `targetEnergy_eV` with K <= maxK.
 *
 * Raising K (closing the gap) lowers every harmonic, so a harmonic can only reach energies
 * at or below n * 0.950 E^2 / lambda_u.  Returns null when no modelled harmonic reaches the
 * energy with the available gap range.
 */
export function tuneUndulator(ring_GeV: number, period_mm: number, targetEnergy_eV: number,
                              maxK: number): UndulatorTuning | null {
  requirePositive(targetEnergy_eV, 'Target photon energy (eV)');
  requirePositive(maxK, 'Maximum deflection parameter K');
  const period_cm = requirePositive(period_mm, 'Undulator period (mm)') / 10;
  const zeroKEnergy_eV = 1000 * UNDULATOR_ENERGY_keV * ring_GeV * ring_GeV / period_cm;
  for (let harmonic = 1; harmonic <= MAX_UNDULATOR_HARMONIC; harmonic += 2) {
    const kk = harmonic * zeroKEnergy_eV / targetEnergy_eV;
    if (kk <= 1) continue;
    const K = Math.sqrt(2 * (kk - 1));
    if (K <= maxK) return { harmonic, K };
  }
  return null;
}

export interface TunedSource {
  kind: SourceConfig['kind'];
  /** Bending magnet only: critical energy (eV). */
  criticalEnergy_eV: number | null;
  /** Undulator only: the gap setting chosen for the fundamental, or null when unreachable. */
  tuning: UndulatorTuning | null;
  provenance: Provenance;
  /** Limits of the model at this setting, for the UI to show next to the flux. */
  notes: string[];
  /**
   * Flux in ph/s per 0.1 % bandwidth through the beamline acceptance at any photon energy,
   * with the device left at the setting chosen for the fundamental.
   */
  fluxAt(energy_eV: number): number;
}

/**
 * Fix the source at the setting it would use for `fundamental_eV`, then report its spectrum.
 *
 * A bending magnet has nothing to tune, so its spectrum is independent of the fundamental.
 * An undulator gap is set once; the flux at 3E or 5E then comes from the corresponding higher
 * harmonic of the same gap, which is what feeds monochromator harmonic contamination.
 */
export function tuneSource(source: SourceConfig, fundamental_eV: number): TunedSource {
  const current_A = requirePositive(source.current_mA, 'Ring current (mA)') / 1000;
  requirePositive(fundamental_eV, 'Fundamental photon energy (eV)');
  if (source.kind === 'bending-magnet') {
    const field_T = source.field_T;
    if (field_T === undefined) throw new Error('A bending-magnet source needs field_T.');
    const accept_mrad = requirePositive(source.hAccept_mrad, 'Horizontal acceptance (mrad)');
    const critical_eV = criticalEnergy_eV(source.ring_GeV, field_T);
    return {
      kind: 'bending-magnet',
      criticalEnergy_eV: critical_eV,
      tuning: null,
      provenance: 'computed',
      notes: [
        'Flux is integrated over all vertical angles: no vertical aperture, slope error or window loss.',
      ],
      fluxAt: (energy_eV: number) =>
        bendingMagnetFluxPerMrad(source.ring_GeV, current_A, field_T, energy_eV) * accept_mrad,
    };
  }
  const undulator = source.undulator;
  if (!undulator) throw new Error('An undulator source needs the undulator block.');
  const { period_mm, periods, K: maxK } = undulator;
  const tuning = tuneUndulator(source.ring_GeV, period_mm, fundamental_eV, maxK);
  const notes = [
    'Simplified undulator: zero emittance and zero energy spread, so real harmonics are broader and weaker, increasingly so at high order.',
    'On-axis central cone only. The horizontal acceptance is ignored and off-axis red-shifted light is not included.',
  ];
  if (!tuning) {
    notes.push(`No odd harmonic reaches ${Math.round(fundamental_eV)} eV with K up to ${maxK}.`);
    return {
      kind: 'undulator',
      criticalEnergy_eV: null,
      tuning: null,
      provenance: 'teaching-model',
      notes,
      fluxAt: () => 0,
    };
  }
  const first_eV = undulatorHarmonicEnergy_eV(source.ring_GeV, period_mm, tuning.K, 1);
  notes.push(`Gap set for harmonic ${tuning.harmonic} at K = ${tuning.K.toFixed(3)}; the natural relative linewidth is 1/(n N) = ${(1 / (tuning.harmonic * periods)).toExponential(2)}.`);
  return {
    kind: 'undulator',
    criticalEnergy_eV: null,
    tuning,
    provenance: 'teaching-model',
    notes,
    fluxAt: (energy_eV: number) => {
      requirePositive(energy_eV, 'Photon energy (eV)');
      const nearest = Math.max(1, 2 * Math.round((energy_eV / first_eV - 1) / 2) + 1);
      if (nearest > MAX_UNDULATOR_HARMONIC) return 0;
      const peak_eV = nearest * first_eV;
      const sigma = 1 / (nearest * periods) / FWHM_PER_SIGMA;
      const detuned = (energy_eV - peak_eV) / peak_eV / sigma;
      const line = Math.exp(-0.5 * detuned * detuned);
      return undulatorCentralConeFlux(periods, current_A, tuning.K, nearest) * line;
    },
  };
}

/**
 * Flux in ph/s per 0.1 % bandwidth through the beamline acceptance at `energy_eV`, with an
 * undulator gap tuned to that same energy.  Use `tuneSource` when one gap setting has to
 * serve a fundamental and its harmonics.
 */
export function spectralFlux(source: SourceConfig, energy_eV: number): number {
  return tuneSource(source, energy_eV).fluxAt(energy_eV);
}
