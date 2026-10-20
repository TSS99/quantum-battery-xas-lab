// State for the /twin/ page: the physics contract (TwinState) plus view settings, a pure reducer,
// the URL hash format and the keyboard map. No React or DOM here, so it is unit tested in Node.
import { TWIN_MODES, type TwinMode, type TwinProfile, type TwinState } from '@/lib/twin/types';

export interface ProfilePreset {
  id: string;
  name: string;
  /** Energy range the monochromator covers with this preset, eV. */
  range_eV: [number, number];
  /** Presets without a profile are listed but not selectable yet. */
  profile?: TwinProfile;
}

/**
 * Generic 3 GeV bending magnet beamline for hard X-ray XAS (plan section 3.8 a), never a real facility.
 * Ring values match a row of the source table in the physics dossier (3.0 GeV, 1.4 T, 0.3 A). The other numbers are
 * illustrative preset inputs that the controls (T4d) and the models (T2) will refine: dark currents are 0 until the
 * ion chamber model sets them, and the gains are set for the default Cu K scan (see below).
 */
const BM3_PROFILE: TwinProfile = {
  format: 'xaslab-twin-profile/1',
  name: '3 GeV bending magnet, hard X-rays',
  preset: 'bm3',
  source: { kind: 'bending-magnet', ring_GeV: 3, current_mA: 300, field_T: 1.4, hAccept_mrad: 1, vDiv_urad: 20 },
  mirrors: [
    { id: 'M1', role: 'collimating', coating: 'Rh', angle_mrad: 3, inserted: true },
    { id: 'M2', role: 'focusing', coating: 'Rh', angle_mrad: 3, inserted: true },
  ],
  mono: { crystal: 'Si111', offset_eV: 0, detune: 0, glitchSeed: 1 },
  // I0 with 15 cm of N2 absorbs about 9.5 % at the Cu K edge (xraydb material_mu), close to the usual 10 to 20 %.
  // Gains are the decade that keeps each amplifier between about 0.2 and 5 V across the Cu K scan with the default
  // sample and Cu reference foil (acquire.ts; full scale 10 V): about 6e-6 A in I0, 1e-5 to 5e-5 A in It, 2e-7 to 4e-6 A in Iref.
  chambers: [
    { id: 'I0', length_cm: 15, gas: { N2: 1 }, gain_V_per_A: 1e5, dark_A: 0 },
    { id: 'It', length_cm: 30, gas: { N2: 0.5, Ar: 0.5 }, gain_V_per_A: 1e5, dark_A: 0 },
    { id: 'Iref', length_cm: 30, gas: { N2: 0.5, Ar: 0.5 }, gain_V_per_A: 1e6, dark_A: 0 },
  ],
  // Window around Cu Ka1 and Ka2 (8046.3 and 8026.7 eV in xraydb).
  sdd: { elements: 4, distance_mm: 30, area_mm2: 50, peaking_us: 1, roi_eV: [7890, 8190], soller: false, exitAngle_deg: 45 },
  beam_um: [500, 200],
  stability: { i0Noise: 1e-3, drift_eV_per_h: 0.1 },
};

export const PROFILE_PRESETS: readonly ProfilePreset[] = [
  { id: 'bm3', name: '3 GeV bending magnet, hard X-rays', range_eV: [4500, 30000], profile: BM3_PROFILE },
  { id: 'und6', name: '6 GeV undulator, hard X-rays', range_eV: [4500, 30000] },
  { id: 'tender', name: 'Tender X-rays, 2 to 5 keV', range_eV: [2000, 5000] },
];

export const presetOf = (state: TwinState) => PROFILE_PRESETS.find(p => p.id === state.profile.preset) ?? PROFILE_PRESETS[0];

export const DEFAULT_TWIN: TwinState = {
  mode: 'transmission',
  realistic: false,
  // Just above the Cu K edge (8979.0 eV in xraydb), so the foil absorbs and fluoresces.
  energy_eV: 9000,
  profile: BM3_PROFILE,
  // A 7 µm Cu reference foil: edge step about 1.5 (mu x 0.25 below and 1.72 above the edge, xraydb, 8.96 g/cm3).
  sample: { formula: 'Cu', density: 8.96, thickness_um: 7, absorber: 'Cu', edge: 'K', form: 'foil', pinholeFraction: 0, thicknessSpread: 0, particle_um: 0, incidence_deg: 45 },
  environment: { kind: 'ambient', temperature_K: 295, windows: [] },
  // The usual Cu reference foil, 7 µm like the sample, between the It and Iref chambers.
  reference: { formula: 'Cu', density: 8.96, thickness_um: 7 },
  // Pre-edge, edge and EXAFS regions relative to the edge; k = 2.8 per angstrom is 30 eV above it.
  scan: {
    kind: 'step', repeats: 1, settle_s: 0.2,
    regions: [
      { space: 'E', start: -150, end: -20, step: 5, dwell_s: 1 },
      { space: 'E', start: -20, end: 30, step: 0.5, dwell_s: 1 },
      { space: 'k', start: 2.8, end: 14, step: 0.05, dwell_s: 1, kWeight: 1 },
    ],
  },
  seed: 1,
};

export type ResultTab = 'live' | 'mu' | 'normalized' | 'derivative' | 'chik' | 'chir' | 'xrf' | 'rocking';
export const RESULT_TABS: readonly ResultTab[] = ['live', 'mu', 'normalized', 'derivative', 'chik', 'chir', 'xrf', 'rocking'];

/** View settings that are not part of the simulated instrument. */
export interface TwinView {
  labels: boolean;
  enlarged: boolean;
  leftHidden: boolean;
  rightHidden: boolean;
  tab: ResultTab;
  /** "What just changed": one line, with $...$ around LaTeX. */
  change: string | null;
  /** False until the URL hash has been read after hydration, so the hash is not overwritten with defaults. */
  hashRead: boolean;
}

export interface TwinStore { twin: TwinState; view: TwinView }

export const INITIAL_STORE: TwinStore = {
  twin: DEFAULT_TWIN,
  view: { labels: true, enlarged: false, leftHidden: false, rightHidden: false, tab: 'mu', change: null, hashRead: false },
};

export type TwinAction =
  | { type: 'mode'; mode: TwinMode }
  | { type: 'realistic'; value?: boolean }
  | { type: 'energy'; energy_eV: number }
  | { type: 'labels' }
  | { type: 'enlarge'; value?: boolean }
  | { type: 'rail'; side: 'left' | 'right' }
  | { type: 'tab'; tab: ResultTab }
  | { type: 'acquire' }
  | { type: 'hash'; mode?: TwinMode; seed?: number }
  | { type: 'note'; text: string };

export interface ModeInfo {
  id: TwinMode;
  key: string;
  name: string;
  group: 'Measure' | 'Tune' | 'Learn';
  /** "What you are looking at": one paragraph, $...$ around LaTeX. */
  looking: string;
  /** The line shown in "What just changed" when this mode is chosen. */
  switched: string;
}

export const MODES: readonly ModeInfo[] = [
  {
    id: 'transmission', key: '1', name: 'Transmission', group: 'Measure',
    looking: String.raw`The monochromator passes one photon energy $E$. Ion chamber $I_0$ measures the beam before the sample and $I_t$ measures what gets through, so the Beer-Lambert law gives the absorption directly: $\mu(E)\,x = \ln(I_0/I_t)$. A reference foil after the sample is measured at the same time in a third chamber, $I_\mathrm{ref}$, and pins the energy scale. Transmission suits concentrated, even samples with an edge step $\Delta\mu x$ near 1 and a total $\mu x$ below about 3.`,
    switched: String.raw`Transmission: $\mu(E)\,x = \ln(I_0/I_t)$ from the two ion chambers.`,
  },
  {
    id: 'fluorescence', key: '2', name: 'Fluorescence', group: 'Measure',
    looking: String.raw`When the absorber is dilute, or the sample is too thick for the beam to get through, measure the X-rays the absorber emits instead. Each absorbed photon leaves a core hole, and a fraction of those holes, the fluorescence yield, refill by emitting a characteristic line such as $\mathrm{K}\alpha$. An energy-dispersive detector at $90^\circ$ to the beam, in the horizontal plane along the beam's polarization where elastic scatter is weakest, counts the photons in a window around that line. For a dilute or thin sample, $\mu(E) \propto I_f/I_0$. In a concentrated, thick sample the escaping fluorescence no longer follows $\mu(E)$ and the peaks flatten (self-absorption), and at high count rates the detector loses events (dead time).`,
    switched: String.raw`Fluorescence: the detector at $90^\circ$ counts the emission line, $\mu(E) \propto I_f/I_0$.`,
  },
  {
    id: 'electron-yield', key: '3', name: 'Electron yield', group: 'Measure',
    looking: String.raw`Absorbed photons eject photoelectrons and Auger electrons, and the current that flows from ground to replace them, the total electron yield, follows the absorption. Only electrons made near the surface escape, so the signal comes from the top few nanometres at soft X-ray edges and from tens to hundreds of nanometres at hard X-ray K edges. With incidence angle $\phi$, electron escape depth $\lambda_e$, absorption $\mu_a$ by the edge of interest and total attenuation $\mu_T$, the yield is $Y \propto \mu_a\lambda_e/(\sin\phi + \mu_T\lambda_e)$. It follows $\mu_a$ while $\mu_T\lambda_e \ll \sin\phi$ and saturates, flattening white lines, at grazing incidence or strong soft X-ray resonances. The sample must conduct or be well grounded.`,
    switched: String.raw`Electron yield: the drain current from the sample follows $\mu(E)$ near its surface.`,
  },
  {
    id: 'xrf', key: '4', name: 'XRF spectrum', group: 'Tune',
    looking: String.raw`At a fixed incident energy $E$, the fluorescence detector sorts every photon by its energy. The spectrum shows the emission lines of each element the beam can excite, the elastic scatter peak at $E$ and the Compton peak just below it. The line widths come from the detector, roughly $150\ \mathrm{eV}$ at $8\ \mathrm{keV}$ for a silicon drift detector. The region of interest set here is the window that fluorescence mode counts; choosing it well, and adding a filter of the element one below the absorber ($Z-1$), keeps most of the scatter out of the signal.`,
    switched: String.raw`XRF spectrum: the detector's energy spectrum at the current $E$, with the counting window.`,
  },
  {
    id: 'mono', key: '5', name: 'Monochromator', group: 'Tune',
    looking: String.raw`Two parallel silicon crystals select the energy by Bragg's law, $E = hc/(2d\sin\theta)$, with an intrinsic bandwidth $\Delta E/E$ of about $10^{-4}$ for $\mathrm{Si}(111)$. The same angle also passes harmonics $nE$ whose reflections are allowed. For $\mathrm{Si}(111)$ the $222$ reflection is nearly forbidden, so the first strong harmonic is $3E$. The sample absorbs the harmonics far less than the fundamental but the detectors still count them, which shrinks the edge step and the EXAFS amplitude. Two cures: detune the second crystal slightly, which costs the fundamental little because harmonic rocking curves are much narrower, or set a mirror angle that reflects $E$ but not $3E$. The rocking curve is the intensity as the second crystal turns through the reflection.`,
    switched: String.raw`Monochromator: Bragg angle, harmonics and the rocking curve of the second crystal.`,
  },
  {
    id: 'calibration', key: '6', name: 'Energy calibration', group: 'Tune',
    looking: String.raw`A monochromator reading can be off by a few electronvolts, and the offset drifts, so every scan carries its own check. A metal foil of known edge energy sits after the sample and is measured with $I_\mathrm{ref}$ at the same time: $\mu_\mathrm{ref}(E)\,x = \ln(I_t/I_\mathrm{ref})$. The first inflection point of the foil's edge, the first peak of $d\mu/dE$, is set to its tabulated value, and the same shift $\Delta E = E_\mathrm{true} - E_\mathrm{reading}$ is applied to the sample. An error of $1\ \mathrm{eV}$ matters, because edge shifts between oxidation states are only a few electronvolts.`,
    switched: String.raw`Energy calibration: the first inflection point of the reference foil fixes the energy scale.`,
  },
  {
    id: 'time-resolved', key: '7', name: 'Time resolved', group: 'Learn',
    looking: String.raw`To follow a reaction or a battery as it charges, the monochromator sweeps without stopping and the detectors are read on the fly, so a spectrum takes from well under a second to a few minutes instead of the tens of minutes of a step scan. Faster spectra collect fewer photons $N$ per point, and the relative counting noise scales as $1/\sqrt{N}$. In this mode a cathode is charged while spectra are taken, and each one is fitted as a mix of two reference states, $\mu(E) = f\,\mu_A(E) + (1-f)\,\mu_B(E)$, which tracks the fraction $f$ over time.`,
    switched: String.raw`Time resolved: continuous scans while a cathode charges, fitted as a mix of two states.`,
  },
  {
    id: 'damage', key: '8', name: 'Beam damage', group: 'Learn',
    looking: String.raw`The beam deposits energy in the sample. For a slab of thickness $x$ and density $\rho$ under a beam of area $A$ carrying $\Phi$ photons per second of energy $E$, the dose rate is about $\dot D = \Phi E\,(1-e^{-\mu x})/(\rho A x)$, in grays per second ($1\ \mathrm{Gy} = 1\ \mathrm{J/kg}$), so halving the beam area doubles it. Some samples change under that dose: metal ions in solution such as $\mathrm{Cu}^{2+}$ are reduced by the electrons and radicals the beam creates, and the edge moves to lower energy from one scan to the next. The usual remedies are to defocus, move to a fresh spot between scans, cool the sample or attenuate the beam.`,
    switched: String.raw`Beam damage: dose from flux, spot size and absorption, and what it does to the sample.`,
  },
];

export const modeInfo = (mode: TwinMode) => MODES.find(m => m.id === mode)!;

// hc/e is exact from the SI values of h, c and e (2019). The Si lattice parameter is the CODATA 2018 value; d(111) = a/sqrt(3).
const HC_EV_ANGSTROM = 12398.419843320026, SI111_D_ANGSTROM = 5.431020511 / Math.sqrt(3);

/** Si(111) Bragg angle in degrees, or null below the lowest energy the reflection reaches (about 1977 eV). */
export function si111BraggDeg(energy_eV: number): number | null {
  const sine = HC_EV_ANGSTROM / (2 * SI111_D_ANGSTROM * energy_eV);
  return sine > 0 && sine <= 1 ? Math.asin(sine) * 180 / Math.PI : null;
}

/** The "What just changed" line once the energy control settles. Only Si(111) is modelled until the monochromator module lands. */
export function energyChange(energy_eV: number): string {
  const theta = si111BraggDeg(energy_eV);
  const energy = String.raw`Energy set to $E = ${energy_eV.toFixed(1)}\ \mathrm{eV}$.`;
  return theta === null ? energy : energy + String.raw` The $\mathrm{Si}(111)$ crystals turn to the Bragg angle $\theta = ${theta.toFixed(2)}^\circ$.`;
}

const clamp = (value: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, value));

export function twinReducer(store: TwinStore, action: TwinAction): TwinStore {
  const { twin, view } = store;
  const note = (change: string, patch: Partial<TwinView> = {}): TwinStore => ({ twin, view: { ...view, ...patch, change } });
  switch (action.type) {
    case 'mode': {
      const info = modeInfo(action.mode);
      return { twin: { ...twin, mode: action.mode }, view: { ...view, change: info.switched } };
    }
    case 'realistic': {
      const realistic = action.value ?? !twin.realistic;
      if (realistic === twin.realistic) return store;
      return {
        twin: { ...twin, realistic },
        view: { ...view, change: realistic ? 'Realistic detectors: counting noise, drift, glitches and dead time will show here once the detector models are connected.' : 'Educational view: expected values, without detector noise.' },
      };
    }
    case 'energy': {
      if (!Number.isFinite(action.energy_eV)) return store;
      const energy_eV = clamp(action.energy_eV, presetOf(twin).range_eV);
      return energy_eV === twin.energy_eV ? store : { twin: { ...twin, energy_eV }, view };
    }
    case 'labels': return note(view.labels ? 'Scene labels hidden.' : 'Scene labels shown.', { labels: !view.labels });
    case 'enlarge': {
      const enlarged = action.value ?? !view.enlarged;
      if (enlarged === view.enlarged) return store;
      return note(enlarged ? 'Results enlarged in place of the scene. Press X or Escape to shrink them.' : 'Results back to normal size.', { enlarged });
    }
    case 'rail': {
      if (action.side === 'left') return note(view.leftHidden ? 'Explanation shown.' : 'Explanation hidden. Press [ to show it again.', { leftHidden: !view.leftHidden });
      return note(view.rightHidden ? 'Controls shown.' : 'Controls hidden. Press ] to show them again.', { rightHidden: !view.rightHidden });
    }
    case 'tab': return { twin, view: { ...view, tab: action.tab } };
    case 'acquire': return note('Acquire pressed. Nothing was recorded: the scan engine is not connected yet.');
    case 'hash': return {
      twin: { ...twin, mode: action.mode ?? twin.mode, seed: action.seed ?? twin.seed },
      view: { ...view, hashRead: true },
    };
    case 'note': return note(action.text);
  }
}

const isMode = (value: string | null): value is TwinMode => value !== null && (TWIN_MODES as readonly string[]).includes(value);

/** Reads "#mode=fluorescence&seed=7". Unknown or invalid values are left out. */
export function parseHash(hash: string): { mode?: TwinMode; seed?: number } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: { mode?: TwinMode; seed?: number } = {};
  const mode = params.get('mode'), seed = params.get('seed');
  if (isMode(mode)) out.mode = mode;
  if (seed !== null && /^\d{1,10}$/.test(seed) && Number(seed) <= 4294967295) out.seed = Number(seed);
  return out;
}

export const formatHash = ({ mode, seed }: Pick<TwinState, 'mode' | 'seed'>) => `#mode=${mode}&seed=${seed}`;

/** What a key does on the twin page, or null. Letters ignore case. */
export function shortcutAction(key: string): TwinAction | null {
  const mode = MODES.find(m => m.key === key);
  if (mode) return { type: 'mode', mode: mode.id };
  switch (key.toLowerCase()) {
    case 'c': return { type: 'realistic' };
    case 'l': return { type: 'labels' };
    case 'i': return { type: 'acquire' };
    case 'x': return { type: 'enlarge' };
    case '[': return { type: 'rail', side: 'left' };
    case ']': return { type: 'rail', side: 'right' };
    default: return null;
  }
}
