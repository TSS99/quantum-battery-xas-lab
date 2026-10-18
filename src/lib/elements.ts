/**
 * Data for the element reference pages (/elements/ and /elements/<symbol>/), read from the
 * tabulated X-ray table at build time. This module imports the whole table (about 200 KiB),
 * so only server components, the sitemap and tests may import it. Browser code loads the
 * table lazily through loadXrayData() in xraydata.ts instead.
 */
import table from '@/data/xray/elements.json';
import { COMPOUND_PRESETS, type CompoundPreset } from '@/data/compound-presets';
import { DEFAULT_STATE, scenarioToJSON } from './scenario';
import { BEAMLINE_RANGES, parseFormula } from './xraydata';

/** Soft (100 eV to 2 keV) or hard (2 keV and up) for edges the lab can scan, else outside. */
export type EdgeBand = 'soft' | 'hard' | 'outside';

export interface ElementEdge {
  edge: string;
  energy_eV: number;
  jumpRatio: number;
  fluorescenceYield: number;
  band: EdgeBand;
}

export interface ElementData {
  Z: number;
  symbol: string;
  name: string;
  /** g/mol, as tabulated. */
  molarMass: number;
  /** URL segment: the lower-case symbol, e.g. "fe". */
  slug: string;
  /** In the table's shell order: K, L1 to L3, M1 to M5, then N, O and P. */
  edges: ElementEdge[];
}

interface RawElement {
  Z: number;
  symbol: string;
  name: string;
  mass: number;
  edges: [string, number, number, number][];
}

const [MIN_eV, MAX_eV] = table.energyRange_eV;

/** Below this fluorescence yield, recommendMode (xraydata.ts) suggests total electron yield. */
export const LOW_FLUORESCENCE_YIELD = 0.05;

/** Same test as resolveSample (sample.ts): the lab scans edges strictly inside 100 eV to 100 keV. */
export function edgeBand(energy_eV: number): EdgeBand {
  if (!(energy_eV > MIN_eV && energy_eV < MAX_eV)) return 'outside';
  return energy_eV < BEAMLINE_RANGES.soft.max_eV ? 'soft' : 'hard';
}

export const ELEMENTS: readonly ElementData[] = (table.elements as unknown as RawElement[]).map(el => ({
  Z: el.Z, symbol: el.symbol, name: el.name, molarMass: el.mass, slug: el.symbol.toLowerCase(),
  edges: el.edges.map(([edge, energy_eV, jumpRatio, fluorescenceYield]) => ({ edge, energy_eV, jumpRatio, fluorescenceYield, band: edgeBand(energy_eV) })),
}));

/** Slug to name, for the breadcrumb in the shell. */
export const ELEMENT_NAMES: Record<string, string> = Object.fromEntries(ELEMENTS.map(el => [el.slug, el.name]));

export const elementBySlug = (slug: string) => ELEMENTS.find(el => el.slug === slug);

export const scannableEdges = (el: ElementData) => el.edges.filter(edge => edge.band !== 'outside');

/** Energies as the Sample page lists them, e.g. 7,112 or 706.8. */
export const formatEnergy = (energy_eV: number) => energy_eV.toLocaleString('en-US');

/**
 * The edge the Sample page picks when this element becomes the absorber (pickElement in
 * sample-controls.tsx): K if scannable, else L3, else the lowest scannable edge, else the highest edge.
 */
export function defaultEdge(el: ElementData): ElementEdge {
  const byEnergy = [...el.edges].sort((a, b) => a.energy_eV - b.energy_eV);
  const scannable = (edge: ElementEdge) => edge.band !== 'outside';
  return byEnergy.find(e => e.edge === 'K' && scannable(e)) ?? byEnergy.find(e => e.edge === 'L3' && scannable(e)) ?? byEnergy.find(scannable) ?? byEnergy[byEnergy.length - 1];
}

/**
 * A lab page with the element as a pure sample, read by LabProvider through elementFromURL.
 * The lab reads the address only when it loads, so link to it with a plain <a>, not next/link.
 */
export const elementLabPath = (route: 'crystal' | 'beamline', symbol: string, edge: string) =>
  `/${route}/?${new URLSearchParams({ element: symbol, edge })}`;

export interface CompoundLink {
  preset: CompoundPreset;
  /** The element's edge selected when the link opens. */
  edge: string;
  /** Sample page with the preset and this element as absorber, as a scenario link. */
  path: string;
}

/**
 * Example compounds that contain the element, those usually measured at its edges first. Each
 * opens the Sample page through a scenario link, the same format as the Experiments share link.
 */
export function compoundsWith(el: ElementData, limit = 6): CompoundLink[] {
  return COMPOUND_PRESETS
    .filter(preset => el.symbol in parseFormula(preset.formula))
    .sort((a, b) => Number(b.absorber === el.symbol) - Number(a.absorber === el.symbol))
    .slice(0, limit)
    .map(preset => {
      const edge = (preset.absorber === el.symbol && el.edges.find(e => e.edge === preset.edge)) || defaultEdge(el);
      // Like SamplePicker's apply(): the energy sits on the edge, clamped to the tabulated range.
      const state = {
        ...DEFAULT_STATE,
        sample: { formula: preset.formula, density: preset.density, absorber: el.symbol, edge: edge.edge, preset: preset.id },
        energy: Math.min(MAX_eV, Math.max(MIN_eV, edge.energy_eV)),
      };
      // scenarioToJSON validates the state; re-serialising without indentation keeps the link short.
      return { preset, edge: edge.edge, path: '/crystal/?scenario=' + encodeURIComponent(JSON.stringify(JSON.parse(scenarioToJSON(state)))) };
    });
}

export const elementTitle = (el: ElementData) => `${el.name} (${el.symbol}) X-ray absorption edges`;

/** Search snippet led by the edges searched for most: the first four above 100 eV, in shell order. */
export function elementDescription(el: ElementData): string {
  const list = (edges: ElementEdge[]) => edges.map(e => `${e.edge} ${formatEnergy(e.energy_eV)} eV`).join(', ');
  const lead = `${el.name} (${el.symbol}, Z = ${el.Z})`;
  const notable = el.edges.filter(e => e.energy_eV > MIN_eV).slice(0, 4);
  if (!notable.length) {
    return `${lead} X-ray absorption ${el.edges.length > 1 ? 'edges' : 'edge'}: ${list(el.edges)}. All lie below 100 eV, under the range of the lab's cross-section tables.`;
  }
  return `${lead} X-ray absorption edge energies: ${list(notable)}. With jump ratios, fluorescence yields and a sample planner.`;
}

/**
 * Cell in the usual periodic-table layout: rows 1 to 7 are the periods, row 8 is a spacer,
 * rows 9 and 10 hold La to Lu and Ac to Cf.
 */
export function tablePosition(Z: number): { row: number; col: number } {
  if (Z === 1) return { row: 1, col: 1 };
  if (Z === 2) return { row: 1, col: 18 };
  if (Z <= 18) {
    const row = Z <= 10 ? 2 : 3, index = Z - (row === 2 ? 2 : 10); // 1 to 8 across the period
    return { row, col: index <= 2 ? index : index + 10 };
  }
  if (Z <= 36) return { row: 4, col: Z - 18 };
  if (Z <= 54) return { row: 5, col: Z - 36 };
  if (Z <= 56) return { row: 6, col: Z - 54 };
  if (Z <= 71) return { row: 9, col: Z - 54 };
  if (Z <= 86) return { row: 6, col: Z - 68 };
  if (Z <= 88) return { row: 7, col: Z - 86 };
  return { row: 10, col: Z - 86 };
}
