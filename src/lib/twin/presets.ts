/**
 * Generic beamline profiles and sample presets for the twin. Never real facility names: the
 * profiles follow the three generic presets of plan 3.8 and dossier 14, whose numbers are typical
 * published values, not any one beamline. Every other number is either cited or labelled a
 * teaching value.
 */
import { COMPOUND_PRESETS } from '../../data/compound-presets';
import { edgeEnergy } from './acquire';
import { muComponents, teachingFineStructure } from './sample';
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
    { id: 'It', length_cm: 30, gas: { N2: 0.5, Ar: 0.5 }, gain_V_per_A: 1e3, dark_A: 0 },
    { id: 'Iref', length_cm: 30, gas: { N2: 0.5, Ar: 0.5 }, gain_V_per_A: 1e4, dark_A: 0 },
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
    { id: 'It', length_cm: 15, gas: { N2: 1 }, gain_V_per_A: 1e5, dark_A: 0 },
    { id: 'Iref', length_cm: 15, gas: { N2: 1 }, gain_V_per_A: 1e6, dark_A: 0 },
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
  /** How it looks in the 3D hutch: the material's usual colour, and whether it is a metal. */
  look: { color: string; metal?: boolean };
  /** Where it sits in the sample picker. */
  group: SampleGroup;
}

export const SAMPLE_GROUPS = ['Foils', 'Oxides and salts', 'Batteries', 'Catalysts', 'Solutions', 'Tender X-rays'] as const;
export type SampleGroup = typeof SAMPLE_GROUPS[number];

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

/*
 * Edge shifts with valence, from studies that measured the compounds beside their metal foil:
 * MN_SHIFT: Mn foil, MnO, Mn2O3, MnO2 at half the edge step: 6543.47, 6543.37, 6548.66, 6551.62 eV (Imam et al.,
 *   J. Synchrotron Rad. 29, 1187 (2022), doi:10.1107/S1600577522006439, Table 2).
 * CU_SHIFT: Cu foil, Cu2O, CuO: 8979.1, 8980.5, 8984.5 eV (Phys. Chem. Chem. Phys., doi:10.1039/D0CP06468H, SI table).
 * CO_SHIFT: Co foil, CoO, Co3O4: 7709.0, 7718.8, 7721.6 eV (Catal. Sci. Technol., doi:10.1039/D2CY02182J, SI table).
 * S_SHIFT: elemental sulfur and Na2SO4 white lines 2472.96 and 2482.56 eV (F. Jalilehvand, XANES lecture, University of
 *   Calgary, read off its figure).
 * AS_SHIFT: As2O3 and As2O5 at 11868.2 and 11872.3 eV (HZDR, Publ-12521), taken against the tabulated As edge, 11867 eV.
 * Other samples keep their element's tabulated edge; their stories say so where the valence would move it.
 */
const COD = (id: number) => `COD ${id}, https://www.crystallography.net/cod/${id}.html`;

export const SAMPLE_PRESETS: readonly SamplePreset[] = [
  {
    id: 'cu-foil', group: 'Foils', name: 'Cu foil', story: 'The reference metal: energy calibration and the EXAFS of fcc copper.',
    sample: { ...base, formula: 'Cu', density: compound('cu-foil').density, absorber: 'Cu', edge: 'K', form: 'foil' },
    thickness: 7, environment: AMBIENT, reference: foil('Cu'), damage: 'oxide', densitySource: compound('cu-foil').densitySource,
    look: { color: '#c8794a', metal: true },
  },
  {
    id: 'limn2o4-pellet', group: 'Batteries', name: 'LiMn₂O₄ cathode pellet', story: 'The battery story: Mn K edge of a spinel cathode, later followed while it charges.',
    // Mn(3.5+): the edge shift interpolated by valence between Mn2O3 (+5.19 eV) and MnO2 (+8.15 eV) of the same study (MN_SHIFT).
    sample: { ...base, formula: 'LiMn2O4', density: compound('limn2o4').density, absorber: 'Mn', edge: 'K', form: 'pellet', edgeShift_eV: 6.67 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Mn'), damage: 'oxide', densitySource: compound('limn2o4').densitySource,
    look: { color: '#26282b' },
  },
  {
    id: 'fe-2mm-water', group: 'Solutions', name: 'Fe, 2 mM in water', story: 'Dilute: transmission barely sees the edge, fluorescence does, and dead time starts to matter.',
    sample: { ...base, formula: `Fe${perWater(0.002)}H2O`, density: compound('water').density, absorber: 'Fe', edge: 'K', form: 'solution' },
    thickness: 1000, environment: LIQUID_CELL, reference: foil('Fe'), damage: 'solution', densitySource: compound('water').densitySource,
    look: { color: '#d9c27a' },
  },
  {
    id: 'nio-pellet', group: 'Oxides and salts', name: 'NiO, thick pellet', story: 'Concentrated and thick: self absorption flattens the white line in fluorescence.',
    sample: { ...base, formula: 'NiO', density: compound('nio').density, absorber: 'Ni', edge: 'K', form: 'pellet' },
    thickness: 200, environment: AMBIENT, reference: foil('Ni'), damage: 'oxide', densitySource: compound('nio').densitySource,
    look: { color: '#5f7a4e' },
  },
  {
    // 1 wt% Pt: 0.01 / 195.08 mol Pt per 0.99 / 101.96 mol Al2O3 = 5.28e-3.
    id: 'pt-alumina', group: 'Catalysts', name: 'Pt on alumina, 1 wt%', story: 'A dilute catalyst at the Pt L₃ edge, where nanoparticles show coordination numbers below 12.',
    // Drawn with the bulk Pt paths: real 1 to 2 nm particles have fewer neighbours, so their EXAFS is weaker than shown.
    sample: { ...base, formula: 'Pt0.00528Al2O3', density: 3.99, absorber: 'Pt', edge: 'L3', form: 'pellet', libraryId: 'pt' },
    thickness: { muX: 2 }, environment: AMBIENT, reference: foil('Pt'), damage: 'oxide',
    densitySource: 'Corundum (α-Al₂O₃), 3.99 g/cm³ (CRC Handbook); the thickness is the equivalent full-density thickness.',
    look: { color: '#6d6a66' },
  },
  {
    id: 'cu-solution', group: 'Solutions', name: 'Cu(II), 10 mM in water', story: 'A metal ion in solution: a focused beam reduces Cu(II), and the edge moves between scans.',
    // Cu(II): CuO's edge shift (+5.4 eV, CU_SHIFT), the same oxidation state.
    sample: { ...base, formula: `Cu${perWater(0.01)}H2O`, density: compound('water').density, absorber: 'Cu', edge: 'K', form: 'solution', edgeShift_eV: 5.4 },
    thickness: 1000, environment: LIQUID_CELL, reference: foil('Cu'), damage: 'solution', densitySource: compound('water').densitySource,
    look: { color: '#7fb3d9' },
  },
  {
    id: 'li2s', group: 'Tender X-rays', name: 'Li₂S pellet', story: 'Sulfur K edge in the tender range, for the lithium-sulfur battery; there is no metal foil, so no reference channel.',
    sample: { ...base, formula: 'Li2S', density: 1.66, absorber: 'S', edge: 'K', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide',
    densitySource: 'Lithium sulfide, 1.66 g/cm³ (CRC Handbook).',
    look: { color: '#e8e2c8' },
  },
  // Reference materials whose FEFF paths are in the library (src/data/twin/feff), so their EXAFS is computed, not
  // the teaching model. Densities are those of the library structures (scripts/twin/structures.py). Thickness: an
  // edge step of 1, the usual aim for a transmission standard.
  {
    id: 'fe-foil', group: 'Foils', name: 'Fe foil', story: 'The Fe K edge calibration foil, and the EXAFS of bcc iron: eight neighbours at 2.48 Å, six more just beyond.',
    sample: { ...base, formula: 'Fe', density: METAL_DENSITY.Fe, absorber: 'Fe', edge: 'K', form: 'foil' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Fe'), damage: 'oxide',
    densitySource: 'Iron, 7.874 g/cm³ (CRC Handbook; NIST SRD 126 Table 1).', look: { color: '#9aa0a6', metal: true },
  },
  {
    id: 'ni-foil', group: 'Foils', name: 'Ni foil', story: 'fcc nickel at the Ni K edge: twelve neighbours at 2.49 Å. Set it beside NiO to see what the oxygens change.',
    sample: { ...base, formula: 'Ni', density: METAL_DENSITY.Ni, absorber: 'Ni', edge: 'K', form: 'foil' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Ni'), damage: 'oxide',
    densitySource: 'Nickel, 8.908 g/cm³ (CRC Handbook).', look: { color: '#b8b4a8', metal: true },
  },
  {
    id: 'pt-foil', group: 'Foils', name: 'Pt foil', story: 'Bulk platinum at the L₃ edge, twelve neighbours at 2.77 Å: the reference for Pt on alumina.',
    sample: { ...base, formula: 'Pt', density: compound('pt-foil').density, absorber: 'Pt', edge: 'L3', form: 'foil' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Pt'), damage: 'oxide',
    densitySource: compound('pt-foil').densitySource, look: { color: '#cfd2d4', metal: true },
  },
  {
    id: 'licoo2-pellet', group: 'Batteries', name: 'LiCoO₂ cathode pellet', story: 'The layered cathode in most phone batteries, at the Co K edge: CoO₆ octahedra in sheets, six oxygens at 1.92 Å.',
    // Co(III): the edge shift extrapolated by valence from CoO (+9.8 eV, Co2+) and Co3O4 (+12.6 eV, Co2.67+) of the same study (CO_SHIFT).
    sample: { ...base, formula: 'LiCoO2', density: compound('licoo2').density, absorber: 'Co', edge: 'K', form: 'pellet', edgeShift_eV: 14 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Co'), damage: 'oxide',
    densitySource: compound('licoo2').densitySource, look: { color: '#2e3033' },
  },
  {
    id: 'lifepo4-pellet', group: 'Batteries', name: 'LiFePO₄ cathode pellet', story: 'The olivine cathode at the Fe K edge: Fe²⁺ in distorted octahedra, so its edge sits below that of Fe₃O₄.',
    sample: { ...base, formula: 'LiFePO4', density: compound('lifepo4').density, absorber: 'Fe', edge: 'K', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Fe'), damage: 'oxide',
    densitySource: compound('lifepo4').densitySource, look: { color: '#7d7f7c' },
  },
  {
    id: 'fe3o4-pellet', group: 'Oxides and salts', name: 'Fe₃O₄ (magnetite) pellet', story: 'The mixed-valence spinel: a third of the iron on tetrahedral sites, two thirds octahedral, both in the EXAFS.',
    sample: { ...base, formula: 'Fe3O4', density: 5.2, absorber: 'Fe', edge: 'K', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Fe'), damage: 'oxide',
    densitySource: 'Magnetite, 5.200 g/cm³, the crystallographic density of the cubic cell a = 8.3941 Å (Fleet, Acta Cryst. B37, 917, 1981).', look: { color: '#1c1c1e' },
  },
  {
    id: 'zno-pellet', group: 'Oxides and salts', name: 'ZnO pellet', story: 'Wurtzite zinc oxide at the Zn K edge: four oxygens at 1.97 Å, then twelve zincs near 3.2 Å, a clean two-shell EXAFS.',
    sample: { ...base, formula: 'ZnO', density: compound('zno').density, absorber: 'Zn', edge: 'K', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Zn'), damage: 'oxide',
    densitySource: compound('zno').densitySource, look: { color: '#ecebe6' },
  },
  {
    id: 'ceo2-pellet', group: 'Oxides and salts', name: 'CeO₂ pellet', story: 'Ceria, a catalyst support, at the Ce L₃ edge near 5.7 keV: eight oxygens at 2.34 Å. There is no Ce foil, so no reference channel.',
    sample: { ...base, formula: 'CeO2', density: 7.215, absorber: 'Ce', edge: 'L3', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide',
    densitySource: 'Ceria, 7.215 g/cm³ (Kobayashi and Fujiwara, J. Alloys Compd. 408-412, 1157, 2006).', look: { color: '#e9dfa8' },
  },  // ---- Metal foils: FEFF paths from deposited CIFs (scripts/twin/structures_cod.py), CRC densities.
  {
    id: 'ti-foil', group: 'Foils', name: 'Ti foil', story: 'The Ti K edge at 4966 eV, low enough to need thin windows and a helium path: hcp titanium, six neighbours at 2.90 Å and six just beyond.',
    sample: { ...base, formula: 'Ti', density: METAL_DENSITY.Ti, absorber: 'Ti', edge: 'K', form: 'foil', libraryId: 'ti' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Ti'), damage: 'oxide', densitySource: 'Titanium, 4.506 g/cm³ (CRC Handbook).', look: { color: '#a7a29a', metal: true },
  },
  {
    id: 'cr-foil', group: 'Foils', name: 'Cr foil', story: 'bcc chromium at the Cr K edge, eight neighbours at 2.50 Å: the zero for Cr₂O₃ and the chromate.',
    sample: { ...base, formula: 'Cr', density: METAL_DENSITY.Cr, absorber: 'Cr', edge: 'K', form: 'foil', libraryId: 'cr' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Cr'), damage: 'oxide', densitySource: 'Chromium, 7.15 g/cm³ (CRC Handbook).', look: { color: '#c3c7cc', metal: true },
  },
  {
    id: 'mn-foil', group: 'Foils', name: 'Mn foil', story: 'Alpha manganese, one of the most complex metals: 58 atoms in the cell on four kinds of site, first neighbours from 2.26 to 2.75 Å. The zero of the Mn oxide series.',
    sample: { ...base, formula: 'Mn', density: METAL_DENSITY.Mn, absorber: 'Mn', edge: 'K', form: 'foil', libraryId: 'mn' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Mn'), damage: 'oxide', densitySource: 'Manganese (alpha), 7.21 g/cm³ (CRC Handbook).', look: { color: '#9c9a95', metal: true },
  },
  {
    id: 'co-foil', group: 'Foils', name: 'Co foil', story: 'hcp cobalt at the Co K edge, twelve neighbours near 2.50 Å: the zero for CoO, Co₃O₄ and LiCoO₂.',
    sample: { ...base, formula: 'Co', density: METAL_DENSITY.Co, absorber: 'Co', edge: 'K', form: 'foil', libraryId: 'co' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Co'), damage: 'oxide', densitySource: 'Cobalt, 8.86 g/cm³ (CRC Handbook).', look: { color: '#a9adb3', metal: true },
  },
  {
    id: 'zn-foil', group: 'Foils', name: 'Zn foil', story: 'hcp zinc, stretched along c: six neighbours at 2.66 Å and six at 2.91 Å. Set it beside ZnO.',
    sample: { ...base, formula: 'Zn', density: METAL_DENSITY.Zn, absorber: 'Zn', edge: 'K', form: 'foil', libraryId: 'zn' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Zn'), damage: 'oxide', densitySource: 'Zinc, 7.134 g/cm³ (CRC Handbook).', look: { color: '#b9bcc0', metal: true },
  },
  {
    id: 'mo-foil', group: 'Foils', name: 'Mo foil', story: 'bcc molybdenum at 20.0 keV, where the EXAFS runs far in k: eight neighbours at 2.73 Å.',
    sample: { ...base, formula: 'Mo', density: METAL_DENSITY.Mo, absorber: 'Mo', edge: 'K', form: 'foil', libraryId: 'mo' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Mo'), damage: 'oxide', densitySource: 'Molybdenum, 10.28 g/cm³ (CRC Handbook).', look: { color: '#a3a6aa', metal: true },
  },
  {
    id: 'pd-foil', group: 'Foils', name: 'Pd foil', story: 'fcc palladium at 24.35 keV, near the top of the beamline: twelve neighbours at 2.75 Å. The reference for Pd on carbon.',
    sample: { ...base, formula: 'Pd', density: METAL_DENSITY.Pd, absorber: 'Pd', edge: 'K', form: 'foil', libraryId: 'pd' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Pd'), damage: 'oxide', densitySource: 'Palladium, 12.02 g/cm³ (CRC Handbook).', look: { color: '#c6c4be', metal: true },
  },
  {
    id: 'au-foil', group: 'Foils', name: 'Au foil', story: 'Gold at the L₃ edge (11.92 keV): twelve neighbours at 2.88 Å. The reference for Au on TiO₂.',
    sample: { ...base, formula: 'Au', density: METAL_DENSITY.Au, absorber: 'Au', edge: 'L3', form: 'foil', libraryId: 'au' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Au'), damage: 'oxide', densitySource: 'Gold, 19.3 g/cm³ (CRC Handbook).', look: { color: '#d4af37', metal: true },
  },
  {
    id: 'w-foil', group: 'Foils', name: 'W foil', story: 'bcc tungsten at the L₃ edge (10.21 keV): eight neighbours at 2.74 Å.',
    sample: { ...base, formula: 'W', density: METAL_DENSITY.W, absorber: 'W', edge: 'L3', form: 'foil', libraryId: 'w' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('W'), damage: 'oxide', densitySource: 'Tungsten, 19.25 g/cm³ (CRC Handbook).', look: { color: '#8f9398', metal: true },
  },
  // ---- Oxides and salts: FEFF paths and X-ray densities from deposited CIFs.
  {
    id: 'cu2o-pellet', group: 'Oxides and salts', name: 'Cu₂O (cuprite) pellet', story: 'Cu(I), two oxygens in a straight line at 1.85 Å. Its edge sits 1.4 eV above the Cu foil\'s; CuO\'s sits 5.4 eV above.',
    sample: { ...base, formula: 'Cu2O', density: 6.1104, absorber: 'Cu', edge: 'K', form: 'pellet', libraryId: 'cu2o', edgeShift_eV: 1.4 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Cu'), damage: 'oxide', densitySource: `Cuprite, 6.110 g/cm³: X-ray density of the cell of Kirfel and Eichhorn, Acta Cryst. A46, 271 (1990), ${COD(9007497)}.`, look: { color: '#8b2a1f' },
  },
  {
    id: 'cuo-pellet', group: 'Oxides and salts', name: 'CuO (tenorite) pellet', story: 'Cu(II) in square planar coordination, four oxygens at 1.95 Å. Its edge sits 5.4 eV above the Cu foil\'s.',
    sample: { ...base, formula: 'CuO', density: 6.5165, absorber: 'Cu', edge: 'K', form: 'pellet', libraryId: 'cuo', edgeShift_eV: 5.4 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Cu'), damage: 'oxide', densitySource: `Tenorite, 6.517 g/cm³: X-ray density of the cell of Åsbrink and Norrby, Acta Cryst. B26, 8 (1970), ${COD(9014580)}.`, look: { color: '#1f1f1f' },
  },
  {
    id: 'mno-pellet', group: 'Oxides and salts', name: 'MnO pellet', story: 'Mn(II), six oxygens at 2.22 Å. Measured at half the edge step its edge sits with the Mn foil\'s (−0.1 eV); Mn₂O₃ sits 5.2 eV higher and MnO₂ 8.2 eV.',
    sample: { ...base, formula: 'MnO', density: 5.3617, absorber: 'Mn', edge: 'K', form: 'pellet', libraryId: 'mno', edgeShift_eV: -0.1 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Mn'), damage: 'oxide', densitySource: `Manganosite, 5.362 g/cm³: X-ray density of the cell of Zhang, Phys. Chem. Minerals 26, 644 (1999), ${COD(9006658)}.`, look: { color: '#4f6b4a' },
  },
  {
    id: 'mn2o3-pellet', group: 'Oxides and salts', name: 'Mn₂O₃ (bixbyite) pellet', story: 'Mn(III) on two kinds of site, in octahedra distorted by Jahn-Teller (Mn–O 1.90 to 2.00 Å). Its edge sits 5.2 eV above the Mn foil\'s.',
    sample: { ...base, formula: 'Mn2O3', density: 5.0266, absorber: 'Mn', edge: 'K', form: 'pellet', libraryId: 'mn2o3', edgeShift_eV: 5.19 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Mn'), damage: 'oxide', densitySource: `Bixbyite, 5.027 g/cm³: X-ray density of the cell of Geller, Acta Cryst. B27, 821 (1971), ${COD(2105791)}.`, look: { color: '#2b2522' },
  },
  {
    id: 'mno2-pellet', group: 'Oxides and salts', name: 'MnO₂ (pyrolusite) pellet', story: 'Mn(IV) in rutile-type chains, six oxygens near 1.88 Å. Its edge sits 8.2 eV above the Mn foil\'s.',
    sample: { ...base, formula: 'MnO2', density: 5.1749, absorber: 'Mn', edge: 'K', form: 'pellet', libraryId: 'mno2', edgeShift_eV: 8.15 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Mn'), damage: 'oxide', densitySource: `Pyrolusite, 5.175 g/cm³: X-ray density of the cell of Bolzan et al., Aust. J. Chem. 46, 939 (1993), ${COD(1514117)}.`, look: { color: '#1b1b1d' },
  },
  {
    id: 'feo-pellet', group: 'Oxides and salts', name: 'FeO (wüstite) pellet', story: 'Fe(II) in rocksalt, six oxygens at 2.16 Å. Its edge is left at Fe metal\'s here: no study we could cite measured it beside the foil.',
    sample: { ...base, formula: 'FeO', density: 5.8944, absorber: 'Fe', edge: 'K', form: 'pellet', libraryId: 'feo' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Fe'), damage: 'oxide', densitySource: `Wüstite, 5.894 g/cm³: X-ray density of the cell of Fjellvåg et al., J. Solid State Chem. 124, 52 (1996), ${COD(9009766)}.`, look: { color: '#2a2a2a' },
  },
  {
    id: 'fe2o3-pellet', group: 'Oxides and salts', name: 'Fe₂O₃ (hematite) pellet', story: 'Fe(III) in corundum-type octahedra: three oxygens at 1.95 Å and three at 2.12 Å. Its edge is left at Fe metal\'s here, as for FeO.',
    sample: { ...base, formula: 'Fe2O3', density: 5.2557, absorber: 'Fe', edge: 'K', form: 'pellet', libraryId: 'fe2o3' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Fe'), damage: 'oxide', densitySource: `Hematite, 5.256 g/cm³: X-ray density of the cell of Blake et al., Am. Mineral. 51, 123 (1966), ${COD(9000139)}.`, look: { color: '#7a2a1a' },
  },
  {
    id: 'co3o4-pellet', group: 'Oxides and salts', name: 'Co₃O₄ pellet', story: 'The cobalt spinel: Co(II) on tetrahedral sites (Co–O 1.93 Å) and Co(III) on octahedral ones (1.92 Å). Its edge sits 12.6 eV above the Co foil\'s.',
    sample: { ...base, formula: 'Co3O4', density: 6.0556, absorber: 'Co', edge: 'K', form: 'pellet', libraryId: 'co3o4', edgeShift_eV: 12.6 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Co'), damage: 'oxide', densitySource: `Co₃O₄, 6.056 g/cm³: X-ray density of the cell of Liu and Prewitt, Phys. Chem. Minerals 17, 168 (1990), ${COD(9005896)}.`, look: { color: '#1d1d1f' },
  },
  {
    id: 'coo-pellet', group: 'Oxides and salts', name: 'CoO pellet', story: 'Co(II) in rocksalt, six oxygens at 2.13 Å. Its edge sits 9.8 eV above the Co foil\'s.',
    sample: { ...base, formula: 'CoO', density: 6.4244, absorber: 'Co', edge: 'K', form: 'pellet', libraryId: 'coo', edgeShift_eV: 9.8 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Co'), damage: 'oxide', densitySource: `CoO, 6.424 g/cm³: X-ray density of the cell of Sasaki et al., Proc. Japan Acad. 55, 43 (1979), ${COD(1533087)}.`, look: { color: '#4a5a3a' },
  },
  {
    id: 'tio2-anatase-pellet', group: 'Oxides and salts', name: 'TiO₂ (anatase) pellet', story: 'Anatase, the photocatalyst: TiO₆ octahedra sharing four edges, Ti–O 1.93 Å. The same formula as rutile and a different EXAFS beyond the first shell.',
    sample: { ...base, formula: 'TiO2', density: 3.8897, absorber: 'Ti', edge: 'K', form: 'pellet', libraryId: 'tio2-anatase' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Ti'), damage: 'oxide', densitySource: `Anatase, 3.890 g/cm³: X-ray density of the cell of Rezaee et al., CrystEngComm 13, 5055 (2011), ${COD(7206075)}.`, look: { color: '#f2f2ee' },
  },
  {
    id: 'tio2-rutile-pellet', group: 'Oxides and salts', name: 'TiO₂ (rutile) pellet', story: 'Rutile: TiO₆ octahedra sharing two edges, Ti–O near 1.95 Å. Compare its second shell with anatase\'s.',
    sample: { ...base, formula: 'TiO2', density: 4.259, absorber: 'Ti', edge: 'K', form: 'pellet', libraryId: 'tio2-rutile' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Ti'), damage: 'oxide', densitySource: `Rutile, 4.259 g/cm³: X-ray density of the cell of Dorolti et al., J. Am. Chem. Soc. 132, 5704 (2010), ${COD(4102355)}.`, look: { color: '#efe9e0' },
  },
  {
    id: 'cr2o3-pellet', group: 'Oxides and salts', name: 'Cr₂O₃ (eskolaite) pellet', story: 'Cr(III), the stable chromium oxide: three oxygens at 1.97 Å and three at 2.02 Å.',
    sample: { ...base, formula: 'Cr2O3', density: 5.2251, absorber: 'Cr', edge: 'K', form: 'pellet', libraryId: 'cr2o3' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Cr'), damage: 'oxide', densitySource: `Eskolaite, 5.225 g/cm³: X-ray density of the cell of Newnham and de Haan, Z. Kristallogr. 117, 235 (1962), ${COD(9008084)}.`, look: { color: '#3f6b3a' },
  },
  {
    id: 'k2cro4-pellet', group: 'Oxides and salts', name: 'K₂CrO₄ (chromate) pellet', story: 'Cr(VI), the toxic chromate: four oxygens in a tetrahedron at 1.64 Å. Its sharp pre-edge peak shows in the computed near edge; the higher edge of real spectra does not, as the edge is left at Cr metal\'s for want of a same-study value.',
    sample: { ...base, formula: 'K2CrO4', density: 2.7361, absorber: 'Cr', edge: 'K', form: 'pellet', libraryId: 'k2cro4' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Cr'), damage: 'oxide', densitySource: `K₂CrO₄, 2.736 g/cm³: X-ray density of the cell of McGinnety, Acta Cryst. B28, 2845 (1972), ${COD(9007570)}.`, look: { color: '#f2c200' },
  },
  {
    id: 'pbo-pellet', group: 'Oxides and salts', name: 'PbO (litharge) pellet', story: 'Lead at the L₃ edge (13.04 keV): Pb(II) with four oxygens at 2.31 Å on one side and its lone pair on the other.',
    sample: { ...base, formula: 'PbO', density: 9.3444, absorber: 'Pb', edge: 'L3', form: 'pellet', libraryId: 'pbo' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide', densitySource: `Litharge, 9.344 g/cm³: X-ray density of the cell of Boher et al., J. Solid State Chem. 57, 343 (1985), ${COD(9012700)}.`, look: { color: '#c8562a' },
  },
  // ---- Batteries and catalysts.
  {
    id: 'nmc111-pellet', group: 'Batteries', name: 'NMC111 cathode pellet (Ni K)', story: 'The layered LiNi⅓Mn⅓Co⅓O₂ cathode of many electric cars, at the Ni K edge; the transition metals share one layer at random, so its EXAFS is the teaching model.',
    sample: { ...base, formula: 'LiNi0.3333Mn0.3333Co0.3333O2', density: 4.749, absorber: 'Ni', edge: 'K', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Ni'), damage: 'oxide',
    densitySource: 'NMC111, 4.749 g/cm³: X-ray density of a = 2.863 Å, c = 14.254 Å, Z = 3 (Ohzuku group, ECS Meeting Abstracts MA2004-02, 324), computed here.', look: { color: '#26272a' },
  },
  {
    id: 'lnmo-pellet', group: 'Batteries', name: 'LNMO (LiNi₀.₅Mn₁.₅O₄) pellet (Ni K)', story: 'The high-voltage spinel cathode at the Ni K edge; its EXAFS is the teaching model.',
    sample: { ...base, formula: 'LiNi0.5Mn1.5O4', density: compound('lnmo').density, absorber: 'Ni', edge: 'K', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Ni'), damage: 'oxide', densitySource: compound('lnmo').densitySource, look: { color: '#2b2c2e' },
  },
  {
    // 5 wt% Pd: 0.05 / 106.42 mol Pd per 0.95 / 12.011 mol C = 5.94e-3.
    id: 'pd-carbon', group: 'Catalysts', name: 'Pd on carbon, 5 wt%', story: 'A supported catalyst at 24.35 keV, drawn with bulk Pd paths: real 2 to 5 nm particles have fewer than twelve neighbours, so their EXAFS is weaker than shown.',
    sample: { ...base, formula: 'Pd0.00594C', density: 2.26, absorber: 'Pd', edge: 'K', form: 'pellet', libraryId: 'pd' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, reference: foil('Pd'), damage: 'oxide',
    densitySource: 'Graphite, 2.26 g/cm³ (CRC Handbook); the thickness is the equivalent full-density thickness.', look: { color: '#1a1a1a' },
  },
  {
    // 1 wt% Au: 0.01 / 196.97 mol Au per 0.99 / 79.87 mol TiO2 = 4.10e-3.
    id: 'au-tio2', group: 'Catalysts', name: 'Au on TiO₂, 1 wt%', story: 'Gold nanoparticles on titania at the Au L₃ edge, drawn with bulk Au paths: real particles have fewer neighbours, so their EXAFS is weaker than shown.',
    sample: { ...base, formula: 'Au0.0041TiO2', density: 3.8897, absorber: 'Au', edge: 'L3', form: 'pellet', libraryId: 'au' },
    thickness: { muX: 2 }, environment: AMBIENT, reference: foil('Au'), damage: 'oxide',
    densitySource: `Anatase, 3.890 g/cm³ (as the anatase sample, ${COD(7206075)}); the thickness is the equivalent full-density thickness.`, look: { color: '#8a6d8f' },
  },
  // ---- Solutions: the teaching model EXAFS.
  {
    id: 'as5-water', group: 'Solutions', name: 'Arsenate, As(V), 1 mM in water', story: 'Groundwater arsenic in its oxidised form. Its edge sits 4.1 eV above arsenite\'s, as As₂O₅ sits above As₂O₃.',
    sample: { ...base, formula: `As${perWater(0.001)}H2O`, density: compound('water').density, absorber: 'As', edge: 'K', form: 'solution', edgeShift_eV: 5.3 },
    thickness: 1000, environment: LIQUID_CELL, damage: 'solution', densitySource: compound('water').densitySource, look: { color: '#dbe6ee' },
  },
  {
    id: 'as3-water', group: 'Solutions', name: 'Arsenite, As(III), 1 mM in water', story: 'The more toxic, reduced arsenic. A focused beam can oxidise it to arsenate during the scan.',
    sample: { ...base, formula: `As${perWater(0.001)}H2O`, density: compound('water').density, absorber: 'As', edge: 'K', form: 'solution', edgeShift_eV: 1.2 },
    thickness: 1000, environment: LIQUID_CELL, damage: 'solution', densitySource: compound('water').densitySource, look: { color: '#dde7ec' },
  },
  {
    id: 'se6-water', group: 'Solutions', name: 'Selenate, Se(VI), 1 mM in water', story: 'Dilute selenium at the Se K edge (12.66 keV). Its edge is left at the element\'s here; real selenate sits several eV higher.',
    sample: { ...base, formula: `Se${perWater(0.001)}H2O`, density: compound('water').density, absorber: 'Se', edge: 'K', form: 'solution' },
    thickness: 1000, environment: LIQUID_CELL, damage: 'solution', densitySource: compound('water').densitySource, look: { color: '#dfe8ee' },
  },
  {
    id: 'zn-water', group: 'Solutions', name: 'Zn²⁺, 10 mM in water', story: 'The zinc aqua ion, six waters near 2.08 Å in reality; here the teaching model.',
    sample: { ...base, formula: `Zn${perWater(0.01)}H2O`, density: compound('water').density, absorber: 'Zn', edge: 'K', form: 'solution' },
    thickness: 1000, environment: LIQUID_CELL, reference: foil('Zn'), damage: 'solution', densitySource: compound('water').densitySource, look: { color: '#e2eaf0' },
  },
  {
    id: 'ni-water', group: 'Solutions', name: 'Ni²⁺, 10 mM in water', story: 'The green nickel aqua ion at the Ni K edge; its EXAFS is the teaching model.',
    sample: { ...base, formula: `Ni${perWater(0.01)}H2O`, density: compound('water').density, absorber: 'Ni', edge: 'K', form: 'solution' },
    thickness: 1000, environment: LIQUID_CELL, reference: foil('Ni'), damage: 'solution', densitySource: compound('water').densitySource, look: { color: '#8cc48c' },
  },
  {
    id: 'uranyl-water', group: 'Solutions', name: 'Uranyl, U(VI), 1 mM in water', story: 'Uranium at the L₃ edge (17.17 keV), the nuclear waste case: two short U=O bonds in reality; here the teaching model.',
    sample: { ...base, formula: `U${perWater(0.001)}H2O`, density: compound('water').density, absorber: 'U', edge: 'L3', form: 'solution' },
    thickness: 1000, environment: LIQUID_CELL, damage: 'solution', densitySource: compound('water').densitySource, look: { color: '#e6dd6a' },
  },
  // ---- Tender X-rays (2 to 5 keV).
  {
    id: 's8-pellet', group: 'Tender X-rays', name: 'Sulfur (S₈) pellet', story: 'Elemental sulfur, the zero of the sulfur scale. No open crystal structure we could use, so its EXAFS is the teaching model.',
    sample: { ...base, formula: 'S', density: 2.07, absorber: 'S', edge: 'K', form: 'pellet' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide', densitySource: 'Sulfur (rhombic), 2.07 g/cm³ (CRC Handbook).', look: { color: '#e8d23a' },
  },
  {
    id: 'zns-pellet', group: 'Tender X-rays', name: 'ZnS (sphalerite) at the S K edge', story: 'Sulfide: each sulfur has four zincs at 2.34 Å. Its edge is left at elemental sulfur\'s; real sulfides sit within about 1 eV of it.',
    sample: { ...base, formula: 'ZnS', density: 4.0905, absorber: 'S', edge: 'K', form: 'pellet', libraryId: 'zns' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide', densitySource: `Sphalerite, 4.090 g/cm³: X-ray density of the cell of Skinner, Am. Mineral. 46, 1399 (1961), ${COD(9000107)}.`, look: { color: '#d9cfa3' },
  },
  {
    id: 'na2so4-pellet', group: 'Tender X-rays', name: 'Na₂SO₄ (sulfate) at the S K edge', story: 'Sulfate, S(VI): four oxygens at 1.48 Å, and an edge 9.6 eV above elemental sulfur\'s, the whole sulfur valence range in one step.',
    sample: { ...base, formula: 'Na2SO4', density: 2.6594, absorber: 'S', edge: 'K', form: 'pellet', libraryId: 'na2so4', edgeShift_eV: 9.6 },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide', densitySource: `Thenardite, 2.659 g/cm³: X-ray density of the cell of Hawthorne and Ferguson, Can. Mineral. 13, 181 (1975), ${COD(9004092)}.`, look: { color: '#f4f4f2' },
  },
  {
    id: 'lifepo4-p-pellet', group: 'Tender X-rays', name: 'LiFePO₄ at the P K edge', story: 'The olivine cathode seen from phosphorus (2.15 keV): four oxygens at 1.52 Å around each P.',
    sample: { ...base, formula: 'LiFePO4', density: compound('lifepo4').density, absorber: 'P', edge: 'K', form: 'pellet', libraryId: 'lifepo4-p' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide', densitySource: compound('lifepo4').densitySource, look: { color: '#7d7f7c' },
  },
  {
    id: 'nacl-pellet', group: 'Tender X-rays', name: 'NaCl at the Cl K edge', story: 'Chloride in rocksalt at 2.82 keV: six sodiums at 2.82 Å.',
    sample: { ...base, formula: 'NaCl', density: 2.1687, absorber: 'Cl', edge: 'K', form: 'pellet', libraryId: 'nacl' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide', densitySource: `Halite, 2.169 g/cm³: X-ray density of the cell of Mettler et al., Chem. Commun. (2023), doi:10.1039/D3CC03727D, ${COD(7132177)}.`, look: { color: '#f6f6f6' },
  },
  {
    id: 'kcl-pellet', group: 'Tender X-rays', name: 'KCl at the K K edge', story: 'Potassium at 3.61 keV, in rocksalt KCl: six chlorides at 3.14 Å.',
    sample: { ...base, formula: 'KCl', density: 2.0022, absorber: 'K', edge: 'K', form: 'pellet', libraryId: 'kcl' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide', densitySource: `Sylvite, 2.002 g/cm³: X-ray density of the cell of Ott, Z. Kristallogr. 63, 222 (1926), ${COD(1011127)}.`, look: { color: '#f3f3f3' },
  },
  {
    id: 'caco3-pellet', group: 'Tender X-rays', name: 'CaCO₃ (calcite) at the Ca K edge', story: 'Calcite at 4.04 keV: each calcium in an octahedron of six carbonate oxygens at 2.36 Å.',
    sample: { ...base, formula: 'CaCO3', density: 2.7136, absorber: 'Ca', edge: 'K', form: 'pellet', libraryId: 'caco3' },
    thickness: { edgeStep: 1 }, environment: AMBIENT, damage: 'oxide', densitySource: `Calcite, 2.714 g/cm³: X-ray density of the cell of Ishizawa et al., Sci. Rep. 3, 2832 (2013), ${COD(1547350)}.`, look: { color: '#f1eee6' },
  },
];

export const samplePreset = (id: string) => SAMPLE_PRESETS.find(p => p.id === id);

/** How a sample looks in the 3D hutch: its preset's colour, or else a plain metal foil or a grey powder. */
export function sampleLook(sample: Pick<SampleConfig, 'formula' | 'absorber' | 'edge' | 'form' | 'libraryId'>): SamplePreset['look'] {
  const preset = SAMPLE_PRESETS.find(p => p.sample.formula === sample.formula && p.sample.absorber === sample.absorber && p.sample.edge === sample.edge && (p.sample.libraryId ?? null) === (sample.libraryId ?? null))
    ?? SAMPLE_PRESETS.find(p => p.sample.formula === sample.formula && p.sample.absorber === sample.absorber && p.sample.edge === sample.edge);
  return preset?.look ?? (sample.form === 'foil' ? { color: '#b9b9b9', metal: true } : { color: '#5a5e66' });
}

/** A metal foil of the absorber for the reference channel when its density is tabulated here, with an edge step of 1. */
export function referenceFor(sample: Omit<SampleConfig, 'thickness_um'>): ReferenceFoil | undefined {
  const density = METAL_DENSITY[sample.absorber];
  if (!density) return undefined;
  return { formula: sample.absorber, density, thickness_um: thicknessFor({ ...sample, formula: sample.absorber, density }, { edgeStep: 1 }) };
}

/** Thickness, um, giving an edge step (or total mu x) of `target` 50 eV above the edge. Needs `loadXrayData()`. */
export function thicknessFor(sample: Omit<SampleConfig, 'thickness_um'>, rule: { edgeStep: number } | { muX: number }): number {
  // The teaching shape, not a loaded FEFF library, so a preset's thickness never depends on what has loaded.
  const above = muComponents({ ...sample, thickness_um: 1 }, edgeEnergy(sample) + 50, { fineStructure: teachingFineStructure(edgeEnergy(sample)) });
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
