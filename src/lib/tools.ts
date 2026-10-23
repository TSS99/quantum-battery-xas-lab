// The four calculator pages (/tools/...): thin wrappers over the twin's tabulated models, used both for the tables
// printed into the static HTML and by the live calculators. Every function needs the X-ray tables (loadXrayData) and,
// for gases and mirrors, the optics tables (loadOptics) to be loaded first.
import { CHAMBER_FILLS, absorbedFraction, suggestGas, type ChamberRole, type GasMix, type GasSuggestion } from './twin/chambers';
import { cutoffEnergy_eV, harmonicRejectionAngle } from './twin/mirrors';
import { mirrorReflectivity } from './twin/tables';
import { fluorescenceFromMu, fluorescenceLine, muComponents, sharpEdge } from './twin/sample';
import { TEACHING_CRITICAL_DOSE_Gy, doseRate, type DamageClass, type DoseInput, type DoseRate } from './twin/damage';
import { elementInfo, mu } from './xraydata';
import type { MirrorCoating, SampleConfig } from './twin/types';

/** Edge energy in eV, from the tabulated edges of one element. */
export function edgeOf(symbol: string, edge: string): number {
  const found = elementInfo(symbol).edges.find(e => e.edge === edge);
  if (!found) throw new Error(`${symbol} has no tabulated ${edge} edge.`);
  return found.energy_eV;
}

/** "N₂ 80 %, Ar 20 %" for a gas mix, heaviest share first. */
export function mixLabel(mix: GasMix): string {
  const name = (gas: string) => gas === 'N2' ? 'N₂' : gas;
  const parts = Object.entries(mix).filter(([, share]) => share! > 0).sort((a, b) => b[1]! - a[1]!);
  return parts.length === 1 ? name(parts[0][0]) : parts.map(([gas, share]) => `${name(gas)} ${Math.round(share! * 100)} %`).join(', ');
}

/* ---------- Ion chamber gas ---------- */

export interface GasPlan {
  energy_eV: number;
  length_cm: number;
  role: ChamberRole;
  suggestion: GasSuggestion;
  /** The standard fills on offer in the twin, with the fraction each one absorbs here. */
  fills: { id: string; label: string; absorbed: number }[];
}

/** The suggested fill for one chamber, and what each standard fill would absorb. */
export function gasPlan(energy_eV: number, length_cm: number, role: ChamberRole): GasPlan {
  return {
    energy_eV, length_cm, role,
    suggestion: suggestGas(energy_eV, role, length_cm),
    fills: CHAMBER_FILLS.map(fill => ({ id: fill.id, label: mixLabel(fill.gas), absorbed: absorbedFraction(fill.gas, length_cm, energy_eV).absorbed })),
  };
}

/* ---------- Harmonic rejection mirror ---------- */

export type MirrorChoice =
  | { ok: true; coating: MirrorCoating; energy_eV: number; angle_mrad: number; cutoff_eV: number | null; fundamental: number; harmonic: number }
  | { ok: false; coating: MirrorCoating; energy_eV: number; reason: string };

/**
 * The largest tabulated mirror angle that keeps at least 80 % of the fundamental and passes at most 1 % of the third
 * harmonic in one bounce, with the cutoff (50 % reflectivity) at that angle and both reflectivities.
 */
export function mirrorChoice(coating: MirrorCoating, energy_eV: number): MirrorChoice {
  let angle: number | null;
  try { angle = harmonicRejectionAngle(coating, energy_eV); }
  catch (error) { return { ok: false, coating, energy_eV, reason: (error as Error).message }; }
  if (angle === null) return { ok: false, coating, energy_eV, reason: `No tabulated angle keeps 80 % at ${Math.round(energy_eV)} eV while passing at most 1 % at ${Math.round(3 * energy_eV)} eV.` };
  return {
    ok: true, coating, energy_eV, angle_mrad: angle, cutoff_eV: cutoffEnergy_eV(coating, angle),
    fundamental: mirrorReflectivity(coating, angle, energy_eV), harmonic: mirrorReflectivity(coating, angle, 3 * energy_eV),
  };
}

/* ---------- Fluorescence self absorption ---------- */

export interface SelfAbsorptionInput {
  formula: string;
  density: number;
  thickness_um: number;
  absorber: string;
  edge: string;
  incidence_deg: number;
  exit_deg: number;
}

export interface SelfAbsorptionPoint {
  label: string;
  energy_eV: number;
  /** Fraction of the true fine structure the fluorescence signal shows: 1 means no self absorption. */
  kept: number;
}

export interface SelfAbsorption {
  edge_eV: number;
  line: { group: string; energy_eV: number };
  /** (mu_T(E)/sin phi + mu_T(E_f)/sin psi) d just above the edge: below about 0.1 the sample is thin. */
  exponent: number;
  points: SelfAbsorptionPoint[];
}

/** k = 7 per angstrom above the edge: E - E0 = hbar^2 k^2 / 2m = 3.81 eV x 49. */
export const EXAFS_K = 7;
const EXAFS_OFFSET_eV = 3.80998 * EXAFS_K ** 2;

/**
 * How much of the fine structure survives self absorption, from the finite-thickness fluorescence equation (Booth and
 * Bridges 2005) that the twin uses. The kept fraction is the sensitivity d ln I_f / d ln mu_a: a small wiggle in the
 * absorber's mu shows at this fraction of its size. It is 1 for a thin or dilute sample and falls to 1 - mu_a/alpha
 * for a thick, concentrated one.
 */
export function selfAbsorption(input: SelfAbsorptionInput): SelfAbsorption {
  const edge_eV = edgeOf(input.absorber, input.edge);
  const sample: SampleConfig = {
    formula: input.formula, density: input.density, thickness_um: input.thickness_um, absorber: input.absorber, edge: input.edge,
    form: 'pellet', pinholeFraction: 0, thicknessSpread: 0, particle_um: 0, incidence_deg: input.incidence_deg,
  };
  const line = fluorescenceLine(input.absorber, input.edge);
  const muOut = mu(input.formula, input.density, line.energy_eV).total;
  const at = (energy_eV: number) => {
    const parts = muComponents(sample, energy_eV, { fineStructure: sharpEdge(edge_eV) });
    const signal = (muA: number) => fluorescenceFromMu({
      muAbsorber_cm_inv: muA, muTotalIn_cm_inv: parts.rest_cm_inv + muA, muTotalOut_cm_inv: muOut,
      thickness_um: input.thickness_um, incidence_deg: input.incidence_deg, exit_deg: input.exit_deg, prefactor: 1,
    });
    const h = 1e-4, muA = parts.absorber_cm_inv;
    return { kept: (signal(muA * (1 + h)).ratio - signal(muA * (1 - h)).ratio) / (2 * h * signal(muA).ratio), exponent: signal(muA).depthIntegralExponent };
  };
  const whiteLine = at(edge_eV + 10), exafs = at(edge_eV + EXAFS_OFFSET_eV);
  return {
    edge_eV, line: { group: line.group, energy_eV: line.energy_eV }, exponent: whiteLine.exponent,
    points: [
      { label: 'White line', energy_eV: edge_eV + 10, kept: whiteLine.kept },
      { label: 'EXAFS', energy_eV: edge_eV + EXAFS_OFFSET_eV, kept: exafs.kept },
    ],
  };
}

/* ---------- Dose ---------- */

export interface DosePlan extends DoseRate {
  /** Seconds to reach each teaching threshold at the mean dose rate. */
  timeTo: { kind: DamageClass; dose_Gy: number; seconds: number }[];
}

/** What each teaching damage threshold stands for. */
export const DAMAGE_KIND_LABEL: Record<DamageClass, string> = {
  solution: 'Metal complex in water', biological: 'Biological, hydrated or frozen', operando: 'Operando cell, electrolyte and binder', oxide: 'Dry oxide powder or foil',
};

/** Dose rate in the illuminated volume and the time to each teaching damage threshold. */
export function dosePlan(input: DoseInput): DosePlan {
  const rate = doseRate(input);
  return {
    ...rate,
    timeTo: (Object.entries(TEACHING_CRITICAL_DOSE_Gy) as [DamageClass, number][]).map(([kind, dose_Gy]) => ({ kind, dose_Gy, seconds: dose_Gy / rate.meanRate_Gy_per_s })),
  };
}

/* ---------- Worked examples printed on the pages ---------- */

/** Common edges for the gas table: [label, element, edge]. */
export const GAS_EXAMPLE_EDGES: [string, string, string][] = [
  ['Ti K', 'Ti', 'K'], ['Mn K', 'Mn', 'K'], ['Fe K', 'Fe', 'K'], ['Ni K', 'Ni', 'K'], ['Cu K', 'Cu', 'K'], ['Zn K', 'Zn', 'K'],
  ['Pt L3', 'Pt', 'L3'], ['Se K', 'Se', 'K'], ['Mo K', 'Mo', 'K'],
];
export const MIRROR_EXAMPLE_ENERGIES_eV = [5000, 7000, 9000, 12000, 15000, 20000];
export const MIRROR_COATINGS_SHOWN: MirrorCoating[] = ['Si', 'Ni', 'Rh', 'Pt'];

export const SELF_ABSORPTION_EXAMPLES: { label: string; input: SelfAbsorptionInput }[] = [
  { label: 'NiO pellet, 200 µm', input: { formula: 'NiO', density: 3.5, thickness_um: 200, absorber: 'Ni', edge: 'K', incidence_deg: 45, exit_deg: 45 } },
  { label: 'NiO pellet diluted 1 to 20 in BN', input: { formula: 'NiO(BN)20', density: 1.6, thickness_um: 500, absorber: 'Ni', edge: 'K', incidence_deg: 45, exit_deg: 45 } },
  { label: 'Ni foil, 5 µm', input: { formula: 'Ni', density: 8.9, thickness_um: 5, absorber: 'Ni', edge: 'K', incidence_deg: 45, exit_deg: 45 } },
  { label: 'Cu foil, 1 µm at 10° exit', input: { formula: 'Cu', density: 8.96, thickness_um: 1, absorber: 'Cu', edge: 'K', incidence_deg: 45, exit_deg: 10 } },
  { label: 'LiMn₂O₄ electrode, 60 µm', input: { formula: 'LiMn2O4', density: 2.5, thickness_um: 60, absorber: 'Mn', edge: 'K', incidence_deg: 45, exit_deg: 45 } },
  { label: 'Fe 2 mM in water, 1 mm', input: { formula: 'FeH55500O27750', density: 1, thickness_um: 1000, absorber: 'Fe', edge: 'K', incidence_deg: 45, exit_deg: 45 } },
];

export const DOSE_EXAMPLES: { label: string; input: DoseInput }[] = [
  { label: 'Bending magnet, unfocused 1 × 0.5 mm, Cu(II) 10 mM in water', input: { flux: 1e11, energy_eV: 9000, beam_um: [1000, 500], formula: 'CuH11100O5550', density: 1, thickness_um: 1000 } },
  { label: 'Undulator, focused 50 × 50 µm, same solution', input: { flux: 1e13, energy_eV: 9000, beam_um: [50, 50], formula: 'CuH11100O5550', density: 1, thickness_um: 1000 } },
  { label: 'Undulator, focused 50 × 50 µm, LiMn₂O₄ electrode 60 µm', input: { flux: 1e13, energy_eV: 6600, beam_um: [50, 50], formula: 'LiMn2O4', density: 2.5, thickness_um: 60 } },
  { label: 'Microprobe, 2 × 2 µm, Fe₂O₃ powder 20 µm', input: { flux: 1e11, energy_eV: 7200, beam_um: [2, 2], formula: 'Fe2O3', density: 2.6, thickness_um: 20 } },
];
