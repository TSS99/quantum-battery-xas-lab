/**
 * Silicon drift detector: solid angle, window and sensor efficiency, energy resolution,
 * dead time, and a synthetic multichannel-analyser spectrum.
 *
 * Units: eV, mm, micrometres, seconds, counts per second, steradian.
 *
 * Call `await loadOptics()` (emission lines) and `await loadXrayData()` (cross sections,
 * edges, fluorescence yields) once before any function here.
 *
 * What is tabulated and what is a teaching model is marked on every function. The teaching
 * pieces are the two peaking-time relations (resolution and dead time), the Compton peak
 * width, the pile-up amplitude and the filter re-emission fraction; each has a parameter
 * that overrides it.
 */

import { elementInfo, elementMuOverRho, massFractions, muOverRho, transmittance, type XrayEdge } from '../xraydata';
import { emissionLines } from './tables';
import type { Provenance, SampleConfig, SddConfig } from './types';

/** Electron rest energy, eV. CODATA 2022 value 0.51099895069 MeV. */
export const ELECTRON_REST_ENERGY_eV = 510_998.95;

/** Mn Ka1: the reference line for quoting silicon-detector resolution. */
export const MN_KA1_eV = 5898.75;

/** 2*sqrt(2*ln 2): Gaussian FWHM per standard deviation. */
const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.LN2);

// ---------------------------------------------------------------- geometry

export interface SolidAngle {
  /** Steradian for one element. */
  perElement_sr: number;
  /** Steradian summed over the elements. */
  total_sr: number;
  /** total_sr / (4 pi): the geometric collection fraction. */
  fraction: number;
  /** Radius of the equivalent circular element face, mm. */
  radius_mm: number;
}

/**
 * Exact on-axis solid angle of a circular detector face of radius r at distance d,
 * Omega = 2 pi (1 - d / sqrt(d^2 + r^2)) (dossier 6.4), summed over the elements.
 *
 * The element area is turned into an equivalent disc. Real multi-element heads sit off
 * axis, so the sum is an upper bound: each outer element subtends slightly less.
 */
export function solidAngle(config: Pick<SddConfig, 'elements' | 'distance_mm' | 'area_mm2'>): SolidAngle {
  const { elements, distance_mm, area_mm2 } = config;
  if (!Number.isInteger(elements) || elements < 1) throw new RangeError('A detector needs at least one element.');
  if (!(distance_mm > 0)) throw new RangeError('Detector distance must be greater than zero millimetres.');
  if (!(area_mm2 > 0)) throw new RangeError('Element area must be greater than zero square millimetres.');
  const radius_mm = Math.sqrt(area_mm2 / Math.PI);
  // 1 - d/sqrt(d^2+r^2) written as r^2 / (s (s + d)) with s = sqrt(d^2+r^2): the same
  // number, but without the cancellation that destroys it when r is much smaller than d.
  const slant_mm = Math.hypot(distance_mm, radius_mm);
  const perElement_sr = (2 * Math.PI * radius_mm ** 2) / (slant_mm * (slant_mm + distance_mm));
  const total_sr = perElement_sr * elements;
  return { perElement_sr, total_sr, fraction: total_sr / (4 * Math.PI), radius_mm };
}

// ---------------------------------------------------------------- efficiency

/**
 * Beryllium window and silicon sensor. The thicknesses are the usual ones for an SDD and
 * are parameters; the densities are the values XrayDB uses for these materials, and are the
 * ones the `detector` fixtures in src/data/twin/fixtures.json were generated with.
 */
export interface EfficiencyOptions {
  window_um?: number;
  sensor_um?: number;
}

export const BERYLLIUM_DENSITY = 1.848;
export const SILICON_DENSITY = 2.329;
export const EFFICIENCY_DEFAULTS = { window_um: 12.5, sensor_um: 450 } as const;

export interface Efficiency {
  /** Transmission of the Be window. */
  window: number;
  /** Fraction absorbed in the Si sensor. */
  sensor: number;
  /** window * sensor. */
  total: number;
}

/**
 * Detection efficiency at one photon energy: transmission through the window times
 * absorption in the sensor, both from the tabulated total attenuation of `xraydata.ts`.
 *
 * Using the total rather than the photoabsorption follows the fixture definition. Above a
 * few keV the scattering share in Be and Si is well under a percent, and a Compton event in
 * the sensor still deposits charge, only at the wrong energy.
 */
export function efficiency(energy_eV: number, options: EfficiencyOptions = {}): Efficiency {
  const window_um = options.window_um ?? EFFICIENCY_DEFAULTS.window_um;
  const sensor_um = options.sensor_um ?? EFFICIENCY_DEFAULTS.sensor_um;
  const window = transmittance('Be', BERYLLIUM_DENSITY, window_um, energy_eV);
  const sensor = 1 - transmittance('Si', SILICON_DENSITY, sensor_um, energy_eV);
  return { window, sensor, total: window * sensor };
}

// ---------------------------------------------------------------- energy resolution

/**
 * Silicon statistics and the electronics.
 *
 * `fanoFactor` and `pairEnergy_eV` are **not** verified values: the dossier (6.5) records a
 * literature range of about 0.11 to 0.12 for F and 3.6 to 3.7 eV for the mean pair-creation
 * energy (XrayDB's silicon ionisation potential is 3.68 eV). The defaults sit inside those
 * ranges and reproduce the dossier's computed Fano limit of 117 eV at Mn Ka1; treat them as
 * typical values to show, not as constants to test against.
 */
export interface ResponseOptions {
  fanoFactor?: number;
  pairEnergy_eV?: number;
  /** Measured FWHM at Mn Ka1. Overrides the peaking-time teaching relation below. */
  fwhmMnKa_eV?: number;
  /** Pulse-pair dead time, seconds. Overrides the peaking-time teaching relation below. */
  deadTime_s?: number;
}

export const RESPONSE_DEFAULTS = { fanoFactor: 0.115, pairEnergy_eV: 3.65 } as const;

/**
 * Teaching relation for the electronic noise against peaking time.
 *
 * Series and parallel noise give the classic U-shaped equivalent noise charge,
 * ENC(t) = ENC_min sqrt((t0/t + t/t0) / 2), minimal at t0. Only the anchor is sourced: the
 * dossier notes that the commonly quoted 125 to 140 eV at Mn Ka1 for an SDD at long peaking
 * time corresponds to about 5 to 9 rms electrons, so ENC_min is 5 electrons at a
 * 4 microsecond peaking time. The shape between peaking times is a teaching model. At the
 * 1 microsecond default of the twin profiles it gives about 133 eV at Mn Ka1.
 */
export const ENC_MIN_ELECTRONS = 5;
export const ENC_OPTIMUM_PEAKING_US = 4;

export function noiseChargeElectrons(peaking_us: number): number {
  if (!(peaking_us > 0)) throw new RangeError('Peaking time must be greater than zero microseconds.');
  const ratio = ENC_OPTIMUM_PEAKING_US / peaking_us;
  return ENC_MIN_ELECTRONS * Math.sqrt((ratio + 1 / ratio) / 2);
}

/** Fano-limited FWHM at one energy, 2.3548 sqrt(F * epsilon * E) (dossier 6.5). */
export function fanoFwhm(energy_eV: number, options: ResponseOptions = {}): number {
  const fanoFactor = options.fanoFactor ?? RESPONSE_DEFAULTS.fanoFactor;
  const pairEnergy_eV = options.pairEnergy_eV ?? RESPONSE_DEFAULTS.pairEnergy_eV;
  if (!(energy_eV > 0)) throw new RangeError('Photon energy must be greater than zero eV.');
  return FWHM_PER_SIGMA * Math.sqrt(fanoFactor * pairEnergy_eV * energy_eV);
}

/**
 * Electronic FWHM contribution, independent of photon energy.
 *
 * With `fwhmMnKa_eV` given, it is whatever is left once the Fano term at Mn Ka1 is removed
 * in quadrature, so `peakFwhm(MN_KA1_eV, ...)` returns exactly the value supplied.
 * Otherwise it comes from the peaking-time teaching relation,
 * FWHM_noise = 2.3548 * epsilon * ENC.
 */
export function noiseFwhm(peaking_us: number, options: ResponseOptions = {}): number {
  const pairEnergy_eV = options.pairEnergy_eV ?? RESPONSE_DEFAULTS.pairEnergy_eV;
  if (options.fwhmMnKa_eV !== undefined) {
    const fano = fanoFwhm(MN_KA1_eV, options);
    if (options.fwhmMnKa_eV < fano) {
      throw new RangeError(`A Mn Ka1 FWHM of ${options.fwhmMnKa_eV} eV is below the Fano limit of ${fano.toFixed(1)} eV for these silicon parameters.`);
    }
    return Math.sqrt(options.fwhmMnKa_eV ** 2 - fano ** 2);
  }
  return FWHM_PER_SIGMA * pairEnergy_eV * noiseChargeElectrons(peaking_us);
}

/** Peak FWHM at one energy: sqrt(FWHM_noise^2 + 2.3548^2 F epsilon E) (dossier 6.5). */
export function peakFwhm(energy_eV: number, peaking_us: number, options: ResponseOptions = {}): number {
  return Math.hypot(noiseFwhm(peaking_us, options), fanoFwhm(energy_eV, options));
}

// ---------------------------------------------------------------- dead time

/**
 * Teaching relation for the pulse-pair dead time: tau equals the peaking time.
 *
 * The dossier (6.6) is explicit that the relation between tau and the shaping time depends
 * on the processor and is unverified, so `ResponseOptions.deadTime_s` overrides this. The
 * one-to-one choice is consistent with the measurement it cites: at the 1 microsecond
 * default the paralyzable ceiling 1/(e tau) is 3.7e5 counts per second per element, and
 * Woicik et al., J. Synchrotron Rad. 17 (2010) 409, report more than 4e5 counts per second
 * per element from a four-element SDD.
 */
export function deadTime(peaking_us: number, options: ResponseOptions = {}): number {
  if (options.deadTime_s !== undefined) {
    if (!(options.deadTime_s > 0)) throw new RangeError('Dead time must be greater than zero seconds.');
    return options.deadTime_s;
  }
  if (!(peaking_us > 0)) throw new RangeError('Peaking time must be greater than zero microseconds.');
  return peaking_us * 1e-6;
}

export type DeadTimeModel = 'paralyzable' | 'non-paralyzable';

/** Output count rate for an input rate (Knoll, dead-time chapter; dossier 6.6). */
export function outputRate(icr: number, deadTime_s: number, model: DeadTimeModel = 'paralyzable'): number {
  if (!Number.isFinite(icr) || icr < 0) throw new RangeError('Input count rate must be zero or positive.');
  if (!(deadTime_s > 0)) throw new RangeError('Dead time must be greater than zero seconds.');
  return model === 'paralyzable' ? icr * Math.exp(-icr * deadTime_s) : icr / (1 + icr * deadTime_s);
}

/** Highest output rate a paralyzable processor can reach, 1 / (e tau), at ICR = 1 / tau. */
export function maximumOutputRate(deadTime_s: number): number {
  if (!(deadTime_s > 0)) throw new RangeError('Dead time must be greater than zero seconds.');
  return 1 / (Math.E * deadTime_s);
}

/** Principal branch of the Lambert W function on [-1/e, 0), by Halley iteration. */
function lambertW0(x: number): number {
  if (x < -1 / Math.E - 1e-12) throw new RangeError('Lambert W0 is undefined below -1/e.');
  if (x >= 0) return 0;
  let w = Math.max(-1, -1 + Math.sqrt(Math.max(0, 2 * (1 + Math.E * x))));
  for (let step = 0; step < 100; step++) {
    const expW = Math.exp(w);
    const f = w * expW - x;
    if (f === 0) break;  // exact, including the branch point w = -1 at x = -1/e
    const denominator = expW * (w + 1) - ((w + 2) * f) / (2 * w + 2);
    const delta = f / denominator;
    if (!Number.isFinite(delta)) break;
    w -= delta;
    if (Math.abs(delta) < 1e-16 * (1 + Math.abs(w))) break;
  }
  return w;
}

/**
 * Input count rate behind a measured output rate: the dead-time correction.
 *
 * The paralyzable inverse n = -W0(-m tau) / tau takes the low-rate branch, the one a
 * detector is meant to be used on. Past the ceiling the equation has no solution, and the
 * measurement is ambiguous anyway: two input rates give the same output ("fold-back").
 */
export function inputRate(ocr: number, deadTime_s: number, model: DeadTimeModel = 'paralyzable'): number {
  if (!Number.isFinite(ocr) || ocr < 0) throw new RangeError('Output count rate must be zero or positive.');
  if (!(deadTime_s > 0)) throw new RangeError('Dead time must be greater than zero seconds.');
  if (ocr === 0) return 0;
  if (model === 'non-paralyzable') {
    if (ocr * deadTime_s >= 1) throw new RangeError('A non-paralyzable output rate cannot reach 1 / tau.');
    return ocr / (1 - ocr * deadTime_s);
  }
  const ceiling = maximumOutputRate(deadTime_s);
  if (ocr > ceiling * (1 + 1e-12)) {
    throw new RangeError(`A paralyzable output rate cannot exceed 1/(e tau) = ${ceiling.toExponential(3)} counts per second.`);
  }
  return -lambertW0(-Math.min(ocr, ceiling) * deadTime_s) / deadTime_s;
}

export interface DeadTimeResult {
  icr: number;
  ocr: number;
  /** 1 - OCR / ICR: the fraction of events the processor lost. */
  deadFraction: number;
  deadTime_s: number;
  model: DeadTimeModel;
}

export function deadTimeLoss(icr: number, deadTime_s: number, model: DeadTimeModel = 'paralyzable'): DeadTimeResult {
  const ocr = outputRate(icr, deadTime_s, model);
  return { icr, ocr, deadFraction: icr > 0 ? 1 - ocr / icr : 0, deadTime_s, model };
}

// ---------------------------------------------------------------- scatter

/**
 * Compton-shifted energy, E' = E / (1 + (E / m_e c^2)(1 - cos Theta)) (dossier 6.7).
 * Theta is the scattering angle; 90 degrees is the usual detector placement.
 */
export function comptonEnergy(energy_eV: number, scatteringAngle_deg = 90): number {
  if (!(energy_eV > 0)) throw new RangeError('Photon energy must be greater than zero eV.');
  const shift = 1 - Math.cos((scatteringAngle_deg * Math.PI) / 180);
  return energy_eV / (1 + (energy_eV / ELECTRON_REST_ENERGY_eV) * shift);
}

// ---------------------------------------------------------------- line production

export interface ProductionLine {
  element: string;
  /** Edge whose vacancy produces this line. */
  edge: string;
  line: string;
  energy_eV: number;
  /**
   * Fluorescence production cross section of this line, cm^2 per gram of the material:
   * mass fraction * mu/rho(photo) * shell share * fluorescence yield * line share.
   */
  crossSection_cm2_g: number;
}

/**
 * Share of the photoabsorption that creates a vacancy in each shell, from the tabulated
 * jump ratios.
 *
 * Walking the edges below the photon energy from the most tightly bound outward, shell i
 * takes (1 - 1/r_i) of what is left after the deeper shells, which is the standard
 * jump-ratio cascade. It ignores Coster-Kronig transfer, which moves L1 vacancies to L2 and
 * L3 before they fluoresce, so ratios inside an L series are indicative only.
 */
function shellShares(symbol: string, energy_eV: number): Map<string, { share: number; edge: XrayEdge }> {
  const shares = new Map<string, { share: number; edge: XrayEdge }>();
  const open = elementInfo(symbol).edges
    .filter(edge => edge.energy_eV < energy_eV && edge.jumpRatio > 1)
    .sort((a, b) => b.energy_eV - a.energy_eV);
  let remaining = 1;
  for (const edge of open) {
    const share = remaining * (1 - 1 / edge.jumpRatio);
    shares.set(edge.edge, { share, edge });
    remaining -= share;
  }
  return shares;
}

/** Relative line intensities are tabulated per initial level; renormalise within each. */
function linesByLevel(symbol: string): Map<string, { name: string; energy_eV: number; share: number }[]> {
  const grouped = new Map<string, { name: string; energy_eV: number; share: number }[]>();
  let lines: readonly { name: string; energy_eV: number; intensity: number; initialLevel: string }[];
  try {
    lines = emissionLines(symbol);
  } catch {
    return grouped;  // H, He and anything else outside the tabulated Li to Cf range.
  }
  for (const line of lines) {
    const list = grouped.get(line.initialLevel) ?? [];
    list.push({ name: line.name, energy_eV: line.energy_eV, share: line.intensity });
    grouped.set(line.initialLevel, list);
  }
  for (const list of grouped.values()) {
    const sum = list.reduce((total, line) => total + line.share, 0);
    if (sum > 0) for (const line of list) line.share /= sum;
  }
  return grouped;
}

/**
 * Every fluorescence line a material emits under illumination at `energy_eV`, with its
 * production cross section per gram of material.
 *
 * Lines above the incident energy cannot be excited and are dropped, as are elements with
 * no tabulated emission lines. Only the photoabsorption enters, because fluorescence
 * follows a photoelectric vacancy.
 */
export function productionLines(formula: string, energy_eV: number): ProductionLine[] {
  const out: ProductionLine[] = [];
  for (const [symbol, weight] of Object.entries(massFractions(formula))) {
    const shares = shellShares(symbol, energy_eV);
    if (shares.size === 0) continue;
    const grouped = linesByLevel(symbol);
    if (grouped.size === 0) continue;
    const photo = elementMuOverRho(symbol, energy_eV).photo;
    for (const [level, lines] of grouped) {
      const shell = shares.get(level);
      if (!shell) continue;
      const production = weight * photo * shell.share * shell.edge.fluorescenceYield;
      if (production <= 0) continue;
      for (const line of lines) {
        if (line.energy_eV >= energy_eV) continue;
        out.push({
          element: symbol,
          edge: level,
          line: line.name,
          energy_eV: line.energy_eV,
          crossSection_cm2_g: production * line.share,
        });
      }
    }
  }
  return out.sort((a, b) => a.energy_eV - b.energy_eV);
}

// ---------------------------------------------------------------- MCA spectrum

export interface McaLine {
  label: string;
  energy_eV: number;
  /** Events per second reaching the processor from this line. */
  rate_cps: number;
  kind: 'fluorescence' | 'elastic' | 'compton' | 'filter-fluorescence' | 'pile-up';
  /** Gaussian FWHM used to render it. */
  fwhm_eV: number;
}

export interface McaOptions {
  channels?: number;
  channelWidth_eV?: number;
  response?: ResponseOptions;
  efficiency?: EfficiencyOptions;
  deadTimeModel?: DeadTimeModel;
  /** Scattering angle used for the Compton peak position. */
  scatteringAngle_deg?: number;
  /**
   * Extra width of the Compton peak as a fraction of its energy shift, added in quadrature
   * to the detector resolution. Teaching value: the real width is set by the Compton
   * profile of the sample's electrons, which is not tabulated here.
   */
  comptonBroadening?: number;
  /**
   * Pulse-pair resolving time for pile-up, seconds. Defaults to the dead time.
   */
  pileupResolving_s?: number;
  /**
   * Fraction of the filter's own fluorescence that reaches the detector when no Soller
   * slits are fitted. Teaching value: Stern and Heald, Rev. Sci. Instrum. 50 (1979) 1579,
   * describe the geometry, but the dossier (6.8) records no verified suppression factor.
   * Soller slits set it to zero.
   */
  filterReemission?: number;
}

export const MCA_DEFAULTS = {
  channels: 2048,
  channelWidth_eV: 10,
  scatteringAngle_deg: 90,
  comptonBroadening: 0.5,
  filterReemission: 0.5,
} as const;

/** Rates arriving at the detector that this module cannot derive from the shipped tables. */
export interface ScatterInput {
  /** Elastically scattered photons per second at the incident energy. */
  elastic_cps?: number;
  /** Compton scattered photons per second. */
  compton_cps?: number;
}

export interface McaSpectrum {
  /** Channel centre energies, eV. */
  energies_eV: Float64Array;
  /** Counts in the dwell, after filter, window, sensor and dead-time loss. */
  counts: Float64Array;
  channelWidth_eV: number;
  /** The discrete lines the spectrum was rendered from, before dead-time loss. */
  lines: McaLine[];
  /** Input and output rates summed over the elements, counts per second. */
  icr: number;
  ocr: number;
  /** Share of events lost to dead time; each element has its own processor and loses the same share. */
  deadFraction: number;
  deadTime_s: number;
  /** Counts inside the detector's configured region of interest. */
  roiCounts: number;
  /** Total counts recorded in the spectrum. */
  totalCounts: number;
  provenance: Provenance[];
}

/** Transmission of the Z-1 filter at one energy; 1 when no filter is fitted. */
export function filterTransmission(config: Pick<SddConfig, 'filter'>, energy_eV: number): number {
  const filter = config.filter;
  if (!filter) return 1;
  return transmittance(filter.formula, filter.density, filter.thickness_um, energy_eV);
}

export interface McaInput {
  sdd: SddConfig;
  sample: Pick<SampleConfig, 'formula'>;
  energy_eV: number;
  /**
   * Fluorescence rate scale, counts per second per (cm^2/g) of production cross section.
   * The caller folds incident flux, the geometric fraction and the sample's thickness and
   * self-absorption term (sample.ts, dossier 6.1) into this one number; in the thin limit
   * it is flux * (Omega / 4 pi) * rho * d / sin(phi).
   */
  fluorescenceScale: number;
  dwell_s: number;
  scatter?: ScatterInput;
}

/**
 * Synthesise a multichannel-analyser spectrum.
 *
 * Everything the detector sees is first assembled as a list of discrete lines with a rate
 * in counts per second: the sample's fluorescence (from `productionLines`, scaled by the
 * caller's `fluorescenceScale`), the elastic and Compton peaks if the caller supplies their
 * rates, the filter's own fluorescence when no Soller slits are fitted, and pile-up sums.
 * Each line is attenuated by the filter, the window and the sensor, broadened with the peak
 * FWHM at its own energy, and binned by integrating the Gaussian over each channel.
 *
 * The elastic and Compton rates are inputs rather than table lookups on purpose: separating
 * them needs the coherent and incoherent cross sections, and `src/lib/xraydata.ts` ships
 * only the photoabsorption and the total. Silicon escape peaks are not modelled either; no
 * citable escape probability was available.
 */
export function mcaSpectrum(input: McaInput, options: McaOptions = {}): McaSpectrum {
  const { sdd, sample, energy_eV, fluorescenceScale, dwell_s } = input;
  if (!(dwell_s > 0)) throw new RangeError('Dwell time must be greater than zero seconds.');
  if (!Number.isFinite(fluorescenceScale) || fluorescenceScale < 0) {
    throw new RangeError('Fluorescence scale must be zero or positive.');
  }
  const channels = options.channels ?? MCA_DEFAULTS.channels;
  const channelWidth_eV = options.channelWidth_eV ?? MCA_DEFAULTS.channelWidth_eV;
  const response = options.response ?? {};
  const efficiencyOptions = options.efficiency ?? {};
  const scatteringAngle_deg = options.scatteringAngle_deg ?? MCA_DEFAULTS.scatteringAngle_deg;
  const comptonBroadening = options.comptonBroadening ?? MCA_DEFAULTS.comptonBroadening;
  const filterReemission = sdd.soller ? 0 : options.filterReemission ?? MCA_DEFAULTS.filterReemission;
  const deadTime_s = deadTime(sdd.peaking_us, response);
  const resolving_s = options.pileupResolving_s ?? deadTime_s;

  const width = (lineEnergy: number) => peakFwhm(lineEnergy, sdd.peaking_us, response);

  // Everything leaving the sample, before the filter and the detector.
  interface Arrival { label: string; energy_eV: number; rate_cps: number; kind: McaLine['kind']; fwhm_eV: number }
  const arrivals: Arrival[] = [];
  for (const line of productionLines(sample.formula, energy_eV)) {
    const rate_cps = fluorescenceScale * line.crossSection_cm2_g;
    if (rate_cps > 0) {
      arrivals.push({
        label: `${line.element} ${line.line}`, energy_eV: line.energy_eV,
        rate_cps, kind: 'fluorescence', fwhm_eV: width(line.energy_eV),
      });
    }
  }
  const elastic_cps = input.scatter?.elastic_cps ?? 0;
  const compton_cps = input.scatter?.compton_cps ?? 0;
  if (elastic_cps > 0) {
    arrivals.push({ label: 'Elastic', energy_eV, rate_cps: elastic_cps, kind: 'elastic', fwhm_eV: width(energy_eV) });
  }
  if (compton_cps > 0) {
    const shifted = comptonEnergy(energy_eV, scatteringAngle_deg);
    arrivals.push({
      label: 'Compton', energy_eV: shifted, rate_cps: compton_cps, kind: 'compton',
      fwhm_eV: Math.hypot(width(shifted), comptonBroadening * (energy_eV - shifted)),
    });
  }

  const lines: McaLine[] = arrivals.map(arrival => ({
    label: arrival.label,
    energy_eV: arrival.energy_eV,
    kind: arrival.kind,
    fwhm_eV: arrival.fwhm_eV,
    rate_cps: arrival.rate_cps * filterTransmission(sdd, arrival.energy_eV)
      * efficiency(arrival.energy_eV, efficiencyOptions).total,
  }));

  // The filter absorbs part of every arriving line and re-emits its own fluorescence
  // isotropically. Soller slits make the detector blind to the filter body, which is what
  // the assembly is for, so filterReemission is then zero and these lines disappear.
  if (sdd.filter && filterReemission > 0) {
    const filterLines = new Map<string, { energy_eV: number; rate_cps: number }>();
    for (const arrival of arrivals) {
      const absorbed = arrival.rate_cps * (1 - filterTransmission(sdd, arrival.energy_eV));
      if (absorbed <= 0) continue;
      const filterPhoto = muOverRho(sdd.filter.formula, arrival.energy_eV).photo;
      if (!(filterPhoto > 0)) continue;
      for (const line of productionLines(sdd.filter.formula, arrival.energy_eV)) {
        // crossSection_cm2_g over the filter's own photoabsorption is the number of these
        // photons emitted per photon absorbed, so the filter thickness cancels.
        const emitted = absorbed * (line.crossSection_cm2_g / filterPhoto);
        const key = `${line.element} ${line.line}`;
        const previous = filterLines.get(key);
        filterLines.set(key, { energy_eV: line.energy_eV, rate_cps: (previous?.rate_cps ?? 0) + emitted });
      }
    }
    for (const [label, line] of filterLines) {
      const rate_cps = line.rate_cps * filterReemission * efficiency(line.energy_eV, efficiencyOptions).total;
      if (rate_cps > 0) {
        lines.push({
          label: `Filter ${label}`, energy_eV: line.energy_eV, rate_cps,
          kind: 'filter-fluorescence', fwhm_eV: width(line.energy_eV),
        });
      }
    }
  }

  // Pile-up at teaching level: the first-order rate of unordered pairs arriving inside the
  // resolving time (dossier 6.9), so the whole pile-up rate is 0.5 * ICR^2 * tau. There is
  // no pulse shape and no rejection logic here, which is where a real processor differs
  // most. Being first order, it is only meaningful while ICR * tau stays well below one;
  // past that it runs away and the detector is being misused anyway. Pulses pile up only
  // within one element, so each element contributes the pair rate of its own share of the
  // rates, which divides the summed pile-up by the number of elements.
  const primary = lines.filter(line => line.rate_cps > 0);
  for (let i = 0; i < primary.length; i++) {
    for (let j = i; j < primary.length; j++) {
      const rate_cps = (i === j ? 0.5 : 1) * primary[i].rate_cps * primary[j].rate_cps * resolving_s / sdd.elements;
      const sum_eV = primary[i].energy_eV + primary[j].energy_eV;
      if (rate_cps <= 0 || sum_eV >= channels * channelWidth_eV) continue;
      lines.push({
        label: `${primary[i].label} + ${primary[j].label}`, energy_eV: sum_eV, rate_cps,
        kind: 'pile-up', fwhm_eV: Math.hypot(primary[i].fwhm_eV, primary[j].fwhm_eV),
      });
    }
  }

  // Rates are summed over the elements; each element has its own pulse processor, so dead time
  // acts on one element's share and the live fraction is the same for every element.
  const icr = lines.reduce((sum, line) => sum + line.rate_cps, 0);
  const loss = deadTimeLoss(icr / sdd.elements, deadTime_s, options.deadTimeModel ?? 'paralyzable');
  const ocr = loss.ocr * sdd.elements;
  const live = icr > 0 ? ocr / icr : 1;

  const energies_eV = new Float64Array(channels);
  const counts = new Float64Array(channels);
  for (let channel = 0; channel < channels; channel++) energies_eV[channel] = (channel + 0.5) * channelWidth_eV;
  for (const line of lines) {
    const sigma = line.fwhm_eV / FWHM_PER_SIGMA;
    const area = line.rate_cps * live * dwell_s;
    const first = Math.max(0, Math.floor((line.energy_eV - 6 * sigma) / channelWidth_eV));
    const last = Math.min(channels - 1, Math.ceil((line.energy_eV + 6 * sigma) / channelWidth_eV));
    for (let channel = first; channel <= last; channel++) {
      // Integral of the Gaussian over the channel, so a peak narrower than one channel
      // keeps its area instead of falling between two bins.
      const low = (channel * channelWidth_eV - line.energy_eV) / (sigma * Math.SQRT2);
      const high = ((channel + 1) * channelWidth_eV - line.energy_eV) / (sigma * Math.SQRT2);
      counts[channel] += area * 0.5 * (erf(high) - erf(low));
    }
  }

  let roi = 0;
  let totalCounts = 0;
  for (let channel = 0; channel < channels; channel++) {
    totalCounts += counts[channel];
    if (energies_eV[channel] >= sdd.roi_eV[0] && energies_eV[channel] <= sdd.roi_eV[1]) roi += counts[channel];
  }

  return {
    energies_eV,
    counts,
    channelWidth_eV,
    lines,
    icr,
    ocr,
    deadFraction: loss.deadFraction,
    deadTime_s,
    roiCounts: roi,
    totalCounts,
    provenance: ['tabulated', 'teaching-model'],
  };
}

/** Counts inside an energy window of an already computed spectrum. */
export function roiCounts(spectrum: McaSpectrum, roi_eV: [number, number]): number {
  let total = 0;
  for (let channel = 0; channel < spectrum.energies_eV.length; channel++) {
    const energy = spectrum.energies_eV[channel];
    if (energy >= roi_eV[0] && energy <= roi_eV[1]) total += spectrum.counts[channel];
  }
  return total;
}

/** Abramowitz and Stegun 7.1.26: |error| below 1.5e-7, far under the counting noise. */
function erf(x: number): number {
  const sign = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const series = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - series * Math.exp(-x * x));
}
