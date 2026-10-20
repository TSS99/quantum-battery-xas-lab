// Contract for the beamline twin (see src/lib/twin/README.md). Every module in src/lib/twin uses these types.
// Units are in the property names: _eV, _keV, _mrad, _urad, _um, _mm, _cm, _K, _s, _A, _Gy. Energies are photon energies.
// These modules are pure TypeScript: no DOM, no React, so they also run in a Web Worker and in Node (headless CLI, MCP).

/** Where a number or curve comes from. Shown as a badge next to every curve. */
export type Provenance = 'tabulated' | 'computed' | 'measured' | 'teaching-model';

export type TwinMode = 'transmission' | 'fluorescence' | 'electron-yield' | 'xrf' | 'mono' | 'calibration' | 'time-resolved' | 'damage';
export const TWIN_MODES: readonly TwinMode[] = ['transmission', 'fluorescence', 'electron-yield', 'xrf', 'mono', 'calibration', 'time-resolved', 'damage'];

export type Crystal = 'Si111' | 'Si311' | 'Si220';
export type MirrorCoating = 'Si' | 'Rh' | 'Pt' | 'Ni';
export type ChamberGas = 'N2' | 'He' | 'Ar' | 'Kr';

export interface SourceConfig {
  kind: 'bending-magnet' | 'undulator';
  ring_GeV: number;
  current_mA: number;
  /** Bending magnet field. */
  field_T?: number;
  undulator?: { period_mm: number; periods: number; K: number };
  /** Horizontal acceptance of the beamline. */
  hAccept_mrad: number;
  /** Vertical divergence seen by the monochromator (sets part of the energy resolution). */
  vDiv_urad: number;
}

export interface MirrorConfig {
  id: string;
  role: 'collimating' | 'focusing' | 'harmonic-rejection';
  coating: MirrorCoating;
  angle_mrad: number;
  inserted: boolean;
}

export interface MonoConfig {
  crystal: Crystal;
  /** Calibration error: true energy minus the reading. Hidden in training scenarios. */
  offset_eV: number;
  /** Second crystal detune as a fraction of the fundamental rocking curve width (0 = peak). */
  detune: number;
  /** Seed for the glitch list of this crystal set. */
  glitchSeed: number;
}

export interface ChamberConfig {
  id: 'I0' | 'It' | 'Iref';
  length_cm: number;
  /** Volume fractions, summing to 1. */
  gas: Partial<Record<ChamberGas, number>>;
  /** Current amplifier gain. */
  gain_V_per_A: number;
  dark_A: number;
}

export interface SddConfig {
  elements: number;
  distance_mm: number;
  /** Active area per element. */
  area_mm2: number;
  /** Pulse processor peaking time: sets dead time and energy resolution. */
  peaking_us: number;
  roi_eV: [number, number];
  filter?: { formula: string; density: number; thickness_um: number };
  soller: boolean;
  /** Angle between the sample surface and the detector axis. */
  exitAngle_deg: number;
}

export interface EnvironmentConfig {
  kind: 'ambient' | 'cryostat' | 'furnace' | 'operando-cell' | 'liquid-cell';
  temperature_K: number;
  /** Windows the beam crosses before and after the sample (Kapton, Be, glass, electrolyte...). */
  windows: { formula: string; density: number; thickness_um: number }[];
}

export interface SampleConfig {
  formula: string;
  density: number;
  thickness_um: number;
  absorber: string;
  /** IUPAC edge label: K, L1, L2, L3, M5... */
  edge: string;
  form: 'pellet' | 'foil' | 'film' | 'solution' | 'capillary';
  /** Fraction of the beam that passes through holes in the sample (0 to 1). */
  pinholeFraction: number;
  /** Relative standard deviation of the thickness across the beam. */
  thicknessSpread: number;
  particle_um: number;
  /** Id of a FEFF path set or XANES library entry, when one exists for this material. */
  libraryId?: string;
  /** Angle between the incident beam and the sample surface. */
  incidence_deg: number;
}

export interface ScanRegion {
  start: number;
  end: number;
  step: number;
  /** 'E' regions are in eV relative to the edge; 'k' regions are in inverse angstrom. */
  space: 'E' | 'k';
  dwell_s: number;
  /** Dwell grows as k^kWeight in k regions. */
  kWeight?: number;
}

export interface ScanPlan {
  regions: ScanRegion[];
  kind: 'step' | 'continuous';
  repeats: number;
  /** Motor settling and readout overhead per point (step scans). */
  settle_s: number;
}

export interface TwinProfile {
  format: 'xaslab-twin-profile/1';
  name: string;
  /** Generic preset id, never a real facility. */
  preset: string;
  source: SourceConfig;
  mirrors: MirrorConfig[];
  mono: MonoConfig;
  chambers: ChamberConfig[];
  sdd: SddConfig;
  /** Beam size at the sample, horizontal and vertical FWHM. */
  beam_um: [number, number];
  stability: { i0Noise: number; drift_eV_per_h: number };
}

/** Metal foil between the It and Iref chambers, measured with every scan to fix the energy scale. */
export interface ReferenceFoil {
  formula: string;
  density: number;
  thickness_um: number;
}

export interface TwinState {
  mode: TwinMode;
  /** false = educational clarity (expected values), true = realistic detectors (noise, drift, glitches, dead time). */
  realistic: boolean;
  energy_eV: number;
  profile: TwinProfile;
  sample: SampleConfig;
  environment: EnvironmentConfig;
  /** No foil when absent: the Iref chamber then sees what leaves the It chamber. */
  reference?: ReferenceFoil;
  scan: ScanPlan;
  seed: number;
}

/** Everything the detectors see at one energy, plus the true values behind it. */
export interface PointResult {
  energy_eV: number;
  /** Photons per second on the sample at the fundamental energy. */
  flux: number;
  /** Fraction of the photons on the sample that are harmonics (3E, ...). */
  harmonicFraction: number;
  i0: number;
  it: number;
  iref: number;
  ifluor: number;
  /** Fluorescence detector input and output count rates (per second, summed over elements). */
  icr: number;
  ocr: number;
  deadFraction: number;
  /** True absorption coefficient of the sample at this energy, per cm. */
  muTrue: number;
  /** Dose delivered so far in the illuminated volume. */
  dose_Gy: number;
}

export interface Acquisition {
  id: string;
  kind: TwinMode;
  /** XDI column names: energy, i0, itrans, ifluor, irefer, mutrans, mufluor, murefer, ... */
  columns: Record<string, number[]>;
  /** XDI header fields, e.g. 'Element.symbol', 'Element.edge', 'Mono.d_spacing'. */
  metadata: Record<string, string>;
  provenance: Provenance[];
  /** Hidden truth for scenarios and tests; never shown before the reveal. */
  truth?: Record<string, number>;
}

/** Literature reference and the location of the transcribed numbers. */
export interface FeffCitation {
  reference: string;
  doi: string;
  locator: string;
  url: string;
}

/** FEFF names retained verbatim. reff, lam and xyz_A are in angstrom;
 * k and rep are in inverse angstrom; phases are in radians.
 * The seven arrays share FEFF's native, nonuniform k grid.
 */
export interface FeffPath {
  id: string;
  reff: number;
  degen: number;
  nleg: number;
  geometry: {
    label: string;
    atomic_number: number;
    ipot: number;
    mass_amu: number;
    xyz_A: [number, number, number];
  }[];
  k: number[];
  real_phc: number[];
  mag_feff: number[];
  pha_feff: number[];
  red_fact: number[];
  lam: number[];
  rep: number[];
}

export interface FeffIndexEntry {
  id: string;
  formula: string;
  absorber: string;
  edge: 'K' | 'L3';
  edge_energy_eV: number;
  /** Total retained paths across all absorber sites. */
  number_of_paths: number;
}

/** Computed EXAFS path data, loaded separately for each material. */
export interface FeffMaterial {
  schema_version: 1;
  id: string;
  formula: string;
  absorber: string;
  edge: 'K' | 'L3';
  edge_energy_eV: number;
  citation: FeffCitation;
  structure: {
    space_group: number;
    setting: string;
    lattice_A_deg: [number, number, number, number, number, number];
    positions: { label: string; element: string; wyckoff: string; fractional: [number, number, number] }[];
    temperature_K: number;
    notes: string;
  };
  checks: {
    passed: boolean;
    composition: { expected: string; cell: Record<string, number>; passed: boolean };
    density: {
      literature_g_cm3: number;
      computed_g_cm3: number;
      relative_error: number;
      tolerance: number;
      source: FeffCitation;
      passed: boolean;
    };
    nearest: {
      site: string;
      element: string;
      distance_A: number;
      source: FeffCitation;
      computed_A: number;
      absolute_error_A: number;
      tolerance_A: number;
      passed: boolean;
    }[];
    symmetry: {
      symprec_A: number;
      space_group: number;
      standard_origin_shift: [number, number, number];
    }[];
  };
  sites: {
    id: string;
    wyckoff: string;
    multiplicity: number;
    weight: number;
    absorber_fractional: [number, number, number];
    cluster_atoms: number;
    input_sha256: string;
    available_paths: number;
    paths: FeffPath[];
  }[];
  /** Relative L2 errors over 2 <= k <= 16 for the three documented cases.
   * Omission compares retained paths against every FEFF output path within RMAX.
   * It is separate from the downstream engine's numerical parity tolerance.
   */
  accuracy: { case: 'a' | 'b' | 'c'; rounding_relative_rms: number; omission_relative_rms: number }[];
}
