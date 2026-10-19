/**
 * Element-agnostic X-ray absorption data for any formula (Z = 1-98).
 *
 * Tabulated isolated-atom cross sections (Elam, Ravel & Sieber 2002, via XrayDB, CC0) on
 * 100 eV - 100 keV. These give the smooth background and the edge jumps only: no XANES or
 * EXAFS fine structure, chemical shifts or solid-state effects.
 *
 * Usage: `await loadXrayData()` once (the table is a separate lazily loaded chunk), then
 * call the synchronous helpers. Units: eV, g/cm^3, cm^2/g, 1/cm, micrometres, mg.
 */

export type Composition = Record<string, number>;
export type EdgeSide = 'below' | 'above';

export interface XrayEdge {
  element: string;
  Z: number;
  edge: string;
  energy_eV: number;
  jumpRatio: number;
  fluorescenceYield: number;
}

export interface ElementInfo {
  Z: number;
  symbol: string;
  name: string;
  molarMass: number;
  edges: XrayEdge[];
}

/** Mass attenuation (cm^2/g) or linear attenuation (1/cm): photoabsorption and total. */
export interface CrossSection {
  photo: number;
  /** Photoabsorption plus coherent and incoherent scattering. */
  total: number;
}

export interface XrayDataInfo {
  source: string;
  license: string;
  citations: readonly string[];
  energyRange_eV: readonly [number, number];
  limitations: string;
  accuracy: {
    awayFromEdges: { maxRelativeError: number; p99RelativeError: number };
    within1PercentOfEdges: { maxRelativeError: number; p99RelativeError: number };
  };
}

export interface EnergyRange {
  label: string;
  min_eV: number;
  max_eV: number;
}

export const BEAMLINE_RANGES = {
  hard: { label: 'Hard X-ray (2-35 keV)', min_eV: 2000, max_eV: 35000 },
  soft: { label: 'Soft X-ray (0.1-2 keV)', min_eV: 100, max_eV: 2000 },
} as const satisfies Record<string, EnergyRange>;

/** Element symbols Z = 1-98 (the tabulated set); index + 1 = Z. */
export const ELEMENT_SYMBOLS: readonly string[] = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb ' +
  'Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf'
).split(' ');
const SYMBOL_SET = new Set(ELEMENT_SYMBOLS);

/** Diluents for pressed pellets. Cellulose is the C6H10O5 repeat unit. */
export const DILUENTS = { BN: 'BN', cellulose: 'C6H10O5' } as const;
export type Diluent = keyof typeof DILUENTS;

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 });
const fmt = (value: number) => NUMBER_FORMAT.format(value);

// ---------------------------------------------------------------- loading

interface RawElement {
  Z: number;
  symbol: string;
  name: string;
  mass: number;
  edges: [string, number, number, number][];
  energy: number[];
  photo: number[];
  total: number[];
}

interface RawXrayFile extends XrayDataInfo {
  elements: RawElement[];
}

interface ElementTable extends ElementInfo {
  energy: number[];
  lnEnergy: Float64Array;
  lnPhoto: Float64Array;
  lnTotal: Float64Array;
  /** Index k of every edge discontinuity: energy[k] === energy[k + 1]. */
  jumps: number[];
}

interface XrayDatabase {
  info: XrayDataInfo;
  elements: Map<string, ElementTable>;
  minEnergy: number;
  maxEnergy: number;
}

let database: XrayDatabase | null = null;
let loading: Promise<XrayDataInfo> | null = null;

function buildDatabase(raw: RawXrayFile): XrayDatabase {
  const elements = new Map<string, ElementTable>();
  for (const item of raw.elements) {
    const edges = item.edges.map(([edge, energy_eV, jumpRatio, fluorescenceYield]) => ({
      element: item.symbol, Z: item.Z, edge, energy_eV, jumpRatio, fluorescenceYield,
    }));
    const jumps: number[] = [];
    for (let k = 0; k + 1 < item.energy.length; k++) if (item.energy[k] === item.energy[k + 1]) jumps.push(k);
    elements.set(item.symbol, {
      Z: item.Z, symbol: item.symbol, name: item.name, molarMass: item.mass, edges,
      energy: item.energy,
      lnEnergy: Float64Array.from(item.energy, Math.log),
      lnPhoto: Float64Array.from(item.photo, Math.log),
      lnTotal: Float64Array.from(item.total, Math.log),
      jumps,
    });
  }
  const { source, license, citations, energyRange_eV, limitations, accuracy } = raw;
  return {
    info: { source, license, citations, energyRange_eV, limitations, accuracy },
    elements, minEnergy: energyRange_eV[0], maxEnergy: energyRange_eV[1],
  };
}

/** Loads the element table once (dynamic import, so it ships as its own chunk). */
export function loadXrayData(): Promise<XrayDataInfo> {
  loading ??= import('../data/xray/elements.json')
    .then(module => {
      database = buildDatabase(module.default as unknown as RawXrayFile);
      return database.info;
    })
    .catch(error => {
      loading = null; // allow a retry after a failed chunk load
      throw error;
    });
  return loading;
}

export function isXrayDataLoaded(): boolean {
  return database !== null;
}

function data(): XrayDatabase {
  if (!database) throw new Error('X-ray data is not loaded yet: await loadXrayData() first.');
  return database;
}

export function xrayDataInfo(): XrayDataInfo {
  return data().info;
}

function table(symbol: string): ElementTable {
  const element = data().elements.get(symbol);
  if (!element) throw new Error(`Unknown element symbol "${symbol}" (tabulated elements are H to Cf, Z = 1-98).`);
  return element;
}

export function elementInfo(symbol: string): ElementInfo {
  const { Z, name, molarMass, edges } = table(symbol);
  return { Z, symbol, name, molarMass, edges: edges.map(edge => ({ ...edge })) };
}

// ---------------------------------------------------------------- formula parsing

const SEPARATORS = '·•∙⋅*';
const CLOSING: Record<string, string> = { '(': ')', '[': ']' };

/**
 * Parses a chemical formula into atom counts, e.g. 'Ca3(PO4)2', 'LiNi0.5Mn1.5O4',
 * 'CuSO4·5H2O', 'CuSO4.5H2O', '[Cu(NH3)4]SO4'. Hydrate or adduct units are joined with
 * '·', '•', '*' or '.'. A '.' between digits is a decimal point, except right before a
 * water of hydration ('CuSO4.5H2O', 'CaSO4.0.5H2O'); use '·' for other adducts.
 * Symbols are case-sensitive ('CO' is carbon monoxide, 'Co' is cobalt).
 */
export function parseFormula(formula: string): Composition {
  if (typeof formula !== 'string') throw new Error('Formula must be text.');
  const s = formula.trim().replace(/\s*([·•∙⋅*])\s*/g, '$1');
  if (!s) throw new Error('Formula is empty.');
  let i = 0;
  const fail = (message: string): never => { throw new Error(`${message} (in "${s}")`); };
  const at = (index: number) => `position ${index + 1}`;

  const merge = (target: Composition, source: Composition, factor: number) => {
    for (const [symbol, count] of Object.entries(source)) target[symbol] = (target[symbol] ?? 0) + count * factor;
  };

  // A '.' after count digits is a hydrate dot when what follows is "<n>H2O" ending a unit.
  const isHydrateDot = (dot: number, integerPart: string) =>
    integerPart !== '0' && /^\d+(?:\.\d+)?H2O(?=$|[·•∙⋅*.])/.test(s.slice(dot + 1));

  const readNumber = (kind: 'count' | 'coefficient'): number | null => {
    const start = i;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    if (i === start) return null;
    if (s[i] === '.' && /\d/.test(s[i + 1] ?? '') && !(kind === 'count' && isHydrateDot(i, s.slice(start, i)))) {
      i++;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    }
    const value = Number(s.slice(start, i));
    if (!(value > 0) || !Number.isFinite(value)) fail(`${kind === 'count' ? 'Count' : 'Coefficient'} at ${at(start)} must be greater than zero`);
    return value;
  };

  const readGroups = (closing: string | null): Composition => {
    const out: Composition = {};
    while (i < s.length) {
      const c = s[i];
      if (c === closing) return out;
      if (c in CLOSING) {
        const open = i++;
        const inner = readGroups(CLOSING[c]);
        if (s[i] !== CLOSING[c]) fail(`Missing "${CLOSING[c]}" for the "${c}" at ${at(open)}`);
        if (!Object.keys(inner).length) fail(`Empty brackets at ${at(open)}`);
        i++;
        merge(out, inner, readNumber('count') ?? 1);
      } else if (c === ')' || c === ']') {
        fail(closing ? `Mismatched "${c}" at ${at(i)}: expected "${closing}"` : `Unexpected "${c}" at ${at(i)}: no matching opening bracket`);
      } else if (c >= 'A' && c <= 'Z') {
        const start = i++;
        if (s[i] >= 'a' && s[i] <= 'z') i++;
        const symbol = s.slice(start, i);
        if (!SYMBOL_SET.has(symbol)) fail(`Unknown element symbol "${symbol}" at ${at(start)}; tabulated elements are H to Cf (Z = 1-98) and symbols are case-sensitive`);
        merge(out, { [symbol]: 1 }, readNumber('count') ?? 1);
      } else if (c >= 'a' && c <= 'z') {
        fail(`"${c}" at ${at(i)} cannot start an element symbol: symbols begin with a capital letter (e.g. "Fe", not "fe")`);
      } else if (c === '.' || SEPARATORS.includes(c)) {
        if (closing) fail(`Hydrate separator "${c}" at ${at(i)} is not allowed inside brackets`);
        return out;
      } else if (c >= '0' && c <= '9') {
        fail(`Unexpected number at ${at(i)}: counts follow an element symbol or a closing bracket`);
      } else {
        fail(`Unexpected character "${c}" at ${at(i)}`);
      }
    }
    return out;
  };

  const result: Composition = {};
  for (;;) {
    const unitStart = i;
    const coefficient = readNumber('coefficient');
    const unit = readGroups(null);
    if (!Object.keys(unit).length) {
      if (i >= s.length) fail(coefficient === null ? `Expected a formula unit at ${at(unitStart)}` : `Coefficient at ${at(unitStart)} must be followed by a formula unit`);
      fail(`Expected an element symbol at ${at(i)}, found "${s[i]}"`);
    }
    merge(result, unit, coefficient ?? 1);
    if (i >= s.length) return result;
    i++; // separator
    if (i >= s.length) fail(`Expected a formula unit after "${s[i - 1]}" at ${at(i - 1)}`);
  }
}

function toComposition(formula: string | Composition): Composition {
  if (typeof formula === 'string') return parseFormula(formula);
  const entries = Object.entries(formula);
  if (!entries.length) throw new Error('Composition is empty.');
  for (const [symbol, count] of entries) {
    if (!SYMBOL_SET.has(symbol)) throw new Error(`Unknown element symbol "${symbol}" (tabulated elements are H to Cf, Z = 1-98).`);
    if (!(count > 0) || !Number.isFinite(count)) throw new Error(`Count for ${symbol} must be a positive number.`);
  }
  return formula;
}

/** Molar mass in g/mol. */
export function molarMass(formula: string | Composition): number {
  return Object.entries(toComposition(formula)).reduce((sum, [symbol, count]) => sum + count * table(symbol).molarMass, 0);
}

/** Mass fraction of each element (sums to 1). */
export function massFractions(formula: string | Composition): Record<string, number> {
  const composition = toComposition(formula);
  const total = molarMass(composition);
  return Object.fromEntries(Object.entries(composition).map(([symbol, count]) => [symbol, count * table(symbol).molarMass / total]));
}

// ---------------------------------------------------------------- interpolation

function requireEnergy(energy_eV: number) {
  const { minEnergy, maxEnergy } = data();
  if (!Number.isFinite(energy_eV) || energy_eV < minEnergy || energy_eV > maxEnergy) {
    throw new RangeError(`Energy ${fmt(energy_eV)} eV is outside the tabulated range ${fmt(minEnergy)} eV to ${fmt(maxEnergy / 1000)} keV.`);
  }
}

function requirePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number.`);
}

/** Straight line in ln(E)-ln(mu/rho) through knots i and j, evaluated at energy (also extrapolates). */
function lineAt(el: ElementTable, i: number, j: number, energy: number): CrossSection {
  const t = (Math.log(energy) - el.lnEnergy[i]) / (el.lnEnergy[j] - el.lnEnergy[i]);
  return {
    photo: Math.exp(el.lnPhoto[i] + t * (el.lnPhoto[j] - el.lnPhoto[i])),
    total: Math.exp(el.lnTotal[i] + t * (el.lnTotal[j] - el.lnTotal[i])),
  };
}

/** Tabulated mu/rho of one element; at exactly an edge energy the value above the edge applies. */
function elementCrossSection(el: ElementTable, energy: number): CrossSection {
  const e = el.energy;
  let lo = 0, hi = e.length - 1;
  if (energy >= e[hi]) return { photo: Math.exp(el.lnPhoto[hi]), total: Math.exp(el.lnTotal[hi]) };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (e[mid] <= energy) lo = mid; else hi = mid;
  }
  return lineAt(el, lo, hi, energy);
}

function findEdge(symbol: string, edge: string): XrayEdge {
  const el = table(symbol);
  const label = edge.trim().toUpperCase();
  const found = el.edges.find(item => item.edge.toUpperCase() === label);
  if (!found) throw new Error(`${symbol} has no "${edge}" edge; tabulated edges: ${el.edges.map(item => item.edge).join(', ')}.`);
  return found;
}

/** Index k of the tabulated discontinuity for a listed edge, or -1 if the table has no step there. */
function jumpIndex(el: ElementTable, edgeEnergy: number): number {
  let best = -1;
  for (const k of el.jumps) {
    if (Math.abs(el.energy[k] / edgeEnergy - 1) < 2e-3 && (best < 0 || Math.abs(el.energy[k] - edgeEnergy) < Math.abs(el.energy[best] - edgeEnergy))) best = k;
  }
  return best;
}

/** Tabulated mu/rho (cm^2/g) of a single element. */
export function elementMuOverRho(symbol: string, energy_eV: number): CrossSection {
  requireEnergy(energy_eV);
  return elementCrossSection(table(symbol), energy_eV);
}

/**
 * mu/rho of one element continued smoothly across one of its edges: 'below' extends the
 * segment under the edge upward, 'above' extends the segment over the edge downward
 * (straight lines in ln-ln). Away from the edge each side equals the tabulated value.
 */
export function elementMuOverRhoSide(symbol: string, edge: string, energy_eV: number, side: EdgeSide): CrossSection {
  requireEnergy(energy_eV);
  const el = table(symbol);
  const k = jumpIndex(el, findEdge(symbol, edge).energy_eV);
  if (k < 0) return elementCrossSection(el, energy_eV);
  if (side === 'below') return energy_eV < el.energy[k] ? elementCrossSection(el, energy_eV) : lineAt(el, k - 1, k, energy_eV);
  return energy_eV >= el.energy[k + 1] ? elementCrossSection(el, energy_eV) : lineAt(el, k + 1, k + 2, energy_eV);
}

/** Mass attenuation coefficient mu/rho of a compound in cm^2/g. */
export function muOverRho(formula: string | Composition, energy_eV: number): CrossSection {
  requireEnergy(energy_eV);
  const out = { photo: 0, total: 0 };
  for (const [symbol, w] of Object.entries(massFractions(formula))) {
    const value = elementCrossSection(table(symbol), energy_eV);
    out.photo += w * value.photo;
    out.total += w * value.total;
  }
  return out;
}

/** Linear attenuation coefficient mu in 1/cm for density in g/cm^3. */
export function mu(formula: string | Composition, density: number, energy_eV: number): CrossSection {
  requirePositive(density, 'Density');
  const value = muOverRho(formula, energy_eV);
  return { photo: value.photo * density, total: value.total * density };
}

/**
 * Total mu (1/cm) of a compound with the absorber's cross section continued across one edge
 * (see elementMuOverRhoSide). Used to draw broadened model edges.
 */
export function muAcrossEdge(formula: string | Composition, density: number, absorber: string, edge: string, energy_eV: number, side: EdgeSide): number {
  requirePositive(density, 'Density');
  requireEnergy(energy_eV);
  let total = 0;
  for (const [symbol, w] of Object.entries(massFractions(formula))) {
    total += w * (symbol === absorber ? elementMuOverRhoSide(symbol, edge, energy_eV, side) : elementCrossSection(table(symbol), energy_eV)).total;
  }
  return total * density;
}

/** Attenuation length 1/mu_total in micrometres. */
export function attenuationLengthUm(formula: string | Composition, density: number, energy_eV: number): number {
  return 1e4 / mu(formula, density, energy_eV).total;
}

/** Transmitted fraction I/I0 = exp(-mu_total d) of a uniform layer. */
export function transmittance(formula: string | Composition, density: number, thicknessUm: number, energy_eV: number): number {
  if (!Number.isFinite(thicknessUm) || thicknessUm < 0) throw new Error('Thickness must be zero or a positive number of micrometres.');
  return Math.exp(-mu(formula, density, energy_eV).total * thicknessUm * 1e-4);
}

// ---------------------------------------------------------------- edges

/** Every tabulated edge of every element in the formula, sorted by energy (ascending). */
export function edgesOf(formula: string | Composition): XrayEdge[] {
  return Object.keys(toComposition(formula))
    .flatMap(symbol => elementInfo(symbol).edges)
    .sort((a, b) => a.energy_eV - b.energy_eV || a.Z - b.Z);
}

/** Edges inside a beamline energy range (default: hard X-rays, 2-35 keV). */
export function edgesInRange(formula: string | Composition, range: EnergyRange = BEAMLINE_RANGES.hard): XrayEdge[] {
  return edgesOf(formula).filter(edge => edge.energy_eV >= range.min_eV && edge.energy_eV <= range.max_eV);
}

export interface EdgeStep {
  absorber: string;
  edge: string;
  /** Listed edge energy (Elam); the tabulated jump sits within about 0.01 % of it. */
  edgeEnergy_eV: number;
  absorberMassFraction: number;
  /** Compound total mu/rho just below and just above the edge, cm^2/g. */
  muOverRhoBelow: number;
  muOverRhoAbove: number;
  deltaMuOverRho: number;
  muBelow_cm_inv: number;
  muAbove_cm_inv: number;
  deltaMu_cm_inv: number;
}

/** Edge step of one absorber edge in a compound, from the tabulated discontinuity. */
export function edgeStep(formula: string | Composition, absorber: string, edge: string, density: number): EdgeStep {
  requirePositive(density, 'Density');
  const fractions = massFractions(formula);
  if (!(absorber in fractions)) throw new Error(`Absorber "${absorber}" is not in the formula.`);
  const listed = findEdge(absorber, edge);
  const { minEnergy, maxEnergy } = data();
  if (listed.energy_eV < minEnergy || listed.energy_eV > maxEnergy) {
    throw new RangeError(`The ${absorber} ${listed.edge} edge (${fmt(listed.energy_eV)} eV) is outside the tabulated range ${fmt(minEnergy)} eV to ${fmt(maxEnergy / 1000)} keV, so its edge step cannot be computed.`);
  }
  const el = table(absorber);
  const k = jumpIndex(el, listed.energy_eV);
  const energy = k < 0 ? listed.energy_eV : el.energy[k];
  let below = 0, above = 0;
  for (const [symbol, w] of Object.entries(fractions)) {
    if (symbol === absorber && k >= 0) {
      below += w * Math.exp(el.lnTotal[k]);
      above += w * Math.exp(el.lnTotal[k + 1]);
    } else {
      const value = w * elementCrossSection(table(symbol), energy).total;
      below += value;
      above += value;
    }
  }
  return {
    absorber, edge: listed.edge, edgeEnergy_eV: listed.energy_eV, absorberMassFraction: fractions[absorber],
    muOverRhoBelow: below, muOverRhoAbove: above, deltaMuOverRho: above - below,
    muBelow_cm_inv: below * density, muAbove_cm_inv: above * density, deltaMu_cm_inv: (above - below) * density,
  };
}

// ---------------------------------------------------------------- sample planning

const TARGET_EDGE_STEP = 1;      // Δμ·d for transmission
export const MAX_TOTAL_ABSORPTION = 3;  // μ_total·d just above the edge
export const SOFT_EDGE_eV = 2000;       // soft-edge mode-advice threshold
const MIN_TRANSMISSION_STEP = 0.3;
const SELF_ABSORPTION_RATIO = 0.1;
/** 13 mm pellet die. */
export const DEFAULT_PELLET_AREA_CM2 = Math.PI * 0.65 ** 2;

export interface ThicknessOptions {
  /** Pellet or sample area in cm^2 (default: 13 mm die, 1.327 cm^2). */
  pelletArea_cm2?: number;
  /** Optional diluent mixed into the pellet. */
  diluent?: { material: Diluent; mass_mg: number };
}

export interface ThicknessRecommendation {
  edgeStep: EdgeStep;
  limitedBy: 'edge-step' | 'total-absorption';
  /** Thickness of a uniform, fully dense layer. */
  thickness_um: number;
  massPerArea_mg_cm2: number;
  pelletArea_cm2: number;
  sampleMass_mg: number;
  achievedEdgeStep: number;
  /** μ_total·d of the sample just above the edge. */
  totalAbsorptionAbove: number;
  diluent: { material: Diluent; formula: string; mass_mg: number; totalAbsorptionAbove: number } | null;
  totalAbsorptionWithDiluent: number;
  notes: string[];
}

/**
 * Transmission sample: aim for an edge step Δμ·d = 1 while μ_total·d just above the edge
 * stays at or below 3; if both cannot hold, the total-absorption limit wins. Reports the
 * equivalent dense thickness and the sample mass for the pellet area.
 */
export function recommendThickness(formula: string | Composition, absorber: string, edge: string, density: number, options: ThicknessOptions = {}): ThicknessRecommendation {
  const area = options.pelletArea_cm2 ?? DEFAULT_PELLET_AREA_CM2;
  requirePositive(area, 'Pellet area');
  const step = edgeStep(formula, absorber, edge, density);
  if (!(step.deltaMuOverRho > 0)) throw new Error(`The ${absorber} ${step.edge} edge has no step in the tabulated data, so no transmission thickness can be derived.`);

  let massPerArea = TARGET_EDGE_STEP / step.deltaMuOverRho; // g/cm^2
  let limitedBy: ThicknessRecommendation['limitedBy'] = 'edge-step';
  if (massPerArea * step.muOverRhoAbove > MAX_TOTAL_ABSORPTION) {
    massPerArea = MAX_TOTAL_ABSORPTION / step.muOverRhoAbove;
    limitedBy = 'total-absorption';
  }
  const thickness_um = massPerArea / density * 1e4;
  const achievedEdgeStep = massPerArea * step.deltaMuOverRho;
  const totalAbsorptionAbove = massPerArea * step.muOverRhoAbove;
  const notes: string[] = [];

  let diluent: ThicknessRecommendation['diluent'] = null;
  if (options.diluent) {
    const { material, mass_mg } = options.diluent;
    if (!(material in DILUENTS)) throw new Error(`Unknown diluent "${material}"; use BN or cellulose.`);
    if (!Number.isFinite(mass_mg) || mass_mg < 0) throw new Error('Diluent mass must be zero or a positive number of mg.');
    const energy = step.edgeEnergy_eV;
    const diluentMuRho = muOverRho(DILUENTS[material], energy).total;
    diluent = { material, formula: DILUENTS[material], mass_mg, totalAbsorptionAbove: diluentMuRho * mass_mg / 1000 / area };
  }
  const totalAbsorptionWithDiluent = totalAbsorptionAbove + (diluent?.totalAbsorptionAbove ?? 0);

  if (limitedBy === 'total-absorption') notes.push(`Edge step limited to ${fmt(achievedEdgeStep)} because total absorption reaches ${MAX_TOTAL_ABSORPTION} first: the absorber is dilute in this matrix, so fluorescence is likely better.`);
  if (diluent && totalAbsorptionWithDiluent > MAX_TOTAL_ABSORPTION) notes.push(`The ${fmt(diluent.mass_mg)} mg of ${diluent.material} raises total absorption to ${fmt(totalAbsorptionWithDiluent)}; use less diluent or a larger pellet.`);
  if (step.edgeEnergy_eV < SOFT_EDGE_eV) notes.push(`Soft X-ray edge: the calculated layer is ${fmt(thickness_um)} µm thick at the supplied density. Check the sample support and beamline's soft X-ray transmission capability.`);
  notes.push('Thickness assumes a uniform, fully dense layer; for powders the mass per area is what matters, and pinholes or large particles distort the edge step.');

  return {
    edgeStep: step, limitedBy, thickness_um, massPerArea_mg_cm2: massPerArea * 1000, pelletArea_cm2: area,
    sampleMass_mg: massPerArea * area * 1000, achievedEdgeStep, totalAbsorptionAbove, diluent, totalAbsorptionWithDiluent, notes,
  };
}

export interface ModeRecommendation {
  mode: 'transmission' | 'fluorescence';
  absorberMassFraction: number;
  /** Δμ / μ_total just above the edge: the share of absorption the edge itself provides. */
  stepToTotalRatio: number;
  /** Best edge step reachable with μ_total·d ≤ 3, capped at 1. */
  achievableEdgeStep: number;
  fluorescenceYield: number;
  /** A thick, concentrated sample would show damped (self-absorbed) fluorescence. */
  selfAbsorptionRisk: boolean;
  reason: string;
}

/**
 * Transmission when an edge step of at least 0.3 is reachable with μ_total·d ≤ 3 on a hard
 * X-ray edge; otherwise fluorescence. Soft edges (< 2 keV) always get fluorescence (or
 * electron yield). Rules of thumb only; the beamline's detectors decide in the end.
 */
export function recommendMode(formula: string | Composition, absorber: string, edge: string): ModeRecommendation {
  const step = edgeStep(formula, absorber, edge, 1);
  const ratio = step.deltaMuOverRho / step.muOverRhoAbove;
  const achievableEdgeStep = Math.min(TARGET_EDGE_STEP, MAX_TOTAL_ABSORPTION * ratio);
  const fluorescenceYield = findEdge(absorber, edge).fluorescenceYield;
  const selfAbsorptionRisk = ratio > SELF_ABSORPTION_RATIO;
  const percent = fmt(step.absorberMassFraction * 100);
  const lowYield = fluorescenceYield < 0.05 ? ` The fluorescence yield is only ${fmt(fluorescenceYield * 100)} %, so total electron yield is often preferred.` : '';
  const selfAbsorption = selfAbsorptionRisk ? ' The absorber is concentrated, so fluorescence from a thick sample is damped by self-absorption; use a thin or diluted sample.' : '';
  let mode: ModeRecommendation['mode'];
  let reason: string;
  if (step.edgeEnergy_eV < SOFT_EDGE_eV) {
    mode = 'fluorescence';
    reason = `Soft X-ray edge (${fmt(step.edgeEnergy_eV)} eV): check sample thickness, windows and the beamline's available detection modes.${lowYield}${selfAbsorption}`;
  } else if (achievableEdgeStep >= MIN_TRANSMISSION_STEP) {
    mode = 'transmission';
    reason = `An edge step of ${fmt(achievableEdgeStep)} is reachable while total absorption stays at or below ${MAX_TOTAL_ABSORPTION} (absorber ${percent} % by mass).`;
  } else {
    mode = 'fluorescence';
    reason = `Only an edge step of ${fmt(achievableEdgeStep)} is reachable before total absorption reaches ${MAX_TOTAL_ABSORPTION}: the absorber (${percent} % by mass) is too dilute for good transmission data.${lowYield}`;
  }
  return { mode, absorberMassFraction: step.absorberMassFraction, stepToTotalRatio: ratio, achievableEdgeStep, fluorescenceYield, selfAbsorptionRisk, reason };
}
