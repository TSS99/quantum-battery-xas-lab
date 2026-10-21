// State for the /twin/ page: the physics contract (TwinState) plus view settings, a pure reducer,
// the URL hash format and the keyboard map. No React or DOM here, so it is unit tested in Node.
import { TWIN_MODES, type TwinMode, type TwinState } from '@/lib/twin/types';
import { PROFILE_PRESETS } from '@/lib/twin/presets';
import { DEFAULT_STATE, applyCommand, type TwinCommand } from '@/lib/twin/twin';
import type { LockKey } from '@/lib/twin/scenarios';
import type { PartId } from './hutch-parts';

export { PROFILE_PRESETS, type ProfilePreset } from '@/lib/twin/presets';

export const presetOf = (state: TwinState) => PROFILE_PRESETS.find(p => p.id === state.profile.preset) ?? PROFILE_PRESETS[0];

/** The page starts from the twin's default state (src/lib/twin/twin.ts). */
export const DEFAULT_TWIN: TwinState = DEFAULT_STATE;

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
  /** Counts Acquire presses (button or I); the results dock starts a scan each time it rises. */
  acquireRequest: number;
  /** The training dialog is open. */
  training: boolean;
  /** Controls a running training scenario has locked. */
  locked: LockKey[];
  /** The scene part whose card the explanation shows, or null for the mode. */
  part: PartId | null;
}

export interface TwinStore { twin: TwinState; view: TwinView }

export const INITIAL_STORE: TwinStore = {
  twin: DEFAULT_TWIN,
  view: { labels: true, enlarged: false, leftHidden: false, rightHidden: false, tab: 'mu', change: null, hashRead: false, acquireRequest: 0, training: false, locked: [], part: null },
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
  | { type: 'note'; text: string }
  /** Any twin command (src/lib/twin/twin.ts); needs the X-ray tables, so failures become the change line. */
  | { type: 'command'; command: TwinCommand }
  /** Replace the instrument, for a training scenario's starting state, and lock some controls. */
  | { type: 'load'; twin: TwinState; locked: LockKey[]; note: string }
  | { type: 'training'; open?: boolean }
  /** Show a scene part's card in the explanation, or close it with null. */
  | { type: 'part'; id: PartId | null };

export interface ModeInfo {
  id: TwinMode;
  key: string;
  name: string;
  group: 'Measure' | 'Tune' | 'Learn';
  /** "What you are looking at": one paragraph, $...$ around LaTeX. */
  looking: string;
  /** The line shown in "What just changed" when this mode is chosen. */
  switched: string;
  /** The serif title of the explanation card: plain words, then the words set in the accent italic. */
  headline: readonly [string, string];
}

export const MODES: readonly ModeInfo[] = [
  {
    id: 'transmission', key: '1', name: 'Transmission', group: 'Measure', headline: ['What gets', 'through'],
    looking: String.raw`The monochromator passes one photon energy $E$. Ion chamber $I_0$ measures the beam before the sample and $I_t$ measures what gets through, so the Beer-Lambert law gives the absorption directly: $\mu(E)\,x = \ln(I_0/I_t)$. A reference foil after the sample is measured at the same time in a third chamber, $I_\mathrm{ref}$, and pins the energy scale. Transmission suits concentrated, even samples with an edge step $\Delta\mu x$ near 1 and a total $\mu x$ below about 3.`,
    switched: String.raw`Transmission: $\mu(E)\,x = \ln(I_0/I_t)$ from the two ion chambers.`,
  },
  {
    id: 'fluorescence', key: '2', name: 'Fluorescence', group: 'Measure', headline: ['Light the sample', 'gives back'],
    looking: String.raw`When the absorber is dilute, or the sample is too thick for the beam to get through, measure the X-rays the absorber emits instead. Each absorbed photon leaves a core hole, and a fraction of those holes, the fluorescence yield, refill by emitting a characteristic line such as $\mathrm{K}\alpha$. An energy-dispersive detector at $90^\circ$ to the beam, in the horizontal plane along the beam's polarization where elastic scatter is weakest, counts the photons in a window around that line. For a dilute or thin sample, $\mu(E) \propto I_f/I_0$. In a concentrated, thick sample the escaping fluorescence no longer follows $\mu(E)$ and the peaks flatten (self-absorption), and at high count rates the detector loses events (dead time).`,
    switched: String.raw`Fluorescence: the detector at $90^\circ$ counts the emission line, $\mu(E) \propto I_f/I_0$.`,
  },
  {
    id: 'electron-yield', key: '3', name: 'Electron yield', group: 'Measure', headline: ['Electrons from', 'the surface'],
    looking: String.raw`Absorbed photons eject photoelectrons and Auger electrons, and the current that flows from ground to replace them, the total electron yield, follows the absorption. Only electrons made near the surface escape, so the signal comes from the top few nanometres at soft X-ray edges and from tens to hundreds of nanometres at hard X-ray K edges. With incidence angle $\phi$, electron escape depth $\lambda_e$, absorption $\mu_a$ by the edge of interest and total attenuation $\mu_T$, the yield is $Y \propto \mu_a\lambda_e/(\sin\phi + \mu_T\lambda_e)$. It follows $\mu_a$ while $\mu_T\lambda_e \ll \sin\phi$ and saturates, flattening white lines, at grazing incidence or strong soft X-ray resonances. The sample must conduct or be well grounded.`,
    switched: String.raw`Electron yield: the drain current from the sample follows $\mu(E)$ near its surface.`,
  },
  {
    id: 'xrf', key: '4', name: 'XRF spectrum', group: 'Tune', headline: ['Every line', 'the detector sees'],
    looking: String.raw`At a fixed incident energy $E$, the fluorescence detector sorts every photon by its energy. The spectrum shows the emission lines of each element the beam can excite, the elastic scatter peak at $E$ and the Compton peak just below it. The line widths come from the detector, roughly $150\ \mathrm{eV}$ at $8\ \mathrm{keV}$ for a silicon drift detector. The region of interest set here is the window that fluorescence mode counts; choosing it well, and adding a filter of the element one below the absorber ($Z-1$), keeps most of the scatter out of the signal.`,
    switched: String.raw`XRF spectrum: the detector's energy spectrum at the current $E$, with the counting window.`,
  },
  {
    id: 'mono', key: '5', name: 'Monochromator', group: 'Tune', headline: ['One energy', 'from a white beam'],
    looking: String.raw`Two parallel silicon crystals select the energy by Bragg's law, $E = hc/(2d\sin\theta)$, with an intrinsic bandwidth $\Delta E/E$ of about $10^{-4}$ for $\mathrm{Si}(111)$. The same angle also passes harmonics $nE$ whose reflections are allowed. For $\mathrm{Si}(111)$ the $222$ reflection is nearly forbidden, so the first strong harmonic is $3E$. The sample absorbs the harmonics far less than the fundamental but the detectors still count them, which shrinks the edge step and the EXAFS amplitude. Two cures: detune the second crystal slightly, which costs the fundamental little because harmonic rocking curves are much narrower, or set a mirror angle that reflects $E$ but not $3E$. The rocking curve is the intensity as the second crystal turns through the reflection.`,
    switched: String.raw`Monochromator: Bragg angle, harmonics and the rocking curve of the second crystal.`,
  },
  {
    id: 'calibration', key: '6', name: 'Energy calibration', group: 'Tune', headline: ['Pinning down', 'the energy scale'],
    looking: String.raw`A monochromator reading can be off by a few electronvolts, and the offset drifts, so every scan carries its own check. A metal foil of known edge energy sits after the sample and is measured with $I_\mathrm{ref}$ at the same time: $\mu_\mathrm{ref}(E)\,x = \ln(I_t/I_\mathrm{ref})$. The first inflection point of the foil's edge, the first peak of $d\mu/dE$, is set to its tabulated value, and the same shift $\Delta E = E_\mathrm{true} - E_\mathrm{reading}$ is applied to the sample. An error of $1\ \mathrm{eV}$ matters, because edge shifts between oxidation states are only a few electronvolts.`,
    switched: String.raw`Energy calibration: the first inflection point of the reference foil fixes the energy scale.`,
  },
  {
    id: 'time-resolved', key: '7', name: 'Time resolved', group: 'Learn', headline: ['Spectra', 'on the move'],
    looking: String.raw`To follow a reaction or a battery as it charges, the monochromator sweeps without stopping and the detectors are read on the fly, so a spectrum takes from well under a second to a few minutes instead of the tens of minutes of a step scan. Faster spectra collect fewer photons $N$ per point, and the relative counting noise scales as $1/\sqrt{N}$. In this mode a cathode is charged while spectra are taken, and each one is fitted as a mix of two reference states, $\mu(E) = f\,\mu_A(E) + (1-f)\,\mu_B(E)$, which tracks the fraction $f$ over time.`,
    switched: String.raw`Time resolved: continuous scans while a cathode charges, fitted as a mix of two states.`,
  },
  {
    id: 'damage', key: '8', name: 'Beam damage', group: 'Learn', headline: ['When the beam', 'changes the sample'],
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
    case 'acquire': return note('Acquiring one scan with the current settings.', { acquireRequest: view.acquireRequest + 1 });
    case 'hash': return {
      twin: { ...twin, mode: action.mode ?? twin.mode, seed: action.seed ?? twin.seed },
      view: { ...view, hashRead: true },
    };
    case 'note': return note(action.text);
    case 'load': return { twin: action.twin, view: { ...view, locked: action.locked, change: action.note } };
    case 'training': return { twin, view: { ...view, training: action.open ?? !view.training } };
    case 'part': return { twin, view: { ...view, part: action.id, leftHidden: action.id ? false : view.leftHidden } };
    case 'command': {
      try {
        const result = applyCommand(twin, action.command);
        return { twin: result.state, view: { ...view, change: result.note } };
      } catch (error) {
        return note('That change could not be made: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
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
    case 't': return { type: 'training', open: true };
    case '[': return { type: 'rail', side: 'left' };
    case ']': return { type: 'rail', side: 'right' };
    default: return null;
  }
}
