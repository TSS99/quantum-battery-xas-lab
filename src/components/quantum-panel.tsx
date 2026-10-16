'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, CheckCircle2, Cpu, Download, FlaskConical, Play, RotateCcw, Square } from 'lucide-react';
import { defaultQuantumParams, validateQuantumParams, type QuantumParams, type QuantumResult } from '@/lib/quantum';
import { Badge, Disclosure, Metric, Panel, Range, download } from './ui';
import { Plot } from './plot';

const stages = [
  { title: 'Choose H', subtitle: 'Hamiltonian → ground state', text: 'Choose a small effective spin model. The browser diagonalizes its Hermitian matrix and selects the normalized lowest-energy eigenvector |g〉. These Pauli terms are explicitly defined; they are not Mn–O electronic integrals.', equation: 'H = Σᵢ h(1 + 0.13i) Zᵢ + J Σᵢ XᵢXᵢ₊₁ + 0.17 Σᵢ Xᵢ' },
  { title: 'Excite', subtitle: 'Dipole-inspired state', text: 'Apply D = X₀ to |g〉. X₀ flips the most significant qubit and happens to preserve the norm. A physical dipole operator generally does not; realistic core excitation and its state preparation require additional work.', equation: '|v〉 = D|g〉; D = X₀; 〈v|v〉 = 1 for this toy choice' },
  { title: 'Evolve', subtitle: 'Exact ↔ product formula', text: 'Follow two branches: exact propagation in the eigenbasis, or a first-order chronological product of Pauli exponentials. Both use the same initial state and ground-energy reference. At each plotted t, the chosen number of steps spans [0, t].', equation: 'U(t) = exp[−i(H − E_g I)t]; Uₙ(t) = eⁱᴱᵍᵗ [∏chronological exp(−icₖPₖt/n)]ⁿ' },
  { title: 'Correlate', subtitle: 'Return amplitude', text: 'Overlap the time-evolved state with the dipole-excited initial state. The complex correlation encodes excitation gaps and their weights. Its value at t = 0 obeys the sum rule. Inspect both real and imaginary parts below.', equation: 'C(t) = 〈g|D† exp[−i(H − E_g I)t]D|g〉 = Σₙ wₙ e⁻ⁱ⁽ᴱⁿ⁻ᴱᵍ⁾ᵗ' },
  { title: 'Reconstruct', subtitle: 'Time → excitation energy', text: 'A positive-sign Fourier transform with lifetime damping and a stated taper reconstructs an absorption-like spectrum. Compare with positive eigenstate Lorentzians. The zero-energy elastic contribution is retained and separately identified; it is not a core absorption excitation.', equation: 'S(ω) = Re ∫₀ᵀ C(t)eⁱωᵗ e⁻ηᵗ w(t)dt / π; η = Lorentzian HWHM' },
];

const sci = (value: number) => Math.abs(value) < 0.001 ? value.toExponential(2) : value.toFixed(4);
const percent = (value: number) => `${(100 * value).toFixed(2)}%`;

function Circuit({ result }: { result: QuantumResult }) {
  const [selected, setSelected] = useState(0);
  const gate = result.circuit[Math.min(selected, result.circuit.length - 1)];
  const width = 100 + result.circuit.length * 70, height = 36 + result.params.qubits * 54;
  return <>
    <p className="muted">One chronological step at final time T, repeated {result.params.trotterSteps} times. q₀ is the leftmost bit of the state vector.</p>
    <div className="quantum-circuit" style={{ overflowX: 'auto' }}>
      <svg role="img" aria-label={`Product formula circuit with ${result.params.qubits} qubits and ${result.circuit.length} gates per step`} width={width} height={height} style={{ display: 'block', minWidth: width }}>
        <title>One Trotter step, ordered left to right</title>
        {Array.from({ length: result.params.qubits }, (_, q) => <g key={q}>
          <text x="12" y={45 + 54 * q} fill="#b9bfd0" fontSize="13" fontFamily="monospace">q{q}</text>
          <line x1="48" x2={width - 18} y1={40 + 54 * q} y2={40 + 54 * q} stroke="#404858" />
        </g>)}
        {result.circuit.map((g, i) => {
          const x = 80 + 70 * i, color = i === selected ? '#f4c777' : '#a28aff';
          return <g key={i}>
            {g.gate === 'CX' ? <>
              <line x1={x} x2={x} y1={40 + 54 * g.qubits[0]} y2={40 + 54 * g.qubits[1]} stroke={color} strokeWidth="2" />
              <circle cx={x} cy={40 + 54 * g.qubits[0]} r="5" fill={color} />
              <circle cx={x} cy={40 + 54 * g.qubits[1]} r="12" fill="#151b29" stroke={color} strokeWidth="2" />
              <path d={`M${x - 8},${40 + 54 * g.qubits[1]}h16 M${x},${32 + 54 * g.qubits[1]}v16`} stroke={color} />
            </> : <>
              <rect x={x - 24} y={22 + 54 * g.qubits[0]} width="48" height="36" rx="7" fill="#211d38" stroke={color} />
              <text x={x} y={45 + 54 * g.qubits[0]} textAnchor="middle" fill={color} fontSize="13" fontFamily="monospace">{g.gate}</text>
            </>}
            <text x={x} y={height - 5} textAnchor="middle" fill="#8c97ad" fontSize="10">{i + 1}</text>
          </g>;
        })}
      </svg>
    </div>
    <div className="toolbar">
      <label>Inspect gate <select aria-label="Inspect circuit gate" value={Math.min(selected, result.circuit.length - 1)} onChange={e => setSelected(+e.target.value)}>
        {result.circuit.map((g, i) => <option key={i} value={i}>{i + 1}. {g.gate} on q{g.qubits.join(', q')}</option>)}
      </select></label>
      <span className="muted">Term {result.terms[gate.termIndex].label}; {gate.angle === undefined ? `control q${gate.qubits[0]}, target q${gate.qubits[1]}` : `angle ${gate.angle.toFixed(5)} rad = 2cT/n`}</span>
    </div>
    <p className="muted">XX synthesis: CX(control, target) → Rx(control) → CX(control, target). The global eⁱᴱᵍᵗ phase is applied numerically. Ground-state preparation, excitation, measurement, hardware routing and error correction are excluded from these resource counts.</p>
  </>;
}

export function QuantumPanel() {
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

  const run = useCallback((input: QuantumParams) => {
    worker.current?.terminate();
    if (timeout.current) clearTimeout(timeout.current);
    referenceAbort.current?.abort();
    referenceAbort.current = null;
    setReferenceBusy(false); setReference(null); setReferenceError('');
    setBusy(true); setError('');
    const id = ++request.current;
    try {
      const next = new Worker(new URL('../workers/quantum.worker.ts', import.meta.url));
      worker.current = next;
      const finish = () => { if (timeout.current) clearTimeout(timeout.current); next.terminate(); if (worker.current === next) worker.current = null; setBusy(false); };
      next.onmessage = event => {
        if (event.data.id !== request.current) return;
        if (event.data.error) setError(event.data.error);
        else { setResult(event.data.result); setCompletedAt(new Date().toISOString()); }
        finish();
      };
      next.onerror = () => { if (id !== request.current) return; setError('The browser worker could not complete the calculation. Retry with fewer qubits or samples.'); finish(); };
      timeout.current = setTimeout(() => { if (id !== request.current) return; setError('Calculation exceeded 90 seconds. Reduce qubits, samples or product-formula steps and retry.'); finish(); }, 90000);
      next.postMessage({ id, params: validateQuantumParams(input) });
    } catch (e) { worker.current?.terminate(); worker.current = null; if (timeout.current) clearTimeout(timeout.current); setBusy(false); setError(e instanceof Error ? e.message : 'Unable to start the browser solver.'); }
  }, []);

  useEffect(() => {
    let initial = defaultQuantumParams;
    try {
      const query = new URLSearchParams(window.location.search).get('quantum');
      const saved = query ?? localStorage.getItem('qbx-quantum-v1');
      if (saved) initial = validateQuantumParams(JSON.parse(saved));
    } catch { /* Invalid saved settings fall back to visible defaults. */ }
    setParams(initial); setReady(true);
    setLocal(['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname));
    run(initial);
    return () => { ++request.current; worker.current?.terminate(); referenceAbort.current?.abort(); if (timeout.current) clearTimeout(timeout.current); };
  }, [run]);

  useEffect(() => { if (ready) try { localStorage.setItem('qbx-quantum-v1', JSON.stringify(params)); } catch { /* Private browsing can disallow storage. */ } }, [params, ready]);
  const update = (patch: Partial<QuantumParams>) => setParams(p => ({ ...p, ...patch }));
  const stale = !!result && JSON.stringify(params) !== JSON.stringify(result.params);

  const crossCheck = async () => {
    if (!local || !result || busy) return;
    setReferenceBusy(true); setReferenceError(''); setReference(null);
    const controller = new AbortController(); referenceAbort.current = controller;
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch('http://127.0.0.1:8000/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result.params), signal: controller.signal });
      if (!response.ok) throw new Error(`Local reference returned HTTP ${response.status}.`);
      const value = await response.json() as QuantumResult;
      if (value.provenance !== 'exact-toy' || value.eigenvalues?.length !== result.eigenvalues.length || !Number.isFinite(value.validation?.expmError)) throw new Error('The local service did not return the expected SciPy reference contract.');
      if (!controller.signal.aborted) setReference(value);
    } catch (e) { if (referenceAbort.current === controller) setReferenceError(`SciPy cross-check unavailable. Start the optional local science service on port 8000. ${e instanceof Error ? e.message : ''}`); }
    finally { clearTimeout(timer); if (referenceAbort.current === controller) setReferenceBusy(false); }
  };

  const exportRun = () => {
    if (!result) return;
    download('quantum-battery-xas-run.json', JSON.stringify({
      schema: 'qbx-quantum-run-v1', modelVersion: 'effective-spin-v1', applicationVersion: '0.1.0', createdAt: completedAt,
      provenance: 'exact-toy', hardwareExecuted: false, units: { energy: 'toy eV', time: 'eV^-1', spectrum: 'toy dipole strength / eV', hbar: 1, fsPerInverseEV: 0.6582119569 },
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
    <div className="module-toolbar toolbar"><Badge>Exact toy model</Badge><Badge tone="green">Browser computation</Badge><span className="muted">2–6 qubits · no account or server required</span></div>
    <p className="callout"><strong>This is an effective quantum model, not calculated Mn K-edge XAS.</strong> The synthetic beamline and this Hamiltonian are separate teaching models. All results are classical numerical simulations; no quantum hardware or advantage is claimed.</p>

    <Panel title="From Hamiltonian to spectrum" eyebrow="THE QUANTUM XAS WORKFLOW">
      <div className="quantum-workflow toolbar" role="group" aria-label="Quantum algorithm stages">
        {stages.map((s, i) => <button key={s.title} className={`button ${stage === i ? '' : 'secondary'}`} onClick={() => setStage(i)} aria-pressed={stage === i}><span className="muted">0{i + 1}</span> {s.title}{i < stages.length - 1 && <ArrowRight size={14}/>}</button>)}
      </div>
      <AnimatePresence mode="wait"><motion.div className="quantum-stage callout" key={stage} initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: reducedMotion ? 1 : 0 }} transition={{ duration: 0.16 }}>
        <h3>{stages[stage].subtitle}</h3><p>{stages[stage].text}</p><p className="equation">{stages[stage].equation}</p>
        {stage === 2 && <div className="toolbar"><button className="button secondary small" onClick={() => document.getElementById('quantum-correlations')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })}>Exact branch · inspect C(t)</button><button className="button secondary small" onClick={() => document.getElementById('quantum-circuit')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })}>Trotter branch · inspect circuit</button></div>}
      </motion.div></AnimatePresence>
    </Panel>

    <div className="two-col">
      <Panel title="Define the experiment" eyebrow="EFFECTIVE HAMILTONIAN" className="control-panel">
        <Range label="Number of qubits" value={params.qubits} min={2} max={6} onChange={qubits => update({ qubits })} hint={`Hilbert space: ${2 ** params.qubits} basis states. Dense memory grows as 4ⁿ.`}/>
        <Range label="Longitudinal field h" value={params.field} min={0} max={2} step={0.05} digits={2} unit="eV" onChange={field => update({ field })}/>
        <Range label="Nearest-neighbor coupling J" value={params.coupling} min={-1} max={1} step={0.05} digits={2} unit="eV" onChange={coupling => update({ coupling })}/>
        <Range label="Observation time T" value={params.timeMax} min={5} max={120} step={5} unit="eV⁻¹" onChange={timeMax => update({ timeMax })} hint={`ℏ = 1; ${params.timeMax} eV⁻¹ = ${(params.timeMax * 0.6582119569).toFixed(2)} fs. Nominal resolution 2π/T = ${(2 * Math.PI / params.timeMax).toFixed(3)} eV.`}/>
        <Range label="Trotter steps" value={params.trotterSteps} min={1} max={128} onChange={trotterSteps => update({ trotterSteps })}/>
        <Range label="Lifetime broadening η" value={params.broadening} min={0.02} max={1} step={0.02} digits={2} unit="eV HWHM" onChange={broadening => update({ broadening })}/>
        <div className="toolbar">
          <label>Time samples <select aria-label="Time samples" value={params.samples} onChange={e => update({ samples: +e.target.value })}>{[64, 128, 256, 512].map(n => <option key={n}>{n}</option>)}</select></label>
          <label>Zero padding <select aria-label="Zero padding" value={params.padding} onChange={e => update({ padding: +e.target.value })}>{[1, 2, 4, 8].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
          <label>Time taper <select aria-label="Time taper" value={params.window} onChange={e => update({ window: e.target.value as QuantumParams['window'] })}><option value="cosine">Cosine</option><option value="none">None</option></select></label>
        </div>
        <div className="quantum-actions toolbar">
          <button className="button" disabled={busy} onClick={() => run(params)}><Play size={15}/>{busy ? 'Computing…' : 'Run simulation'}</button>
          {busy && <button className="button secondary" onClick={() => { ++request.current; worker.current?.terminate(); worker.current = null; if (timeout.current) clearTimeout(timeout.current); setBusy(false); setError('Calculation cancelled. The last completed result is retained.'); }}><Square size={14}/>Cancel</button>}
          <button className="button secondary" onClick={() => { setParams(defaultQuantumParams); run(defaultQuantumParams); }}><RotateCcw size={15}/>Reset</button>
        </div>
        <p role="status" aria-live="polite" className="muted">{busy ? 'Solving in a background worker. Controls remain responsive.' : stale ? 'Parameters changed. Displayed results still belong to the last completed run; run again to update.' : result ? `Completed ${result.params.qubits}-qubit calculation. All plots use this same run.` : 'Preparing browser solver…'}</p>
        {error && <p className="callout" role="alert">{error}</p>}
      </Panel>

      <Panel title="Numerical run record" eyebrow="REPRODUCIBLE BY DESIGN" aside={result && <button className="button secondary small" onClick={exportRun}><Download size={14}/>Full run JSON</button>}>
        {result ? <>
          <div className="metric-grid"><Metric label="Ground energy" value={result.groundEnergy.toFixed(5)} unit="eV"/><Metric label="Final state fidelity" value={percent(result.finalFidelity)} tone="violet"/><Metric label="Trotter spectral L¹ error" value={percent(result.validation.spectralL1TrotterVsExact)}/><Metric label="Serial circuit depth" value={result.resources.depth}/></div>
          <p className="muted">Run: {result.params.qubits} qubits · J = {result.params.coupling.toFixed(2)} eV · h = {result.params.field.toFixed(2)} eV · {result.params.trotterSteps} steps · T = {result.params.timeMax} eV⁻¹. {stale && <strong>Pending controls differ.</strong>}</p>
          <div className="equation">H = {result.terms.map((term, i) => <span key={i}>{i ? ' + ' : ''}({term.coefficient.toFixed(3)}) {term.label}</span>)}</div>
          <p>Fixed transverse field = 0.17 eV. D = X₀. Ground gap = {sci(result.validation.groundGap)} eV; ground-space dimension within 10⁻⁹ eV = {result.validation.groundDegeneracy}.</p>
          <p className="muted">Export records parameters, Pauli ordering, ground state, units, all numerical arrays, signed and clipped spectra, gates, diagnostics, caveats and optional SciPy output. Numerical residuals do not quantify uncertainty in a chemical model.</p>
          {warnings.map(w => <p key={w} role="alert" className="callout">{w}</p>)}
          <Disclosure title="Inspect ground state in the computational basis"><div className="table-wrap"><table><thead><tr><th>Basis |q₀…qₙ〉</th><th>Real amplitude</th><th>Probability</th></tr></thead><tbody>{result.groundState.map((v, i) => <tr key={i}><td>|{i.toString(2).padStart(result.params.qubits, '0')}〉</td><td>{v.re.toFixed(7)}</td><td>{(v.re ** 2 + v.im ** 2).toFixed(7)}</td></tr>)}</tbody></table></div></Disclosure>
        </> : <div className="callout"><Cpu size={24}/><p>The browser is diagonalizing the model and checking its evolution. Numerical results appear after a completed calculation.</p></div>}
      </Panel>
    </div>

    {result && <>
      <div className="two-col" id="quantum-correlations">
        <Panel title="The time-domain signal" eyebrow="COMPLEX DIPOLE CORRELATION"><Plot exportName="quantum-correlations" xLabel="Time (eV⁻¹; ℏ = 1)" yLabel="C(t), toy dipole strength" series={[
          { name: 'Exact Re C', color: '#a28aff', x: result.times, y: result.correlationReal }, { name: 'Exact Im C', color: '#70dfac', x: result.times, y: result.correlationImag },
          { name: 'Trotter Re C', color: '#f4c777', x: result.times, y: result.trotterReal, dashed: true }, { name: 'Trotter Im C', color: '#ff686b', x: result.times, y: result.trotterImag, dashed: true },
        ]}/></Panel>
        <Panel title="Approximation under a microscope" eyebrow="STATE FIDELITY"><Plot exportName="quantum-fidelity" xLabel="Time (eV⁻¹; ℏ = 1)" yLabel="|〈ψ exact(t)|ψ Trotter(t)〉|²" minY={0} series={[{ name: 'Fidelity on D|g〉', color: '#70dfac', x: result.times, y: result.fidelity }]}/><p className="muted">Fidelity measures this input state, not average gate fidelity. Pointwise errors can oscillate. Increase steps and compare the spectral output error as well.</p></Panel>
      </div>
      <Panel title="Excitation spectrum" eyebrow="FOURIER RECONSTRUCTION ↔ EIGENSTATE REFERENCE" aside={<label><input type="checkbox" checked={signed} onChange={e => setSigned(e.target.checked)}/> Show signed Fourier diagnostic</label>}>
        <Plot exportName="quantum-excitation-spectrum" xLabel="Effective excitation energy (eV; not Mn K-edge energy)" yLabel={signed ? 'Signed S(ω), toy strength/eV' : 'Absorption-like S(ω), toy strength/eV'} series={[
          { name: 'Eigenstate Lorentzians', color: '#70dfac', x: result.spectralEnergy, y: result.spectrumReference },
          { name: signed ? 'Exact Fourier · signed' : 'Exact Fourier · clipped', color: '#a28aff', x: result.spectralEnergy, y: signed ? result.spectrumFourierSigned : result.spectrumFourierClipped },
          { name: signed ? 'Trotter Fourier · signed' : 'Trotter Fourier · clipped', color: '#f4c777', x: result.spectralEnergy, y: signed ? result.spectrumTrotterSigned : result.spectrumTrotterClipped, dashed: true },
        ]}/>
        <div className="metric-grid"><Metric label="Nominal 2π/T resolution" value={result.validation.resolution.toFixed(4)} unit="eV"/><Metric label="Padded grid spacing" value={result.validation.paddedGridSpacing.toFixed(4)} unit="eV"/><Metric label="Nyquist energy" value={result.validation.nyquist.toFixed(3)} unit="eV"/><Metric label="Fourier / Lorentzian L¹" value={percent(result.validation.spectralL1FourierVsReference)}/></div>
        <p className="muted">Zero padding changes grid density, not physical resolution. η = {result.params.broadening.toFixed(2)} eV is HWHM; the {result.params.window} time taper and finite observation time add broadening. The reference has only Lorentzian lifetime broadening, so a finite-window mismatch is expected. L¹ errors integrate signed-array absolute differences over the returned nonnegative energy grid.</p>
        <div className="table-wrap"><table><caption>Clipping audit — raw signed arrays remain in the JSON export</caption><thead><tr><th>Trace</th><th>Minimum signed value</th><th>Negative bins (&lt; −10⁻¹²)</th><th>Area removed</th></tr></thead><tbody><tr><td>Exact Fourier</td><td>{sci(result.validation.fftMinimum)}</td><td>{result.validation.negativeBins}</td><td>{sci(result.validation.clippedArea)}</td></tr><tr><td>Trotter Fourier</td><td>{sci(result.validation.trotterFftMinimum)}</td><td>{result.validation.trotterNegativeBins}</td><td>{sci(result.validation.trotterClippedArea)}</td></tr></tbody></table></div>
        <Disclosure title="Transition energies and dipole weights"><p>Weights below 10⁻¹² are omitted from this table. Elastic zero-gap weight is retained in all curves; it is not a core absorption line.</p><div className="table-wrap"><table><thead><tr><th>Eₙ − E_g (eV)</th><th>|〈n|D|g〉|²</th><th>Contribution</th></tr></thead><tbody>{result.transitions.map((t, i) => <tr key={i}><td>{t.energy.toFixed(6)}</td><td>{t.weight.toExponential(5)}</td><td>{t.kind === 'elastic' ? 'Elastic · not absorption' : 'Inelastic toy transition'}</td></tr>)}</tbody></table></div></Disclosure>
      </Panel>

      <div id="quantum-circuit"><Panel title="Inspect the product-formula circuit" eyebrow="EXPLICIT GATE DECOMPOSITION">
        <div className="metric-grid"><Metric label="Gates per step" value={result.resources.gatesPerStep}/><Metric label="Total serial depth" value={result.resources.depth}/><Metric label="Total CX gates" value={result.resources.entanglingGates}/><Metric label="Product-formula order" value="1"/></div><Circuit result={result}/>
      </Panel></div>
      <div className="two-col">
        <Panel title="Numerical validation" eyebrow="CHECK THE INVARIANTS" aside={<CheckCircle2 size={20}/>}>
          <div className="table-wrap"><table><thead><tr><th>Check</th><th>Max error / residual</th></tr></thead><tbody>{[
            ['Hermiticity, max |H − H†|', result.validation.hermiticityError], ['Exact propagator, max |U†U − I|', result.validation.unitarityError], ['Exact / Trotter state norm', result.validation.normError], ['Ground-state residual', result.validation.groundResidual], ['C(0) − 〈g|D†D|g〉', result.validation.correlationAtZeroError], ['Sum of transition weights − 1', result.validation.transitionWeightError], ['Fourier / reference RMSE', result.validation.spectralRmseFourierVsReference],
          ].map(([label, value]) => <tr key={label as string}><td>{label}</td><td>{sci(value as number)}</td></tr>)}</tbody></table></div>
          <p className="muted">These residuals check the chosen model and implementation. They do not validate the model against a material or experiment.</p>
        </Panel>
        <Panel title="Independent SciPy reference" eyebrow="OPTIONAL · LOCAL COMPUTATION" aside={<FlaskConical size={20}/>}>
          <p>The deployed GitHub Pages laboratory computes fully in the browser. For local research checks, the optional Python service independently uses SciPy <code>eigh</code> and <code>expm</code> on the same completed run.</p>
          {local ? <button className="button secondary" disabled={busy || referenceBusy} onClick={crossCheck}>{referenceBusy ? 'Cross-checking…' : 'Run local SciPy cross-check'}</button> : <p className="callout">Available only when running the app on localhost. Follow the README to start the optional science service. This hosted page does not contact a Python server.</p>}
          {referenceError && <p role="alert" className="callout">{referenceError}</p>}
          {reference && maxEigenError !== null && maxCorrelationError !== null && <><div className="metric-grid"><Metric label="Eigenvalue max difference" value={sci(maxEigenError)} unit="eV"/><Metric label="Complex C(t) max difference" value={sci(maxCorrelationError)}/><Metric label="SciPy expm cross-check" value={sci(reference.validation.expmError!)}/></div><p className="muted">Independent reference completed. Ground eigenvector signs can differ; degenerate ground spaces can yield different selected states. The full reference is included in subsequent run exports.</p></>}
        </Panel>
      </div>
      <Panel title="Where the research begins" eyebrow="RESEARCH MOTIVATION, WITH BOUNDARIES">
        <p>The dipole → time evolution → correlation → spectrum connection is motivated by <a href="https://arxiv.org/abs/2405.11015" target="_blank" rel="noreferrer">Fomichev et al. (2024)</a>. Spectral error, time truncation and broadening controls also connect to the questions studied in <a href="https://arxiv.org/abs/2506.15784" target="_blank" rel="noreferrer">Fomichev et al. (2025)</a>. This lab does not implement their chemical active spaces, specialized factorizations or fault-tolerant resource estimates.</p>
        <Disclosure title="Complete conventions and limitations"><ul>{result.caveats.map(c => <li key={c}>{c}</li>)}</ul></Disclosure>
      </Panel>
    </>}
  </div>;
}
