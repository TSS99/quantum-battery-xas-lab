'use client';
/**
 * Quantum XAS (/quantum/): an X-ray absorption spectrum computed the way a fault tolerant quantum computer would, by
 * Hadamard tests of the core-excited state's time evolution, read out shot by shot (Fomichev et al., arXiv
 * 2506.15784). The noiseless signals come from the library packs; shots are drawn here; small problems can be rerun
 * in the browser. See docs/PLAN-quantum.md and docs/QUANTUM_LIBRARY.md.
 */
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft, Cpu, Shuffle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plot } from '../plot';
import { CostCard } from './cost-card';
import { seededRandom } from '@/lib/xas';
import { loadIndex, loadPack, spectra, storedSignals, type Factorization, type Pack, type PackEntry } from '@/lib/quantum/packs';
import type { RunMessage, RunRequest } from '@/lib/quantum/worker';
import type { Signal } from '@/lib/quantum/spectrum';
import validation from '@/data/quantum/validation.json';

const Cluster3D = dynamic(() => import('./cluster-3d'), { ssr: false, loading: () => <div className="qx-stage-empty">Loading the atoms…</div> });
const MeasureCard = dynamic(() => import('./measure-card'), { ssr: false });

const ALPHA = 1.3384;  // the paper's shot distribution exponent
const SHOT_STEPS = [1_000, 3_000, 10_000, 30_000, 100_000, 300_000, 1_000_000];
const fmt = (x: number, digits = 1) => x.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** A problem too large for a browser pack: shown with its cost, and the atoms of a pack built on the same cluster. */
interface Target { id: string; title: string; why: string; same_atoms_as: string | null; orbitals: number; active_electrons: number; determinants: number }

interface Live { key: string; signals: (Signal | null)[]; seconds: number; /** Largest difference from the stored Python signal. */ difference: number }

function useEmulator() {
  const worker = useRef<Worker | null>(null);
  const current = useRef(0);
  const [progress, setProgress] = useState<{ running: boolean; done: number; total: number; error?: string }>({ running: false, done: 0, total: 0 });
  const run = useCallback((request: Omit<RunRequest, 'id' | 'type'>, finish: (signals: (Signal | null)[], seconds: number) => void) => {
    const id = ++current.current;
    setProgress({ running: true, done: 0, total: 1 });
    if (!worker.current) worker.current = new Worker(new URL('../../lib/quantum/worker.ts', import.meta.url));
    worker.current.onmessage = (event: MessageEvent<RunMessage>) => {
      const m = event.data;
      if (m.id !== current.current) return;
      if (m.type === 'step') setProgress({ running: true, done: m.done, total: m.total });
      else if (m.type === 'done') {
        setProgress(p => ({ ...p, running: false, done: p.total }));
        finish(m.signals.map(s => s ? [Float64Array.from(s[0]), Float64Array.from(s[1])] as Signal : null), m.seconds);
      } else setProgress({ running: false, done: 0, total: 0, error: m.message });
    };
    worker.current.postMessage({ type: 'run', id, ...request } satisfies RunRequest);
  }, []);
  useEffect(() => () => worker.current?.terminate(), []);
  return { progress, run };
}

export function QuantumPage() {
  const [index, setIndex] = useState<PackEntry[]>([]);
  const [id, setId] = useState('h2o-o-k-sto3g');
  const [pack, setPack] = useState<Pack | null>(null);
  const [method, setMethod] = useState<Factorization>('exact');
  const [shotStep, setShotStep] = useState(2);
  const [jmax, setJmax] = useState(100);
  const [seed, setSeed] = useState(1);
  const [live, setLive] = useState<Live | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [atoms, setAtoms] = useState<[string, number[]][] | null>(null);
  const { progress, run } = useEmulator();

  useEffect(() => { void loadIndex().then(setIndex); }, []);
  useEffect(() => {
    if (!index.length) return;
    const packed = new Set(index.map(p => p.id));
    void import('@/data/quantum/estimates.json').then(m => setTargets((m.default.problems as unknown as Target[]).filter(p => !packed.has(p.id))));
  }, [index]);
  const target = targets.find(t => t.id === id);
  const source = target ? target.same_atoms_as : id;
  useEffect(() => {
    let stale = false;
    setPack(null);
    setAtoms(null);
    if (!source) return;
    void loadPack(source).then(p => { if (stale) return; setAtoms(p.atoms); if (!target) setPack(p); });
    return () => { stale = true; };
  }, [source, target]);

  // The Mn cluster packs hold only the compressed factorization (the exact one would take hours per problem here).
  const available = pack ? (['exact', 'cdf'] as Factorization[]).filter(f => pack.signals[f]) : [];
  const used: Factorization = available.includes(method) ? method : available[0] ?? method;
  const key = `${id}:${used}`;
  const signals = useMemo(() => {
    if (!pack) return null;
    return live?.key === key ? live.signals : storedSignals(pack, used);
  }, [pack, used, live, key]);
  const shots = SHOT_STEPS[shotStep];
  const result = useMemo(() => pack && signals ? spectra(pack, signals, Math.min(jmax, pack.settings.jmax), shots, ALPHA, seededRandom(seed)) : null,
    [pack, signals, jmax, shots, seed]);

  const runHere = () => {
    if (!pack?.live) return;
    const { states, fragments, ...problem } = pack.live;
    run({ problem, fragments: fragments[used], states: pack.dipole_norms.map((n, k) => n ? states[k] : null), tau: pack.settings.tau_per_Ha,
      jmax: pack.settings.jmax, substeps: pack.signals[used]?.substeps ?? pack.settings.substeps }, (s, seconds) => {
      const stored = storedSignals(pack, used);
      let difference = 0;
      s.forEach((g, k) => { const p = stored[k]; if (g && p) for (let j = 0; j < g[0].length; j++) difference = Math.max(difference, Math.abs(g[0][j] - p[0][j]), Math.abs(g[1][j] - p[1][j])); });
      setLive({ key, signals: s, seconds, difference });
    });
  };

  const absorber = atoms ? Math.max(0, atoms.findIndex(([s]) => s === 'O')) : 0;
  const measured = validation.rows.filter(r => r.problem === id);
  const m = pack?.meta;
  const substeps = pack?.signals[used]?.substeps ?? 1;
  const steps = pack ? Math.min(jmax, pack.settings.jmax) * substeps : 0;

  return <div className="qx-app">
    <header className="twin-hero qx-hero">
      <p className="twin-kicker">X-ray absorption on a quantum computer</p>
      <h1>Quantum <em>XAS</em></h1>
      <p className="twin-intro">The absorption spectrum computed the way a fault tolerant quantum computer would: the core-excited state is evolved in time, a Hadamard test reads out how it overlaps with where it started, shot by shot, and a Fourier sum turns those numbers into the spectrum (Fomichev et al., 2025). A classical emulator stands in for the quantum computer and every result is checked against the exact answer.</p>
      <div className="twin-chips">
        <Link className="twin-chip" href="/"><ArrowLeft size={14} aria-hidden="true" />The beamline twin</Link>
        <Link className="twin-chip" href="/methods/">Methods</Link>
        <a className="twin-chip" href="https://github.com/TSS99/quantum-battery-xas-lab/blob/main/docs/QUANTUM_REPRO.md" target="_blank" rel="noreferrer">How it was checked</a>
      </div>
    </header>

    <div className="qx-grid">
      <section className="twin-card qx-card" aria-labelledby="qx-problem">
        <h2 id="qx-problem" className="twin-kicker">Problem</h2>
        <label className="twin-field">Absorber and cluster
          <select value={id} onChange={e => { setId(e.target.value); setLive(null); }}>
            {(index.length ? index : [{ id, title: 'Water, oxygen K edge, minimal basis' } as PackEntry]).map(p =>
              <option key={p.id} value={p.id}>{p.title}{p.live ? ' (runs in your browser)' : ''}</option>)}
            {targets.map(t => <option key={t.id} value={t.id}>{t.title} (cost only)</option>)}
          </select>
        </label>
        <div className="qx-stage">{atoms ? <Cluster3D atoms={atoms} absorber={absorber} label="The atoms of the problem, the absorbing oxygen glowing" /> : <div className="qx-stage-empty">Loading…</div>}</div>
        {target && <>
          <dl className="qx-facts">
            <div><dt>Active space</dt><dd>{target.active_electrons} electrons in {target.orbitals} orbitals</dd></div>
            <div><dt>Qubits</dt><dd>{2 * target.orbitals + 1} (two per orbital, one for the test)</dd></div>
            <div><dt>Determinants</dt><dd>{target.determinants.toLocaleString('en')}</dd></div>
            <div><dt>Exact edge</dt><dd>none: beyond exact methods</dd></div>
          </dl>
          <p className="qx-note">{target.why}</p>
        </>}
        {pack && m && <>
          <dl className="qx-facts">
            <div><dt>Active space</dt><dd>{m.active_electrons} electrons in {m.active_orbitals} orbitals</dd></div>
            <div><dt>Qubits</dt><dd>{m.qubits} (two per orbital, one for the test)</dd></div>
            <div><dt>Determinants</dt><dd>{m.ci_dimension.toLocaleString('en')}</dd></div>
            <div><dt>Exact edge</dt><dd>{fmt(pack.reference.edge_eV)} eV</dd></div>
          </dl>
          <p className="qx-note">{pack.why}</p>
          {measured.length > 0 && <ul className="qx-measured" aria-label="Against experiment">
            {measured.map(r => <li key={r.feature}>{r.feature[0].toUpperCase() + r.feature.slice(1)}: measured {r.eV.toFixed(2)} eV, this model {r.computed_eV.toFixed(2)} eV ({r.difference_eV > 0 ? '+' : ''}{r.difference_eV.toFixed(2)} eV). <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">{r.source}</a></li>)}
          </ul>}
        </>}
      </section>

      {target ? <section className="twin-card qx-card" aria-labelledby="qx-none">
        <h2 id="qx-none" className="twin-kicker">Circuits</h2>
        <p className="qx-note">No spectrum here. With {target.determinants.toLocaleString('en')} determinants this problem is beyond exact classical methods, and its {2 * target.orbitals + 1} qubit circuits are beyond emulation on an ordinary computer: that is what makes it a target for fault tolerant hardware. Its cost is below.</p>
      </section> : <>
      <section className="twin-card qx-card" aria-labelledby="qx-circuit">
        <h2 id="qx-circuit" className="twin-kicker">Circuits</h2>
        <div className="twin-switch" role="group" aria-label="Factorization">
          <button type="button" aria-pressed={used === 'exact'} disabled={!available.includes('exact')} onClick={() => setMethod('exact')}>Exact factorization</button>
          <button type="button" aria-pressed={used === 'cdf'} disabled={!available.includes('cdf')} onClick={() => setMethod('cdf')}>Compressed</button>
        </div>
        {pack && !available.includes('exact') && <p className="qx-note">Only the compressed factorization is offered for this problem, with one Trotter step per time point as in the paper&apos;s Fig. 9: emulating the exact one would take about six hours per problem here.</p>}
        {/* A label names the first labelable element inside it, and <output> is one; so label and readout sit apart. */}
        <div className="twin-field">
          <div className="qx-field-head"><label htmlFor="qx-jmax">Evolution length, j_max</label><output htmlFor="qx-jmax">{Math.min(jmax, pack?.settings.jmax ?? jmax)} times</output></div>
          <input id="qx-jmax" type="range" min={5} max={100} step={5} value={jmax} onChange={e => setJmax(+e.target.value)} />
        </div>
        <div className="twin-field">
          <div className="qx-field-head"><label htmlFor="qx-shots">Shots per dipole direction</label><output htmlFor="qx-shots">{shots.toLocaleString('en')}</output></div>
          <input id="qx-shots" type="range" min={0} max={SHOT_STEPS.length - 1} step={1} value={shotStep}
            aria-valuetext={`${shots.toLocaleString('en')} shots`} onChange={e => setShotStep(+e.target.value)} />
        </div>
        <div className="qx-actions">
          <button type="button" className="twin-chip" onClick={() => setSeed(s => s + 1)}><Shuffle size={14} aria-hidden="true" />New shots</button>
          {pack?.live && <button type="button" className="twin-chip is-accent" disabled={progress.running} onClick={runHere}>
            <Cpu size={14} aria-hidden="true" />{progress.running ? `Running ${Math.round(100 * progress.done / Math.max(1, progress.total))} %` : 'Run the circuits in your browser'}</button>}
        </div>
        {progress.error && <p className="qx-note" role="alert">{progress.error}</p>}
        {pack && <dl className="qx-facts">
          <div><dt>Fragments</dt><dd>{pack.signals[used]?.fragments}, integral error {pack.signals[used]?.factor_max_error_Ha.toExponential(1)} Ha</dd></div>
          <div><dt>Trotter steps, longest circuit</dt><dd>{steps.toLocaleString('en')} of {fmt(pack.settings.tau_per_Ha / substeps, 3)} Ha⁻¹</dd></div>
          <div><dt>Shots in all</dt><dd>{result ? result.shots.toLocaleString('en') : '…'}</dd></div>
        </dl>}
        {pack && <p className="qx-note" role="status">{live?.key === key ? `Signal computed here, in your browser, in ${fmt(live.seconds, 1)} s; it differs from the Python emulator's by at most ${live.difference.toExponential(0)}.` : 'Signal computed by the Python emulator; shots are drawn here.'}</p>}
      </section>

      <section className="twin-card qx-card qx-wide" aria-labelledby="qx-spectrum">
        <h2 id="qx-spectrum" className="twin-kicker">Spectrum</h2>
        {result ? <>
          <Plot exportName={`quantum-${id}`} xLabel="Photon energy, E − E_I (eV)" yLabel="Absorption, exact peak at 1" height={280}
            series={[
              { name: 'Exact', color: '#d4dae3', x: result.energies_eV, y: result.exact },
              { name: 'Noiseless circuits', color: '#ffc46b', dash: 'dashed', x: result.energies_eV, y: result.perfect },
              { name: `Measured, ${shots.toLocaleString('en')} shots`, color: '#8ce3ff', x: result.energies_eV, y: result.measured },
            ]} />
          <dl className="qx-facts qx-readout">
            <div><dt>Main peak, exact</dt><dd>{fmt(result.peak_eV.exact, 2)} eV</dd></div>
            <div><dt>Main peak, measured</dt><dd>{fmt(result.peak_eV.measured, 2)} eV</dd></div>
            <div><dt>Largest difference</dt><dd>{fmt(100 * result.difference, 1)} % of the peak</dd></div>
          </dl>
        </> : <p className="qx-note">Loading the problem…</p>}
      </section>

      </>}

      <CostCard id={id} />

      {!target && <section className="twin-card qx-card qx-wide" aria-labelledby="qx-signal">
        <h2 id="qx-signal" className="twin-kicker">What the circuits measure</h2>
        {result && <Plot exportName={`quantum-signal-${id}`} xLabel="Evolution time, t (1/Ha)" yLabel="Re G(t), between −1 and 1" height={200}
          series={[
            { name: 'Noiseless', color: '#ffc46b', dash: 'dashed', x: result.times, y: Array.from(result.signalPerfect[0]) },
            { name: 'Measured', color: '#8ce3ff', x: result.times, y: Array.from(result.signalMeasured[0]) },
          ]} />}
        <p className="qx-note">Each point is the real part of the Hadamard test at one evolution time, averaged over the three dipole directions. Shots are spread so that early times, which matter most, get the most. Energies sit 6 to 30 eV above experiment because these small models do not relax the orbitals around the core hole; the quantum algorithm reproduces each model&apos;s exact spectrum, which is what this page checks.</p>
      </section>}

      <MeasureCard id={id} />
    </div>
  </div>;
}
