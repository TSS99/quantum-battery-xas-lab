import { parseFormula, edgesOf, mu, recommendThickness, recommendMode, type XrayEdge } from './xraydata';
import { modelSpectrum } from './xas-general';
import { mu as batteryMu } from './xas';
import type { LabState } from './scenario';
import type { Spectrum } from './spectra';

export interface Sample {
  formula: string;
  density: number;
  absorber: string;
  edge: string;
  preset: string | null;
}
export const BATTERY_PRESET = 'battery-example';
export const DEFAULT_SAMPLE: Sample = { formula: 'Li0.5MnO2', density: 4.3, absorber: 'Mn', edge: 'K', preset: BATTERY_PRESET };
export const isBattery = (sample: Sample) => sample.preset === BATTERY_PRESET;
export const batteryFormula = (x: number) => x === 0 ? 'MnO2' : 'Li' + Number(x.toFixed(4)) + 'MnO2';

/** Portable validation does not load the large cross-section table. */
export function validateSample(value: unknown): Sample {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sample must be an object.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['formula', 'density', 'absorber', 'edge', 'preset'].includes(k))) throw new Error('Unknown sample field.');
  if (typeof v.formula !== 'string' || v.formula.length > 240) throw new Error('Enter a formula of at most 240 characters.');
  const formula = v.formula.trim(), composition = parseFormula(formula);
  if (Object.values(composition).some(n => !Number.isFinite(n) || n > 1e12)) throw new Error('Formula counts are too large.');
  if (typeof v.density !== 'number' || !Number.isFinite(v.density) || v.density <= 0 || v.density > 1000) throw new Error('Density must be greater than 0 and at most 1000 g/cm³.');
  if (typeof v.absorber !== 'string' || !(v.absorber in composition)) throw new Error('Choose an absorber that is in the formula.');
  if (typeof v.edge !== 'string' || !/^(K|L[1-3]|M[1-5]|N[1-7]|O[1-7]|P[1-5])$/.test(v.edge)) throw new Error('Choose an edge such as K, L3 or M5.');
  if (v.preset !== null && (typeof v.preset !== 'string' || v.preset.length > 80)) throw new Error('Invalid sample preset.');
  return { formula, density: v.density, absorber: v.absorber, edge: v.edge, preset: v.preset };
}

/** The edge picked when only an absorber is chosen: K, then L3, then any edge inside 100 eV to 100 keV, else the highest. */
export function defaultEdge(formula: string, absorber: string): XrayEdge | undefined {
  const options = edgesOf(formula).filter(e => e.element === absorber), inRange = (e: XrayEdge) => e.energy_eV > 100 && e.energy_eV < 100000;
  return options.find(e => e.edge === 'K' && inRange(e)) ?? options.find(e => e.edge === 'L3' && inRange(e)) ?? options.find(inRange) ?? options[options.length - 1];
}

/** Semantic edge check after loadXrayData; outside-range edges remain inspectable. */
export function resolveSample(sample: Sample): { edge: XrayEdge; inRange: boolean; start: number; end: number } {
  const checked = validateSample(sample);
  const edge = edgesOf(checked.formula).find(e => e.element === checked.absorber && e.edge === checked.edge);
  if (!edge) throw new Error(checked.absorber + ' has no ' + checked.edge + ' edge. Choose an edge listed for this sample.');
  const inRange = edge.energy_eV > 100 && edge.energy_eV < 100000;
  return { edge, inRange,
    start: inRange ? Math.max(100, edge.energy_eV - Math.max(30, edge.energy_eV * .005)) : 100,
    end: inRange ? Math.min(100000, edge.energy_eV + Math.max(80, edge.energy_eV * .012)) : 100000 };
}
export function sampleScan(state: LabState, model = false): Spectrum {
  const sample = state.sample, window = resolveSample(sample);
  const energy_eV = Array.from({ length: 501 }, (_, i) => window.start + (window.end - window.start) * i / 500);
  const base: Spectrum = {
    id: 'live', name: sample.formula + ' · ' + sample.absorber + ' ' + sample.edge,
    energy_eV, mu_cm_inv: energy_eV.map(e => mu(sample.formula, sample.density, e).total),
    provenance: 'tabulated', sampleId: sample.formula,
    source: 'XrayDB / Elam isolated-atom cross sections',
    notes: 'Density ' + sample.density + ' g/cm³. Total attenuation includes scattering. No chemical fine structure.',
    calibration: { reference: sample.absorber + ' ' + sample.edge + ' tabulated edge: ' + window.edge.energy_eV + ' eV; not a measured calibration', offset_eV: 0, status: 'uncalibrated' },
  };
  if (!model || !window.inRange) return base;
  if (isBattery(sample) && sample.absorber === 'Mn' && sample.edge === 'K') {
    const curve = { energy_eV, mu_cm_inv: energy_eV.map(e => batteryMu(e, state)) };
    return { ...base, ...curve, name: 'Battery teaching model', provenance: 'synthetic', parameters: { x: state.x, edge: state.edge, shift: state.shift, width: state.width, whiteLine: state.whiteLine, preEdge: state.preEdge, oscillation: state.oscillation }, source: 'Adjustable battery teaching model' };
  }
  const curve = modelSpectrum({ ...sample, start_eV: window.start, end_eV: window.end, step_eV: (window.end - window.start) / 500, edgeShift_eV: state.shift - 3 });
  return { ...base, energy_eV: curve.energy_eV, mu_cm_inv: curve.mu_cm_inv, provenance: 'synthetic', name: base.name + ' · near-edge model', source: curve.provenance, notes: curve.disclosure };
}
export function samplePlan(sample: Sample) {
  const resolved = resolveSample(sample);
  if (!resolved.inRange) return { ...resolved, plan: null, mode: null, note: 'This edge is outside 100 eV to 100 keV. The plot shows absorption over the available range.' };
  let plan = null;
  try { plan = recommendThickness(sample.formula, sample.absorber, sample.edge, sample.density); } catch { /* Some shells have no tabulated jump. */ }
  return { ...resolved, plan, mode: recommendMode(sample.formula, sample.absorber, sample.edge), note: plan ? '' : 'No tabulated jump is available for thickness planning at this edge.' };
}
