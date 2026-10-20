/**
 * Numbers for the landing-page validation cards, computed from the lab's own modules.
 * Server-safe: no browser APIs. The home page calls it at build time, so every value is
 * recomputed on each build rather than typed in.
 */
import { BEAMLINE_RANGES, ELEMENT_SYMBOLS, elementInfo, loadXrayData } from './xraydata';
import { benchmarkDeviations, summarizeAgreement, type Benchmark, type BenchmarkQuantity } from './benchmark';
import { simulateQuantum } from './quantum';

export interface CardRow {
  name: string;
  /** LaTeX for the value, such as `2.1\times10^{-6}`. */
  value: string;
  /** Bar length from 0 to 1; the card's `barMeaning` says what it measures. */
  bar: number;
}
export interface ValidationCard {
  id: string;
  title: string;
  description: string;
  metric: string;
  barMeaning: string;
  rows: CardRow[];
}

/** Matching decimal digits of a relative or absolute deviation, capped at `cap`. */
export const matchingDigits = (deviation: number, cap: number) =>
  deviation <= 0 ? cap : Math.min(cap, Math.max(0, -Math.log10(deviation)));

const sci = (x: number) => {
  if (x === 0) return '0';
  const [mantissa, exponent] = x.toExponential(1).split('e');
  return `${mantissa}\\times10^{${Number(exponent)}}`;
};

const QUANTITY_NAMES: Record<BenchmarkQuantity, string> = {
  total: 'Total attenuation', photo: 'Photoabsorption', edgeEnergy: 'Edge energy', edgeStep: 'Edge step', thickness: 'Pellet thickness',
};
const AGREEMENT_CAP = 8;
const RESIDUAL_CAP = 16;

export async function buildValidationCards(): Promise<ValidationCard[]> {
  await loadXrayData();
  const benchmark: Benchmark = (await import('../data/xray/benchmark.json')).default as unknown as Benchmark;
  const agreement = summarizeAgreement(benchmarkDeviations(benchmark));
  const pointCount = agreement.reduce((sum, item) => sum + item.points, 0);

  const elements = ELEMENT_SYMBOLS.map(elementInfo);
  const share = (count: number) => count / elements.length;
  const inRange = (range: { min_eV: number; max_eV: number }) =>
    elements.filter(e => e.edges.some(edge => edge.energy_eV >= range.min_eV && edge.energy_eV <= range.max_eV)).length;
  const withEdge = (label: string) => elements.filter(e => e.edges.some(edge => edge.edge === label)).length;
  const edgeTotal = elements.reduce((sum, e) => sum + e.edges.length, 0);
  const hard = inRange(BEAMLINE_RANGES.hard), soft = inRange(BEAMLINE_RANGES.soft);

  const { validation: v } = simulateQuantum({ qubits: 2, coupling: .35, field: .7, timeMax: 20, samples: 128, trotterSteps: 24, broadening: .12, window: 'cosine', padding: 4 });
  const residuals: [string, number][] = [
    ['Hamiltonian is Hermitian', v.hermiticityError],
    ['Time evolution is unitary', v.unitarityError],
    ['Ground state solves the eigenproblem', v.groundResidual],
    ['Correlation at zero time', v.correlationAtZeroError],
    ['Transition weights sum to one', v.transitionWeightError],
  ];

  return [
    {
      id: 'xraydb', title: 'Agreement with xraydb',
      description: `The lab's attenuation code against ${pointCount} values computed directly with xraydb ${benchmark.xraydbVersion} for ${benchmark.cases.length} materials.`,
      metric: 'Worst relative deviation',
      barMeaning: `Bar length: matching decimal digits at the worst point, out of ${AGREEMENT_CAP}.`,
      rows: agreement.map(item => ({ name: QUANTITY_NAMES[item.quantity], value: sci(item.max), bar: matchingDigits(item.max, AGREEMENT_CAP) / AGREEMENT_CAP })),
    },
    {
      id: 'coverage', title: 'Element coverage',
      description: `Absorption edges tabulated for ${elements.length} elements from hydrogen to californium (${edgeTotal} edges in all), from the same XrayDB tables.`,
      metric: `Elements out of ${elements.length}`,
      barMeaning: `Bar length: share of the ${elements.length} elements.`,
      rows: [
        { name: 'With any tabulated edge', value: String(elements.filter(e => e.edges.length).length), bar: share(elements.filter(e => e.edges.length).length) },
        { name: 'With a K edge', value: String(withEdge('K')), bar: share(withEdge('K')) },
        { name: 'With an L3 edge', value: String(withEdge('L3')), bar: share(withEdge('L3')) },
        { name: 'Edge inside 2 to 35 keV', value: String(hard), bar: share(hard) },
        { name: 'Edge inside 0.1 to 2 keV', value: String(soft), bar: share(soft) },
      ],
    },
    {
      id: 'solver', title: 'Quantum solver residuals',
      description: 'One fixed two-qubit run, checked against its own equations. This tests the code, not the physics of a real material.',
      metric: 'Largest residual',
      barMeaning: `Bar length: digits below one, out of ${RESIDUAL_CAP}. A full bar is exact to double precision.`,
      rows: residuals.map(([name, value]) => ({ name, value: sci(value), bar: matchingDigits(value, RESIDUAL_CAP) / RESIDUAL_CAP })),
    },
  ];
}
