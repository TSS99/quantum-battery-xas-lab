/**
 * Sample and environment: mu(E) assembly, transmission with sample imperfections,
 * fluorescence with self absorption, and total electron yield.
 *
 * Units: eV, cm, um, g/cm^3, degrees. mu values are linear attenuation coefficients in
 * 1/cm. Intensities are returned as ratios to the flux on the sample, so the acquisition
 * step can multiply them by I0 and combine harmonics at nE.
 *
 * Call `await loadXrayData()` once before any function here, and `await loadOptics()`
 * before the fluorescence helpers as well: they need the emission-line table.
 *
 * Equations and their sources are in the physics dossier:
 *   - transmission distortion models: dossier 5.2, reference script `s05_transmission.py`;
 *   - finite-thickness fluorescence: dossier 6.1, after C. H. Booth and F. Bridges,
 *     Physica Scripta T115 (2005) 202, eq. 1; reference script `s06_fluo.py`;
 *   - electron yield: dossier 7, a teaching-level escape-depth model.
 */

import {
  elementInfo, elementMuOverRhoSide, massFractions, mu, muAcrossEdge, muOverRho, parseFormula, xrayDataInfo,
  type Composition, type XrayEdge,
} from '../xraydata';
import { defaultEdgeWidth, defaultNearEdgeFeatures, type NearEdgeFeatures } from '../xas-general';
import { emissionLines } from './tables';
import type { EnvironmentConfig, Provenance, SampleConfig } from './types';

/** k^2 in inverse square angstrom per eV above the edge, as in src/lib/xas-general.ts. */
const K_PER_EV = 0.2624684;

const DEG = Math.PI / 180;

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be greater than zero.`);
  return value;
}

function requireFraction(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${label} must be between 0 and 1.`);
  return value;
}

/** Angle from the sample surface, in radians, for an incidence or exit angle in degrees. */
function surfaceAngle(degrees: number, label: string): number {
  if (!Number.isFinite(degrees) || degrees <= 0 || degrees > 90) {
    throw new RangeError(`${label} must be greater than 0 and at most 90 degrees from the sample surface.`);
  }
  return degrees * DEG;
}

function findEdge(symbol: string, edge: string): XrayEdge {
  const label = edge.trim().toUpperCase();
  const found = elementInfo(symbol).edges.find(item => item.edge.toUpperCase() === label);
  if (!found) throw new Error(`${symbol} has no "${edge}" edge.`);
  return found;
}

// ---------------------------------------------------------------- fine structure

/**
 * Shape factor multiplying the tabulated edge jump of the chosen edge.
 *
 * Convention: the factor is 0 well below the edge, where that core level contributes no
 * absorption at all, and 1 well above it, so `jump(E) * factor(E)` reproduces the tabulated
 * atomic edge. In the EXAFS region the factor is `1 + chi(E)`, which is why a flat 1 means
 * "no fine structure". `sharpEdge` is the bare tabulated step; the default is the teaching
 * model below; T3a plugs in a FEFF path sum and T1c a XANES library spectrum.
 */
export type FineStructure = (energy_eV: number) => number;

export interface FineStructureModel {
  factor: FineStructure;
  provenance: Provenance;
  /** Short label for the provenance badge. */
  label: string;
}

/** The tabulated atomic edge with no fine structure: a step at the tabulated edge energy. */
export function sharpEdge(edgeEnergy_eV: number): FineStructureModel {
  return {
    factor: (energy_eV: number) => (energy_eV >= edgeEnergy_eV ? 1 : 0),
    provenance: 'tabulated',
    label: 'tabulated atomic edge, no fine structure',
  };
}

/**
 * The labelled teaching model of `src/lib/xas-general.ts`: an arctangent edge onset of the
 * core-hole plus resolution width, a Gaussian pre-edge peak, a Gaussian white line and one
 * damped sine in photoelectron k. The shapes are illustrative, not predictions for the
 * material; their default sizes scale with the edge energy.
 */
export function teachingFineStructure(
  edgeEnergy_eV: number,
  overrides: Partial<NearEdgeFeatures> & { edgeWidth_eV?: number } = {},
): FineStructureModel {
  requirePositive(edgeEnergy_eV, 'Edge energy');
  const features = { ...defaultNearEdgeFeatures(edgeEnergy_eV), ...overrides };
  const width = overrides.edgeWidth_eV ?? defaultEdgeWidth(edgeEnergy_eV);
  const gaussian = (x: number, centre: number, sigma: number) => Math.exp(-0.5 * ((x - centre) / sigma) ** 2);
  return {
    factor: (energy_eV: number) => {
      const step = 0.5 + Math.atan((energy_eV - edgeEnergy_eV) / width) / Math.PI;
      let shape = step;
      shape += features.preEdgeHeight * gaussian(energy_eV, edgeEnergy_eV - features.preEdgeOffset_eV, features.preEdgeWidth_eV);
      shape += features.whiteLineHeight * gaussian(energy_eV, edgeEnergy_eV + features.whiteLineOffset_eV, features.whiteLineWidth_eV);
      if (energy_eV > edgeEnergy_eV) {
        const k = Math.sqrt(K_PER_EV * (energy_eV - edgeEnergy_eV));
        shape += step * features.oscillation * Math.sin(2 * k * features.distance_A) * Math.exp(-2 * features.sigma2_A2 * k * k);
      }
      return shape;
    },
    provenance: 'teaching-model',
    label: 'teaching model: parametric near-edge shapes',
  };
}

// ---------------------------------------------------------------- mu components

export interface MuOptions {
  /** Default: `teachingFineStructure` for this sample's edge. */
  fineStructure?: FineStructureModel;
}

export interface MuComponents {
  energy_eV: number;
  /** Tabulated energy of the chosen absorber edge. */
  edgeEnergy_eV: number;
  /** Tabulated total mu of the sample, with its sharp atomic edge, 1/cm. */
  tabulated_cm_inv: number;
  /** Everything except the chosen edge: other elements, other edges and scattering, 1/cm. */
  rest_cm_inv: number;
  /** The chosen edge's jump continued to this energy, with no fine structure, 1/cm. */
  sharpStep_cm_inv: number;
  /** Value of the fine-structure factor at this energy. */
  fineStructureFactor: number;
  /** mu_a(E): the chosen edge's contribution including fine structure, 1/cm. */
  absorber_cm_inv: number;
  /** rest + absorber: the mu the twin's detectors see, 1/cm. */
  total_cm_inv: number;
  provenance: Provenance[];
  fineStructureLabel: string;
}

/**
 * Split mu(E) of the sample into the chosen absorber edge and everything else.
 *
 * The background and the edge jump are the tabulated isolated-atom cross sections of
 * `src/lib/xraydata.ts` (Elam, Ravel and Sieber via XrayDB). The jump of the chosen edge at
 * energy E is the photoabsorption of the above-edge segment minus the below-edge segment
 * continued upward, both straight lines in log-log, taken for the absorber alone and
 * weighted by its mass fraction. Removing that jump from the tabulated total leaves
 * `rest_cm_inv`, which is smooth across the edge. The fine-structure factor then multiplies
 * the jump, so with `sharpEdge` the total is exactly the tabulated mu.
 */
export function muComponents(sample: SampleConfig, energy_eV: number, options: MuOptions = {}): MuComponents {
  // The formula string, not a parsed copy, so xraydata's per-formula cache applies.
  const composition = sample.formula;
  const fractions = massFractions(composition);
  if (!(sample.absorber in fractions)) {
    throw new Error(`Absorber "${sample.absorber}" is not in the formula "${sample.formula}".`);
  }
  requirePositive(sample.density, 'Sample density');
  const edge = findEdge(sample.absorber, sample.edge);
  const model = options.fineStructure ?? teachingFineStructure(edge.energy_eV);

  const tabulated_cm_inv = mu(composition, sample.density, energy_eV).total;
  const above = elementMuOverRhoSide(sample.absorber, edge.edge, energy_eV, 'above').photo;
  const below = elementMuOverRhoSide(sample.absorber, edge.edge, energy_eV, 'below').photo;
  const sharpStep_cm_inv = Math.max(0, (above - below) * fractions[sample.absorber] * sample.density);
  // The table's own jump can sit a fraction of an eV from the edge record (Fe K: just above
  // 7112.0 eV, Cu K: just below 8979.0 eV), so the side is read off the tabulated value itself:
  // below the jump it is exactly the below-edge segment.
  const below_cm_inv = muAcrossEdge(composition, sample.density, sample.absorber, edge.edge, energy_eV, 'below');
  const tabulatedAbove = Math.abs(tabulated_cm_inv - below_cm_inv) > 1e-12 * tabulated_cm_inv;
  const rest_cm_inv = tabulated_cm_inv - (tabulatedAbove ? sharpStep_cm_inv : 0);

  const fineStructureFactor = model.factor(energy_eV);
  if (!Number.isFinite(fineStructureFactor)) throw new Error('The fine-structure factor must be a finite number.');
  const absorber_cm_inv = Math.max(0, sharpStep_cm_inv * fineStructureFactor);

  return {
    energy_eV,
    edgeEnergy_eV: edge.energy_eV,
    tabulated_cm_inv,
    rest_cm_inv,
    sharpStep_cm_inv,
    fineStructureFactor,
    absorber_cm_inv,
    total_cm_inv: rest_cm_inv + absorber_cm_inv,
    provenance: model.provenance === 'tabulated' ? ['tabulated'] : ['tabulated', model.provenance],
    fineStructureLabel: model.label,
  };
}

// ---------------------------------------------------------------- environment

/**
 * Transmission of the environment windows at one energy.
 *
 * Every entry in `environment.windows` is one layer the beam crosses: a cell window, a
 * cryostat shroud, the electrolyte path of a liquid cell. The list is the whole path, so
 * `transmission` applies the product once to the transmitted beam, and `fluorescence`
 * applies it at the incident energy on the way in and at the line energy on the way out,
 * because a cell has windows on both sides.
 */
export function windowTransmission(environment: Pick<EnvironmentConfig, 'windows'>, energy_eV: number): number {
  let value = 1;
  for (const window of environment.windows) {
    requirePositive(window.density, `Window density of ${window.formula}`);
    if (!Number.isFinite(window.thickness_um) || window.thickness_um < 0) {
      throw new RangeError(`Window thickness of ${window.formula} must be zero or positive.`);
    }
    value *= Math.exp(-mu(window.formula, window.density, energy_eV).total * window.thickness_um * 1e-4);
  }
  return value;
}

// ---------------------------------------------------------------- Gauss-Hermite nodes

const hermiteCache = new Map<number, { nodes: Float64Array; weights: Float64Array }>();

/**
 * Gauss-Hermite nodes and weights for the integral of exp(-x^2) f(x) over the whole line,
 * so the weights sum to sqrt(pi). Newton iteration on the Hermite recurrence with the
 * standard starting guesses (Press, Teukolsky, Vetterling and Flannery, Numerical Recipes,
 * routine `gauher`).
 */
export function gaussHermite(order: number): { nodes: Float64Array; weights: Float64Array } {
  if (!Number.isInteger(order) || order < 2 || order > 200) {
    throw new RangeError('Gauss-Hermite order must be an integer between 2 and 200.');
  }
  const cached = hermiteCache.get(order);
  if (cached) return cached;
  const nodes = new Float64Array(order);
  const weights = new Float64Array(order);
  const half = (order + 1) >> 1;
  const pim4 = Math.PI ** -0.25;
  let z = 0;
  for (let i = 0; i < half; i++) {
    if (i === 0) z = Math.sqrt(2 * order + 1) - 1.85575 * (2 * order + 1) ** (-1 / 6);
    else if (i === 1) z -= (1.14 * order ** 0.426) / z;
    else if (i === 2) z = 1.86 * z - 0.86 * nodes[0];
    else if (i === 3) z = 1.91 * z - 0.91 * nodes[1];
    else z = 2 * z - nodes[i - 2];
    let pp = 0;
    for (let iteration = 0; iteration < 30; iteration++) {
      let p1 = pim4, p2 = 0;
      for (let j = 1; j <= order; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = z * Math.sqrt(2 / j) * p2 - Math.sqrt((j - 1) / j) * p3;
      }
      pp = Math.sqrt(2 * order) * p2;
      const previous = z;
      z = previous - p1 / pp;
      if (Math.abs(z - previous) <= 1e-14 * Math.abs(z)) break;
    }
    nodes[i] = z;
    nodes[order - 1 - i] = -z;
    weights[i] = 2 / (pp * pp);
    weights[order - 1 - i] = weights[i];
  }
  const result = { nodes, weights };
  hermiteCache.set(order, result);
  return result;
}

// ---------------------------------------------------------------- transmission

/**
 * Gauss-Hermite order used for the thickness average. 20 nodes reproduce the analytic
 * Gaussian result to better than 1e-10 for every spread the controls allow.
 */
export const THICKNESS_QUADRATURE_ORDER = 20;

export interface TransmissionOptions extends MuOptions {
  /** Number of Gauss-Hermite nodes for the thickness average. Default 20. */
  quadratureOrder?: number;
}

export interface TransmissionResult {
  energy_eV: number;
  components: MuComponents;
  /** mu_total * mean thickness: the optical depth of a uniform, hole-free sample. */
  muX: number;
  /** Mean exp(-mu x) over the sample, with particle size, thickness spread and pinholes. */
  sampleTransmission: number;
  /** Transmission of the environment windows at this energy. */
  windowTransmission: number;
  /** sampleTransmission * windowTransmission: what the I_t chamber sees, per unit I0. */
  transmission: number;
  /** -ln(sampleTransmission): the mu*x a transmission experiment reports. */
  apparentMuX: number;
  /** d(apparentMuX)/d(muX): the factor by which fine-structure amplitudes are damped here. */
  amplitudeFactor: number;
  /** Sample temperature, carried through for the EXAFS damping of T3a. */
  temperature_K: number;
  provenance: Provenance[];
}

/**
 * Mean transmission of the sample at one total mu, with the three imperfection models of
 * dossier 5.2 composed through the effective optical depth.
 *
 * 1. Particle size (dossier 5.2 item 5, after K. Lu and E. A. Stern, "Size effect of
 *    powdered sample on EXAFS amplitude", Nucl. Instrum. Methods 212 (1983) 475): grains of
 *    thickness t are placed at random, so their number in a column is Poisson with mean
 *    n = x / t and the mean transmission of an otherwise uniform sample of the same mass is
 *    exp[-n (1 - exp(-mu t))]. This is a worst case, since packed grains fluctuate less.
 *    Grains well below one absorption length 1/mu cost almost nothing; Lu and Stern
 *    recommend particles well below 400 mesh, about 37 um.
 * 2. Thickness spread: the thickness is x * u with u Gaussian of mean 1 and relative
 *    standard deviation `thicknessSpread`, averaged over u by Gauss-Hermite quadrature.
 *    Nodes with u <= 0 are dropped and the weights renormalised, which only matters above
 *    about 25 % spread, where a Gaussian thickness is no longer a sensible description.
 *    Without that truncation this is the analytic exp(-mu x + mu^2 sigma_x^2 / 2) of
 *    dossier 5.2 item 2.
 * 3. Pinholes: a fraction a of the beam misses the sample, T = (1 - a) <exp(-mu x)> + a
 *    (dossier 5.2 item 1).
 *
 * Harmonic contamination (dossier 5.2 item 4) is deliberately not here: it needs the mono
 * harmonic fractions and the chamber efficiencies at nE, so `acquire.ts` combines the
 * transmissions this function returns at E and at nE.
 */
function meanTransmission(muTotal_cm_inv: number, sample: SampleConfig, order: number): number {
  const thickness_cm = requirePositive(sample.thickness_um, 'Sample thickness') * 1e-4;
  const pinholes = requireFraction(sample.pinholeFraction, 'Pinhole fraction');
  const spread = sample.thicknessSpread;
  if (!Number.isFinite(spread) || spread < 0) throw new RangeError('Thickness spread must be zero or positive.');
  const grain_cm = sample.particle_um * 1e-4;
  if (!Number.isFinite(grain_cm) || grain_cm < 0) throw new RangeError('Particle size must be zero or positive.');

  let opticalDepth = muTotal_cm_inv * thickness_cm;
  if (grain_cm > 0) {
    opticalDepth = (thickness_cm / grain_cm) * -Math.expm1(-muTotal_cm_inv * grain_cm);
  }

  let averaged: number;
  if (spread === 0) {
    averaged = Math.exp(-opticalDepth);
  } else {
    const { nodes, weights } = gaussHermite(order);
    let sum = 0, norm = 0;
    for (let i = 0; i < nodes.length; i++) {
      const u = 1 + Math.SQRT2 * spread * nodes[i];
      if (u <= 0) continue;
      sum += weights[i] * Math.exp(-opticalDepth * u);
      norm += weights[i];
    }
    averaged = norm > 0 ? sum / norm : 0;
  }
  return (1 - pinholes) * averaged + pinholes;
}

/** Transmission of the sample and the environment windows at one energy. */
export function transmission(sample: SampleConfig, environment: EnvironmentConfig, energy_eV: number,
                             options: TransmissionOptions = {}): TransmissionResult {
  const order = options.quadratureOrder ?? THICKNESS_QUADRATURE_ORDER;
  const components = muComponents(sample, energy_eV, options);
  const muTotal = components.total_cm_inv;
  const sampleTransmission = meanTransmission(muTotal, sample, order);
  const windows = windowTransmission(environment, energy_eV);

  // d(-ln T)/d(mu x) from a central difference in mu: every imperfection model is smooth.
  const step = Math.max(muTotal * 1e-5, 1e-9);
  const high = -Math.log(meanTransmission(muTotal + step, sample, order));
  const low = -Math.log(meanTransmission(muTotal - step, sample, order));
  const thickness_cm = sample.thickness_um * 1e-4;

  return {
    energy_eV,
    components,
    muX: muTotal * thickness_cm,
    sampleTransmission,
    windowTransmission: windows,
    transmission: sampleTransmission * windows,
    apparentMuX: -Math.log(sampleTransmission),
    amplitudeFactor: (high - low) / (2 * step * thickness_cm),
    temperature_K: environment.temperature_K,
    provenance: components.provenance,
  };
}

// ---------------------------------------------------------------- emission line

export interface FluorescenceLine {
  element: string;
  edge: string;
  /** Line group, for example 'Ka', 'Kb', 'La'. */
  group: string;
  /** Intensity-weighted mean energy of the lines in the group. */
  energy_eV: number;
  /** Share of the vacancies in this shell that decay through this group. */
  lineFraction: number;
  /** Fluorescence yield of the shell, from the tabulated edge record. */
  fluorescenceYield: number;
  lines: { name: string; energy_eV: number; share: number }[];
  provenance: Provenance;
}

/**
 * The detected emission group of one edge: its mean energy, its share of the shell's
 * vacancies and the shell's fluorescence yield.
 *
 * Relative line intensities in `optics.json` are tabulated per initial level, so they are
 * renormalised within the level before the group's share is summed. The default group is
 * the strongest one, Ka for a K edge and La for an L3 edge. This reproduces the triple
 * XrayDB's `fluor_yield(element, edge, line, E)` returns (yield, mean line energy,
 * probability) to the precision of the stored intensities; dossier 6.1 lists its values.
 */
export function fluorescenceLine(symbol: string, edge: string, group?: string): FluorescenceLine {
  const record = findEdge(symbol, edge);
  const level = record.edge;
  const own = emissionLines(symbol).filter(line => line.initialLevel === level);
  if (own.length === 0) throw new Error(`No tabulated emission lines decay into the ${symbol} ${level} level.`);
  const total = own.reduce((sum, line) => sum + line.intensity, 0);
  const groups = new Map<string, { name: string; energy_eV: number; share: number }[]>();
  for (const line of own) {
    const key = line.name.slice(0, 2);
    const list = groups.get(key) ?? [];
    list.push({ name: line.name, energy_eV: line.energy_eV, share: line.intensity / total });
    groups.set(key, list);
  }
  const share = (lines: { share: number }[]) => lines.reduce((sum, line) => sum + line.share, 0);
  let key = group?.trim();
  if (key === undefined) {
    let best = '';
    let bestShare = -1;
    for (const [candidate, lines] of groups) {
      if (share(lines) > bestShare) { best = candidate; bestShare = share(lines); }
    }
    key = best;
  }
  const lines = groups.get(key);
  if (!lines) {
    throw new Error(`${symbol} has no "${key}" lines from the ${level} level; tabulated groups: ${[...groups.keys()].join(', ')}.`);
  }
  const lineFraction = share(lines);
  return {
    element: symbol,
    edge: level,
    group: key,
    energy_eV: lines.reduce((sum, line) => sum + line.share * line.energy_eV, 0) / lineFraction,
    lineFraction,
    fluorescenceYield: record.fluorescenceYield,
    lines,
    provenance: 'tabulated',
  };
}

// ---------------------------------------------------------------- fluorescence

export interface FluorescenceMuInput {
  /** mu_a(E): absorption of the probed edge alone, 1/cm. */
  muAbsorber_cm_inv: number;
  /** mu_T(E): total absorption of the sample at the incident energy, 1/cm. */
  muTotalIn_cm_inv: number;
  /** mu_T(E_f): total absorption at the emission-line energy, 1/cm. */
  muTotalOut_cm_inv: number;
  thickness_um: number;
  /** Angle between the incident beam and the sample surface. */
  incidence_deg: number;
  /** Angle between the sample surface and the detector axis. */
  exit_deg: number;
  /**
   * Everything in front of the depth integral: (Omega / 4pi) * epsilon * omega * p_line,
   * with epsilon the detector efficiency including filter, air and window transmission at
   * the line energy. `fluorescence` assembles it from the tabulated yield and line share.
   */
  prefactor: number;
}

export interface FluorescenceResult {
  /** I_f / I_0 at the sample: counts per second per photon per second on the sample. */
  ratio: number;
  /** sin(incidence) / sin(exit): the g of Booth and Bridges. */
  geometryRatio: number;
  /** mu_T(E) + g mu_T(E_f): the alpha of the self-absorption relation, 1/cm. */
  alpha_cm_inv: number;
  /** The exponent in the bracket: (mu_T(E)/sin phi + mu_T(E_f)/sin psi) d. */
  depthIntegralExponent: number;
  /** Ratio in the thin limit, where that exponent is small. */
  thinLimit: number;
  /** Ratio in the thick limit, where that exponent is large. */
  thickLimit: number;
  /** 1 - mu_a / alpha: the first-order damping of the fine structure (dossier 6.2). */
  dampingFactor: number;
  prefactor: number;
}

/**
 * Fluorescence intensity for a slab of finite thickness (dossier 6.1, Booth and Bridges
 * 2005 eq. 1), with g = sin phi / sin psi:
 *
 *   I_f / I_0 = P mu_a(E) / (mu_T(E) + g mu_T(E_f))
 *               * [1 - exp(-(mu_T(E)/sin phi + mu_T(E_f)/sin psi) d)]
 *
 * which is the same expression as (mu_a / sin phi) divided by (mu_T(E)/sin phi +
 * mu_T(E_f)/sin psi), because that denominator equals (mu_T(E) + g mu_T(E_f)) / sin phi.
 * Self absorption is not a separate term: it is already there, because mu_T(E) contains
 * mu_a(E), so the ratio stops following mu_a as the absorber gets concentrated.
 */
export function fluorescenceFromMu(input: FluorescenceMuInput): FluorescenceResult {
  const { muAbsorber_cm_inv: muA, muTotalIn_cm_inv: muIn, muTotalOut_cm_inv: muOut, prefactor } = input;
  for (const [value, label] of [[muA, 'mu_a(E)'], [muIn, 'mu_T(E)'], [muOut, 'mu_T(E_f)']] as const) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be zero or positive.`);
  }
  if (!(muIn > 0) || !(muOut > 0)) {
    throw new RangeError('The total mu at the incident and line energies must be greater than zero.');
  }
  if (!Number.isFinite(prefactor) || prefactor < 0) throw new RangeError('The fluorescence prefactor must be zero or positive.');
  const phi = surfaceAngle(input.incidence_deg, 'Incidence angle');
  const psi = surfaceAngle(input.exit_deg, 'Exit angle');
  const thickness_cm = requirePositive(input.thickness_um, 'Sample thickness') * 1e-4;

  const geometryRatio = Math.sin(phi) / Math.sin(psi);
  const alpha = muIn + geometryRatio * muOut;
  const exponent = (muIn / Math.sin(phi) + muOut / Math.sin(psi)) * thickness_cm;
  const thick = (prefactor * muA) / alpha;
  return {
    ratio: thick * -Math.expm1(-exponent),
    geometryRatio,
    alpha_cm_inv: alpha,
    depthIntegralExponent: exponent,
    thinLimit: (prefactor * muA * thickness_cm) / Math.sin(phi),
    thickLimit: thick,
    dampingFactor: 1 - muA / alpha,
    prefactor,
  };
}

/** Thin limit: I_f / I_0 = P mu_a d / sin phi, strictly proportional to mu_a (dossier 6.1). */
export function thinFluorescence(input: FluorescenceMuInput): number {
  return fluorescenceFromMu(input).thinLimit;
}

/** Thick limit: I_f / I_0 = P mu_a / (mu_T(E) + g mu_T(E_f)) (dossier 6.1). */
export function thickFluorescence(input: FluorescenceMuInput): number {
  return fluorescenceFromMu(input).thickLimit;
}

export interface FluorescenceGeometry {
  /** Omega / 4pi, from `solidAngle` in sdd.ts. */
  solidAngleFraction: number;
  /** epsilon: detector, filter and air transmission at the line energy. */
  efficiency: number;
  /** Angle between the sample surface and the detector axis. Default 45. */
  exit_deg?: number;
  /** Angle between the incident beam and the sample surface. Default sample.incidence_deg. */
  incidence_deg?: number;
  /** Emission group to detect, for example 'Ka'. Default: the strongest group of the edge. */
  line?: string;
}

export interface SampleFluorescence extends FluorescenceResult {
  energy_eV: number;
  components: MuComponents;
  line: FluorescenceLine;
  /** mu_T at the line energy, 1/cm. */
  muTotalOut_cm_inv: number;
  /** Window transmission at the incident energy, on the way in. */
  windowTransmissionIn: number;
  /** Window transmission at the line energy, on the way out. */
  windowTransmissionOut: number;
  temperature_K: number;
  provenance: Provenance[];
}

/** Default exit angle when neither the SDD configuration nor the caller gives one. */
export const DEFAULT_EXIT_ANGLE_DEG = 45;

/**
 * Fluorescence of the sample at one energy, with the tabulated yield, line share and mu.
 *
 * The prefactor is (Omega / 4pi) * epsilon * omega * p_line * T_windows(E_f), and the
 * incident beam is attenuated by the same windows at E, so both appear in the ratio. The
 * fine-structure factor reaches the ratio through mu_a and mu_T at the incident energy;
 * mu_T at the line energy is tabulated, which is the usual assumption, because the line
 * sits far below the edge.
 */
export function fluorescence(sample: SampleConfig, environment: EnvironmentConfig, energy_eV: number,
                             geometry: FluorescenceGeometry, options: MuOptions = {}): SampleFluorescence {
  const components = muComponents(sample, energy_eV, options);
  const line = fluorescenceLine(sample.absorber, sample.edge, geometry.line);
  const [minEnergy] = xrayDataInfo().energyRange_eV;
  if (line.energy_eV < minEnergy) {
    throw new RangeError(`The ${line.element} ${line.group} line at ${line.energy_eV} eV is below the tabulated range, so its self absorption cannot be computed.`);
  }
  requireFraction(geometry.solidAngleFraction, 'Solid-angle fraction');
  requireFraction(geometry.efficiency, 'Detector efficiency');

  const muTotalOut = mu(sample.formula, sample.density, line.energy_eV).total;
  const windowsIn = windowTransmission(environment, energy_eV);
  const windowsOut = windowTransmission(environment, line.energy_eV);
  const prefactor = geometry.solidAngleFraction * geometry.efficiency
    * line.fluorescenceYield * line.lineFraction * windowsOut;

  const result = fluorescenceFromMu({
    muAbsorber_cm_inv: components.absorber_cm_inv,
    muTotalIn_cm_inv: components.total_cm_inv,
    muTotalOut_cm_inv: muTotalOut,
    thickness_um: sample.thickness_um,
    incidence_deg: geometry.incidence_deg ?? sample.incidence_deg,
    exit_deg: geometry.exit_deg ?? DEFAULT_EXIT_ANGLE_DEG,
    prefactor,
  });

  return {
    ...result,
    ratio: result.ratio * windowsIn,
    thinLimit: result.thinLimit * windowsIn,
    thickLimit: result.thickLimit * windowsIn,
    energy_eV,
    components,
    line,
    muTotalOut_cm_inv: muTotalOut,
    windowTransmissionIn: windowsIn,
    windowTransmissionOut: windowsOut,
    temperature_K: environment.temperature_K,
    provenance: components.provenance,
  };
}

/**
 * Larch's `fluo_corr` alpha for this material and edge (dossier 6.3):
 *
 *   alpha = (g mu(E_f) + mu(E0 - 10)) / (mu(E0 + 10) - mu(E0 - 10))
 *
 * a density-independent measure of how badly a thick sample self absorbs. A large alpha
 * means a dilute sample with little distortion; the thick-limit damping of the fine
 * structure is alpha / (alpha + 1) at the top of the edge step.
 */
export function selfAbsorptionAlpha(formula: string | Composition, absorber: string, edge: string,
                                    incidence_deg: number, exit_deg: number, line?: string): number {
  const record = findEdge(absorber, edge);
  const emission = fluorescenceLine(absorber, record.edge, line);
  const geometryRatio = Math.sin(surfaceAngle(incidence_deg, 'Incidence angle'))
    / Math.sin(surfaceAngle(exit_deg, 'Exit angle'));
  const below = muOverRho(formula, record.energy_eV - 10).total;
  const above = muOverRho(formula, record.energy_eV + 10).total;
  const atLine = muOverRho(formula, emission.energy_eV).total;
  if (!(above > below)) {
    throw new Error(`The +/-10 eV finite difference of the fluo_corr algorithm does not resolve the ${absorber} ${record.edge} step in this material: the tabulated background falls by more over those 20 eV than the edge adds, which happens at high dilution, where self absorption is negligible anyway.`);
  }
  return (geometryRatio * atLine + below) / (above - below);
}

// ---------------------------------------------------------------- electron yield

/**
 * Default effective electron sampling depth, a teaching value.
 *
 * Hard X-ray K edges sample the ranges of the Auger electrons of the absorber, "hundreds of
 * angstroms" for LMM and "thousands" for KLL (A. Erbil, G. S. Cargill III, R. Frahm and
 * R. F. Boehme, Phys. Rev. B 37 (1988) 2450). 100 nm sits inside that range but is not a
 * measured value for any particular material, and dossier 7 records the published soft
 * X-ray escape depths as unverified, so this is a parameter with a teaching default rather
 * than tabulated data.
 */
export const TEACHING_ESCAPE_DEPTH_NM = 100;

export interface ElectronYieldInput {
  muAbsorber_cm_inv: number;
  muTotal_cm_inv: number;
  incidence_deg: number;
  /** Effective electron sampling depth. Default TEACHING_ESCAPE_DEPTH_NM. */
  escapeDepth_nm?: number;
}

export interface ElectronYieldResult {
  /** Y in the arbitrary units of the model: mu_a lambda / (sin phi + mu_T lambda). */
  yield: number;
  /** Yield in the unsaturated limit, mu_a lambda / sin phi: proportional to mu_a. */
  linearYield: number;
  /** yield / linearYield = sin phi / (sin phi + mu_T lambda): 1 when not saturated. */
  saturation: number;
  /** X-ray attenuation depth along the surface normal, sin phi / mu_T, in nm. */
  attenuationDepth_nm: number;
  escapeDepth_nm: number;
  provenance: Provenance;
}

/**
 * Total electron yield with saturation (dossier 7):
 *
 *   Y = integral_0^inf (mu_a / sin phi) exp(-mu_T z / sin phi) exp(-z / lambda_e) dz
 *     = mu_a lambda_e / (sin phi + mu_T lambda_e)
 *
 * from exponential X-ray attenuation along the beam path and exponential electron escape
 * from depth z. The yield is proportional to mu_a while mu_T lambda_e stays well below
 * sin phi, and saturates towards mu_a / mu_T when the X-ray attenuation depth approaches
 * the escape depth: that is what flattens white lines at grazing incidence and at strong
 * soft X-ray resonances (quantified for the Fe, Co and Ni L edges by R. Nakajima, J. Stohr
 * and Y. U. Idzerda, Phys. Rev. B 59 (1999) 6421). Teaching level: the escape depth is one
 * effective parameter, and charging of insulators is not modelled.
 */
export function electronYield(input: ElectronYieldInput): ElectronYieldResult {
  const { muAbsorber_cm_inv: muA, muTotal_cm_inv: muT } = input;
  if (!Number.isFinite(muA) || muA < 0) throw new RangeError('mu_a must be zero or positive.');
  if (!(muT > 0)) throw new RangeError('mu_T must be greater than zero.');
  const phi = surfaceAngle(input.incidence_deg, 'Incidence angle');
  const escapeDepth_nm = requirePositive(input.escapeDepth_nm ?? TEACHING_ESCAPE_DEPTH_NM, 'Escape depth');
  const lambda_cm = escapeDepth_nm * 1e-7;
  const sin = Math.sin(phi);
  const linearYield = (muA * lambda_cm) / sin;
  const saturation = sin / (sin + muT * lambda_cm);
  return {
    yield: linearYield * saturation,
    linearYield,
    saturation,
    attenuationDepth_nm: (sin / muT) * 1e7,
    escapeDepth_nm,
    provenance: 'teaching-model',
  };
}

export interface SampleElectronYieldOptions extends MuOptions {
  escapeDepth_nm?: number;
  /** Default sample.incidence_deg. */
  incidence_deg?: number;
}

/** Electron yield of a configured sample at one energy. */
export function sampleElectronYield(sample: SampleConfig, energy_eV: number,
                                    options: SampleElectronYieldOptions = {}): ElectronYieldResult & { components: MuComponents } {
  const components = muComponents(sample, energy_eV, options);
  return {
    ...electronYield({
      muAbsorber_cm_inv: components.absorber_cm_inv,
      muTotal_cm_inv: components.total_cm_inv,
      incidence_deg: options.incidence_deg ?? sample.incidence_deg,
      escapeDepth_nm: options.escapeDepth_nm,
    }),
    components,
  };
}
