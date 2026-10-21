import { transmittance } from '@/lib/xraydata';
import { gasAttenuation, type GasMix } from '@/lib/twin/chambers';
import { cutoffEnergy_eV } from '@/lib/twin/mirrors';
import { dSpacing_A } from '@/lib/twin/mono';
import type { ChamberConfig, MirrorConfig, TwinState } from '@/lib/twin/types';
import type { HutchLive } from './hutch-live';
import type { PartId } from './hutch-parts';

/**
 * The physics card of each part in the hutch scene: the governing relation, the same relation with this
 * instrument's numbers, typical values, what goes wrong and how it shows in the data, and the source.
 * Every string is prose with LaTeX between dollar signs, except `equation`, which is display LaTeX.
 * `live` needs the X-ray and optics tables (loadXrayData, loadOptics) and returns null when the models give no value.
 */
export interface PartPhysics {
  equation: string | ((twin: TwinState) => string);
  live?: (twin: TwinState, live: HutchLive) => string | null;
  typical: string;
  wrong: string;
  source: string;
}

const sci = (value: number, digits = 2) => { const [m, e] = value.toExponential(digits).split('e'); return `${m}\\times10^{${Number(e)}}`; };
const pct = (fraction: number) => `${(fraction * 100).toFixed(fraction < 0.001 ? 3 : 1)}\\,\\%`;
const attempt = <T>(f: () => T): T | null => { try { return f(); } catch { return null; } };
const GAS_TEX: Record<string, string> = { He: '\\mathrm{He}', N2: '\\mathrm{N_2}', Ar: '\\mathrm{Ar}', Kr: '\\mathrm{Kr}' };
const gasTex = (gas: GasMix) => {
  const parts = Object.entries(gas).filter(([, x]) => (x ?? 0) > 0);
  const total = parts.reduce((sum, [, x]) => sum + (x ?? 0), 0);
  return parts.length === 1 ? `$${GAS_TEX[parts[0][0]] ?? parts[0][0]}$` : parts.map(([g, x]) => `$${GAS_TEX[g] ?? g}$ ${Math.round((x ?? 0) / total * 100)} %`).join(', ');
};
const CHAMBER_TEX = { I0: 'I_0', It: 'I_t', Iref: 'I_\\mathrm{ref}' } as const;
const chamberOf = (twin: TwinState, id: ChamberConfig['id']) => twin.profile.chambers.find(c => c.id === id);
const mirrorOf = (twin: TwinState, role: MirrorConfig['role']) => twin.profile.mirrors.find(m => m.role === role);
const crystalTex = (crystal: string) => `\\mathrm{Si}(${crystal.slice(2)})`;

/** One ion chamber: fill, length, absorbed fraction, W and the current. */
function chamberLive(twin: TwinState, live: HutchLive, id: ChamberConfig['id']): string | null {
  const chamber = chamberOf(twin, id), reading = id === 'I0' ? live.i0 : id === 'It' ? live.it : live.iref;
  if (!chamber || !reading) return null;
  const W = attempt(() => gasAttenuation(chamber.gas, live.energy_eV).W_eV);
  return `Filled with ${gasTex(chamber.gas)} over $L = ${chamber.length_cm}\\ \\mathrm{cm}$, $${CHAMBER_TEX[id]}$ absorbs $f = ${pct(reading.absorbedFraction)}$` +
    (W === null ? '' : ` with $W = ${W.toFixed(1)}\\ \\mathrm{eV}$ per ion pair`) + `, giving $I = ${sci(reading.current_A)}\\ \\mathrm{A}$.`;
}

function mirrorLive(twin: TwinState, role: MirrorConfig['role'], against?: number): string | null {
  const mirror = mirrorOf(twin, role);
  if (!mirror) return null;
  const cut = attempt(() => cutoffEnergy_eV(mirror.coating, mirror.angle_mrad));
  return `${mirror.inserted ? 'In the beam' : 'Out of the beam'}: a ${mirror.coating} stripe at $${mirror.angle_mrad}\\ \\mathrm{mrad}$ ` +
    (cut === null ? 'keeps more than half the beam over the whole tabulated range.' : `reflects less than half above about $${Math.round(cut)}\\ \\mathrm{eV}$` +
      (against === undefined ? '.' : `, against $3E = ${Math.round(against)}\\ \\mathrm{eV}$.`));
}

const CHAMBER_EQUATION = String.raw`\begin{gathered} f = 1 - e^{-\mu_\mathrm{gas}L} \\ I =\Phi\,f\,\frac{E}{W}\,e \end{gathered}`;
const CHAMBER_SOURCE = 'G. F. Knoll, Radiation Detection and Measurement, chapter 5; gas cross sections and $W$ values from xraydb.';
const ENVIRONMENTS: Record<TwinState['environment']['kind'], string> = { ambient: 'In air', cryostat: 'In the cryostat', furnace: 'In the furnace', 'operando-cell': 'In the operando coin cell', 'liquid-cell': 'In the liquid cell' };

export const PART_PHYSICS: Record<PartId, PartPhysics> = {
  source: {
    equation: twin => twin.profile.source.kind === 'undulator'
      ? String.raw`E_1\,[\mathrm{keV}] = \frac{0.950\,E_e^2\,[\mathrm{GeV}^2]}{\lambda_u\,[\mathrm{cm}]\,(1 + K^2/2)}`
      : String.raw`\varepsilon_c\,[\mathrm{keV}] = 0.665\,E_e^2\,[\mathrm{GeV}^2]\,B\,[\mathrm{T}]`,
    live: (twin, live) => {
      const s = twin.profile.source, flux = live.flux === null ? '' : ` The flux reaching $I_0$ is $${sci(live.flux)}\\ \\mathrm{s^{-1}}$.`;
      if (s.kind === 'undulator' && s.undulator) {
        const { period_mm, K } = s.undulator;
        return `With $E_e = ${s.ring_GeV}\\ \\mathrm{GeV}$, $\\lambda_u = ${period_mm}\\ \\mathrm{mm}$ and $K = ${K}$, the first harmonic sits at $E_1 = ${(0.95 * s.ring_GeV ** 2 / (period_mm / 10 * (1 + K * K / 2))).toFixed(2)}\\ \\mathrm{keV}$.` + flux;
      }
      if (s.field_T === undefined) return flux.trim() || null;
      return `With $E_e = ${s.ring_GeV}\\ \\mathrm{GeV}$ and $B = ${s.field_T}\\ \\mathrm{T}$, $\\varepsilon_c = ${(0.665 * s.ring_GeV ** 2 * s.field_T).toFixed(2)}\\ \\mathrm{keV}$.` + flux;
    },
    typical: String.raw`A bending magnet gives a smooth, broad spectrum: half its power lies above the critical energy $\varepsilon_c$, and the flux falls off steeply a few times above it. An undulator puts its flux into narrow harmonics that the magnet gap tunes.`,
    wrong: String.raw`Top-up injections and beam loss change the ring current, and orbit motion moves the beam on the slits. Dividing by $I_0$ removes both while every chamber sees the same beam; when they do not, it shows as steps and drifts in $\mu(E)$.`,
    source: 'X-ray Data Booklet, section 2.1 (K.-J. Kim); prefactors re-derived from CODATA constants.',
  },
  'front-end-slits': {
    equation: String.raw`\Phi \propto \Delta\theta_h\quad\text{(bending magnet)}`,
    live: twin => `They pass a horizontal fan of $\\Delta\\theta_h = ${twin.profile.source.hAccept_mrad}\\ \\mathrm{mrad}$.`,
    typical: String.raw`A bending-magnet beamline takes one to a few milliradians of the horizontal fan; the vertical opening is matched to the natural opening angle, about $1/\gamma$.`,
    wrong: 'Wider slits bring more flux and more heat onto the first crystal. A wider vertical opening adds divergence, which broadens the energy resolution.',
    source: 'X-ray Data Booklet, section 2.1.',
  },
  'collimating-mirror': {
    equation: String.raw`\theta_c = \sqrt{2\delta} = \lambda\sqrt{r_e\,\rho_e/\pi}`,
    live: twin => mirrorLive(twin, 'collimating'),
    typical: 'Grazing angles of 2 to 5 mrad. A heavier coating (Rh, Pt) reflects to higher energies than bare silicon at the same angle, because its electron density is higher.',
    wrong: 'Set too steep for the energy, the mirror cuts the beam above its cutoff. Slope errors and thermal bumps spoil the collimation, which broadens the energy resolution.',
    source: 'J. Als-Nielsen and D. McMorrow, Elements of Modern X-ray Physics, chapter 3; reflectivities tabulated with xraydb.',
  },
  monochromator: {
    equation: String.raw`E = \frac{hc}{2d\sin\theta}`,
    live: (twin, live) => {
      const crystal = twin.profile.mono.crystal, d = attempt(() => dSpacing_A(crystal));
      if (d === null) return null;
      return `$${crystalTex(crystal)}$ has $d = ${d.toFixed(4)}\\ \\mathring{\\mathrm{A}}$; ` + (live.theta_deg === null
        ? `it cannot reach $E = ${live.energy_eV.toFixed(1)}\\ \\mathrm{eV}$.`
        : `at $\\theta = ${live.theta_deg.toFixed(3)}^\\circ$ it passes $E = ${live.energy_eV.toFixed(1)}\\ \\mathrm{eV}$.`);
    },
    typical: String.raw`$\mathrm{Si}(111)$ reaches down to $1977\ \mathrm{eV}$ at $\theta = 90^\circ$. $\mathrm{Si}(311)$ gives about five times finer resolution and less flux.`,
    wrong: String.raw`An offset in the angle encoder shifts the whole energy scale by a few electronvolts; the reference foil measures it. Glitches, where another reflection takes intensity at one angle, leave sharp spikes that do not fully divide out when the sample is uneven.`,
    source: 'J. Als-Nielsen and D. McMorrow, Elements of Modern X-ray Physics, section 6.4.',
  },
  'first-crystal': {
    equation: String.raw`\Delta E = E\cot\theta\,\sqrt{\omega_D^2 + \Delta\theta_v^2}`,
    live: (_, live) => live.deltaE_eV === null ? null
      : `Here $\\Delta E = ${live.deltaE_eV.toFixed(2)}\\ \\mathrm{eV}$ at $E = ${live.energy_eV.toFixed(1)}\\ \\mathrm{eV}$, so $\\Delta E/E = ${sci(live.deltaE_eV / live.energy_eV)}$.`,
    typical: String.raw`The intrinsic width of $\mathrm{Si}(111)$ gives $\Delta E/E \approx 1.3\times10^{-4}$; the vertical divergence of the beam adds to it.`,
    wrong: 'It takes the whole white beam, so it is cooled. A thermal bump bends it, which broadens the resolution and lets the flux drift during a scan.',
    source: 'J. Als-Nielsen and D. McMorrow, section 6.4; Darwin widths tabulated with xraydb.',
  },
  'second-crystal': {
    equation: String.raw`T_n(\delta) \propto \left(\frac{\omega_n}{\delta}\right)^2\quad(\delta \gg \omega_n)`,
    live: (twin, live) => `Detuned by $${Math.round(twin.profile.mono.detune * 100)}\\,\\%$ of the rocking curve width` +
      (live.harmonicFraction === null ? '.' : `; harmonics make up $${sci(live.harmonicFraction)}$ of the flux at the sample.`),
    typical: 'A detune of 20 to 50 % of the fundamental width removes most of the harmonics and keeps most of the fundamental, because harmonic rocking curves are much narrower.',
    wrong: 'If it drifts from parallel during a scan, the flux drifts with it. Too little detune lets harmonics through, and they shrink the edge step and the EXAFS amplitude.',
    source: 'J. Als-Nielsen and D. McMorrow, section 6.4; Darwin curves tabulated with xraydb.',
  },
  'focusing-mirror': {
    equation: String.raw`R = \frac{2pq}{(p+q)\sin\theta}`,
    live: twin => `It focuses the beam to $${twin.profile.beam_um[0]}\\times${twin.profile.beam_um[1]}\\ \\mu\\mathrm{m}$ (horizontal by vertical, full width at half maximum) at the sample.`,
    typical: 'Hundreds of micrometres at a bending-magnet XAS beamline; a few micrometres or less with microfocus optics.',
    wrong: 'A smaller spot raises the dose rate (see beam damage) and makes the data more sensitive to an uneven sample and to beam motion.',
    source: 'Coddington equation for the meridional focus of a grazing-incidence mirror ($p$ source distance, $q$ image distance).',
  },
  'harmonic-rejection-mirror': {
    equation: String.raw`E < E_\mathrm{cut}(\theta) < 3E`,
    live: (twin, live) => mirrorLive(twin, 'harmonic-rejection', 3 * live.energy_eV),
    typical: 'The angle is chosen so that one bounce keeps at least 80 % of the fundamental and passes at most 1 % of the third harmonic, the rule this twin uses.',
    wrong: 'Left out where harmonics pass, the edge step shrinks and white lines flatten. Set too steep, it cuts the fundamental as well.',
    source: 'Mirror reflectivities tabulated with xraydb.',
  },
  'experiment-slits': {
    equation: String.raw`\dot D \propto \frac{\Phi}{A},\quad A = h\times v`,
    live: twin => `They leave a beam of $${twin.profile.beam_um[0]}\\times${twin.profile.beam_um[1]}\\ \\mu\\mathrm{m}$ on the sample.`,
    typical: 'Slightly smaller than the focused beam, so the blades trim its tails without clipping the core.',
    wrong: String.raw`Closed onto a moving beam, they turn beam motion into intensity changes that $I_0$ and $I_t$ see differently, which leaves noise in $\mu(E)$.`,
    source: 'G. Bunker, Introduction to XAFS (Cambridge, 2010).',
  },
  'helium-path': {
    equation: String.raw`T = e^{-\mu x}`,
    live: (_, live) => {
      const air = attempt(() => transmittance('N1.562O0.42Ar0.0093', 0.001205, 1e5, live.energy_eV));
      const he = attempt(() => transmittance('He', 0.0001664, 1e5, live.energy_eV));
      return air === null || he === null ? null : `At $${live.energy_eV.toFixed(0)}\\ \\mathrm{eV}$, $10\\ \\mathrm{cm}$ of air passes $${pct(air)}$ and $10\\ \\mathrm{cm}$ of helium passes $${pct(he)}$.`;
    },
    typical: 'Needed below about 5 keV, where air absorbs strongly; above 10 keV a short air path costs only a few percent.',
    wrong: String.raw`A leak lets air in: the flux drops, most at the lowest energies, so $I_0$ falls and the slope of the spectrum changes.`,
    source: 'Cross sections from xraydb (W. T. Elam, B. D. Ravel and J. R. Sieber, Radiat. Phys. Chem. 63 (2002) 121).',
  },
  i0: {
    equation: CHAMBER_EQUATION,
    live: (twin, live) => chamberLive(twin, live, 'I0'),
    typical: String.raw`Fill $I_0$ to absorb about 10 to 20 % of the beam; $I_t$ and $I_\mathrm{ref}$ absorb most of what reaches them.`,
    wrong: String.raw`Too much gain clips the amplifier at 10 V (OVER); too little leaves the signal near the noise floor. A fill that absorbs too much in $I_0$ starves the sample.`,
    source: CHAMBER_SOURCE,
  },
  'sample-stage': {
    equation: String.raw`I_t = I_0\,e^{-\mu(E)\,x}`,
    live: (_, live) => live.sampleTransmission === null || live.muX === null ? null
      : `The sample passes $${pct(live.sampleTransmission)}$ of the beam ($\\mu x = ${live.muX.toFixed(2)}$)` + (live.edgeStep === null ? '.' : ` and its edge step is $\\Delta\\mu x = ${live.edgeStep.toFixed(2)}$.`),
    typical: String.raw`Aim for an edge step $\Delta\mu x$ near 1 with a total $\mu x$ below about 3.`,
    wrong: 'Pinholes and uneven thickness let unabsorbed beam through. That flattens the spectrum and shrinks the EXAFS amplitude, the thickness effect.',
    source: 'E. A. Stern and K. Kim, Phys. Rev. B 23 (1981) 3781, on the thickness effect.',
  },
  'sample-environment': {
    equation: String.raw`\sigma^2(T) = \frac{\hbar^2}{2\mu_r k_B\Theta_E}\coth\frac{\Theta_E}{2T}`,
    live: twin => `${ENVIRONMENTS[twin.environment.kind]} at $T = ${twin.environment.temperature_K}\\ \\mathrm{K}$` +
      (twin.environment.windows.length ? `, behind ${twin.environment.windows.length} windows.` : '.'),
    typical: String.raw`Cooling to $77\ \mathrm{K}$ with liquid nitrogen shrinks the thermal part of $\sigma^2$ and sharpens the EXAFS at high $k$.`,
    wrong: 'Windows and cell walls absorb before the sample does; at low energies a Kapton window or a liquid layer can take most of the beam.',
    source: 'Einstein model of the EXAFS Debye-Waller factor, as in Larch sigma2_eins ($\\mu_r$ reduced mass, $\\Theta_E$ Einstein temperature).',
  },
  'drain-current': {
    equation: String.raw`Y \propto \frac{\mu_a\lambda_e}{\sin\phi + \mu_T\lambda_e}`,
    live: () => 'The model is relative, so it gives no current in amperes.',
    typical: 'Probes the top few nanometres at soft X-ray edges and tens to hundreds of nanometres at hard X-ray K edges.',
    wrong: 'An insulating sample charges, and the current drops or drifts. At grazing incidence, or on a strong resonance, the yield saturates and flattens the white line.',
    source: 'A teaching escape-depth model; see J. Stöhr, NEXAFS Spectroscopy (Springer, 1992).',
  },
  'fluorescence-detector': {
    equation: String.raw`\begin{gathered} \Omega = 2\pi\left(1 - \frac{d}{\sqrt{d^2 + r^2}}\right) \\ N_\mathrm{out} = N_\mathrm{in}\,e^{-N_\mathrm{in}\tau} \end{gathered}`,
    live: (twin, live) => live.icr === null ? null : `At $d = ${twin.profile.sdd.distance_mm}\\ \\mathrm{mm}$ the ${twin.profile.sdd.elements} elements take in $N_\\mathrm{in} = ${sci(live.icr)}\\ \\mathrm{s^{-1}}$` +
      (live.deadFraction === null ? '.' : ` and lose $${pct(live.deadFraction)}$ to dead time.`),
    typical: String.raw`Dead time stays small while $N_\mathrm{in}\tau \ll 1$; with $\tau = 1\ \mu\mathrm{s}$ that means well under $10^6$ counts per second per element.`,
    wrong: String.raw`Too close, or on a concentrated sample, the input rate swamps the processor and the counts stop following $\mu(E)$. Concentrated, thick samples also absorb their own fluorescence, which flattens the white line.`,
    source: 'G. F. Knoll, Radiation Detection and Measurement (dead time); C. H. Booth and F. Bridges, Physica Scripta T115 (2005) 202 (self absorption).',
  },
  it: {
    equation: String.raw`\mu(E)\,x = \ln\frac{I_0}{I_t}`,
    live: (twin, live) => chamberLive(twin, live, 'It'),
    typical: String.raw`It should absorb most of the beam that leaves the sample, so its current is well above the amplifier noise.`,
    wrong: String.raw`Harmonics pass the sample almost unabsorbed and still reach $I_t$, which shrinks the measured edge step.`,
    source: CHAMBER_SOURCE,
  },
  'reference-foil': {
    equation: String.raw`\mu_\mathrm{ref}(E)\,x = \ln\frac{I_t}{I_\mathrm{ref}}`,
    live: (_, live) => live.foilTransmission === null ? null : `The foil passes $${pct(live.foilTransmission)}$ of what leaves $I_t$; the first peak of $d\\mu_\\mathrm{ref}/dE$ is set to the tabulated edge.`,
    typical: 'A metal foil of the absorbing element, a few micrometres thick, measured in every scan.',
    wrong: String.raw`It needs the beam that got through the sample and $I_t$; a very thick sample leaves too little, and the calibration signal turns noisy.`,
    source: 'G. Bunker, Introduction to XAFS (Cambridge, 2010).',
  },
  iref: {
    equation: CHAMBER_EQUATION,
    live: (twin, live) => chamberLive(twin, live, 'Iref'),
    typical: String.raw`Filled like $I_t$, often with a heavier gas, so it absorbs most of the little beam left after the foil.`,
    wrong: 'A thick sample or a thick foil leaves it so little beam that the reference edge is lost in the noise.',
    source: CHAMBER_SOURCE,
  },
  'beam-stop': {
    equation: String.raw`T = e^{-\mu_\mathrm{W}x}`,
    live: (_, live) => {
      const t = attempt(() => transmittance('W', 19.3, 2000, live.energy_eV));
      return t === null ? null : `At $${live.energy_eV.toFixed(0)}\\ \\mathrm{eV}$, $2\\ \\mathrm{mm}$ of tungsten passes ` + (t < 1e-300 ? 'less than $10^{-300}$ of the beam.' : `$${sci(t, 1)}$ of the beam.`);
    },
    typical: 'A few millimetres of tungsten or lead absorb the direct beam completely at XAS energies.',
    wrong: 'Scatter from the stop and the air around it can reach a fluorescence detector that sits close, adding background.',
    source: 'Cross sections from xraydb.',
  },
};

/** The card's equation for this instrument. */
export const partEquation = (id: PartId, twin: TwinState) => { const e = PART_PHYSICS[id].equation; return typeof e === 'function' ? e(twin) : e; };
