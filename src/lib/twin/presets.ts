/**
 * Generic beamline profiles and sample presets for the twin. Never real facility names: the
 * profiles follow the three generic presets of plan 3.8 and dossier 14, whose numbers are typical
 * published values, not any one beamline. Every other number is either cited or labelled a
 * teaching value.
 */
import { COMPOUND_PRESETS } from '../../data/compound-presets';
import { edgeEnergy } from './acquire';
import { muComponents } from './sample';
import type { DamageClass } from './damage';
import type { EnvironmentConfig, ReferenceFoil, SampleConfig, TwinProfile } from './types';

export interface ProfilePreset {
  id: string;
  name: string;
  /** Energy range the monochromator covers with this preset, eV. */
  range_eV: [number, number];
  profile: TwinProfile;
  /** Sample preset that suits the range, used when a profile change leaves the sample's edge out of reach. */
  sample: string;
}

/**
 * Dossier 14.1: 3.0 GeV, 1.4 T, 0.3 A bending magnet, collimating and focusing mirrors, Si(111).
 * Harmonic rejection: a Si stripe at about 3 mrad for 4.5 to 9 keV (dossier 14.1); the twin sets
 * the angle from mirrors.ts when it is inserted. Chamber fills put I0 near 10 % and It near 70 %
 * absorbed at the Cu K edge (chambers.ts FILL_TARGETS); gains keep the amplifiers between about
 * 0.2 and 5 V for the default Cu K scan. Beam size 500 x 200 um and the stability numbers are
 * teaching values inside the 0.1 to 1 mm focused range of dossier 14.1.
 */
const BM3: TwinProfile = {
  format: 'xaslab-twin-profile/1',
  name: '3 GeV bending magnet, hard X-rays',
  preset: 'bm3',
  source: { kind: 'bending-magnet', ring_GeV: 3, current_mA: 300, field_T: 1.4, hAccept_mrad: 1, vDiv_urad: 20 },
  mirrors: [
    { id: 'M1', role: 'collimating', coating: 'Rh', angle_mrad: 3, inserted: true },
    { id: 'M2', role: 'focusing', coating: 'Rh', angle_mrad: 3, inserted: true },
    { id: 'M3', role: 'harmonic-rejection', coating: 'Si', angle_mrad: 3, inserted: false },
  ],
  mono: { crystal: 'Si111', offset_eV: 0, detune: 0, glitchSeed: 1 },
  chambers: [
    { id: 'I0', length_cm: 15, gas: { N2: 1 }, gain_V_per_A: 1e5, dark_A: 0 },
    { id: 'It', length_cm: 30, gas: { N2: 0.5, Ar: 0.5 }, gain_V_per_A: 1e5, dark_A: 0 },
    { id: 'Iref', length_cm: 30, gas: { N2: 0.5, Ar: 0.5 }, gain_V_per_A: 1e6, dark_A: 0 },
  ],
  // Window around Cu Ka1 and Ka2 (8046.3 and 8026.7 eV in xraydb); the twin re-centres it on the line of the chosen edge.
  sdd: { elements: 4, distance_mm: 30, area_mm2: 50, peaking_us: 1, roi_eV: [7890, 8190], soller: false, exitAngle_deg: 45 },
  beam_um: [500, 200],
  stability: { i0Noise: 1e-3, drift_eV_per_h: 0.1 },
};

/**
 * Dossier 14.2: 6 GeV undulator (2.7 cm period, 74 periods, about 2 m; K up to 2 is a teaching
 * value), Si(111) with Si(311) on the same stage, Rh mirrors at 3 mrad for harmonic rejection
 * and focusing. The 200 x 100 um defocused spot is the dose-control setting of dossier 14.2.
 */
const UND6: TwinProfile = {
  ...BM3,
  name: '6 GeV undulator, hard X-rays',
  preset: 'und6',
  source: { kind: 'undulator', ring_GeV: 6, current_mA: 100, undulator: { period_mm: 27, periods: 74, K: 2 }, hAccept_mrad: 0.1, vDiv_urad: 10 },
  mirrors: [
    { id: 'M1', role: 'harmonic-rejection', coating: 'Rh', angle_mrad: 3, inserted: true },
    { id: 'M2', role: 'focusing', coating: 'Rh', angle_mrad: 3, inserted: true },
  ],
  chambers: [
    { id: 'I0', length_cm: 15, gas: { N2: 1 }, gain_V_per_A: 1e4, dark_A: 0 },
    { id: 'It', length_cm: 30, gas: { N2: 0.5, Ar: 0.5 }, gain_V_per_A: 1e4, dark_A: 0 },
    { id: 'Iref', length_cm: 30, gas: { N2: 0.5, Ar: 0.5 }, gain_V_per_A: 1e5, dark_A: 0 },
  ],
  beam_um: [200, 100],
};

/**
 * Dossier 14.3: tender X-rays in helium, the same bending magnet, Si(111), Si mirrors at 6 mrad
 * (the top of the tabulated angles) whose single-bounce reflectivity falls from 0.81 at 2472 eV
 * to 2.9e-2 at 3E, so two bounces reject the third harmonic by about 1e-3. A helium-filled I0 and a
 * nitrogen It, because 10 cm of nitrogen absorbs 95 % at 2.5 keV (dossier 14.3); gains are
 * teaching values for the default S K scan.
 */
const TENDER: TwinProfile = {
  ...BM3,
  name: 'Tender X-rays, 2 to 5 keV',
  preset: 'tender',
  mirrors: [
    { id: 'M1', role: 'collimating', coating: 'Si', angle_mrad: 6, inserted: true },
    { id: 'M2', role: 'focusing', coating: 'Si', angle_mrad: 6, inserted: true },
  ],
  chambers: [
    { id: 'I0', length_cm: 15, gas: { He: 1 }, gain_V_per_A: 1e7, dark_A: 0 },
    { id: 'It', length_cm: 15, gas: { N2: 1 }, gain_V_per_A: 1e6, dark_A: 0 },
    { id: 'Iref', length_cm: 15, gas: { N2: 1 }, gain_V_per_A: 1e7, dark_A: 0 },
  ],
  sdd: { ...BM3.sdd, roi_eV: [2207, 2407] },
};

export const PROFILE_PRESETS: readonly ProfilePreset[] = [
  { id: 'bm3', name: BM3.name, range_eV: [4500, 30000], profile: BM3, sample: 'cu-foil' },
  { id: 'und6', name: UND6.name, range_eV: [4500, 30000], profile: UND6, sample: 'cu-foil' },
  { id: 'tender', name: TENDER.name, range_eV: [2000, 5000], profile: TENDER, sample: 'li2s' },
];

export const profilePreset = (id: string) => PROFILE_PRESETS.find(p => p.id === id);

// ---------------------------------------------------------------- samples

export interface SamplePreset {
  id: string;
  name: string;
  /** What the specimen teaches (plan 3.5). */
  story: string;
  sample: Omit<SampleConfig, 'thickness_um'>;
  /** A fixed thickness, or the rule that sets it once the X-ray tables are loaded. */
  thickness: number | { edgeStep: number } | { muX: number };
  environment: EnvironmentConfig;
  /** Metal foil for the reference channel; its thickness gives an edge step of 1. */
  reference?: Omit<ReferenceFoil, 'thickness_um'>;
  damage: DamageClass;
  densitySource: string;
}

const compound = (id: string) => {
  const found = COMPOUND_PRESETS.find(c => c.id === id);
  if (!found) throw new Error(`Unknown compound preset ${id}.`);
  return found;
};

/** CRC Handbook of Chemistry and Physics, densities of the elements at 20 °C (alpha-Mn for Mn). */
const METAL_DENSITY: Record<string, number> = {
  Ti: 4.506, V: 6.11, Cr: 7.15, Mn: 7.21, Fe: 7.874, Co: 8.86, Ni: 8.908, Cu: 8.96, Zn: 7.134, Zr: 6.52,
  Mo: 10.28, Pd: 12.02, Ag: 10.49, W: 19.25, Pt: 21.45, Au: 19.3,
};
const foil = (symbol: string) => ({ formula: symbol, density: METAL_DENSITY[symbol] });

/** Kapton HN polyimide, C22H10N2O5, 1.42 g/cm^3 (DuPont Kapton HN datasheet), 25 um per side. */
const KAPTON = { formula: 'C22H10N2O5', density: 1.42, thickness_um: 25 };
const AMBIENT: EnvironmentConfig = { kind: 'ambient', temperature_K: 295, windows: [] };
const LIQUID_CELL: EnvironmentConfig = { kind: 'liquid-cell', temperature_K: 295, windows: [KAPTON, KAPTON] };

/**
 * Molar ratio of a solute to water at a concentration in mol/L: water at 0.997 g/cm^3 (CRC, 25 °C)
 * and 18.015 g/mol is 55.34 mol/L.
 */
const perWater = (molar: number) => +(molar / (997 / 18.015)).toPrecision(4);

const base = { pinholeFraction: 0, thicknessSpread: 0, particle_um: 0, incidence_deg: 45 } as const;

export const SAMPLE_PRESETS: readonly SamplePreset[] = [
  {
    id: 'cu-foil', name: 'Cu foil', story: 'The reference metal: energy calibration and the EXAFS of fcc copper.',
    sample: { ...base, formula: 'Cu', density: compound('cu-foil').density, absorber: 'Cu', edge: 'K', form: 'foil' },
    thickness: 7, environment: AMBIENT, reference: foil('Cu'), damage: 'oxide', densitySource: compound('cu-foil').densitySource,
  },
  {
    id: 'limn2o4-pellet', name: 'LiMn₂O₄ cathode pellet', story: 'The battery story: Mn K edge of a spinel cathode, later followed while it charges.',
    sample: { ...base, formula: 'LiMn2O4', density: compound('limn2o4').density, absorber: 'Mn', edge: 'K', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Mn'), damage: 'oxide', densitySource: compound('limn2o4').densitySource,
  },
  {
    id: 'fe-2mm-water', name: 'Fe, 2 mM in water', story: 'Dilute: transmission barely sees the edge, fluorescence does, and dead time starts to matter.',
    sample: { ...base, formula: `Fe${perWater(0.002)}H2O`, density: compound('water').density, absorber: 'Fe', edge: 'K', form: 'solution' },
    thickness: 1000, environment: LIQUID_CELL, reference: foil('Fe'), damage: 'solution', densitySource: compound('water').densitySource,
  },
  {
    id: 'nio-pellet', name: 'NiO, thick pellet', story: 'Concentrated and thick: self absorption flattens the white line in fluorescence.',
    sample: { ...base, formula: 'NiO', density: compound('nio').density, absorber: 'Ni', edge: 'K', form: 'pellet' },
    thickness: 200, environment: AMBIENT, reference: foil('Ni'), damage: 'oxide', densitySource: compound('nio').densitySource,
  },
  {
    // 1 wt% Pt: 0.01 / 195.08 mol Pt per 0.99 / 101.96 mol Al2O3 = 5.28e-3.
    id: 'pt-alumina', name: 'Pt on alumina, 1 wt%', story: 'A dilute catalyst at the Pt L₃ edge, where nanoparticles show coordination numbers below 12.',
    sample: { ...base, formula: 'Pt0.00528Al2O3', density: 3.99, absorber: 'Pt', edge: 'L3', form: 'pellet' },
    thickness: { muX: 2 }, environment: AMBIENT, reference: foil('Pt'), damage: 'oxide',
    densitySource: 'Corundum (α-Al₂O₃), 3.99 g/cm³ (CRC Handbook); the thickness is the equivalent full-density thickness.',
  },
  {
    id: 'cu-solution', name: 'Cu(II), 10 mM in water', story: 'A metal ion in solution: a focused beam reduces Cu(II), and the edge moves between scans.',
    sample: { ...base, formula: `Cu${perWater(0.01)}H2O`, density: compound('water').density, absorber: 'Cu', edge: 'K', form: 'solution' },
    thickness: 1000, environment: LIQUID_CELL, reference: foil('Cu'), damage: 'solution', densitySource: compound('water').densitySource,
  },
  {
    id: 'li2s', name: 'Li₂S pellet', story: 'Sulfur K edge in the tender range, for the lithium-sulfur battery; there is no metal foil, so no reference channel.',
    sample: { ...base, formula: 'Li2S', density: 1.66, absorber: 'S', edge: 'K', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide',
    densitySource: 'Lithium sulfide, 1.66 g/cm³ (CRC Handbook).',
  },
];

export const samplePreset = (id: string) => SAMPLE_PRESETS.find(p => p.id === id);

/** A metal foil of the absorber for the reference channel when its density is tabulated here, with an edge step of 1. */
export function referenceFor(sample: Omit<SampleConfig, 'thickness_um'>): ReferenceFoil | undefined {
  const density = METAL_DENSITY[sample.absorber];
  if (!density) return undefined;
  return { formula: sample.absorber, density, thickness_um: thicknessFor({ ...sample, formula: sample.absorber, density }, { edgeStep: 1 }) };
}

/** Thickness, um, giving an edge step (or total mu x) of `target` 50 eV above the edge. Needs `loadXrayData()`. */
export function thicknessFor(sample: Omit<SampleConfig, 'thickness_um'>, rule: { edgeStep: number } | { muX: number }): number {
  const above = muComponents({ ...sample, thickness_um: 1 }, edgeEnergy(sample) + 50);
  const per_cm = 'edgeStep' in rule ? above.sharpStep_cm_inv : above.total_cm_inv;
  const target = 'edgeStep' in rule ? rule.edgeStep : rule.muX;
  return +(target / per_cm * 1e4).toPrecision(3);
}

/** The sample, environment and reference foil a preset describes, with its thicknesses resolved. Needs `loadXrayData()`. */
export function resolveSamplePreset(preset: SamplePreset): { sample: SampleConfig; environment: EnvironmentConfig; reference?: ReferenceFoil } {
  const thickness_um = typeof preset.thickness === 'number' ? preset.thickness : thicknessFor(preset.sample, preset.thickness);
  const reference = preset.reference && {
    ...preset.reference,
    thickness_um: thicknessFor({ ...preset.sample, formula: preset.reference.formula, density: preset.reference.density }, { edgeStep: 1 }),
  };
  return { sample: { ...preset.sample, thickness_um }, environment: preset.environment, ...(reference ? { reference } : {}) };
}
