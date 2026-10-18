/**
 * Agreement between the lab's attenuation code (src/lib/xraydata.ts) and xraydb.
 *
 * The reference values in src/data/xray/benchmark.json come from scripts/make-benchmark.py,
 * which calls xraydb directly. The lab's tables were derived from the same Elam data in
 * XrayDB, so this measures the implementation (table compression, interpolation, formula
 * parsing, mixing and edge handling), not the underlying physics data.
 * Requires `await loadXrayData()` first.
 */
import { edgeStep, edgesOf, mu, recommendThickness } from './xraydata';

export interface BenchmarkPoint {
  energy_eV: number;
  /** 'grid' or the offset from the chosen edge, e.g. 'edge-10'. */
  where: string;
  total_cm_inv: number;
  photo_cm_inv: number;
}

export interface BenchmarkEdgeStep {
  tableEdge_eV: number;
  muBelow_cm_inv: number;
  muAbove_cm_inv: number;
  deltaMu_cm_inv: number;
  thickness_um: number;
  limitedBy: string;
}

export interface BenchmarkCase {
  id: string;
  label: string;
  source: string;
  formula: string;
  xraydbFormula: string;
  /** Atom counts from xraydb.chemparse. */
  composition: Partial<Record<string, number>>;
  density: number;
  absorber: string;
  edge: string;
  edgeEnergy_eV: number;
  points: BenchmarkPoint[];
  edgeStep: BenchmarkEdgeStep | null;
}

export interface Benchmark {
  xraydbVersion: string;
  xraydbDatabase: string;
  /** Listed edge energies (eV) by element and edge label. */
  edges: Record<string, Record<string, number>>;
  cases: BenchmarkCase[];
}

export type BenchmarkQuantity = 'total' | 'photo' | 'edgeEnergy' | 'edgeStep' | 'thickness';
export const BENCHMARK_QUANTITIES: readonly BenchmarkQuantity[] = ['total', 'photo', 'edgeEnergy', 'edgeStep', 'thickness'];

export interface Deviation {
  quantity: BenchmarkQuantity;
  caseId: string;
  /** Where the value was taken: 'grid', 'edge+10', 'edge-below', an edge label, ... */
  where: string;
  energy_eV: number;
  lab: number;
  reference: number;
  /** |lab / reference - 1| */
  relative: number;
}

export interface Agreement {
  quantity: BenchmarkQuantity;
  points: number;
  median: number;
  max: number;
  worst: Deviation;
}

const deviation = (quantity: BenchmarkQuantity, caseId: string, where: string, energy_eV: number, lab: number, reference: number): Deviation =>
  ({ quantity, caseId, where, energy_eV, lab, reference, relative: Math.abs(lab / reference - 1) });

/** Every lab value next to its xraydb reference. Edge energies are compared once per element. */
export function benchmarkDeviations(benchmark: Benchmark): Deviation[] {
  const out: Deviation[] = [];
  const seen = new Set<string>();
  for (const item of benchmark.cases) {
    for (const point of item.points) {
      const value = mu(item.formula, item.density, point.energy_eV);
      out.push(deviation('total', item.id, point.where, point.energy_eV, value.total, point.total_cm_inv));
      out.push(deviation('photo', item.id, point.where, point.energy_eV, value.photo, point.photo_cm_inv));
    }
    for (const edge of edgesOf(item.formula)) {
      const key = `${edge.element} ${edge.edge}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reference = benchmark.edges[edge.element]?.[edge.edge];
      if (reference === undefined) throw new Error(`The benchmark has no xraydb value for the ${key} edge.`);
      out.push(deviation('edgeEnergy', item.id, edge.edge, reference, edge.energy_eV, reference));
    }
    const ref = item.edgeStep;
    if (ref) {
      const step = edgeStep(item.formula, item.absorber, item.edge, item.density);
      out.push(deviation('total', item.id, 'edge-below', ref.tableEdge_eV, step.muBelow_cm_inv, ref.muBelow_cm_inv));
      out.push(deviation('total', item.id, 'edge-above', ref.tableEdge_eV, step.muAbove_cm_inv, ref.muAbove_cm_inv));
      out.push(deviation('edgeStep', item.id, item.edge, ref.tableEdge_eV, step.deltaMu_cm_inv, ref.deltaMu_cm_inv));
      const plan = recommendThickness(item.formula, item.absorber, item.edge, item.density);
      out.push(deviation('thickness', item.id, plan.limitedBy, ref.tableEdge_eV, plan.thickness_um, ref.thickness_um));
    }
  }
  return out;
}

/** Number of values, median and maximum relative deviation per quantity. */
export function summarizeAgreement(deviations: Deviation[]): Agreement[] {
  return BENCHMARK_QUANTITIES.flatMap(quantity => {
    const items = deviations.filter(item => item.quantity === quantity);
    if (!items.length) return [];
    const sorted = items.map(item => item.relative).sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const worst = items.reduce((a, b) => (b.relative > a.relative ? b : a));
    return [{ quantity, points: items.length, median, max: worst.relative, worst }];
  });
}
