/**
 * X-ray dose in the illuminated volume and photoreduction kinetics.
 *
 * Units: eV, um, cm, g/cm^3, s, Gy (J/kg). Beam sizes are FWHM in micrometres, as in
 * `TwinProfile.beam_um`, and the illuminated area is taken as that rectangle, which is the
 * flat-top convention of dossier 11.1 (a Gaussian beam of the same FWHM has a higher peak
 * dose rate at its centre).
 *
 * Call `await loadXrayData()` once before any function here.
 *
 * Equations: dossier section 11, reference script `s11_dose.py`.
 *   - dose rate: the photoabsorption cross section of the sample stands in for the mass
 *     energy absorption coefficient mu_en/rho, which agrees with the NIST table for water
 *     within 1.2 % between 5 and 20 keV (dossier 11.1);
 *   - photoreduction: pseudo first order in dose, f = exp(-D/D_c), after G. N. George,
 *     I. J. Pickering et al., J. Synchrotron Rad. 19 (2012) 875. The critical doses D_c are
 *     teaching values: the dossier records every published number it found as unverified.
 */

import { muOverRho } from '../xraydata';
import type { Provenance, SampleConfig } from './types';

/** Joules per electronvolt (CODATA 2018 elementary charge, exact in the 2019 SI). */
const J_PER_eV = 1.602176634e-19;

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be greater than zero.`);
  return value;
}

// ---------------------------------------------------------------- dose rate

export interface DoseInput {
  /** Photons per second on the sample at the energy below. */
  flux: number;
  energy_eV: number;
  /** Beam size at the sample, horizontal and vertical FWHM, treated as a flat rectangle. */
  beam_um: [number, number];
  formula: string;
  density: number;
  thickness_um: number;
  /**
   * Fraction of the absorbed energy that stays in the illuminated volume. Fluorescence
   * photons mostly leave a thin sample, so 1 is an upper bound on the dose. Default 1.
   */
  depositedFraction?: number;
}

export interface DoseRate {
  energy_eV: number;
  /** Illuminated area of the sample face, cm^2. */
  area_cm2: number;
  /** Photons per second per square millimetre: the quantity damage studies report. */
  fluxDensity_per_s_mm2: number;
  /** mu_photo/rho of the sample, the proxy for mu_en/rho, cm^2/g. */
  muEnOverRho_cm2_g: number;
  /** mu_photo * thickness: the optical depth that absorbs energy. */
  photoOpticalDepth: number;
  /** Surface dose rate Phi E (mu_en/rho) / A, the thin-sample formula, Gy/s. */
  surfaceRate_Gy_per_s: number;
  /** Dose rate averaged over the illuminated volume, Gy/s (dossier 11.1, thick formula). */
  meanRate_Gy_per_s: number;
  /** Watts absorbed in the illuminated volume. */
  absorbedPower_W: number;
  depositedFraction: number;
  provenance: Provenance[];
}

/**
 * Dose rate in the illuminated volume (dossier 11.1).
 *
 * Thin sample, where attenuation through the thickness is negligible, uniform beam of area
 * A: the surface dose rate is
 *
 *   Ddot = Phi E (mu_en/rho) / A
 *
 * with E in joules, mu_en/rho in m^2/kg and A in m^2. For a sample of finite thickness x the
 * dose averaged over the illuminated volume is
 *
 *   Ddot_mean = Phi E (1 - exp(-mu x)) f_dep / (rho x A)
 *
 * which is the absorbed power divided by the illuminated mass. The two agree as mu x goes to
 * zero, because (1 - exp(-mu x)) / x tends to mu; the mean rate is always the smaller of the
 * two, since the front face sees more than the average. `mu` here is photoabsorption only:
 * scattered photons carry their energy away.
 */
export function doseRate(input: DoseInput): DoseRate {
  const flux = requirePositive(input.flux, 'Flux');
  const energy_eV = requirePositive(input.energy_eV, 'Energy');
  const density = requirePositive(input.density, 'Density');
  const thickness_cm = requirePositive(input.thickness_um, 'Thickness') * 1e-4;
  const [horizontal_um, vertical_um] = input.beam_um;
  const area_cm2 = (requirePositive(horizontal_um, 'Horizontal beam size') * 1e-4)
    * (requirePositive(vertical_um, 'Vertical beam size') * 1e-4);
  const depositedFraction = input.depositedFraction ?? 1;
  if (!Number.isFinite(depositedFraction) || depositedFraction < 0 || depositedFraction > 1) {
    throw new RangeError('The deposited fraction must be between 0 and 1.');
  }

  const muEnOverRho = muOverRho(input.formula, energy_eV).photo;
  const muPhoto_cm_inv = muEnOverRho * density;
  const photoOpticalDepth = muPhoto_cm_inv * thickness_cm;
  const power_W = flux * energy_eV * J_PER_eV;

  // Gy = J/kg, so the gram-based cross sections need a factor 1000 g per kg.
  const surfaceRate = (power_W * muEnOverRho * 1e3) / area_cm2;
  const absorbed_W = power_W * -Math.expm1(-photoOpticalDepth) * depositedFraction;
  const mass_g = density * thickness_cm * area_cm2;

  return {
    energy_eV,
    area_cm2,
    fluxDensity_per_s_mm2: flux / (area_cm2 * 100),
    muEnOverRho_cm2_g: muEnOverRho,
    photoOpticalDepth,
    surfaceRate_Gy_per_s: surfaceRate * depositedFraction,
    meanRate_Gy_per_s: (absorbed_W * 1e3) / mass_g,
    absorbedPower_W: absorbed_W,
    depositedFraction,
    provenance: ['tabulated', 'computed'],
  };
}

export interface SampleDoseOptions {
  depositedFraction?: number;
}

/** Dose rate for a configured sample and beam. */
export function sampleDoseRate(sample: SampleConfig, flux: number, energy_eV: number,
                               beam_um: [number, number], options: SampleDoseOptions = {}): DoseRate {
  return doseRate({
    flux,
    energy_eV,
    beam_um,
    formula: sample.formula,
    density: sample.density,
    thickness_um: sample.thickness_um,
    depositedFraction: options.depositedFraction,
  });
}

// ---------------------------------------------------------------- photoreduction

/**
 * Teaching critical doses D_c, the dose at which a fraction 1 - 1/e of the absorber has been
 * reduced. These are illustrative orders of magnitude for the four classes of sample the twin
 * offers, not measured values: dossier 11.2 records every published critical dose it found as
 * unverified, and George et al. 2012 report exposure times rather than doses. They are
 * ordered the way the literature orders sensitivity (solution worst, hard-X-ray oxides best)
 * and sit well below the 3e7 Gy at which protein crystal diffraction halves (R. L. Owen,
 * E. Rudino-Pinera and E. F. Garman, PNAS 103 (2006) 4912), because metal-site
 * photoreduction in XAS happens at much lower dose (J. Yano, J. Kern et al., PNAS 102 (2005)
 * 12047). Pass your own `criticalDose_Gy` whenever you have a measured one.
 */
export const TEACHING_CRITICAL_DOSE_Gy = {
  /** Metal complexes in water at room temperature: radiolysis products do the damage. */
  solution: 1e4,
  /** Hydrated or frozen biological sample. */
  biological: 1e5,
  /** Operando cell with electrolyte and binder. */
  operando: 1e6,
  /** Dry inorganic oxide powder or foil in a hard X-ray beam. */
  oxide: 1e8,
} as const;

export type DamageClass = keyof typeof TEACHING_CRITICAL_DOSE_Gy;

/**
 * Cryogenic protection factor, a teaching value.
 *
 * George et al. 2012 report that about 10 K is far more protective than liquid nitrogen
 * temperature, which "may be inadequate", but give no factor, so this is one illustrative
 * number per temperature band rather than a measured ratio. It multiplies the critical dose.
 */
export function cryoFactor(temperature_K: number): number {
  requirePositive(temperature_K, 'Temperature');
  if (temperature_K <= 20) return 10;
  if (temperature_K <= 120) return 3;
  return 1;
}

export interface PhotoreductionInput {
  /** Dose delivered so far, Gy. */
  dose_Gy: number;
  /** D_c: the dose constant of the first-order kinetics, Gy. */
  criticalDose_Gy: number;
}

export interface Photoreduction {
  dose_Gy: number;
  criticalDose_Gy: number;
  /** Fraction of the absorber still in its original state, exp(-D/D_c). */
  intactFraction: number;
  /** 1 - exp(-D/D_c): the fraction that has been reduced. */
  reducedFraction: number;
  provenance: Provenance;
}

/**
 * Photoreduced fraction after a given dose (dossier 11.2).
 *
 * Pseudo first order in dose: the original species decays as f(D) = exp(-D/D_c), equivalently
 * exp(-kt) with k proportional to the dose rate. The observed spectrum is then
 * f mu_original + (1 - f) mu_reduced, which `acquire.ts` mixes per energy point in
 * acquisition order, so the high-k end of a scan is more damaged than the edge.
 */
export function photoreduction(input: PhotoreductionInput): Photoreduction {
  const dose = input.dose_Gy;
  if (!Number.isFinite(dose) || dose < 0) throw new RangeError('Dose must be zero or positive.');
  const criticalDose_Gy = requirePositive(input.criticalDose_Gy, 'Critical dose');
  const reducedFraction = -Math.expm1(-dose / criticalDose_Gy);
  return {
    dose_Gy: dose,
    criticalDose_Gy,
    intactFraction: 1 - reducedFraction,
    reducedFraction,
    provenance: 'teaching-model',
  };
}

export interface Mitigations {
  /** Beam area multiplier from defocusing: 4 doubles both beam dimensions. Default 1. */
  defocus?: number;
  /** Transmission of an inserted attenuator at the incident energy. Default 1. */
  attenuation?: number;
  /** Sample temperature, for `cryoFactor`. Default: no cryogenic protection. */
  temperature_K?: number;
  /**
   * Number of fresh spots the sample is translated through. The dose each spot receives is
   * the total divided by this, which is what translating between sweeps buys. Default 1.
   */
  spots?: number;
}

export interface DamageEstimate {
  rate: DoseRate;
  /** Dose rate after defocusing and attenuation, Gy/s. */
  mitigatedRate_Gy_per_s: number;
  /** Dose in one spot after `exposure_s` of beam, Gy. */
  dose_Gy: number;
  /** Critical dose after the cryogenic factor, Gy. */
  criticalDose_Gy: number;
  reduction: Photoreduction;
  /** Seconds of beam per spot until the reduced fraction reaches `fraction`. */
  timeToFraction_s: (fraction: number) => number;
  provenance: Provenance[];
  notes: string[];
}

export interface DamageInput extends DoseInput {
  /** Seconds of beam on the sample, summed over the scans so far. */
  exposure_s: number;
  /** Sample class for the teaching critical dose. Ignored when `criticalDose_Gy` is given. */
  damageClass?: DamageClass;
  /** Measured critical dose, Gy. Overrides `damageClass`. */
  criticalDose_Gy?: number;
  mitigations?: Mitigations;
}

/**
 * Dose and photoreduced fraction for one exposure, with the mitigations of dossier 11.3.
 *
 * Defocusing and attenuation lower the dose rate; translating the sample divides the dose
 * between spots; a cryostat raises the critical dose by `cryoFactor`. Each of those is a
 * teaching-level factor, so the whole estimate is labelled a teaching model even though the
 * dose rate it starts from is computed from tabulated cross sections.
 */
export function damageEstimate(input: DamageInput): DamageEstimate {
  const exposure_s = input.exposure_s;
  if (!Number.isFinite(exposure_s) || exposure_s < 0) throw new RangeError('Exposure must be zero or positive.');
  const mitigations = input.mitigations ?? {};
  const defocus = requirePositive(mitigations.defocus ?? 1, 'Defocus factor');
  const attenuation = mitigations.attenuation ?? 1;
  if (!Number.isFinite(attenuation) || attenuation <= 0 || attenuation > 1) {
    throw new RangeError('Attenuation must be greater than 0 and at most 1.');
  }
  const spots = mitigations.spots ?? 1;
  if (!Number.isInteger(spots) || spots < 1) throw new RangeError('The number of spots must be a positive integer.');

  const rate = doseRate({ ...input, beam_um: [input.beam_um[0] * Math.sqrt(defocus), input.beam_um[1] * Math.sqrt(defocus)] });
  const mitigatedRate = rate.meanRate_Gy_per_s * attenuation;
  const dose_Gy = (mitigatedRate * exposure_s) / spots;

  const cryo = mitigations.temperature_K === undefined ? 1 : cryoFactor(mitigations.temperature_K);
  const base = input.criticalDose_Gy
    ?? TEACHING_CRITICAL_DOSE_Gy[input.damageClass ?? 'oxide'];
  const criticalDose_Gy = requirePositive(base, 'Critical dose') * cryo;

  const notes = [
    'Dose rate from the tabulated photoabsorption cross section, which stands in for the mass energy absorption coefficient.',
  ];
  if (input.criticalDose_Gy === undefined) {
    notes.push(`Critical dose ${base.toExponential(0)} Gy is a teaching value for a ${input.damageClass ?? 'oxide'} sample, not a measured one.`);
  }
  if (cryo !== 1) notes.push(`Cryogenic protection raises the critical dose by a teaching factor of ${cryo}.`);
  if (spots > 1) notes.push(`Translating between ${spots} spots divides the dose per spot by ${spots}.`);

  return {
    rate,
    mitigatedRate_Gy_per_s: mitigatedRate,
    dose_Gy,
    criticalDose_Gy,
    reduction: photoreduction({ dose_Gy, criticalDose_Gy }),
    timeToFraction_s: (fraction: number) => {
      if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
        throw new RangeError('The reduced fraction must be greater than 0 and less than 1.');
      }
      return (-criticalDose_Gy * Math.log(1 - fraction) * spots) / mitigatedRate;
    },
    provenance: ['tabulated', 'computed', 'teaching-model'],
    notes,
  };
}
