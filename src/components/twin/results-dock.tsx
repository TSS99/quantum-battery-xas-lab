'use client';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useReducedMotion } from 'motion/react';
import { Aperture, Download, ExternalLink, Maximize2, Minimize2, Pause, Play, Square, Upload } from 'lucide-react';
import { Num, Tex, Unit } from '../tex';
import { Plot, type Series } from '../plot';
import { download } from '../ui';
import { loadXrayData } from '@/lib/xraydata';
import { gradient, preEdge } from '@/lib/xas-reduction';
import { loadPaths } from '@/lib/twin/exafs';
import { firstShellFit } from '@/lib/twin/first-shell-fit';
import { libraryMaterialId } from '@/lib/twin/sample';
import { loadOptics } from '@/lib/twin/tables';
import { dSpacing_A } from '@/lib/twin/mono';
import { edgeEnergy, type SimulatedPoint } from '@/lib/twin/acquire';
import { READOUT_DEFAULTS } from '@/lib/twin/chambers';
import { planDuration, planPoints } from '@/lib/twin/scan';
import { rockingCurve, xrfSpectrum } from '@/lib/twin/twin';
import { writeXdi } from '@/lib/twin/xdi';
import { importAcquisition } from '@/lib/twin/import';
import { larchScript } from '@/lib/twin/larch-export';
import { muOf, reduceAcquisition } from '@/lib/twin/reduction';
import type { Acquisition, FeffMaterial, Provenance, TwinMode, TwinState } from '@/lib/twin/types';
import { RESULT_TABS, type ResultTab } from './twin-state';
import { storedAcquisition, useTwin, type StoredAcquisition } from './twin-store';
import { TexProse } from './tex-prose';
import { useTwinScan } from './use-twin-worker';
import { scanCursor } from './scan-cursor';

// The scope's drawing code loads after the page, keeping the first load within its budget.
const LiveScope = dynamic(() => import('./live-scope').then(m => m.LiveScope), { ssr: false, loading: () => <p className="twin-empty">Starting the live scope…</p> });

/** Tab labels: `name` is the accessible name, `tex` the typeset label when it has maths, `shows` what the tab is for. */
const TABS: Record<ResultTab, { name: string; tex?: string; shows: string }> = {
  live: { name: 'Live channels', shows: String.raw`The amplifier outputs of $I_0$, $I_t$ and $I_\mathrm{ref}$ as they are read now, with saturation warnings; during a scan, against scan time.` },
  mu: { name: 'μ(E)', tex: String.raw`\mu(E)`, shows: String.raw`The absorption $\mu(E)$, built point by point as the scan runs.` },
  normalized: { name: 'Normalized', shows: String.raw`$\mu(E)$ scaled to an edge step of 1, with the edge energy $E_0$ and the step marked.` },
  derivative: { name: 'Derivative', shows: String.raw`$d\mu/dE$, whose first peak marks $E_0$ and the energy calibration point.` },
  chik: { name: 'χ(k)', tex: String.raw`\chi(k)`, shows: String.raw`The EXAFS $k^2\chi(k)$ after background removal (Larch AUTOBK port).` },
  chir: { name: '|χ(R)|', tex: String.raw`|\chi(R)|`, shows: String.raw`$|\chi(R)|$, the Fourier transform of $k^2\chi(k)$ with a Hanning window.` },
  fit: { name: 'Fit', shows: String.raw`A first shell fit of $|\chi(R)|$ with the FEFF paths the twin used, next to the values that made the spectrum.` },
  xrf: { name: 'XRF spectrum', shows: String.raw`The fluorescence detector's energy spectrum at the current $E$ in one second, with the counting window shaded.` },
  rocking: { name: 'Rocking curve', shows: String.raw`What the second crystal passes as it turns through the reflection, for the fundamental and the third harmonic.` },
};

/** The twin shows a whole scan in about four seconds, so it can be watched; the readout gives the beamline time. */
const REPLAY_MS = 4000;
const BADGE: Record<Provenance, string> = { tabulated: 'Tabulated', computed: 'Computed', measured: 'Measured', 'teaching-model': 'Teaching model' };
const FLUOR_MODES: readonly TwinMode[] = ['fluorescence', 'xrf'];

function Badges({ provenance }: { provenance: Provenance[] }) {
  return <p className="twin-badges">{provenance.map(p => <span key={p} className={'twin-badge is-' + p}>{BADGE[p]}</span>)}</p>;
}

const Empty = ({ children }: { children: ReactNode }) => <p className="twin-empty">{children}</p>;

/** Tabs that need a finished spectrum: normalized, derivative, χ(k) and |χ(R)|. */
function Reduced({ tab, acquisition, mode }: { tab: ResultTab; acquisition: Acquisition | null; mode: TwinMode }) {
  const result = useMemo(() => {
    if (!acquisition) return null;
    const { energy, mu } = muOf(acquisition.columns, mode);
    try {
      const pre = preEdge(energy, mu);
      if (tab === 'normalized' || tab === 'derivative') return { pre, energy, mu, exafs: null, error: null };
      const exafs = reduceAcquisition(acquisition, mode).exafs;
      return { pre, energy, mu, exafs, error: null };
    } catch (error) { return { pre: null, energy, mu, exafs: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [acquisition, mode, tab]);
  if (!acquisition || !result) return <Empty>Press Acquire to record a scan; this view fills in when it finishes.</Empty>;
  if (result.error || !result.pre) return <Empty>This scan could not be reduced: {result.error}</Empty>;
  const { pre, energy, mu } = result;
  if (tab === 'normalized') return <>
    <Plot series={[{ name: 'Normalized μ(E)', label: <>Normalized <Tex plain>{'\\mu(E)'}</Tex></>, color: '#7fd8cf', x: energy, y: pre.norm }]} yLabel="Normalized μ(E)" yTex={String.raw`\mu(E)\ \mathrm{normalized}`} edge={pre.e0} exportName="twin-normalized" />
    <p className="twin-readout"><Tex plain>{String.raw`E_0 = ${pre.e0.toFixed(2)}\ \mathrm{eV}`}</Tex>, edge step <Num>{pre.edgeStep.toPrecision(3)}</Num> (Larch <code>pre_edge</code> port).</p>
  </>;
  if (tab === 'derivative') {
    const dE = gradient(energy), dmu = gradient(mu);
    return <>
      <Plot series={[{ name: 'dμ/dE', label: <Tex plain>{'d\\mu/dE'}</Tex>, color: '#ffc46b', x: energy, y: dmu.map((v, i) => v / dE[i]) }]} yLabel="dμ/dE" yTex={String.raw`d\mu/dE`} edge={pre.e0} exportName="twin-derivative" />
      <p className="twin-readout">First inflection at <Tex plain>{String.raw`E_0 = ${pre.e0.toFixed(2)}\ \mathrm{eV}`}</Tex>; compare it with the tabulated edge to calibrate.</p>
    </>;
  }
  if (!result.exafs) return <Empty>No EXAFS range in this scan.</Empty>;
  const { autobk, xftf } = result.exafs;
  if (tab === 'chik') return <Plot series={[{ name: 'k²χ(k)', label: <Tex plain>{'k^2\\chi(k)'}</Tex>, color: '#7fd8cf', x: autobk.k, y: autobk.chi.map((c, i) => c * autobk.k[i] ** 2) }]} xLabel="k (Å⁻¹)" yLabel="k²χ(k)" yTex={String.raw`k^2\chi(k)\ (\mathring{\mathrm{A}}^{-2})`} exportName="twin-chik" />;
  return <Plot series={[{ name: '|χ(R)|', label: <Tex plain>{'|\\chi(R)|'}</Tex>, color: '#ffc46b', x: xftf.r, y: xftf.magnitude }]} xLabel="R (Å)" yLabel="|χ(R)|" yTex={String.raw`|\chi(R)|\ (\mathring{\mathrm{A}}^{-3})`} exportName="twin-chir" />;
}

/** Fit parameters: name in the fit, typeset symbol, typeset unit and decimals. */
const FIT_ROWS = [
  ['s02', String.raw`S_0^2`, '', 3],
  ['e0', String.raw`\Delta E_0`, String.raw`\mathrm{eV}`, 2],
  ['dr', String.raw`\Delta R`, String.raw`\mathring{\mathrm{A}}`, 4],
  ['ss', String.raw`\sigma^2`, String.raw`\mathring{\mathrm{A}}^2`, 5],
] as const;

/** First shell fit of the latest acquisition (src/lib/twin/first-shell-fit.ts), for samples in the FEFF library. */
function FitPanel({ stored }: { stored: StoredAcquisition | undefined }) {
  const id = stored ? libraryMaterialId(stored.config) : null;
  const [material, setMaterial] = useState<FeffMaterial | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    loadPaths(id).then(m => { if (live) setMaterial(m); }, () => undefined);
    return () => { live = false; };
  }, [id]);
  const fit = useMemo(() => {
    if (!stored || !material || material.id !== id) return null;
    const { energy, mu } = muOf(stored.acquisition.columns, stored.mode);
    try { return { value: firstShellFit(material, energy, mu, stored.temperature_K), error: null }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [stored, material, id]);
  if (!stored) return <Empty>Press Acquire to record a scan; the fit runs on the latest acquisition.</Empty>;
  if (stored.acquisition.provenance.includes('measured') && stored.acquisition.metadata['XASLab.declared_edge'] !== 'true') return <Empty>The Fit tab needs an element and edge declared by the imported file. Plain columns without that metadata can still be reduced in the other tabs.</Empty>;
  if (!id) return <Empty>{stored.acquisition.provenance.includes('measured')
    ? 'The imported element, edge and sample do not match a material in the FEFF library. The other result tabs remain available.'
    : 'Fits use the FEFF paths in the twin\'s library, which has no entry for this sample. Choose a library sample, such as the Cu foil.'}</Empty>;
  if (!fit) return <Empty>Loading the FEFF paths…</Empty>;
  if (!fit.value) return <Empty>The fit could not run: {fit.error}</Empty>;
  const { result, truth, window_A, kRange, reff_A } = fit.value;
  const end = result.curves.r_A.findIndex(r => r > 6);
  const upTo = (values: number[]) => values.slice(0, end < 0 ? values.length : end);
  const used = { s02: truth.s02, e0: null, dr: truth.deltar_A, ss: truth.sigma2_A2 } as const;
  const off = FIT_ROWS.filter(([key]) => {
    const p = result.parameters[key], t = used[key];
    return t !== null && p.stderr !== null && Math.abs(p.value - t) > 2 * p.stderr;
  });
  const dr = result.parameters.dr.value;
  return <>
    <Plot series={[
      { name: 'Data |χ(R)|', label: <>Data <Tex plain>{'|\\chi(R)|'}</Tex></>, color: '#7fd8cf', x: upTo(result.curves.r_A), y: upTo(result.curves.dataR.magnitude) },
      { name: 'Fit |χ(R)|', label: <>Fit <Tex plain>{'|\\chi(R)|'}</Tex></>, color: '#ffc46b', dash: 'dashed', x: upTo(result.curves.r_A), y: upTo(result.curves.modelR.magnitude) },
    ]} xLabel="R (Å)" yLabel="|χ(R)|" yTex={String.raw`|\chi(R)|\ (\mathring{\mathrm{A}}^{-3})`} minY={0} bands={[{ from: window_A[0], to: window_A[1], label: 'Fit range' }]} exportName="twin-fit" />
    <table className="twin-fit-table">
      <caption className="sr-only">First shell fit</caption>
      <thead><tr><th scope="col">Parameter</th><th scope="col">Fit</th><th scope="col">Used by the twin</th></tr></thead>
      <tbody>{FIT_ROWS.map(([key, symbol, unit, digits]) => {
        const p = result.parameters[key], t = used[key];
        return <tr key={key}>
          <th scope="row"><Tex plain>{symbol}</Tex></th>
          <td><Num>{p.value.toFixed(digits)}</Num>{p.stderr !== null && <> <Tex plain>{'\\pm'}</Tex> <Num>{p.stderr.toFixed(digits)}</Num></>}{unit && <> <Tex plain>{unit}</Tex></>}</td>
          <td>{t === null ? <>depends on where <Tex plain>{'E_0'}</Tex> is placed</> : <><Num>{t.toFixed(digits)}</Num>{unit && <> <Tex plain>{unit}</Tex></>}</>}</td>
        </tr>;
      })}</tbody>
    </table>
    <p className="twin-readout"><TexProse>{String.raw`Distance $R = ${(reff_A + dr).toFixed(3)}\ \mathring{\mathrm{A}}$ from the FEFF path at $${reff_A.toFixed(3)}\ \mathring{\mathrm{A}}$. R factor $${result.rFactor === null ? '-' : result.rFactor.toFixed(4)}$ with $${result.nIdp.toFixed(1)}$ independent points for $${result.nVarys}$ variables, fitted over $k$ from $${kRange[0]}$ to $${kRange[1].toFixed(1)}\ \mathring{\mathrm{A}}^{-1}$ and $R$ from $${window_A[0].toFixed(2)}$ to $${window_A[1].toFixed(2)}\ \mathring{\mathrm{A}}$ with $k^2$ weight. As in Larch, the standard errors are scaled by $\sqrt{\chi^2_\nu}$.`}</TexProse></p>
    <p className="twin-readout">{off.length === 0
      ? 'The fit agrees with every value the twin used within two standard errors.'
      : <TexProse>{`${off.map(([, symbol]) => `$${symbol}$`).join(', ')} ${off.length > 1 ? 'differ' : 'differs'} from the value the twin used by more than two standard errors. Background removal, the fit window and, in fluorescence, self-absorption all bias a first shell fit.`}</TexProse>}</p>
    {result.warnings.map(w => <p key={w} className="twin-warning">{w}</p>)}
    <Badges provenance={['computed']} />
  </>;
}

function csv(acquisition: Acquisition) {
  const names = Object.keys(acquisition.columns);
  const rows = acquisition.columns.energy.map((_, i) => names.map(n => acquisition.columns[n][i]).join(','));
  return names.join(',') + '\n' + rows.join('\n') + '\n';
}

/** A second window for one result view. React renders into it through a portal, so it stays live with no server. */
interface PopUp { win: Window; root: HTMLElement }

function openPopUp(): PopUp | null {
  const win = window.open('', 'xaslab-twin-results', 'popup,width=960,height=660');
  if (!win) return null;
  const doc = win.document;
  // The page's own styles, so plots, KaTeX and the fonts look the same; links need absolute addresses there.
  const styles = [...document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')].map(node => {
    const copy = node.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
    if (node instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = node.href;
    return copy;
  });
  const viewport = doc.createElement('meta');
  viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1';
  doc.head.replaceChildren(viewport, ...styles);
  doc.title = 'Results · Beamline twin · XAS Lab';
  doc.documentElement.lang = 'en';
  // The root layout puts the font variables on html and body.
  doc.documentElement.className = document.documentElement.className;
  doc.body.className = document.body.className;
  const root = doc.createElement('div');
  root.className = (document.querySelector('.twin-fonts')?.className ?? '') + ' twin-app twin-popout';
  doc.body.replaceChildren(root);
  return { win, root };
}

/** Which fine structure the scan's sample used: the FEFF library's path sum or the teaching shape. */
function FineStructureNote({ acquisition }: { acquisition: Acquisition }) {
  const label = acquisition.metadata['Sample.fine_structure'];
  if (!label) return null;
  // The header keeps plain ASCII for XDI; on screen the symbols are typeset.
  const tex = label.replace('sigma^2', String.raw`$\sigma^2$`).replace(/theta_E (\d+) K/, (_, t: string) => String.raw`$\theta_E = ${t}\ \mathrm{K}$`);
  return <p className="twin-readout">Fine structure: <TexProse>{tex}</TexProse>.</p>;
}

/** Bottom dock: result tabs, Acquire (one scan in the worker), the acquisition gallery, Enlarge and Pop out. */
export function ResultsDock() {
  const { store: { twin, view }, dispatch, acquisitions: stored, setAcquisitions: setStored } = useTwin();
  const { progress, start, cancel } = useTwinScan();
  const reduced = useReducedMotion();
  const tabs = useRef<HTMLDivElement>(null);
  const [tables, setTables] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState('');
  const [scanState, setScanState] = useState<{ twin: TwinState; times: number[]; minutes: number } | null>(null);
  // Replay time in milliseconds; it stands still while the scan is paused.
  const [elapsed, setElapsed] = useState(0), [paused, setPaused] = useState(false);
  const handled = useRef(0), saved = useRef<Acquisition | null>(null);
  const [popUp, setPopUp] = useState<PopUp | null>(null), [popTab, setPopTab] = useState<ResultTab>('mu');
  const popRef = useRef<PopUp | null>(null);
  useEffect(() => {
    popRef.current = popUp;
    if (!popUp) return;
    const timer = setInterval(() => { if (popUp.win.closed) setPopUp(null); }, 500);
    return () => clearInterval(timer);
  }, [popUp]);
  // Leaving the page closes the second window, which would otherwise stay open and empty.
  useEffect(() => () => popRef.current?.win.close(), []);
  useEffect(() => { Promise.all([loadXrayData(), loadOptics()]).then(() => setTables(true), () => undefined); }, []);

  // Each Acquire press (button or I) starts one scan with the settings of that moment.
  useEffect(() => {
    if (view.acquireRequest === handled.current || !tables) return;
    handled.current = view.acquireRequest;
    let e0: number, plan: ReturnType<typeof planPoints>;
    try { e0 = edgeEnergy(twin.sample); plan = planPoints(twin.scan, e0); } catch (error) {
      dispatch({ type: 'note', text: 'The scan could not start: ' + (error instanceof Error ? error.message : String(error)) });
      return;
    }
    const repeats = Math.max(1, twin.scan.repeats);
    const settle = twin.scan.kind === 'step' ? twin.scan.settle_s : 0;
    let t = 0;
    const times = Array.from({ length: plan.dwell_s.length * repeats }, (_, i) => (t += plan.dwell_s[i % plan.dwell_s.length] + settle));
    setScanState({ twin, times, minutes: planDuration(twin.scan, e0).total_s / 60 });
    setElapsed(0); setPaused(false);
    start(twin, twin.scan, times.length);
  }, [view.acquireRequest, tables, twin, start, dispatch]);

  // Replay the streamed points at a watchable pace (instantly with reduced motion).
  const shown = !scanState ? 0 : reduced ? progress.points.length : Math.min(progress.points.length, Math.ceil(progress.total * elapsed / REPLAY_MS));
  const replaying = !!scanState && (progress.running || shown < progress.points.length);
  // The 3D hutch follows the point on show: its crystals step with the scan.
  useEffect(() => { scanCursor.energy_eV = replaying && shown > 0 ? progress.points[shown - 1].energy_eV : null; }, [replaying, shown, progress.points]);
  useEffect(() => () => { scanCursor.energy_eV = null; }, []);
  useEffect(() => {
    if (!replaying || paused) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(time) { setElapsed(e => e + Math.max(0, time - last)); last = time; frame = requestAnimationFrame(tick); });
    return () => cancelAnimationFrame(frame);
  }, [replaying, paused]);
  const togglePause = () => {
    setPaused(!paused);
    dispatch({ type: 'note', text: paused ? 'Scan resumed.' : `Scan paused at point ${shown} of ${progress.total}. Press Space to go on.` });
  };

  // Store each finished acquisition once its replay has caught up.
  useEffect(() => {
    const acquisition = progress.acquisition;
    if (!acquisition || replaying || !scanState || saved.current === acquisition) return;
    saved.current = acquisition;
    const n = stored.length + 1;
    setStored(list => [...list, { n, acquisition, mode: scanState.twin.mode, sample: scanState.twin.sample.formula, minutes: scanState.minutes, config: scanState.twin.sample, temperature_K: scanState.twin.environment.temperature_K }]);
    dispatch({ type: 'note', text: `Acquisition ${n} stored: ${acquisition.columns.energy.length} points, ${scanState.minutes.toFixed(1)} min of beamline time.` });
  }, [progress.acquisition, replaying, scanState, stored.length, dispatch]);

  const loadData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = importAcquisition(await file.text(), file.name, {
        sample: twin.sample,
        monoDSpacing_A: dSpacing_A(twin.profile.mono.crystal),
      });
      const item = storedAcquisition(imported.acquisition, stored.length + 1, twin);
      setStored(list => [...list, item]);
      setImportStatus(`${file.name} imported as measured data.`);
      dispatch({ type: 'note', text: `${file.name} imported as measured data.` });
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : String(error));
    }
    event.target.value = '';
  };

  function onTabKey(event: KeyboardEvent) {
    const i = RESULT_TABS.indexOf(view.tab), n = RESULT_TABS.length;
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    dispatch({ type: 'tab', tab: RESULT_TABS[next] });
    tabs.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  const points: SimulatedPoint[] = progress.points.slice(0, shown);
  const latest = stored.at(-1)?.acquisition ?? null;
  const mode = scanState?.twin.mode ?? twin.mode;
  const panelFor = (tab: ResultTab) => {
    switch (tab) {
      case 'live': {
        // Between scans the scope runs live at the current energy; during one it shows the scan as it is read.
        if (!replaying || !points.length) return <LiveScope twin={twin} />;
        const volts = (counts: number, i: number) => counts / READOUT_DEFAULTS.v2fFullScale_Hz / (scanState!.times[i] - (scanState!.times[i - 1] ?? 0) - (scanState!.twin.scan.kind === 'step' ? scanState!.twin.scan.settle_s : 0)) * READOUT_DEFAULTS.fullScale_V;
        const x = points.map((_, i) => scanState!.times[i]);
        const series: Series[] = [
          { name: 'I0', label: <Tex plain>{'I_0'}</Tex>, color: '#7fd8cf', x, y: points.map((p, i) => volts(p.i0, i)) },
          { name: 'It', label: <Tex plain>{'I_t'}</Tex>, color: '#ffc46b', x, y: points.map((p, i) => volts(p.it, i)) },
          { name: 'Iref', label: <Tex plain>{'I_\\mathrm{ref}'}</Tex>, color: '#b49cff', x, y: points.map((p, i) => volts(p.iref, i)) },
        ];
        const clipped = [...new Set(points.flatMap(p => p.saturated))];
        const low = series.filter(s => Math.max(...s.y) < 0.05).map(s => s.name);
        return <>
          <Plot series={series} xLabel="Scan time (s)" yLabel="Amplifier output (V)" minY={0} exportName="twin-live" />
          {clipped.length > 0 && <p className="twin-warning" role="alert">{clipped.join(', ')} clipped at {READOUT_DEFAULTS.fullScale_V} V: lower the gain (Auto gain picks one).</p>}
          {low.length > 0 && <p className="twin-warning">{low.join(', ')} below 50 mV: the gain is too low for a clean signal.</p>}
        </>;
      }
      case 'mu': {
        const live = points.length ? points : null;
        if (!live && !latest) return <Empty><TexProse>{String.raw`Press Acquire to start a scan; $\mu(E)$ builds here point by point.`}</TexProse></Empty>;
        let series: Series[];
        if (live) {
          const fluo = FLUOR_MODES.includes(mode);
          series = [{ name: fluo ? 'If/I0' : 'ln(I0/It)', label: <Tex plain>{fluo ? 'I_f/I_0' : '\\ln(I_0/I_t)'}</Tex>, color: '#7fd8cf', x: live.map(p => p.energy_eV), y: live.map(p => fluo ? p.ifluor / p.i0 : Math.log(p.i0 / p.it)) }];
          if (mode === 'calibration') series.push({ name: 'Reference ln(It/Iref)', label: <>Reference <Tex plain>{'\\ln(I_t/I_\\mathrm{ref})'}</Tex></>, color: '#b49cff', dash: 'dashed', x: live.map(p => p.energy_eV), y: live.map(p => Math.log(p.it / p.iref)) });
        } else {
          const { energy, mu } = muOf(latest!.columns, stored.at(-1)!.mode);
          series = [{ name: 'μ(E)', label: <Tex plain>{'\\mu(E)'}</Tex>, color: '#7fd8cf', x: energy, y: mu }];
        }
        return <>
          <Plot series={series.map(s => ({ ...s, y: s.y.map(v => Number.isFinite(v) ? v : NaN) }))} yLabel="μ(E) (arb.)" yTex={String.raw`\mu(E)\ (\mathrm{arb.})`} exportName="twin-mu" />
          <Badges provenance={latest?.provenance ?? ['tabulated', 'computed', 'teaching-model']} />
          {latest && <FineStructureNote acquisition={latest} />}
        </>;
      }
      case 'normalized': case 'derivative': case 'chik': case 'chir':
        return <><Reduced tab={tab} acquisition={latest} mode={stored.at(-1)?.mode ?? mode} />{latest && <><Badges provenance={latest.provenance} /><FineStructureNote acquisition={latest} /></>}</>;
      case 'fit': return <FitPanel stored={stored.at(-1)} />;
      case 'xrf': {
        if (!tables) return <Empty>Loading the X-ray tables…</Empty>;
        const mca = xrfSpectrum(twin);
        if (!mca) return <Empty>No fluorescence line of this absorber falls inside the tabulated range.</Empty>;
        const top = Math.min(mca.energies_eV.length, Math.ceil((twin.energy_eV + 1000) / mca.channelWidth_eV));
        return <>
          <Plot series={[{ name: 'Counts', color: '#74dcaa', x: Array.from(mca.energies_eV.slice(0, top)), y: Array.from(mca.counts.slice(0, top)) }]} yLabel="Counts per channel" yTex={String.raw`\mathrm{counts}`} minY={0}
            bands={[{ from: twin.profile.sdd.roi_eV[0], to: twin.profile.sdd.roi_eV[1], label: 'ROI' }]} exportName="twin-xrf"
            onBand={(_, band) => dispatch({ type: 'command', command: { type: 'sdd', patch: { roi_eV: [band.from, band.to] } } })} />
          <p className="twin-readout">Drag the edges of the shaded window to set what fluorescence mode counts; the Fluorescence detector controls set it by keyboard.</p>
          <p className="twin-readout">Input rate <Num>{mca.icr.toExponential(2)}</Num> <Unit>s^-1</Unit>, dead time <Num>{(mca.deadFraction * 100).toFixed(1) + '%'}</Num>. Elastic and Compton scatter are not included.</p>
          {mca.deadFraction > 0.5 && <p className="twin-warning">The detector is saturated: it loses <Num>{(mca.deadFraction * 100).toFixed(mca.deadFraction > 0.999 ? 2 : 0) + '%'}</Num> of the events, so the spectrum is nearly empty. Move it back, use a dilute sample, or attenuate the beam.</p>}
          <Badges provenance={mca.provenance} />
        </>;
      }
      case 'rocking': {
        if (!tables) return <Empty>Loading the X-ray tables…</Empty>;
        const curve = rockingCurve(twin);
        return <>
          <Plot series={[{ name: 'Fundamental', color: '#7fd8cf', x: curve.detune, y: curve.fundamental }, { name: 'Third harmonic', color: '#ffc46b', dash: 'dashed', x: curve.detune, y: curve.third }]}
            xLabel="Second crystal detune (fundamental widths)" yLabel="Throughput" yTex={String.raw`\mathrm{throughput}`} minY={0} exportName="twin-rocking" />
          <p className="twin-readout">The third harmonic&apos;s curve is narrower, so a small detune removes it while keeping most of the fundamental.</p>
          <Badges provenance={['tabulated']} />
        </>;
      }
    }
  };
  const panel = panelFor(view.tab);

  const popOut = () => {
    if (popUp && !popUp.win.closed) { popUp.win.focus(); return; }
    const opened = openPopUp();
    if (!opened) { dispatch({ type: 'note', text: 'The browser blocked the second window. Allow pop-ups for this site to use Pop out.' }); return; }
    setPopTab(view.tab); setPopUp(opened);
    dispatch({ type: 'note', text: `${TABS[view.tab].name} opened in a second window. It updates with this page, and its View list shows the other results.` });
  };

  return <section className="twin-dock twin-card" aria-labelledby="twin-results-title">
    <div className="twin-dock-head">
      <h2 id="twin-results-title" className="twin-kicker"><span className={'twin-dot' + (replaying ? ' is-live' : '')} aria-hidden="true" />Results</h2>
      <span className="twin-kicker twin-dock-sub" aria-hidden="true">{TABS[view.tab].name}{replaying ? paused ? ' · paused' : ' · scanning' : stored.length ? ` · ${stored.length} stored` : ''}</span>
      <div className="twin-dock-actions">
        {replaying && <button type="button" className="twin-icon" data-scan-pause aria-pressed={paused} aria-keyshortcuts="Space" title={paused ? 'Resume (Space)' : 'Pause (Space)'} onClick={togglePause}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}<span className="sr-only">Pause</span></button>}
        {replaying
          ? <button type="button" className="twin-acquire is-stop" onClick={() => { cancel(); setScanState(null); setPaused(false); dispatch({ type: 'note', text: 'Scan stopped; nothing was stored.' }); }}><Square size={14} aria-hidden="true" />Stop</button>
          : <button type="button" className="twin-acquire" aria-keyshortcuts="I" disabled={!tables} onClick={() => dispatch({ type: 'acquire' })}><Aperture size={15} aria-hidden="true" />Acquire</button>}
        <button type="button" className="twin-icon" title="Pop out" onClick={popOut}><ExternalLink size={16} aria-hidden="true" /><span className="sr-only">Pop out</span></button>
        <button type="button" className="twin-icon" aria-pressed={view.enlarged} aria-keyshortcuts="X" title="Enlarge (X)" onClick={() => dispatch({ type: 'enlarge' })}>{view.enlarged ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}<span className="sr-only">Enlarge</span></button>
      </div>
    </div>
    {replaying && <div className="twin-progress">
      <div role="progressbar" aria-label="Scan progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={shown}><span style={{ width: `${progress.total ? 100 * shown / progress.total : 0}%` }} /></div>
      <span><Num>{String(shown)}</Num> of <Num>{String(progress.total)}</Num> points · <Num>{scanState!.minutes.toFixed(1)}</Num> min at the beamline</span>
    </div>}
    {progress.error && <p className="twin-warning" role="alert">The scan failed: {progress.error}</p>}
    <div className="twin-tabs" role="tablist" aria-label="Result views" ref={tabs} onKeyDown={onTabKey}>
      {RESULT_TABS.map(tab => <button key={tab} type="button" role="tab" id={`twin-tab-${tab}`} aria-controls="twin-result-panel" aria-selected={view.tab === tab} tabIndex={view.tab === tab ? 0 : -1} aria-label={TABS[tab].tex ? TABS[tab].name : undefined} onClick={() => dispatch({ type: 'tab', tab })}>
        {TABS[tab].tex ? <Tex plain>{TABS[tab].tex!}</Tex> : TABS[tab].name}
      </button>)}
    </div>
    <div className="twin-tabpanel" role="tabpanel" id="twin-result-panel" aria-labelledby={`twin-tab-${view.tab}`} tabIndex={0}>
      {/* The live scope's caption says what it shows, so its description gives the room to the trace. */}
      {(view.tab !== 'live' || replaying) && <p><TexProse>{TABS[view.tab].shows}</TexProse></p>}
      {panel}
    </div>
    <section className="twin-gallery" aria-labelledby="twin-gallery-title">
      <div className="twin-gallery-head"><h3 id="twin-gallery-title">Acquisitions</h3>
        <input ref={importInput} name="acquisition-file" className="sr-only" type="file" accept=".xdi,.txt,.dat,.csv,text/plain" aria-label="Acquisition data file" onChange={loadData} />
        <button type="button" className="button secondary small" onClick={() => importInput.current?.click()}><Upload size={14} aria-hidden="true" />Import data</button>
      </div>
      {stored.length ? <ol>{stored.map(s => <li key={s.n}>
        <span><strong>#{s.n}</strong> {s.acquisition.name ?? s.sample}, {s.mode.replace('-', ' ')}, <Num>{String(s.acquisition.columns.energy.length)}</Num> points {s.acquisition.provenance.map(p => <span key={p} className={'twin-badge is-' + p}>{BADGE[p]}</span>)}</span>
        <span className="twin-gallery-actions">
          {(['xdi', 'csv', 'json', 'larch'] as const).map(kind => <button key={kind} type="button" className="button secondary small" aria-label={`Download acquisition ${s.n} as ${kind === 'larch' ? 'Larch' : kind.toUpperCase()}`}
            onClick={() => {
              const base = `twin-${s.n}-${s.acquisition.metadata['Element.symbol']}${s.acquisition.metadata['Element.edge']}`;
              try {
                if (kind === 'larch') {
                  const script = larchScript(s.acquisition, base, s.mode);
                  download(script.filename, script.code, 'text/x-python');
                } else {
                  const text = kind === 'xdi' ? writeXdi(s.acquisition, [`Acquisition ${s.n} from the XAS Lab beamline twin (${s.acquisition.provenance.includes('measured') ? 'measured data' : 'simulated data'}).`]) : kind === 'csv' ? csv(s.acquisition) : JSON.stringify(s.acquisition);
                  download(`${base}.${kind}`, text, kind === 'json' ? 'application/json' : 'text/plain');
                }
              } catch (error) { dispatch({ type: 'note', text: `The ${kind} download could not be made: ${error instanceof Error ? error.message : String(error)}` }); }
            }}><Download size={14} aria-hidden="true" />{kind === 'larch' ? 'Larch' : kind.toUpperCase()}</button>)}
        </span>
      </li>)}</ol> : <p className="twin-empty">No acquisitions stored.</p>}
      <p className="twin-dialog-status" role="status">{importStatus}</p>
    </section>
    {popUp && createPortal(<>
      <header className="twin-popout-head">
        <h1 className="twin-kicker"><span className={'twin-dot' + (replaying ? ' is-live' : '')} aria-hidden="true" />Results · Beamline twin</h1>
        <label className="twin-popout-view">View <select name="view" value={popTab} onChange={e => setPopTab(e.target.value as ResultTab)}>
          {RESULT_TABS.map(tab => <option key={tab} value={tab}>{TABS[tab].name}</option>)}
        </select></label>
      </header>
      <main className="twin-tabpanel">
        <p><TexProse>{TABS[popTab].shows}</TexProse></p>
        {panelFor(popTab)}
      </main>
    </>, popUp.root)}
  </section>;
}
