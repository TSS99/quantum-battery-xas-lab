/**
 * Ion chambers: absorbed fraction of a gas fill, saturated current, amplifier readout,
 * voltage-to-frequency counting, noise and a fill suggestion.
 *
 * Units: eV, cm, g/cm^3, A, V, Hz, s. Fluxes are photons per second.
 *
 * Call `await loadOptics()` (gas records) and `await loadXrayData()` (cross sections) once
 * before any function here; both throw a clear error if their table is missing.
 *
 * Convention: **one elementary charge per electron-ion pair** in the external circuit
 * (Knoll, Radiation Detection and Measurement, ch. 5; dossier 4.1). XrayDB's
 * `ionchamber_fluxes` defaults to `both_carriers=True`, which counts the electron and the
 * ion separately and so doubles the charge per pair; the fixtures in
 * `src/data/twin/fixtures.json` are recorded with `both_carriers=False, with_compton=False`
 * to match this module. The Compton term of `ionchamber_fluxes` is not modelled: it needs
 * the incoherent cross section on its own, and `src/lib/xraydata.ts` ships only
 * photoabsorption and the total. Below about 20 keV that term is under 0.5 % of the
 * current, which is where XrayDB itself starts recommending it.
 */

import { mu } from '../xraydata';
import { gas, type GasName } from './tables';
import type { ChamberConfig } from './types';

/** Coulomb. Exact by the 2019 SI definition of the ampere. */
export const ELEMENTARY_CHARGE = 1.602176634e-19;

/** The gas densities in optics.json are ideal-gas values at this temperature and 1 atm. */
export const GAS_TABLE_TEMPERATURE_K = 295;
export const GAS_TABLE_PRESSURE_ATM = 1;

/** Mole fractions of the fill. They are renormalised, so they need not sum to one. */
export type GasMix = Partial<Record<GasName, number>>;

/**
 * Fill conditions. Density scales as P/T for an ideal gas, from the stored 295 K, 1 atm
 * values (src/data/twin/README.md). XrayDB's own built-in gas densities correspond to
 * about 273 K, so a comparison with `ionchamber_fluxes` has to be made at that temperature.
 */
export interface GasConditions {
  temperature_K?: number;
  pressure_atm?: number;
}

export interface GasAttenuation {
  /** Photoabsorption, 1/cm. */
  photo: number;
  /** Photoabsorption plus coherent and incoherent scattering, 1/cm. */
  total: number;
  /** Mole-fraction weighted mean energy per electron-ion pair, eV. */
  W_eV: number;
}

function entries(mix: GasMix): [GasName, number][] {
  const list = Object.entries(mix).filter(([, fraction]) => (fraction ?? 0) > 0) as [GasName, number][];
  if (list.length === 0) throw new Error('A chamber fill needs at least one gas with a positive mole fraction.');
  for (const [name, fraction] of list) {
    if (!Number.isFinite(fraction)) throw new RangeError(`Mole fraction of ${name} must be finite.`);
  }
  return list;
}

/**
 * Linear attenuation of the fill and its mean ion-pair energy.
 *
 * Each gas is taken at its partial pressure, so the mole fraction multiplies its pure-gas
 * density; summing the resulting linear coefficients is exactly what XrayDB's
 * `ionchamber_fluxes` does. W is the mole-fraction weighted mean of the pure-gas values
 * (same weighting as XrayDB; the values come from `xraydb.ionization_potential`, which
 * cites Knoll Table 5-1 and ICRU Report 31).
 */
export function gasAttenuation(mix: GasMix, energy_eV: number, conditions: GasConditions = {}): GasAttenuation {
  const temperature_K = conditions.temperature_K ?? GAS_TABLE_TEMPERATURE_K;
  const pressure_atm = conditions.pressure_atm ?? GAS_TABLE_PRESSURE_ATM;
  if (!(temperature_K > 0)) throw new RangeError('Gas temperature must be greater than zero kelvin.');
  if (!(pressure_atm > 0)) throw new RangeError('Gas pressure must be greater than zero.');
  const scale = (pressure_atm / GAS_TABLE_PRESSURE_ATM) * (GAS_TABLE_TEMPERATURE_K / temperature_K);

  const list = entries(mix);
  const total = list.reduce((sum, [, fraction]) => sum + fraction, 0);
  const out: GasAttenuation = { photo: 0, total: 0, W_eV: 0 };
  for (const [name, fraction] of list) {
    const record = gas(name);
    const weight = fraction / total;
    const coefficients = mu(record.formula, record.density_g_cm3 * scale, energy_eV);
    out.photo += weight * coefficients.photo;
    out.total += weight * coefficients.total;
    out.W_eV += weight * record.W_eV;
  }
  return out;
}

export interface AbsorbedFraction extends GasAttenuation {
  /** Fraction of the incident photons that is removed from the beam, 1 - exp(-mu_total L). */
  attenuated: number;
  /** Fraction absorbed photoelectrically: the part that makes ion pairs. */
  absorbed: number;
  /** Fraction that leaves the chamber, exp(-mu_total L). */
  transmitted: number;
}

/**
 * Absorbed and transmitted fractions over the active length.
 *
 * `attenuated = 1 - exp(-mu_total L)` and the photoelectric share of it is
 * `attenuated * mu_photo / mu_total`, which is how `ionchamber_fluxes` splits the loss.
 */
export function absorbedFraction(mix: GasMix, length_cm: number, energy_eV: number,
                                 conditions: GasConditions = {}): AbsorbedFraction {
  if (!(length_cm > 0)) throw new RangeError('Chamber length must be greater than zero centimetres.');
  const coefficients = gasAttenuation(mix, energy_eV, conditions);
  const transmitted = Math.exp(-coefficients.total * length_cm);
  const attenuated = -Math.expm1(-coefficients.total * length_cm);
  return {
    ...coefficients,
    attenuated,
    absorbed: attenuated * (coefficients.photo / coefficients.total),
    transmitted,
  };
}

/**
 * Current amplifier and voltage-to-frequency converter.
 *
 * The 10 V full scale and the 9 V linearity warning are the common range of commercial
 * current amplifiers rather than a measured specification (dossier 4.1 marks both
 * UNVERIFIED), so they are parameters. The V2F full scale is a teaching value for the same
 * reason: 1 MHz and 10 MHz units are both common.
 */
export interface ReadoutOptions {
  conditions?: GasConditions;
  /** Output voltage at which the amplifier clips. Teaching value. */
  fullScale_V?: number;
  /** Output voltage above which the amplifier is flagged as nonlinear. Teaching value. */
  linearLimit_V?: number;
  /** Counting frequency at full scale. Teaching value. */
  v2fFullScale_Hz?: number;
  /** Counting frequency with no input ("dark" measurement offset). Teaching value. */
  v2fOffset_Hz?: number;
}

export const READOUT_DEFAULTS = {
  fullScale_V: 10,
  linearLimit_V: 9,
  v2fFullScale_Hz: 1e6,
  v2fOffset_Hz: 0,
} as const;

export interface ChamberReadout {
  /** Photoelectric share of the incident flux. */
  absorbedFraction: number;
  attenuatedFraction: number;
  /** Photons per second absorbed photoelectrically: the counting statistics of the signal. */
  absorbedRate: number;
  /** Photons per second leaving the chamber, for the next optic or chamber. */
  transmittedFlux: number;
  W_eV: number;
  /** Ionisation current alone, A. */
  signalCurrent_A: number;
  /** Signal plus dark current, A. */
  current_A: number;
  /** Amplifier output before clipping, V. */
  rawVoltage_V: number;
  /** Amplifier output after clipping at full scale, V. */
  voltage_V: number;
  saturated: boolean;
  /** Above the linearity limit: the reading is still on scale but no longer trustworthy. */
  nonlinear: boolean;
  /** V2F output rate for the clipped voltage, Hz. */
  frequency_Hz: number;
}

/**
 * Saturated ionisation current and the amplifier reading for a chamber.
 *
 *   I = Phi * f_photo * (E / W) * e            (one charge per ion pair, dossier 4.1)
 *   V = (I + I_dark) * gain, clipped at full scale
 *   f = f_max * V / V_max + f_offset
 *
 * Recombination at low bias is not modelled: the dossier gives only a phenomenological
 * collection efficiency whose functional form is unverified.
 */
export function chamberReadout(config: ChamberConfig, flux: number, energy_eV: number,
                               options: ReadoutOptions = {}): ChamberReadout {
  if (!Number.isFinite(flux) || flux < 0) throw new RangeError('Incident flux must be zero or a positive number of photons per second.');
  const fullScale_V = options.fullScale_V ?? READOUT_DEFAULTS.fullScale_V;
  const linearLimit_V = options.linearLimit_V ?? READOUT_DEFAULTS.linearLimit_V;
  const v2fFullScale_Hz = options.v2fFullScale_Hz ?? READOUT_DEFAULTS.v2fFullScale_Hz;
  const v2fOffset_Hz = options.v2fOffset_Hz ?? READOUT_DEFAULTS.v2fOffset_Hz;
  if (!(fullScale_V > 0)) throw new RangeError('Amplifier full scale must be greater than zero volts.');

  const fractions = absorbedFraction(config.gas, config.length_cm, energy_eV, options.conditions);
  const absorbedRate = flux * fractions.absorbed;
  const signalCurrent_A = (absorbedRate * energy_eV * ELEMENTARY_CHARGE) / fractions.W_eV;
  const current_A = signalCurrent_A + config.dark_A;
  const rawVoltage_V = current_A * config.gain_V_per_A;
  const voltage_V = Math.min(rawVoltage_V, fullScale_V);
  return {
    absorbedFraction: fractions.absorbed,
    attenuatedFraction: fractions.attenuated,
    absorbedRate,
    transmittedFlux: flux * fractions.transmitted,
    W_eV: fractions.W_eV,
    signalCurrent_A,
    current_A,
    rawVoltage_V,
    voltage_V,
    saturated: rawVoltage_V > fullScale_V,
    nonlinear: rawVoltage_V > linearLimit_V,
    frequency_Hz: (v2fFullScale_Hz * voltage_V) / fullScale_V + v2fOffset_Hz,
  };
}

export interface ChamberNoiseOptions {
  /**
   * Amplifier output noise, V rms in a one-second integration, scaled as 1/sqrt(dwell).
   * Teaching value: real figures depend on the gain setting and the rise-time filter, and
   * the dossier records no verified number.
   */
  amplifierNoise_V?: number;
}

export const AMPLIFIER_NOISE_V = 1e-4;

export interface ChamberNoise {
  /** Counting statistics of the absorbed photons, as a voltage. */
  shot_V: number;
  /** Shot noise of the dark current over the same integration. */
  dark_V: number;
  /** Amplifier noise floor. */
  amplifier_V: number;
  /** Quadrature sum. */
  total_V: number;
  /** total_V divided by the signal voltage; Infinity with no signal. */
  relative: number;
  /** Absorbed photons in the dwell: the N that enters the IXS 2000 noise formulas. */
  absorbedPhotons: number;
}

/**
 * Noise of one reading over a dwell. Returns standard deviations only; `acquire.ts` draws
 * the random numbers, so this module stays deterministic.
 *
 * Shot noise of the signal is the Poisson statistics of the absorbed photons,
 * sigma_V / V = 1 / sqrt(N) with N = absorbedRate * dwell (IXS 2000 eq. 7 counts exactly
 * these absorbed photons, not the V2F counts). Dark-current shot noise uses
 * sqrt(2 e I df) with the bandwidth of a dwell-long integration, df = 1 / (2 * dwell).
 */
export function chamberNoise(readout: ChamberReadout, dwell_s: number, config: ChamberConfig,
                             options: ChamberNoiseOptions = {}): ChamberNoise {
  if (!(dwell_s > 0)) throw new RangeError('Dwell time must be greater than zero seconds.');
  const amplifierNoise_V = options.amplifierNoise_V ?? AMPLIFIER_NOISE_V;
  const absorbedPhotons = readout.absorbedRate * dwell_s;
  const signal_V = readout.signalCurrent_A * config.gain_V_per_A;
  const shot_V = absorbedPhotons > 0 ? signal_V / Math.sqrt(absorbedPhotons) : 0;
  const dark_V = config.gain_V_per_A * Math.sqrt((ELEMENTARY_CHARGE * Math.abs(config.dark_A)) / dwell_s);
  const amplifier_V = amplifierNoise_V / Math.sqrt(dwell_s);
  const total_V = Math.hypot(shot_V, dark_V, amplifier_V);
  return {
    shot_V,
    dark_V,
    amplifier_V,
    total_V,
    relative: signal_V > 0 ? total_V / signal_V : Infinity,
    absorbedPhotons,
  };
}

// ---------------------------------------------------------------- fill suggestion

export type ChamberRole = 'I0' | 'It' | 'Iref';

/**
 * Target photoabsorbed fractions per role (dossier 4.3, after Bunker, Introduction to XAFS,
 * Cambridge University Press 2010, ch. 3): I0 takes 10 to 20 % so the monitor has signal
 * without costing the sample much flux, and I_t (and the reference chamber behind the foil)
 * takes most of what is left, usually 50 to 90 %. Absorbing much more than that in I_t buys
 * little and leaves nothing for a reference chamber downstream.
 */
export const FILL_TARGETS: Record<ChamberRole, { min: number; aim: number; max: number }> = {
  I0: { min: 0.10, aim: 0.15, max: 0.20 },
  It: { min: 0.50, aim: 0.70, max: 0.90 },
  Iref: { min: 0.50, aim: 0.70, max: 0.90 },
};

/**
 * Candidate fills, ordered from the weakest absorber upward: He, then He/N2, N2, N2/Ar, Ar,
 * Ar/Kr, Kr. The order is also roughly the order of cost, so ties go to the earlier mix.
 */
function candidates(steps = 100): GasMix[] {
  const list: GasMix[] = [{ He: 1 }];
  const ladder: [GasName, GasName][] = [['He', 'N2'], ['N2', 'Ar'], ['Ar', 'Kr']];
  for (const [light, heavy] of ladder) {
    for (let step = 1; step <= steps; step++) {
      list.push(step === steps ? { [heavy]: 1 } : { [light]: (steps - step) / steps, [heavy]: step / steps });
    }
  }
  return list;
}

export interface GasSuggestion {
  mix: GasMix;
  /** Photoabsorbed fraction of the suggested fill at this energy and length. */
  absorbed: number;
  /** True when `absorbed` falls inside the role's target band. */
  inBand: boolean;
  target: { min: number; aim: number; max: number };
}

/**
 * Suggest a fill for one chamber. The search walks the candidate ladder, keeps the mix whose
 * photoabsorbed fraction is closest to the role's aim, and prefers the lighter mix when two
 * are equally close. Absorption is evaluated at the real energy for every candidate rather
 * than interpolated, because a gas edge inside the range (Kr K at 14.3 keV) breaks any
 * monotonic assumption.
 */
export function suggestGas(energy_eV: number, role: ChamberRole, length_cm: number,
                           conditions: GasConditions = {}): GasSuggestion {
  const target = FILL_TARGETS[role];
  let best: GasSuggestion | null = null;
  for (const mix of candidates()) {
    const absorbed = absorbedFraction(mix, length_cm, energy_eV, conditions).absorbed;
    const inBand = absorbed >= target.min && absorbed <= target.max;
    const distance = Math.abs(absorbed - target.aim);
    if (!best) {
      best = { mix, absorbed, inBand, target };
      continue;
    }
    const better = inBand !== best.inBand ? inBand : distance < Math.abs(best.absorbed - target.aim);
    if (better) best = { mix, absorbed, inBand, target };
  }
  return best as GasSuggestion;
}
