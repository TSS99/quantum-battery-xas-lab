/**
 * Model X-ray absorption spectrum for any compound, absorber and edge.
 *
 * Background and edge jump: tabulated atomic mu(E) of the compound (src/lib/xraydata.ts).
 * On top of that, optional parametric shapes (edge broadening, pre-edge peak, white line,
 * damped post-edge oscillation) whose default sizes scale with the edge energy. The shapes
 * are illustrative, not predictions: tabulated atomic data contain no XANES or EXAFS.
 * Requires `await loadXrayData()` first.
 */
import { edgeStep, elementInfo, mu, muAcrossEdge, parseFormula, xrayDataInfo, type Composition } from './xraydata';

export const GENERAL_XAS_PROVENANCE = 'tabulated-background + parametric-model' as const;
export const GENERAL_XAS_DISCLOSURE =
  'Model spectrum. The smooth background and the edge jump are tabulated isolated-atom cross sections ' +
  '(Elam, Ravel & Sieber via XrayDB). The edge broadening, pre-edge peak, white line and post-edge oscillation ' +
  'are illustrative parametric shapes, not predictions for this compound.';

/** Heights are fractions of the edge jump; offsets and widths are in eV. */
export interface NearEdgeFeatures {
  preEdgeHeight: number;
  /** Pre-edge peak position below the edge. */
  preEdgeOffset_eV: number;
  /** Gaussian sigma. */
  preEdgeWidth_eV: number;
  whiteLineHeight: number;
  /** White-line position above the edge. */
  whiteLineOffset_eV: number;
  whiteLineWidth_eV: number;
  /** Amplitude of the damped oscillation sin(2kR)·exp(-2σ²k²) above the edge. */
  oscillation: number;
  /** Effective scattering distance R in Å. */
  distance_A: number;
  /** Damping σ² in Å². */
  sigma2_A2: number;
}

/** Arctan half-width of the edge (core-hole lifetime plus resolution), scaled with E0. */
export function defaultEdgeWidth(edgeEnergy_eV: number): number {
  return Math.max(0.3, 2e-4 * edgeEnergy_eV);
}

/** Default feature sizes: offsets and widths scale with the edge energy, with small floors for soft edges. */
export function defaultNearEdgeFeatures(edgeEnergy_eV: number): NearEdgeFeatures {
  const e0 = edgeEnergy_eV;
  return {
    preEdgeHeight: 0.05, preEdgeOffset_eV: Math.max(2, 1.2e-3 * e0), preEdgeWidth_eV: Math.max(0.4, 1.5e-4 * e0),
    whiteLineHeight: 0.4, whiteLineOffset_eV: Math.max(1.5, 1e-3 * e0), whiteLineWidth_eV: Math.max(0.8, 4e-4 * e0),
    // The oscillation lives in photoelectron k, which does not depend on E0.
    oscillation: 0.06, distance_A: 2, sigma2_A2: 0.008,
  };
}

export interface GeneralSpectrumOptions {
  formula: string | Composition;
  /** g/cm^3 */
  density: number;
  absorber: string;
  /** 'K', 'L3', 'M5', ... */
  edge: string;
  /** Chemical shift applied to the model edge position. Default 0. */
  edgeShift_eV?: number;
  /** Default: defaultEdgeWidth(E0). */
  edgeWidth_eV?: number;
  /** Override some features, or false for the broadened atomic step only. */
  features?: Partial<NearEdgeFeatures> | false;
  /** Scan limits and step; defaults scale with E0 (about -1.5 % to +8 % of E0). */
  start_eV?: number;
  end_eV?: number;
  step_eV?: number;
}

export interface GeneralSpectrum {
  energy_eV: number[];
  /** Model: broadened tabulated edge plus parametric features, 1/cm. */
  mu_cm_inv: number[];
  /** Tabulated atomic mu_total(E) of the compound with its sharp edge, 1/cm. */
  tabulated_cm_inv: number[];
  provenance: typeof GENERAL_XAS_PROVENANCE;
  disclosure: string;
  metadata: {
    formula: string;
    density: number;
    absorber: string;
    edge: string;
    tabulatedEdge_eV: number;
    modelEdge_eV: number;
    edgeWidth_eV: number;
    edgeStep_cm_inv: number;
    features: NearEdgeFeatures | null;
    dataSource: string;
  };
}

const MAX_POINTS = 20000;
const K_PER_EV = 0.2624684; // k² (Å⁻²) per eV above the edge: 2m/ħ²

function requireRange(value: number, low: number, high: number, label: string) {
  if (!Number.isFinite(value) || value < low || value > high) throw new Error(`${label} must be between ${low} and ${high}.`);
}

function validateFeatures(f: NearEdgeFeatures, e0: number) {
  const maxOffset = Math.max(50, 0.05 * e0);
  requireRange(f.preEdgeHeight, 0, 3, 'Pre-edge height');
  requireRange(f.preEdgeOffset_eV, 0, maxOffset, 'Pre-edge offset (eV)');
  requireRange(f.preEdgeWidth_eV, 0.01, maxOffset, 'Pre-edge width (eV)');
  requireRange(f.whiteLineHeight, 0, 3, 'White-line height');
  requireRange(f.whiteLineOffset_eV, 0, maxOffset, 'White-line offset (eV)');
  requireRange(f.whiteLineWidth_eV, 0.01, maxOffset, 'White-line width (eV)');
  requireRange(f.oscillation, 0, 0.5, 'Oscillation amplitude');
  requireRange(f.distance_A, 0.5, 10, 'Scattering distance (Å)');
  requireRange(f.sigma2_A2, 0, 0.1, 'Damping σ² (Å²)');
}

const gaussian = (x: number, centre: number, sigma: number) => Math.exp(-0.5 * ((x - centre) / sigma) ** 2);

/** Model spectrum around one edge of one absorber in any compound. */
export function modelSpectrum(options: GeneralSpectrumOptions): GeneralSpectrum {
  const { density, absorber, edge } = options;
  const composition = typeof options.formula === 'string' ? parseFormula(options.formula) : options.formula;
  const formula = typeof options.formula === 'string' ? options.formula : Object.entries(composition).map(([s, n]) => `${s}${n}`).join('');
  const step = edgeStep(composition, absorber, edge, density); // validates absorber, edge and range
  const e0Tab = step.edgeEnergy_eV;
  const [minEnergy, maxEnergy] = xrayDataInfo().energyRange_eV;

  const shift = options.edgeShift_eV ?? 0;
  requireRange(shift, -Math.max(50, 0.01 * e0Tab), Math.max(50, 0.01 * e0Tab), 'Edge shift (eV)');
  const e0 = e0Tab + shift;
  const width = options.edgeWidth_eV ?? defaultEdgeWidth(e0Tab);
  requireRange(width, 0.01, Math.max(20, 0.005 * e0Tab), 'Edge width (eV)');
  const features = options.features === false ? null : { ...defaultNearEdgeFeatures(e0Tab), ...options.features };
  if (features) validateFeatures(features, e0Tab);

  const start = options.start_eV ?? Math.max(minEnergy, e0Tab - Math.max(30, 0.015 * e0Tab));
  const end = options.end_eV ?? Math.min(maxEnergy, e0Tab + Math.max(80, 0.08 * e0Tab));
  const stepSize = options.step_eV ?? Math.max(0.05, 1.5e-4 * e0Tab);
  requireRange(start, minEnergy, maxEnergy, 'Scan start (eV)');
  requireRange(end, minEnergy, maxEnergy, 'Scan end (eV)');
  if (!(end > start)) throw new Error('Scan end must be above scan start.');
  if (!(stepSize > 0) || (end - start) / stepSize + 1 > MAX_POINTS) throw new Error(`Scan step must be positive and give at most ${MAX_POINTS} points.`);

  const count = Math.floor((end - start) / stepSize + 1e-9) + 1;
  const energy_eV: number[] = [], mu_cm_inv: number[] = [], tabulated_cm_inv: number[] = [];
  for (let i = 0; i < count; i++) {
    const energy = start + i * stepSize;
    const below = muAcrossEdge(composition, density, absorber, step.edge, energy, 'below');
    const jump = muAcrossEdge(composition, density, absorber, step.edge, energy, 'above') - below;
    const arctanStep = 0.5 + Math.atan((energy - e0) / width) / Math.PI;
    let shape = arctanStep;
    if (features) {
      shape += features.preEdgeHeight * gaussian(energy, e0 - features.preEdgeOffset_eV, features.preEdgeWidth_eV);
      shape += features.whiteLineHeight * gaussian(energy, e0 + features.whiteLineOffset_eV, features.whiteLineWidth_eV);
      if (energy > e0) {
        const k = Math.sqrt(K_PER_EV * (energy - e0));
        shape += arctanStep * features.oscillation * Math.sin(2 * k * features.distance_A) * Math.exp(-2 * features.sigma2_A2 * k * k);
      }
    }
    energy_eV.push(energy);
    mu_cm_inv.push(below + jump * shape);
    tabulated_cm_inv.push(mu(composition, density, energy).total);
  }

  return {
    energy_eV, mu_cm_inv, tabulated_cm_inv,
    provenance: GENERAL_XAS_PROVENANCE,
    disclosure: GENERAL_XAS_DISCLOSURE,
    metadata: {
      formula, density, absorber, edge: step.edge, tabulatedEdge_eV: e0Tab, modelEdge_eV: e0, edgeWidth_eV: width,
      edgeStep_cm_inv: step.deltaMu_cm_inv, features, dataSource: xrayDataInfo().source,
    },
  };
}

/** Absorber edges a model spectrum can be drawn for (inside the tabulated energy range). */
export function modelableEdges(absorber: string): string[] {
  const [minEnergy, maxEnergy] = xrayDataInfo().energyRange_eV;
  return elementInfo(absorber).edges.filter(e => e.energy_eV > minEnergy && e.energy_eV < maxEnergy).map(e => e.edge);
}
