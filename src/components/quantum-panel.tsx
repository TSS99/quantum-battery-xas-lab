'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, CheckCircle2, Cpu, Download, FlaskConical, Play, RotateCcw, Square } from 'lucide-react';
import { defaultQuantumParams, validateQuantumParams, type PauliTerm, type QuantumParams, type QuantumResult } from '@/lib/quantum';
import { Badge, Disclosure, Metric, Panel, Range, TryThis, download } from './ui';
import { parseHamiltonian, HAMILTONIAN_EXAMPLE, type CustomHamiltonian } from '@/lib/custom-hamiltonian';
import { useLab } from './lab-context';
import { Plot } from './plot';
import { Num, Tex, Unit } from './tex';

const stages = [
  { title: 'Choose H', subtitle: 'Hamiltonian → ground state', text: <>Choose a small effective spin model. The browser diagonalizes its Hermitian matrix and selects the normalized lowest-energy eigenvector <Tex plain>{'|g\\rangle'}</Tex>. The Pauli terms are set by hand. They are not Mn–O electronic integrals.</>, equation: String.raw`H = \sum_i h\,(1 + 0.13\,i)\,Z_i + J\sum_i X_i X_{i+1} + 0.17\sum_i X_i` },
  { title: 'Excite', subtitle: 'Dipole-inspired state', text: <>Apply <Tex plain>{'D = X_0'}</Tex> to <Tex plain>{'|g\\rangle'}</Tex>. <Tex plain>{'X_0'}</Tex> flips the most significant qubit and happens to preserve the norm. A physical dipole operator generally does not. Realistic core excitation and its state preparation are not modeled here.</>, equation: String.raw`|v\rangle = D|g\rangle,\quad D = X_0,\quad \langle v|v\rangle = 1\ \text{for this toy choice}` },
  { title: 'Evolve', subtitle: 'Exact ↔ product formula', text: <>The state is propagated two ways: exactly in the eigenbasis, and with a first-order chronological product of Pauli exponentials. Both start from the same state and use the same ground-energy reference. At each plotted <Tex plain>{'t'}</Tex>, the chosen number of steps spans <Tex plain>{'[0, t]'}</Tex>.</>, equation: String.raw`U(t) = e^{-i(H - E_g I)t},\qquad U_n(t) = e^{iE_g t}\Big[\prod_{k}^{\text{in order}} e^{-i c_k P_k t/n}\Big]^{n}` },
  { title: 'Correlate', subtitle: 'Return amplitude', text: <>Overlap the time-evolved state with the dipole-excited initial state. The complex correlation encodes excitation gaps and their weights. Its value at <Tex plain>{'t = 0'}</Tex> obeys the sum rule. Inspect both real and imaginary parts below.</>, equation: String.raw`C(t) = \langle g|D^\dagger e^{-i(H - E_g I)t} D|g\rangle = \sum_n w_n\, e^{-i(E_n - E_g)t}` },
  { title: 'Reconstruct', subtitle: 'Time → excitation energy', text: <>A positive-sign Fourier transform, with lifetime damping and the chosen time taper, turns <Tex plain>{'C(t)'}</Tex> into an absorption-like spectrum. Compare it with the positive eigenstate Lorentzians. The zero-energy elastic term is kept and labeled separately; it is not a core absorption excitation.</>, equation: String.raw`S(\omega) = \frac{1}{\pi}\,\mathrm{Re}\int_0^T C(t)\,e^{i\omega t}\,e^{-\eta t}\,w(t)\,dt,\qquad \eta = \text{Lorentzian HWHM}` },
];

const sci = (value: number) => Math.abs(value) < 0.001 ? value.toExponential(2) : value.toFixed(4);
const readableCaveat = (text: string) => text.replace('ALIASING WARNING:', 'Aliasing:').replace('DEGENERATE GROUND SPACE:', 'Degenerate ground space:');
// Caveats stay plain ASCII in the JSON export; on screen their math fragments are typeset.
const CAVEAT_TEX: Record<string, string> = { 'D = X0': 'D = X_0', 'eV^-1': String.raw`\text{eV}^{-1}`, 'hbar = 1': String.raw`\hbar = 1`, '|<g|X0|g>|²': String.raw`|\langle g|X_0|g\rangle|^2`, 'D|g>': String.raw`D|g\rangle`, 'X0': 'X_0', 'q0': 'q_0', 'L1': 'L^1' };
const caveatNode = (text: string) => readableCaveat(text).split(/(D = X0|eV\^-1|hbar = 1|\|<g\|X0\|g>\|²|D\|g>|\bX0\b|\bq0\b|\bL1\b)/).map((part, i) => i % 2 ? <Tex key={i}>{CAVEAT_TEX[part]}</Tex> : part);
const pauliTex = (label: string) => [...label].map((p, q) => p === 'I' ? '' : `${p}_{${q}}`).join('') || 'I';
const hamiltonianTex = (terms: PauliTerm[]) => 'H = ' + terms.map((t, i) => (t.coefficient < 0 ? '- ' : i ? '+ ' : '') + String.raw`${Math.abs(t.coefficient).toFixed(3)}\,${pauliTex(t.label)}`).join(' ');
const percent = (value: number) => `${(100 * value).toFixed(2)}%`;

function Circuit({ result }: { result: QuantumResult }) {
  const [selected, setSelected] = useState(0);
  const gate = result.circuit[Math.min(selected, result.circuit.length - 1)];
  const width = 100 + result.circuit.length * 70, height = 36 + result.params.qubits * 54;
  return <>
    <p className="muted">One chronological step at final time T, repeated {result.params.trotterSteps} times. <Tex plain>{'q_0'}</Tex> is the leftmost bit of the state vector.</p>
    <div className="quantum-circuit" style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="Circuit diagram, scrolls sideways">
      <svg role="img" aria-label={`Product formula circuit with ${result.params.qubits} qubits and ${result.circuit.length} gates per step`} width={width} height={height} style={{ display: 'block', minWidth: width }}>
        <title>One Trotter step, ordered left to right</title>
        {Array.from({ length: result.params.qubits }, (_, q) => <g key={q}>
          <text x="12" y={45 + 54 * q} fill="#b9bfd0" fontSize="13" fontFamily="monospace">q{q}</text>
          <line x1="48" x2={width - 18} y1={40 + 54 * q} y2={40 + 54 * q} stroke="#6b7a8c" />
        </g>)}
        {result.circuit.map((g, i) => {
          const x = 80 + 70 * i, color = i === selected ? '#f4c777' : '#c4ccd6';
          return <g key={i}>
            {g.gate === 'CX' ? <>
              <line x1={x} x2={x} y1={40 + 54 * g.qubits[0]} y2={40 + 54 * g.qubits[1]} stroke={color} strokeWidth="2" />
              <circle cx={x} cy={40 + 54 * g.qubits[0]} r="5" fill={color} />
              <circle cx={x} cy={40 + 54 * g.qubits[1]} r="12" fill="#151b29" stroke={color} strokeWidth="2" />
              <path d={`M${x - 8},${40 + 54 * g.qubits[1]}h16 M${x},${32 + 54 * g.qubits[1]}v16`} stroke={color} />
            </> : <>
              <rect x={x - 24} y={22 + 54 * g.qubits[0]} width="48" height="36" rx="7" fill="#1c2530" stroke={color} />
              <text x={x} y={45 + 54 * g.qubits[0]} textAnchor="middle" fill={color} fontSize="13" fontFamily="monospace">{g.gate}</text>
            </>}
            <text x={x} y={height - 5} textAnchor="middle" fill="#8c97ad" fontSize="13">{i + 1}</text>
          </g>;
        })}
      </svg>
    </div>
    <div className="toolbar">
      <label>Inspect gate <select aria-label="Inspect circuit gate" value={Math.min(selected, result.circuit.length - 1)} onChange={e => setSelected(+e.target.value)}>
        {result.circuit.map((g, i) => <option key={i} value={i}>{i + 1}. {g.gate} on q{g.qubits.join(', q')}</option>)}
      </select></label>
      <span className="muted">Term {result.terms[gate.termIndex].label}; {gate.angle === undefined ? `control q${gate.qubits[0]}, target q${gate.qubits[1]}` : <>angle <Tex>{`${gate.angle.toFixed(5)}\\ \\text{rad} = 2cT/n`}</Tex></>}</span>
    </div>
    <p className="muted">XX synthesis: CX(control, target) → Rx(control) → CX(control, target). The global <Tex>{'e^{iE_g t}'}</Tex> phase is applied numerically. Ground-state preparation, excitation, measurement, hardware routing and error correction are excluded from these resource counts.</p>
  </>;
}

export function QuantumPanel() {
  const { state,complete } = useLab();
  const [userRan,setUserRan]=useState(false);
  const [custom,setCustom]=useState<CustomHamiltonian|null>(null);
  const customRef=useRef<CustomHamiltonian|null>(null);
  const [hamiltonianText,setHamiltonianText]=useState(JSON.stringify(HAMILTONIAN_EXAMPLE,null,2));
  const [hamiltonianError,setHamiltonianError]=useState('');
  const [comparison, setComparison] = useState<QuantumResult | null>(null);
  const [params, setParams] = useState<QuantumParams>(defaultQuantumParams);
  const [result, setResult] = useState<QuantumResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState(0);
  const [signed, setSigned] = useState(false);
  const [local, setLocal] = useState(false);
  const [ready, setReady] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [reference, setReference] = useState<QuantumResult | null>(null);
  const [completedAt, setCompletedAt] = useState('');
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);
  const referenceAbort = useRef<AbortController | null>(null);
  const reducedMotion = useReducedMotion();

  const run = useCallback((input: QuantumParams, hamiltonian: CustomHamiltonian|null = customRef.current) => {
    worker.current?.terminate();
    if (timeout.current) clearTimeout(timeout.current);
    referenceAbort.current?.abort();
    referenceAbort.current = null;
    setReferenceBusy(false); setReference(null); setReferenceError('');
    setBusy(true); setError(''); setStage(1);
    const id = ++request.current;
    try {
      const next = new Worker(new URL('../workers/quantum.worker.ts', import.meta.url));
      worker.current = next;
      const finish = () => { if (timeout.current) clearTimeout(timeout.current); next.terminate(); if (worker.current === next) worker.current = null; setBusy(false); };
      next.onmessage = event => {
        if (event.data.id !== request.current) return;
        if (event.data.error) setError(event.data.error);
        else { setResult(event.data.result); setStage(4); setCompletedAt(new Date().toISOString()); }
        finish();
      };
      next.onerror = () => { if (id !== request.current) return; setError('The browser worker could not complete the calculation. Retry with fewer qubits or samples.'); finish(); };
      timeout.current = setTimeout(() => { if (id !== request.current) return; setError('Calculation exceeded 90 seconds. Reduce qubits, samples or product-formula steps and retry.'); finish(); }, 90000);
      next.postMessage({ id, params: validateQuantumParams({...input,qubits:Math.max(2,input.qubits)}), hamiltonian });
    } catch (e) { worker.current?.terminate(); worker.current = null; if (timeout.current) clearTimeout(timeout.current); setBusy(false); setError(e instanceof Error ? e.message : 'Unable to start the browser solver.'); }
  }, []);

  useEffect(() => {
    let initial = defaultQuantumParams;
    try {
      const query = new URLSearchParams(window.location.search).get('quantum');
      const saved = query ?? localStorage.getItem('qbx-quantum-v1');
      if (saved) initial = validateQuantumParams({...JSON.parse(saved),qubits:Math.max(2,JSON.parse(saved).qubits)});
      const storedHamiltonian=!query&&localStorage.getItem('qbx-custom-hamiltonian-v1');
      if(storedHamiltonian){const h=parseHamiltonian(storedHamiltonian);customRef.current=h;setCustom(h);setHamiltonianText(JSON.stringify(h,null,2));initial={...initial,qubits:h.qubits};}
    } catch { /* Invalid saved settings fall back to visible defaults. */ }
    setParams(initial); setReady(true);
    setLocal(['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname));
    run(initial);
    return () => { ++request.current; worker.current?.terminate(); referenceAbort.current?.abort(); if (timeout.current) clearTimeout(timeout.current); };
  }, [run]);

  useEffect(() => { if (ready) try { localStorage.setItem('qbx-quantum-v1', JSON.stringify(params)); } catch { /* Private browsing can disallow storage. */ } }, [params, ready]);
  const update = (patch: Partial<QuantumParams>) => setParams(p => ({ ...p, ...patch }));
  const stale = !!result && (JSON.stringify(params) !== JSON.stringify(result.params)||JSON.stringify(custom)!==JSON.stringify(result.customHamiltonian??null));

  useEffect(()=>{if(userRan&&result&&!busy&&!stale)complete(['kick','evolve','sampling','transform']);},[userRan,result,busy,stale,complete]);
  const crossCheck = async () => {
    if (!local || !result || busy || result.customHamiltonian) return;
    setReferenceBusy(true); setReferenceError(''); setReference(null);
    const controller = new AbortController(); referenceAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch('http://127.0.0.1:8000/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result.params), signal: controller.signal });
      if (!response.ok) throw new Error(`Local reference returned HTTP ${response.status}.`);
      const value = await response.json() as QuantumResult;
      if (value.provenance !== 'exact-toy' || value.eigenvalues?.length !== result.eigenvalues.length || !Number.isFinite(value.validation?.expmError)) throw new Error('The local service response does not match the expected SciPy reference format.');
      if (!controller.signal.aborted) setReference(value);
    } catch (e) { if (referenceAbort.current === controller) setReferenceError(`SciPy cross-check unavailable. Start the optional local science service on port 8000. ${e instanceof Error ? e.message : ''}`); }
    finally { clearTimeout(timer); if (referenceAbort.current === controller) setReferenceBusy(false); }
  };

  const exportRun = () => {
    if (!result) return;
    download('quantum-battery-xas-run.json', JSON.stringify({
      schema: 'qbx-quantum-run-v1', modelVersion: result.customHamiltonian ? 'custom-pauli-v1' : 'effective-spin-v1', applicationVersion: '0.1.0', createdAt: completedAt,
      provenance: result.customHamiltonian ? 'user-supplied-model' : 'exact-toy', hardwareExecuted: false, units: { energy: 'toy eV', time: 'eV^-1', spectrum: 'toy dipole strength / eV', hbar: 1, fsPerInverseEV: 0.6582119569 },
      dipole: 'X0', qubitOrdering: 'q0 is the most significant bit', groundStateConvention: 'normalized first eigenvector of the lowest eigenvalue; no ground-space average',
      fourierConvention: 'positive exponential, one-sided real transform / pi, trapezoidal quadrature; window and lifetime damping recorded in params',
      calibration: { status: 'not-applicable-to-effective-model', mappedToMnKEdge: false },
      codeRevision: process.env.NEXT_PUBLIC_GIT_SHA || 'unrecorded; retain the source revision with this run',
      uncertainty: 'numerical residuals only; no chemical-model or hardware uncertainty estimate', result, scipyReference: reference,
    }, null, 2));
  };

  const maxEigenError = result && reference ? Math.max(...result.eigenvalues.map((v, i) => Math.abs(v - reference.eigenvalues[i]))) : null;
  const maxCorrelationError = result && reference ? Math.max(...result.correlationReal.map((v, i) => Math.hypot(v - reference.correlationReal[i], result.correlationImag[i] - reference.correlationImag[i]))) : null;
  const warnings = result?.caveats.filter(c => c.includes('WARNING') || c.startsWith('DEGENERATE')) ?? [];

  return <div className="quantum-lab">
    <p className="muted">A small Hamiltonian in eV. Its spectrum has no material or Mn-edge calibration.</p>
    <Panel title="From Hamiltonian to spectrum" eyebrow="Calculation steps">
      <div className="quantum-workflow toolbar" role="tablist" aria-label="Quantum algorithm stages">
        {stages.map((s, i) => <button key={s.title} className={`button ${stage === i ? '' : 'secondary'}`} onClick={() => setStage(i)} role="tab" aria-selected={stage === i} tabIndex={stage === i ? 0 : -1} id={'quantum-tab-'+i} aria-controls="quantum-stage" onKeyDown={event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const next=(i+(event.key==='ArrowRight'?1:stages.length-1))%stages.length;setStage(next);document.getElementById('quantum-tab-'+next)?.focus();}}}><span className="muted">0{i + 1}</span> {s.title}{i < stages.length - 1 && <ArrowRight size={14}/>}</button>)}
      </div>
      <AnimatePresence mode="wait"><motion.div className="quantum-stage" role="tabpanel" id="quantum-stage" aria-labelledby={'quantum-tab-'+stage} key={stage} initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: reducedMotion ? 1 : 0 }} transition={{ duration: 0.16 }}>
        <h3>{stages[stage].subtitle}</h3><p>{state.expert?stages[stage].text:[ 'The Hamiltonian describes how the spins interact. Its lowest-energy state is the starting point for this calculation.', 'Flip the first qubit to make an excited starting state. This is a simple stand-in for an excitation.', 'Calculate the motion exactly, then approximate it with short steps. Compare how the two answers differ.', 'Measure the overlap with the starting state as time passes. Its oscillations contain the excitation energies.', 'Convert the time signal into an energy spectrum. A longer observation time can resolve more closely spaced features.' ][stage]}</p>{state.expert&&<div className="equation"><Tex block>{stages[stage].equation}</Tex></div>}
        {state.expert && stage === 2 && <div className="toolbar"><button className="button secondary small" onClick={() => document.getElementById('quantum-correlations')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })}>Exact branch · inspect C(t)</button><button className="button secondary small" onClick={() => document.getElementById('quantum-circuit')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })}>Trotter branch · inspect circuit</button></div>}
      </motion.div></AnimatePresence>
    </Panel>

    <details className="disclosure hamiltonian-loader"><summary>Load your Hamiltonian</summary><div>
      <p>Use 1–6 qubits and up to 64 Pauli strings. Coefficients are real numbers in eV; <Tex plain>{'q_0'}</Tex> is the leftmost letter. The kick remains <Tex>{'D = X_0'}</Tex>.</p>
      <label className="field-label" htmlFor="hamiltonian-json">Pauli strings JSON<textarea id="hamiltonian-json" rows={8} value={hamiltonianText} aria-invalid={!!hamiltonianError} aria-describedby="hamiltonian-error" onChange={e=>{setHamiltonianText(e.target.value);setHamiltonianError('');}}/></label>
      <p id="hamiltonian-error" role={hamiltonianError?'alert':undefined} className="field-error">{hamiltonianError}</p>
      <div className="toolbar"><button className="button" disabled={busy} onClick={()=>{try{const h=parseHamiltonian(hamiltonianText);setUserRan(true);customRef.current=h;setCustom(h);setParams(p=>({...p,qubits:h.qubits}));setHamiltonianError('');setComparison(null);localStorage.setItem('qbx-custom-hamiltonian-v1',JSON.stringify(h));run({...params,qubits:h.qubits},h);}catch(e){setHamiltonianError(e instanceof Error?e.message:'Check the Hamiltonian.');}}}>Load and run Hamiltonian</button>
      <button className="button secondary" onClick={()=>setHamiltonianText(JSON.stringify(HAMILTONIAN_EXAMPLE,null,2))}>Use example JSON</button>
      <label className="file-control">Import Hamiltonian JSON<input type="file" accept=".json,application/json" aria-label="Import Hamiltonian JSON" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{if(file.size>16000)throw new Error('Hamiltonian JSON must be at most 16 kB.');const text=await file.text();parseHamiltonian(text);setHamiltonianText(text);setHamiltonianError('');}catch(e){setHamiltonianError(e instanceof Error?e.message:'Check the file.');}}}/></label></div>
      {custom&&<p role="status">Loaded: {custom.name}, {custom.qubits} qubits, {custom.terms.length} Pauli terms.</p>}
    </div></details>

    <Panel title="Kick, evolve, transform" className="primary-controls">
      <Range label="Trotter steps" value={params.trotterSteps} min={1} max={128} onChange={trotterSteps=>update({trotterSteps})}/>
      <div className="toolbar"><button className="button" disabled={busy} onClick={()=>{setUserRan(true);setStage(2);run(params);}}>{busy?'Computing…':'Run simulation'}</button>{busy&&<button className="button secondary" onClick={()=>{++request.current;worker.current?.terminate();if(timeout.current)clearTimeout(timeout.current);setBusy(false);}}>Cancel</button>}</div>
      <p role="status">{stale?'Settings changed. Run again.':busy?'Following the time signal…':result?'Spectrum ready. Compare it with the exact calculation.':'Preparing the solver…'}</p>
      {error&&<p role="alert">{error}</p>}
      {result&&<><Plot exportName="quantum-spectrum" xLabel="Excitation energy (eV)" yLabel="Strength / eV" yTex={'\\text{Strength}/\\mathrm{eV}'} series={[{name:'Exact spectrum',color:'#c4ccd6',x:result.spectralEnergy,y:result.spectrumFourierClipped},{name:'Trotter spectrum',color:'#ffc46b',x:result.spectralEnergy,y:result.spectrumTrotterClipped,dashed:true}]}/><Metric label="Spectrum error vs exact" value={percent(result.validation.spectralL1TrotterVsExact)}/></>}
    </Panel>
    <TryThis steps={['kick','evolve','sampling','transform']} action={result&&<button className="button secondary small" disabled={busy||stale} onClick={()=>setComparison(result)}>Keep run as reference</button>} done={!!comparison&&!!result&&!stale&&result!==comparison} research={<>{custom?'H uses your Pauli terms.':'H is a small spin model.'} <Tex>{'D = X_0'}</Tex>. Energies are referenced to <Tex>{'E_g'}</Tex>; no Mn K-edge calibration is applied.{comparison&&result&&result!==comparison&&!stale&&<> Spectral <Tex plain>{'L^1'}</Tex>: {percent(comparison.validation.spectralL1TrotterVsExact)} → {percent(result.validation.spectralL1TrotterVsExact)}.</>}</>}>{comparison&&result&&!stale&&result!==comparison?<>Spectrum error vs exact changed from {percent(comparison.validation.spectralL1TrotterVsExact)} to {percent(result.validation.spectralL1TrotterVsExact)}. Compare fidelity too: one can improve while the other doesn't.</>:<>{comparison?'Reference kept. Change Trotter steps and run again to compare the spectral error.':'Keep the current run as a reference, change Trotter steps, and run again to compare the spectral error.'}</>}</TryThis>
    <details className="research-drawer" open={state.expert}><summary>Research settings and results</summary><div className="drawer-body">
    <div className="two-col">
      <Panel title="Define the experiment" eyebrow="Hamiltonian settings" className="control-panel">
        {!custom&&<><Range label="Number of qubits" value={params.qubits} min={2} max={6} onChange={qubits => update({ qubits })} hint={<>Hilbert space: {2 ** params.qubits} basis states. Dense memory grows as <Tex>{'4^n'}</Tex>.</>}/>
        <Range label="Longitudinal field h" display={<>Longitudinal field <Tex plain>{'h'}</Tex></>} value={params.field} min={0} max={2} step={0.05} digits={2} unit="eV" onChange={field => update({ field })}/>
        <Range label="Nearest-neighbor coupling J" display={<>Nearest-neighbor coupling <Tex plain>{'J'}</Tex></>} value={params.coupling} min={-1} max={1} step={0.05} digits={2} unit="eV" onChange={coupling => update({ coupling })}/></>}
        <Range label="Observation time T" display={<>Observation time <Tex plain>{'T'}</Tex></>} value={params.timeMax} min={5} max={120} step={5} unit="eV⁻¹" onChange={timeMax => update({ timeMax })} hint={<><Tex>{'\\hbar = 1'}</Tex>; <Tex>{`${params.timeMax}\\ \\text{eV}^{-1} = ${(params.timeMax * 0.6582119569).toFixed(2)}\\ \\text{fs}`}</Tex>. Nominal resolution <Tex>{`2\\pi/T = ${(2 * Math.PI / params.timeMax).toFixed(3)}\\ \\text{eV}`}</Tex>.</>}/>
        <Range label="Lifetime broadening η" display={<>Lifetime broadening <Tex plain>{'\\eta'}</Tex></>} value={params.broadening} min={0.02} max={1} step={0.02} digits={2} unit="eV HWHM" onChange={broadening => update({ broadening })}/>
        <div className="toolbar">
          <label>Time samples <select aria-label="Time samples" value={params.samples} onChange={e => update({ samples: +e.target.value })}>{[64, 128, 256, 512].map(n => <option key={n}>{n}</option>)}</select></label>
          <label>Zero padding <select aria-label="Zero padding" value={params.padding} onChange={e => update({ padding: +e.target.value })}>{[1, 2, 4, 8].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
          <label>Time taper <select aria-label="Time taper" value={params.window} onChange={e => update({ window: e.target.value as QuantumParams['window'] })}><option value="cosine">Cosine</option><option value="none">None</option></select></label>
        </div><button className="button secondary" onClick={() => { customRef.current=null;setCustom(null);localStorage.removeItem('qbx-custom-hamiltonian-v1');setParams(defaultQuantumParams); run(defaultQuantumParams,null); }}>Reset model</button>
        <p role="status" aria-live="polite" className="muted">{busy ? 'Solving in a background worker. Controls remain responsive.' : stale ? 'Settings changed. Run again.' : result ? `Completed ${result.params.qubits}-qubit calculation. All plots use this same run.` : 'Preparing browser solver…'}</p>
        {error && <p className="callout" role="alert">{error}</p>}
      </Panel>

      <Panel title="Results" eyebrow="Completed run" aside={result && <button className="button secondary small" onClick={exportRun}><Download size={14}/>Full run JSON</button>}>
        {result ? <>
          <div className="metric-grid"><Metric label="Ground energy" value={result.groundEnergy.toFixed(5)} unit="eV"/><Metric label="Final state fidelity" value={percent(result.finalFidelity)} tone="violet"/><Metric label="Spectrum error vs exact" value={percent(result.validation.spectralL1TrotterVsExact)}/><Metric label="Circuit depth" value={result.customHamiltonian?'Not compiled':result.resources.depth}/></div>
          <p className="muted">Run: {result.params.qubits} qubits · <Tex>{`J = ${result.params.coupling.toFixed(2)}\\ \\text{eV}`}</Tex> · <Tex>{`h = ${result.params.field.toFixed(2)}\\ \\text{eV}`}</Tex> · {result.params.trotterSteps} steps · <Tex>{`T = ${result.params.timeMax}\\ \\text{eV}^{-1}`}</Tex>. {stale && <strong>Controls have changed since this run.</strong>}</p>
          <div className="equation"><Tex>{hamiltonianTex(result.terms)}</Tex></div>
          <p>{result.customHamiltonian?'Terms loaded from your JSON.':'Fixed transverse field = 0.17 eV.'} <Tex>{'D = X_0'}</Tex>. Ground gap: <Num>{sci(result.validation.groundGap)}</Num> <Unit>eV</Unit>; ground-space dimension within <Tex plain>{'10^{-9}\\ \\mathrm{eV}'}</Tex>: {result.validation.groundDegeneracy}.</p>
          <p className="muted">The JSON export includes parameters, Pauli ordering, ground state, units, all numerical arrays, signed and clipped spectra, gates, diagnostics, caveats and optional SciPy output.</p>
          {warnings.map(w => <p key={w} role="alert" className="callout">{caveatNode(w)}</p>)}
          <Disclosure title="Inspect ground state in the computational basis"><div className="table-wrap"><table><thead><tr><th>Basis <Tex>{'|q_0 \\ldots q_n\\rangle'}</Tex></th><th>Real amplitude</th><th>Imaginary amplitude</th><th>Probability</th></tr></thead><tbody>{result.groundState.map((v, i) => <tr key={i}><td><Tex>{`|${i.toString(2).padStart(result.params.qubits, '0')}\\rangle`}</Tex></td><td><Num>{v.re.toFixed(7)}</Num></td><td><Num>{v.im.toFixed(7)}</Num></td><td>{(v.re ** 2 + v.im ** 2).toFixed(7)}</td></tr>)}</tbody></table></div></Disclosure>
        </> : <div className="callout"><Cpu size={24}/><p>The browser is diagonalizing the model and checking its time evolution. Results appear when the run finishes.</p></div>}
      </Panel>
    </div>

    {result && <>
      <div className="two-col" id="quantum-correlations">
        <Panel title="The time-domain signal" eyebrow="Complex dipole correlation"><Plot exportName="quantum-correlations" xLabel="Time (eV⁻¹; ℏ = 1)" yLabel="C(t), toy dipole strength" yTex={'C(t)\\text{, toy dipole strength}'} series={[
          { name: 'Exact Re C', color: '#c4ccd6', x: result.times, y: result.correlationReal }, { name: 'Exact Im C', color: '#70dfac', x: result.times, y: result.correlationImag },
          { name: 'Trotter Re C', color: '#f4c777', x: result.times, y: result.trotterReal, dashed: true }, { name: 'Trotter Im C', color: '#ff686b', x: result.times, y: result.trotterImag, dashed: true },
        ]}/></Panel>
        <Panel title="Exact and Trotter fidelity" eyebrow="State fidelity"><Plot exportName="quantum-fidelity" xLabel="Time (eV⁻¹; ℏ = 1)" yLabel="|〈ψ exact(t)|ψ Trotter(t)〉|²" yTex={'|\\langle\\psi_{\\text{exact}}(t)|\\psi_{\\text{Trotter}}(t)\\rangle|^2'} minY={0} series={[{ name: 'Fidelity on D|g〉', color: '#70dfac', x: result.times, y: result.fidelity }]}/><p className="muted">This is the fidelity of one input state, <Tex>{'D|g\\rangle'}</Tex>, which differs from average gate fidelity. Pointwise errors can oscillate in time, so when you add steps, check the spectral error as well.</p></Panel>
      </div>
      <Panel title="Excitation spectrum" eyebrow="Fourier and eigenstate comparison" aside={<label><input type="checkbox" checked={signed} onChange={e => setSigned(e.target.checked)}/> Show signed Fourier diagnostic</label>}>
        <Plot exportName="quantum-excitation-spectrum" xLabel="Effective excitation energy (eV; not Mn K-edge energy)" yLabel={signed ? 'Signed S(ω), toy strength/eV' : 'Absorption-like S(ω), toy strength/eV'} yTex={signed ? '\\text{Signed }S(\\omega)\\text{, toy strength}/\\mathrm{eV}' : '\\text{Absorption-like }S(\\omega)\\text{, toy strength}/\\mathrm{eV}'} series={[
          { name: 'Eigenstate Lorentzians', color: '#70dfac', x: result.spectralEnergy, y: result.spectrumReference },
          { name: signed ? 'Exact Fourier · signed' : 'Exact Fourier · clipped', color: '#c4ccd6', x: result.spectralEnergy, y: signed ? result.spectrumFourierSigned : result.spectrumFourierClipped },
          { name: signed ? 'Trotter Fourier · signed' : 'Trotter Fourier · clipped', color: '#f4c777', x: result.spectralEnergy, y: signed ? result.spectrumTrotterSigned : result.spectrumTrotterClipped, dashed: true },
        ]}/>
        <div className="metric-grid"><Metric label={<>Nominal <Tex plain>{'2\\pi/T'}</Tex> resolution</>} value={result.validation.resolution.toFixed(4)} unit="eV"/><Metric label="Padded grid spacing" value={result.validation.paddedGridSpacing.toFixed(4)} unit="eV"/><Metric label="Nyquist energy" value={result.validation.nyquist.toFixed(3)} unit="eV"/><Metric label={<>Fourier / Lorentzian <Tex plain>{'L^1'}</Tex></>} value={percent(result.validation.spectralL1FourierVsReference)}/></div>
        <p className="muted">Zero padding makes the energy grid denser but does not improve physical resolution. <Tex>{`\\eta = ${result.params.broadening.toFixed(2)}\\ \\text{eV}`}</Tex> is HWHM; {result.params.window==='none'?'the finite observation time adds':'the cosine time taper and finite observation time add'} broadening. The reference has only Lorentzian lifetime broadening, so expect some mismatch from the finite window. <Tex plain>{'L^1'}</Tex> errors integrate signed-array absolute differences over the returned nonnegative energy grid.</p>
        <div className="table-wrap"><table><caption>Clipping audit: raw signed arrays remain in the JSON export</caption><thead><tr><th>Trace</th><th>Minimum signed value</th><th>Negative bins (<Tex>{'< -10^{-12}'}</Tex>)</th><th>Area removed</th></tr></thead><tbody><tr><td>Exact Fourier</td><td><Num>{sci(result.validation.fftMinimum)}</Num></td><td>{result.validation.negativeBins}</td><td><Num>{sci(result.validation.clippedArea)}</Num></td></tr><tr><td>Trotter Fourier</td><td><Num>{sci(result.validation.trotterFftMinimum)}</Num></td><td>{result.validation.trotterNegativeBins}</td><td><Num>{sci(result.validation.trotterClippedArea)}</Num></td></tr></tbody></table></div>
        <Disclosure title="Transition energies and dipole weights"><p>Weights below <Tex plain>{'10^{-12}'}</Tex> are omitted from this table. Elastic zero-gap weight is retained in all curves; it is not a core absorption line.</p><div className="table-wrap"><table><thead><tr><th><Tex>{'E_n - E_g'}</Tex> (eV)</th><th><Tex>{'|\\langle n|D|g\\rangle|^2'}</Tex></th><th>Contribution</th></tr></thead><tbody>{result.transitions.map((t, i) => <tr key={i}><td>{t.energy.toFixed(6)}</td><td><Num>{t.weight.toExponential(5)}</Num></td><td>{t.kind === 'elastic' ? 'Elastic · not absorption' : 'Inelastic toy transition'}</td></tr>)}</tbody></table></div></Disclosure>
      </Panel>

      <div id="quantum-circuit"><Panel title="Inspect the product-formula circuit" eyebrow="Gate decomposition">
        <div className="metric-grid"><Metric label="Gates per step" value={result.customHamiltonian?'Not compiled':result.resources.gatesPerStep}/><Metric label="Total serial depth" value={result.resources.depth}/><Metric label="Total CX gates" value={result.customHamiltonian?'Not compiled':result.resources.entanglingGates}/><Metric label="Product-formula order" value="1"/></div>{result.customHamiltonian?<p>Custom Pauli evolution is calculated directly. Circuit synthesis and hardware cost are not estimated.</p>:<Circuit result={result}/>}
      </Panel></div>
      <div className="two-col">
        <Panel title="Numerical validation" eyebrow="Residuals" aside={<CheckCircle2 size={20}/>}>
          <div className="table-wrap"><table><thead><tr><th>Check</th><th>Max error / residual</th></tr></thead><tbody>{([
            ['herm', <>Hermiticity, <Tex>{'\\max|H - H^\\dagger|'}</Tex></>, result.validation.hermiticityError], ['unit', <>Exact propagator, <Tex>{'\\max|U^\\dagger U - I|'}</Tex></>, result.validation.unitarityError], ['norm', 'Exact / Trotter state norm', result.validation.normError], ['ground', 'Ground-state residual', result.validation.groundResidual], ['c0', <Tex>{'C(0) - \\langle g|D^\\dagger D|g\\rangle'}</Tex>, result.validation.correlationAtZeroError], ['sum', <>Sum of transition weights, <Tex>{'\\sum_n w_n - 1'}</Tex></>, result.validation.transitionWeightError], ['rmse', 'Fourier / reference RMSE', result.validation.spectralRmseFourierVsReference],
          ] as [string, React.ReactNode, number][]).map(([key, label, value]) => <tr key={key}><td>{label}</td><td><Num>{sci(value)}</Num></td></tr>)}</tbody></table></div>
          <p className="muted">These residuals check the chosen model and implementation. They do not validate the model against a material or experiment.</p>
        </Panel>
        <Panel title="Independent SciPy reference" eyebrow="Optional local calculation" aside={<FlaskConical size={20}/>}>
          <p>The GitHub Pages site runs every calculation in the browser. When you run the app locally, an optional Python service can recompute the same run with SciPy <code>eigh</code> and <code>expm</code> as an independent check.</p>
          {local ? <button className="button secondary" disabled={busy || referenceBusy || !!result.customHamiltonian} onClick={crossCheck}>{referenceBusy ? 'Cross-checking…' : 'Run local SciPy cross-check'}</button> : <p className="callout">Available only when running the app on localhost. Follow the README to start the optional science service. This hosted page does not contact a Python server.</p>}
          {referenceError && <p role="alert" className="callout">{referenceError}</p>}
          {reference && maxEigenError !== null && maxCorrelationError !== null && <><div className="metric-grid"><Metric label="Eigenvalue max difference" value={sci(maxEigenError)} unit="eV"/><Metric label={<>Complex <Tex plain>{'C(t)'}</Tex> max difference</>} value={sci(maxCorrelationError)}/><Metric label="SciPy expm cross-check" value={sci(reference.validation.expmError!)}/></div><p className="muted">SciPy reference finished. Ground eigenvector signs can differ, and with a degenerate ground space the two solvers may pick different states. The full reference is included when you export this run.</p></>}
        </Panel>
      </div>
      <Panel title="Related research" eyebrow="Background">
        <p>The dipole → time evolution → correlation → spectrum connection is motivated by <a href="https://arxiv.org/abs/2405.11015" target="_blank" rel="noreferrer">Fomichev et al. (2024)</a>. The spectral error, time truncation and broadening controls relate to questions studied in <a href="https://arxiv.org/abs/2506.15784" target="_blank" rel="noreferrer">Fomichev et al. (2025)</a>. This lab does not implement their chemical active spaces, specialized factorizations or fault-tolerant resource estimates.</p>
        <Disclosure title="Complete conventions and limitations"><ul>{result.caveats.map(c => <li key={c}>{caveatNode(c)}</li>)}</ul></Disclosure>
      </Panel>
    </>}
    </div></details>
  </div>;
}
