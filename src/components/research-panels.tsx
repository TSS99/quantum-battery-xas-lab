'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, CheckCircle2, Copy, Download, FileJson, FlaskConical, RefreshCcw, ShieldCheck, Upload } from 'lucide-react';
import { useLab } from './lab-context';
import { Num, ScienceText, Tex, Unit } from './tex';
import { EXPERIMENT_ART } from './experiment-art';
import { ModelEquations } from './model-equations';
import { TwinMethods } from './twin-methods';
import { SceneDefs } from './scene-kit';
import { Badge, Disclosure, Metric, Panel, Range, TryThis, download } from './ui';
import { DEFAULT_STATE, scenarioFromJSON, scenarioToJSON, scenarioToURL, type LabState, validateScenario } from '@/lib/scenario';
import { nominalMnOxidation, transmission, logisticEdge } from '@/lib/xas';
import { isBattery } from '@/lib/sample';
import { validateSpectrum, type Spectrum } from '@/lib/spectra';
import type { QuantumResult } from '@/lib/quantum';
import { loadXrayData } from '@/lib/xraydata';
import { benchmarkDeviations, summarizeAgreement, type Agreement, type Benchmark, type BenchmarkQuantity } from '@/lib/benchmark';

const presets=[
 {title:'Lithium & local redox',art:'crystal',tag:'Materials',description:'Add lithium and watch manganese change charge.',route:'crystal',patch:{x:.25},question:'How does charge neutrality constrain nominal oxidation?'},
 {title:'Across the absorption edge',art:'edge',tag:'Spectroscopy',description:'Scan the Mn edge and watch transmission fall.',route:'beamline',patch:{energy:6530,thickness:40,x:.5},question:'Why does transmission fall when absorption rises?'},
 {title:'Photon statistics',art:'counts',tag:'Measurement',description:'Lower the photon count to see counting noise.',route:'beamline',patch:{photons:1000,thickness:75,seed:42},question:'How much does counting noise matter?'},
 {title:'An exact quantum response',art:'quantum',tag:'Quantum',description:'Turn a two-qubit time signal into a spectrum.',route:'quantum',patch:{},quantum:{qubits:2,coupling:.35,field:.7,timeMax:40,samples:256,trotterSteps:24,broadening:.12,window:'cosine',padding:4},question:'Where do the spectral peaks come from?'},
 {title:'Test a product formula',art:'trotter',tag:'Convergence',description:'Increase the number of steps and compare the spectrum.',route:'quantum',patch:{},quantum:{qubits:3,coupling:.6,field:.7,timeMax:30,samples:256,trotterSteps:4,broadening:.15,window:'cosine',padding:4},question:'Does a better state fidelity also improve the spectrum?'},
 {title:'Compare a loading series',art:'series',tag:'Analysis',description:'Save curves at different lithium contents.',route:'spectra',patch:{x:0},question:'How much does an edge estimator depend on line shape?'},
] as const;
export function ExperimentPanel() {
  const { state, set, reset, runs, addRun, notify, loadPreset } = useLab();
  const [error, setError] = useState(''), [share, setShare] = useState(''), [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function copyShare() {
    const url = scenarioToURL(state, window.location.origin + (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/experiments/');
    setShare(url);
    try { await navigator.clipboard.writeText(url); notify('Link copied.'); } catch { notify('Select and copy the link below.'); }
  }
  return <>
    <TryThis done={saved || !!share} research={<>The link stores sample settings and the count seed. Download includes the current curves. Quantum runs are exported on their own page.</>}>{saved || share ? 'Your settings are ready to use in another session.' : 'Open an example, or save your current experiment below.'}</TryThis>
    <svg className="scene-defs" aria-hidden="true" focusable="false"><SceneDefs /></svg>
    <div className="preset-grid">{presets.map(p => { const Art = EXPERIMENT_ART[p.art]; return <Link className="preset-card" key={p.title} href={'/' + p.route + '/' + ('quantum' in p ? '?quantum=' + encodeURIComponent(JSON.stringify(p.quantum)) : '')} onClick={() => {
      loadPreset({ ...DEFAULT_STATE, ...p.patch, expert: state.expert });
      if ('quantum' in p) localStorage.setItem('qbx-quantum-v1', JSON.stringify(p.quantum));
      notify('Opened ' + p.title + '.');
    }}><Art /><h2>{p.title}</h2><p>{p.description}</p></Link>; })}</div>
    <Panel title="Save your experiment"><p>The link saves settings. Download also saves your curves.</p>
      <div className="toolbar"><button className="button" onClick={copyShare}>Copy link</button><button className="button secondary" onClick={() => {
        download('qbx-experiment.json', JSON.stringify({ schema: 'qbx-session', version: 1, parameters: state, spectra: runs }, null, 2)); setSaved(true);
      }}>Download experiment</button><button className="button secondary" onClick={() => input.current?.click()}>Load experiment</button></div>
      <input ref={input} hidden type="file" accept=".json,application/json" aria-label="Load scenario JSON" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        try {
          if (file.size > 5_000_000) throw new Error('File exceeds 5 MB.');
          const text = await file.text(), value = JSON.parse(text);
          if (value.schema === 'qbx-session' && value.version === 1) {
            const params = validateScenario(value.parameters);
            if (!Array.isArray(value.spectra) || value.spectra.length > 12) throw new Error('Expected up to 12 saved curves.');
            const curves = value.spectra.map(validateSpectrum);
            set(params); curves.forEach((curve: Spectrum) => addRun({ ...curve, id: crypto.randomUUID() }));
          } else set(scenarioFromJSON(text));
          setError(''); notify('Experiment loaded.');
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the experiment.'); }
      }} />
      {error && <p className="field-error" role="alert"><ScienceText>{error}</ScienceText></p>}
      {share && <label className="field-label">Share URL<textarea readOnly value={share} rows={3} onFocus={e => e.target.select()} /></label>}
      <Disclosure title="More save options"><div className="toolbar"><button className="button secondary" onClick={() => { download('qbx-scenario.json', scenarioToJSON(state)); setSaved(true); }}>Download settings only</button><button className="button secondary" onClick={reset}>Reset settings</button></div><pre>{scenarioToJSON(state)}</pre></Disclosure>
    </Panel>
    <details className="research-drawer" open={state.expert}><summary>Experiment settings</summary><div className="drawer-body">
      {isBattery(state.sample) && <Range label="Scenario lithium content" value={state.x} min={0} max={1} step={.01} digits={2} onChange={x => set({ x })} />}
      <label className="field-label">Reproducible count seed<input type="number" min={0} max={4294967295} value={state.seed} onChange={e => { const n = +e.target.value; if (Number.isInteger(n) && n >= 0 && n <= 4294967295) set({ seed: n }); }} /></label>
      <Link className="text-link" href="/crystal/">Change the sample</Link><p>Saved curves clear when you reload the page. Keep a download for later work.</p>
    </div></details>
  </>;
}

const papers: [string, string, string, ReactNode][] = [
 ['2405.11015','Simulating X-ray absorption spectroscopy of battery materials on a quantum computer','Fomichev et al., 2024','The time-domain workflow and oxygen-centred cluster example.'],
 ['2506.15784','Fast simulations of X-ray absorption spectroscopy for battery materials on a quantum computer','Fomichev et al., 2025','Sampling, eigenvalue error and fault-tolerant cost estimates.'],
 ['2505.08612','Demonstration of logical quantum phase estimation for X-ray absorption spectra','Nishi et al., 2025',<><Tex plain>{'\\mathrm{Fe}\\ L_{2,3}'}</Tex> edges, trapped-ion calculations and Lorentzian post-processing.</>],
 ['2602.20270','Quantum algorithm for simulating resonant inelastic X-ray scattering in battery materials','Loaiza et al., 2026','RIXS extends the absorption problem; it is outside this lab.'],
 ['2606.30738','Practical Estimation of Trotter Error for Hamiltonian Simulation','Maxwell et al., 2026','Why peak shifts can matter more than state fidelity.'],
 ['2606.30741','Theory and practice of Trotter product formulas for quantum chemistry','Casares et al., 2026','Improved product formulas; this lab uses first order.'],
 ['2503.14390','Role of symmetry-forbidden transitions in resonant inelastic X-ray scattering emission from materials with trapped molecular O₂','Radin and Kunitsa, 2025','Context for oxygen-edge studies of lithium-rich cathodes.'],
 ['2610.13189','Insights on the volume variation of LiCoxMn2-xO4 electrode upon cycling: a correlative operando XRD and XAS study','Mahayoni et al., 2026','Measured cycling data as context for the battery example.'],
 ['2609.33776','Benchmark of First-Principles Titanium K-Edge X-Ray Absorption Spectral Simulations on Titanium-containing Oxides','Cao et al., 2026','Motivates comparing several similarity scores over a stated energy window.'],
];
const AGREEMENT_LABELS: Record<BenchmarkQuantity, ReactNode> = {
  total: <>Total attenuation <Tex>{'\\mu_{\\mathrm{total}}'}</Tex></>,
  photo: <>Photoabsorption <Tex>{'\\mu_{\\mathrm{photo}}'}</Tex></>,
  edgeEnergy: <>Edge energies <Tex>{'E_0'}</Tex></>,
  edgeStep: <>Edge step <Tex>{'\\Delta\\mu'}</Tex></>,
  thickness: <>Transmission thickness <Tex>{'d'}</Tex></>,
};
const percent = (value: number) => value ? (value * 100).toPrecision(2) + '%' : '0%';

/** Recomputes the xraydb benchmark with the lab's own functions; loads its data only when opened. */
function XraydbAgreement() {
  const [result, setResult] = useState<{ version: string; materials: number; rows: Agreement[] } | null>(null), [error, setError] = useState('');
  const started = useRef(false);
  function load() {
    if (started.current) return;
    started.current = true;
    setError('');
    Promise.all([loadXrayData(), import('@/data/xray/benchmark.json')]).then(([, module]) => {
      const benchmark: Benchmark = module.default;
      setResult({ version: benchmark.xraydbVersion, materials: benchmark.cases.length, rows: summarizeAgreement(benchmarkDeviations(benchmark)) });
    }).catch(() => { started.current = false; setError('The comparison data could not load. Close and reopen this section to try again.'); });
  }
  return <details className="disclosure" onToggle={e => { if (e.currentTarget.open) load(); }}><summary>Agreement with xraydb</summary><div>
    {error ? <p className="field-error" role="alert">{error}</p> : !result ? <p className="muted" role="status">Comparing with xraydb…</p> : <>
      <p>Your browser recomputes <Num>{String(result.materials)}</Num> materials with the lab’s own code and compares them with xraydb {result.version}, the reference Python library: every preset, one pure element per period, a hydrate and a dilute sample, from <Num>100</Num> <Unit>eV</Unit> to <Num>100</Num> <Unit>keV</Unit>. Deviation is <Tex>{'|x_{\\mathrm{lab}}/x_{\\mathrm{xraydb}} - 1|'}</Tex>.</p>
      <div className="table-wrap"><table><thead><tr><th>Quantity</th><th>Points</th><th>Median deviation</th><th>Max deviation</th></tr></thead><tbody>{result.rows.map(row => <tr key={row.quantity}><td>{AGREEMENT_LABELS[row.quantity]}</td><td><Num>{String(row.points)}</Num></td><td><Num>{percent(row.median)}</Num></td><td><Num>{percent(row.max)}</Num></td></tr>)}</tbody></table></div>
      <p className="muted">The lab’s tables were derived from the same Elam data in XrayDB, so this checks the implementation (table compression, interpolation, formula parsing and mixing), not the physics data. Energies within <Num>1</Num> <Unit>eV</Unit> of an edge are left out, because there the rounded edge position and xraydb’s spline can legitimately differ.</p>
    </>}
  </div></details>;
}

type CheckResult={id:string;label:ReactNode;value:ReactNode;pass:boolean};
export function ValidationPanel(){const {state,complete}=useLab();const [checks,setChecks]=useState<CheckResult[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');const workerRef=useRef<Worker|null>(null);
 async function runChecks(){setBusy(true);setError('');const t=transmission(100,50,100000);const values:CheckResult[]=[{id:'charge',label:<>Charge neutrality: <Tex>{'x + (4 - x) - 4'}</Tex></>,value:<><Num>0</Num> at <Tex plain>{'x = 0, 0.5, 1'}</Tex></>,pass:[0,.5,1].every(x=>Math.abs(x+nominalMnOxidation(x)-4)<1e-12)},{id:'beer',label:'Beer–Lambert log identity',value:Math.abs(Math.log(t.expectedIncident/t.expectedTransmitted)-t.opticalDepth).toExponential(2),pass:Math.abs(Math.log(t.expectedIncident/t.expectedTransmitted)-t.opticalDepth)<1e-12},{id:'counts',label:<>Deterministic <Tex>{'I_t \\le I_0'}</Tex></>,value:<Tex plain>{`${t.expectedTransmitted.toFixed(2)} \\le 100000`}</Tex>,pass:t.expectedTransmitted<=t.expectedIncident},{id:'edge',label:'Logistic edge is monotonic',value:'101 grid points',pass:Array.from({length:100},(_,i)=>logisticEdge(6530+i*.5,6550,1.2)<=logisticEdge(6530+(i+1)*.5,6550,1.2)).every(Boolean)}];setChecks(values);try{const result=await new Promise<QuantumResult>((resolve,reject)=>{const w=new Worker(new URL('../workers/quantum.worker.ts',import.meta.url));workerRef.current=w;const timeout=setTimeout(()=>{w.terminate();reject(new Error('Validation worker timed out.'));},20000);w.onmessage=e=>{clearTimeout(timeout);w.terminate();e.data.error?reject(new Error(e.data.error)):resolve(e.data.result);};w.onerror=()=>{clearTimeout(timeout);w.terminate();reject(new Error('Could not run browser solver.'));};w.postMessage({id:1,params:{qubits:2,coupling:.35,field:.7,timeMax:20,samples:128,trotterSteps:24,broadening:.12,window:'cosine',padding:4}});});const v=result.validation;setChecks([...values,...([{id:'herm',label:'Hamiltonian Hermiticity',n:v.hermiticityError},{id:'unit',label:'Exact propagator unitarity',n:v.unitarityError},{id:'ground',label:'Ground-state eigenpair residual',n:v.groundResidual},{id:'c0',label:<Tex>{'C(0) = \\langle g|D^\\dagger D|g\\rangle'}</Tex>,n:v.correlationAtZeroError},{id:'sum',label:'Transition-weight sum rule',n:v.transitionWeightError}].map(c=>({id:c.id,label:c.label,value:c.n.toExponential(3),pass:c.n<1e-10})))]);}catch(e){setError(e instanceof Error?e.message:'Validation failed.');}finally{setBusy(false);}}
 return <><TryThis steps={['validate']} done={checks.length===9&&!busy&&checks.every(c=>c.pass)} research={<>Charge and attenuation: residual <Tex>{'< 10^{-12}'}</Tex>. Quantum: residual <Tex>{'< 10^{-10}'}</Tex> for the two-qubit reference.</>}>{checks.length===9&&!busy?<>{checks.filter(c=>c.pass).length} of {checks.length} checks passed. Each one tests the code against its own equations.</>:'Run the checks to test charge balance, attenuation and the quantum solver.'}</TryThis>
 <Panel title="Check the calculations"><button className="button" disabled={busy} onClick={runChecks}>{busy?'Checking…':'Run sanity checks'}</button>{error&&<p className="field-error" role="alert"><ScienceText>{error}</ScienceText></p>}<div className="check-results" aria-live="polite">{checks.map(c=><div key={c.id}><span>{c.label}</span><code>{typeof c.value === 'string' ? <Num>{c.value}</Num> : c.value}</code><strong>{c.pass?'Pass':'Fail'}</strong></div>)}</div><XraydbAgreement /></Panel>
 <Panel title="What the results mean"><ul className="source-list"><li><strong>Tabulated atomic data.</strong> XrayDB / Elam data give absorption backgrounds and edge jumps for H to Cf, 100 <Unit>eV</Unit> to 100 <Unit>keV</Unit>.</li><li><strong>Teaching spectra.</strong> Adjustable peaks and edge shifts are models, not measured data.</li><li><strong>Quantum response.</strong> The browser solves a small Hamiltonian. It does not predict a material spectrum.</li><li><strong>Imported curves.</strong> Raw arrays and your notes are preserved. Origin and calibration are unverified.</li></ul><p>A passing check means the tested residual or condition met its threshold. It does not establish accuracy for every setting or for a real sample.</p><h3>Claims we do not make</h3><ul>
<li>The quantum curve is the response of whichever Hamiltonian is loaded. That alone does not make it the XAS of a material or of a Mn K-edge.</li>
<li>This lab does not reproduce the papers’ spectra, active spaces or resource estimates.</li>
<li>These calculations run classically. They show no hardware result or quantum advantage.</li>
<li>State fidelity does not measure spectral accuracy. <Tex plain>{'L^1'}</Tex> and RMSE here are app diagnostics.</li>
<li>A model edge shift does not measure lithium content or oxidation state.</li>
<li>The model ripples cannot give bond lengths. The pre-edge is not a pure dipole <Tex plain>{'1s \\to 3d'}</Tex> transition.</li>
<li>A model sweep is not operando data and cannot diagnose oxygen redox or degradation.</li>
<li>A high similarity score does not validate a model. Imported measurements and calibration are unverified.</li>
</ul></Panel>
 <TwinMethods />
 <Panel title="Research references"><p>The anchor papers simulate the oxygen K-edge of a <Tex plain>{'\\mathrm{Li_4Mn_2O}'}</Tex> cluster. The Mn teaching spectrum here is a separate example.</p><ol className="reference-list">{papers.map(([id,title,authors,why])=><li key={id}><a href={`https://arxiv.org/abs/${id}`} target="_blank" rel="noreferrer">{title}</a><span>{authors}</span><p>{why}</p></li>)}</ol></Panel>
 <Panel title="Model equations"><p>Each equation is written the way the code evaluates it, with what its symbols mean, their units, and the file and function that compute it.</p><details className="disclosure" open={state.expert}><summary>Equations, symbols and sources</summary><div><ModelEquations /></div></details></Panel>
 <details className="research-drawer" open={state.expert} onToggle={e=>{if(e.currentTarget.open)complete(['cost']);}}><summary>Limits and further work</summary><div className="drawer-body"><p>Material predictions need a structure, an active space, a core-excited Hamiltonian and calibrated reference spectra. Check convergence before comparing with a measurement.</p><p>Dense matrix storage grows as <Tex>{'4^n'}</Tex>. The browser solver is limited to six qubits. Its gate counts exclude state preparation, measurement and error correction.</p><div className="equation"><Tex>{'\\text{model error} \\neq \\text{numerical error}'}</Tex><Tex>{'\\text{counting noise} \\neq \\text{systematic uncertainty}'}</Tex></div></div></details></>;
}
