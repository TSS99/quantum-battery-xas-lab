'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, FlaskConical, Plus, Trash2, Upload } from 'lucide-react';
import { useLab } from './lab-context';
import { SpectrumScores } from './spectrum-scores';
import { resolveSample } from '@/lib/sample';
import { Plot, type Series } from './plot';
import { Badge, Disclosure, Metric, Panel, Range, TryThis, download } from './ui';
import { MAX_SPECTRUM_BYTES, estimateEdge, parseSpectrum, snapshotSpectrum, spectrumManifest, spectrumProvenance, spectrumToCSV, spectrumToJSON, spectrumView, validateSpectrum, type FitResult, type Spectrum, type SpectrumView } from '@/lib/spectra';
import { isBattery } from '@/lib/sample';
import { DataLoading, SampleSummary, useSampleSpectrum } from './sample-controls';
import { type XASParams } from '@/lib/xas';

const colors = ['#c4ccd6', '#ffc46b', '#74dcaa', '#ff8a8f', '#9cc5e8', '#d5c6ad'];
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed.';
const filename = (name: string) => name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'spectrum';
const newId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function MetadataEditor({ spectrum, onSave }: { spectrum: Spectrum; onSave: (spectrum: Spectrum) => void }) {
  const [name, setName] = useState(spectrum.name);
  const [sampleId, setSampleId] = useState(spectrum.sampleId ?? '');
  const [notes, setNotes] = useState(spectrum.notes ?? '');
  const [reference, setReference] = useState(spectrum.calibration?.reference ?? '');
  const [offset, setOffset] = useState(String(spectrum.calibration?.offset_eV ?? 0));
  const [status, setStatus] = useState<'uncalibrated' | 'user-declared'>(spectrum.calibration?.status ?? 'uncalibrated');
  const [error, setError] = useState('');
  return <form className="control-panel" onSubmit={event => {
    event.preventDefault(); setError('');
    try {
      if (!offset.trim()) throw new Error('Enter a calibration offset in eV. Use 0 if there is none.');
      if (!name.trim()) throw new Error('Enter a run name.');
      onSave(validateSpectrum({ ...spectrum, name: name.trim(), sampleId, notes, calibration: { reference, offset_eV: Number(offset), status } }));
    } catch (issue) { setError(errorText(issue)); }
  }}>
    <label>Run name<input value={name} maxLength={200} onChange={event => setName(event.target.value)} /></label>
    <label>Sample ID<input value={sampleId} maxLength={200} placeholder="Your sample or batch identifier" onChange={event => setSampleId(event.target.value)} /></label>
    <label>Calibration status<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="uncalibrated">Uncalibrated / unknown</option><option value="user-declared">User-declared reference</option></select></label>
    <div className="two-col"><label>Reference / method<input value={reference} maxLength={512} placeholder="Foil, standard and procedure" onChange={event => setReference(event.target.value)} /></label><label>Energy offset (eV)<input type="number" min={-1000} max={1000} step="any" value={offset} onChange={event => setOffset(event.target.value)} /></label></div>
    <label>Acquisition / processing notes<textarea value={notes} maxLength={8000} rows={3} placeholder="Record acquisition mode, cycle, state of charge, temperature and uncertainty source, if known." onChange={event => setNotes(event.target.value)} /></label>
    <p className="muted">A reference records your calibration method. Enable display offsets to view the correction; raw energies stay unchanged.</p>
    {error && <p className="callout" role="alert">{error}</p>}
    <button type="submit" className="button secondary small">{spectrum.id === 'live' ? 'Save as a new run' : 'Save run metadata'}</button>
  </form>;
}

export function SpectraPanel() {
  const {state}=useLab();
  const data=useSampleSpectrum(isBattery(state.sample));
  if(!data.spectrum)return <DataLoading error={data.error}>Next you can save the live curve, change the sample and overlay the two, or import your own CSV or JSON spectrum and score a model against it.</DataLoading>;
  return <SpectraWorkspace liveCurve={data.spectrum}/>;
}
function SpectraWorkspace({liveCurve}:{liveCurve:Spectrum}) {
  const { state, set, runs, addRun, updateRun, removeRun, notify } = useLab();
  const [view, setView] = useState<SpectrumView>('raw');
  const [selectedId, setSelectedId] = useState('live');
  const [showLive, setShowLive] = useState(true);
  const [applyOffset, setApplyOffset] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [edgeMethod, setEdgeMethod] = useState<'derivative' | 'half-height'>('derivative');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [fitProgress, setFitProgress] = useState<number | null>(null);
  const [fit, setFit] = useState<{ result: FitResult; parameters: XASParams; spectrum: Spectrum } | null>(null);
  const fitWorker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const shapeKey = JSON.stringify([state.sample,state.x, state.edge, state.shift, state.width, state.whiteLine, state.preEdge, state.oscillation]);
  const live = useMemo(() => ({ ...liveCurve, id: 'live' }), [liveCurve]); // Only shape controls change a spectrum.
  const selected = runs.find(run => run.id === selectedId) ?? live;
  const allSpectra = [live, ...runs];

  useEffect(() => {
    fitWorker.current?.terminate(); fitWorker.current = null; requestId.current++;
    setFit(null); setFitProgress(null);
  }, [selected.id, shapeKey]);
  useEffect(() => () => fitWorker.current?.terminate(), []);

  const plotted = useMemo(() => {
    const problems: string[] = [], series: Series[] = [];
    for (const [index, item] of [live, ...runs].entries()) {
      if ((item.id === 'live' && !showLive) || hidden.includes(item.id)) continue;
      try {
        const transformed = spectrumView(item, view, applyOffset);
        series.push({ name: `${item.name} · ${spectrumProvenance(item)}`, color: colors[index % colors.length], x: transformed.energy_eV, y: transformed.values, sigma: transformed.sigma, dashed: item.provenance === 'imported' });
      } catch (issue) { problems.push(`${item.name}: ${errorText(issue)}`); }
    }
    return { series, problems };
  }, [live, runs, view, applyOffset, hidden, showLive]);

  let edge: number | null = null, edgeError = '';
  try { edge = estimateEdge(selected, edgeMethod); } catch (issue) { edgeError = errorText(issue); }
  const appliedOffset = applyOffset && selected.calibration?.status === 'user-declared' ? selected.calibration.offset_eV : 0;
  const yLabel = view === 'raw' ? 'μ (cm⁻¹)' : view === 'normalized' ? 'Endpoint-normalized μ (dimensionless)' : 'dμ/dE (cm⁻¹ eV⁻¹)';

  function snapshot() {
    const run = { ...live, id: newId() }; addRun(run); setSelectedId(run.id); notify('Curve saved.');
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setError(''); setImporting(true);
    try {
      if (file.size > MAX_SPECTRUM_BYTES) throw new Error('Spectrum exceeds the 5 MB file limit.');
      const bytes = await file.arrayBuffer();
      const parsed = parseSpectrum(new TextDecoder('utf-8', { fatal: true }).decode(bytes), file.name);
      // IDs identify this import event; a file-provided ID must not replace another run.
      let sourceSha256: string | undefined;
      if (globalThis.crypto?.subtle) sourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      const run = { ...parsed, id: newId(), sourceSha256 };
      addRun(run); setSelectedId(run.id); notify(`${spectrumProvenance(run)}. ${run.energy_eV.length} rows imported; ${sourceSha256 ? 'file SHA-256 recorded' : 'SHA-256 is not available on this origin'}.`);
    } catch (issue) { setError(errorText(issue)); }
    finally { setImporting(false); }
  }
  function exportView() {
    try {
      const transformed = spectrumView(selected, view, applyOffset);
      const metadata = { sourceId: selected.id, sourceName: selected.name, provenance: spectrumProvenance(selected), view, valueUnit: transformed.valueUnit, appliedOffset_eV: transformed.appliedOffset_eV, uncertainty: view === 'raw' ? 'Supplied pointwise sigma' : 'Not propagated' };
      const column = view === 'raw' ? 'mu_cm_inv' : view === 'normalized' ? 'mu_endpoint_normalized' : 'dmu_dE_cm_inv_per_eV';
      const exportMetadata = { name: `${selected.name} · ${view} view`, provenance: selected.provenance, declaredProvenance: selected.declaredProvenance, source: selected.source, sampleId: selected.sampleId, notes: `Derived ${view} view from ${selected.id}. Applied energy offset ${transformed.appliedOffset_eV} eV. ${selected.notes ?? ''}`, calibration: selected.calibration ? { ...selected.calibration, offset_eV: 0 } : undefined };
      const contents = [`# metadata: ${JSON.stringify(exportMetadata)}`, `# processing: ${JSON.stringify(metadata)}`, `energy_eV,${column}${transformed.sigma ? ',sigma_mu_cm_inv' : ''}`, ...transformed.energy_eV.map((energy, i) => `${energy},${transformed.values[i]}${transformed.sigma ? `,${transformed.sigma[i]}` : ''}`)].join('\n');
      download(`${filename(selected.name)}-${view}-view.csv`, contents, 'text/csv');
    } catch (issue) { setError(errorText(issue)); }
  }
  function runFit() {
    setError(''); setFit(null); fitWorker.current?.terminate();
    const id = ++requestId.current, parameters = { ...snapshotSpectrum(state).parameters! }, target = validateSpectrum(selected);
    setFitProgress(0);
    try {
      const worker = new Worker(new URL('../workers/fit.worker.ts', import.meta.url)); fitWorker.current = worker;
      worker.onmessage = (event: MessageEvent<{ id: number; progress?: number; result?: FitResult; error?: string }>) => {
        if (event.data.id !== requestId.current) return;
        if (event.data.progress !== undefined) { setFitProgress(event.data.progress); return; }
        if (event.data.error) setError(event.data.error);
        if (event.data.result) setFit({ result: event.data.result, parameters, spectrum: target });
        setFitProgress(null); worker.terminate(); fitWorker.current = null;
      };
      worker.onerror = () => { setError('The fit worker could not run. Your curves are still loaded; download any you need before reloading the page.'); setFitProgress(null); worker.terminate(); fitWorker.current = null; };
      worker.postMessage({ id, spectrum: target, params: parameters });
    } catch (issue) { setError(errorText(issue)); setFitProgress(null); }
  }

  return <div className="module-content">
    <SampleSummary/><TryThis steps={['validate']} done={view==='derivative'} research={<>Raw μ in cm⁻¹; endpoint normalization uses the first and last 10% of points. Derivatives use a three-point unequal grid; neither transform propagates uncertainty.</>}>{view==='derivative'?'The vertical axis now shows dμ/dE in cm⁻¹ eV⁻¹. Peaks mark rapid changes in absorption; noise can also produce peaks.':'Save this curve, change the sample, then use Derivative to find where absorption rises fastest.'}</TryThis>
    <div className="toolbar"><button className="button" onClick={snapshot}><Plus size={16}/>Save this curve</button><label className="button secondary"><Upload size={16}/>{importing ? 'Validating file…' : 'Import CSV / JSON'}<input type="file" accept=".csv,.json,text/csv,application/json" disabled={importing} onChange={importFile} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} aria-label="Import spectrum CSV or JSON" /></label><span className="muted">Up to 12 curves; files up to 5 MB and 20,000 rows.</span></div>
    {error && <p className="callout" role="alert">{error}</p>}
    <div>
      <Panel title="Spectral comparison" eyebrow="Spectrum display" aside={<Badge tone="amber">{view}</Badge>}>
        <div className="toolbar" role="group" aria-label="Spectrum transform">{(['raw', 'normalized', 'derivative'] as const).map(mode => <button key={mode} className={`button small ${view === mode ? '' : 'secondary'}`} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'raw' ? 'Raw μ' : mode === 'normalized' ? 'Normalize' : 'Derivative'}</button>)}</div>
        {isBattery(state.sample)&&<Range label="Lithium loading x" value={state.x} min={0} max={1} step={0.01} digits={2} onChange={x => set({ x })} />}
        <Plot ghostKey={shapeKey} edge={isBattery(state.sample)?state.edge-state.shift*state.x:resolveSample(state.sample).edge.energy_eV} series={plotted.series} yLabel={yLabel} exportName={`spectra-${view}`} height={310} />
        {plotted.problems.map(problem => <p className="callout" key={problem} role="status">{problem}</p>)}
        <div className="toolbar"><label><input type="checkbox" checked={showLive} onChange={event => setShowLive(event.target.checked)} /> Live curve</label>{state.expert&&<label><input type="checkbox" checked={applyOffset} onChange={event => setApplyOffset(event.target.checked)} /> Apply user-declared offsets to display</label>}</div>
        <p className="muted">{view === 'raw' ? 'Shading shows supplied ±1σ pointwise uncertainty where available; it does not include unspecified systematic errors.' : view === 'normalized' ? 'Simple first/last 10% endpoint-window normalization. No polynomial background fit or uncertainty propagation.' : 'Three-point unequal-grid derivative; endpoints use two points. No smoothing or uncertainty propagation.'} {applyOffset ? 'Displayed E = raw E + declared offset. Raw exports are unchanged.' : 'Calibration offsets are metadata only; raw energy axes are displayed.'}</p>
      </Panel>
      </div><div className="curve-chips" aria-label="Saved curve selection">{allSpectra.map(item=><button key={item.id} className="button secondary small" aria-pressed={selected.id===item.id} onClick={()=>setSelectedId(item.id)}>{item.name}</button>)}</div>
      <details className="research-drawer" open={state.expert}><summary>Data tools</summary><div className="drawer-body">
      <Panel title="Selected curve" className="control-panel" eyebrow="Sample and run">

        {isBattery(state.sample)&&<Range label="Edge shift per lithium" value={state.shift} min={-10} max={10} step={0.1} digits={1} unit="eV" onChange={shift => set({ shift })} hint="Assumed synthetic relationship; no measured valence calibration." />}
        <label>Selected run<select value={selected.id} onChange={event => setSelectedId(event.target.value)}>{allSpectra.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <Badge tone={selected.provenance === 'synthetic' ? 'violet' : 'amber'}>{spectrumProvenance(selected)}</Badge>
        <label>Find the edge by<select value={edgeMethod} onChange={event => setEdgeMethod(event.target.value as typeof edgeMethod)}><option value="derivative">Steepest point</option><option value="half-height">Half height</option></select></label>
        <div className="metric-grid"><Metric label="Edge estimate" value={edge === null ? 'Undefined' : (edge + appliedOffset).toFixed(2)} unit={edge === null ? '' : ' eV'} /><Metric label="Calibration" value={selected.calibration?.status === 'user-declared' ? 'Declared' : 'Unknown'} /></div>
        <p className="muted">{live.calibration?.reference}</p><p className="muted">Noise and line shape can move this estimate. Calibrate against a measured reference before interpreting a shift.</p>
        {edgeError && <p className="callout">{edgeError}</p>}
      </Panel>
    <SpectrumScores key={selected.id+shapeKey} reference={live} target={selected} edge={resolveSample(state.sample).edge.energy_eV}/><Panel title="Saved curves" eyebrow="Saved runs">
      <div className="table-wrap"><table><thead><tr><th scope="col">Overlay</th><th scope="col">Run / sample</th><th scope="col">Provenance</th><th scope="col">Calibration</th><th scope="col">Actions</th></tr></thead><tbody>{allSpectra.map((item, index) => <tr key={item.id}><td>{item.id === 'live' ? <span style={{ color: colors[0] }}>Live</span> : <input type="checkbox" checked={!hidden.includes(item.id)} aria-label={`Show ${item.name}`} onChange={event => setHidden(current => event.target.checked ? current.filter(id => id !== item.id) : [...current, item.id])} />}</td><td><button className="text-button" onClick={() => setSelectedId(item.id)} style={{ color: colors[index % colors.length] }}>{item.name}</button><small>{item.sampleId || 'No sample identifier'}</small></td><td>{spectrumProvenance(item)}</td><td>{item.calibration?.status ?? 'uncalibrated'}<small>{item.calibration?.offset_eV ?? 0} eV offset {applyOffset && item.calibration?.status === 'user-declared' ? 'applied to display' : 'metadata only'}</small></td><td>{item.id !== 'live' && <button className="icon-button" aria-label={`Remove ${item.name}`} onClick={() => { removeRun(item.id); if (selectedId === item.id) setSelectedId('live'); }}><Trash2 size={15}/></button>}</td></tr>)}</tbody></table></div>
      <p className="muted">Up to 12 saved curves; they clear on reload. Download curves you want to keep.</p>
      <div className="toolbar"><button className="button secondary small" onClick={() => download(`${filename(selected.name)}-raw.csv`, spectrumToCSV(selected), 'text/csv')}><Download size={14}/>Raw CSV</button><button className="button secondary small" onClick={() => download(`${filename(selected.name)}-raw.json`, spectrumToJSON(selected))}>Raw JSON</button><button className="button secondary small" onClick={exportView}>Current view CSV</button><button className="button secondary small" onClick={() => { try { download(`${filename(selected.name)}-manifest.json`, JSON.stringify(spectrumManifest(selected, state, view, applyOffset, fit && fit.spectrum.id === selected.id ? { parameters: fit.parameters, result: fit.result } : undefined), null, 2)); } catch (issue) { setError(errorText(issue)); } }}>Run manifest</button></div>
      <Disclosure title="Accepted import format and data integrity"><p>CSV headers must be <code>energy_eV,mu_cm_inv</code>, optionally <code>sigma_mu_cm_inv</code>. Energies must strictly increase; coefficients must be absolute linear coefficients in cm⁻¹. Dimensionless optical depth or normalized absorption cannot stand in for μ. JSON uses those array field names, or the versioned envelope produced by Raw JSON.</p><p>Display operations never modify the original arrays. Each import gets a new internal ID. On secure origins the app records a SHA-256 hash of the file bytes. The hash lets you check later that a file is unchanged; it says nothing about whether the data are a genuine measurement. Exported metadata includes your notes, so review them before sharing.</p></Disclosure>
    </Panel>
    <div className="two-col">
      <Panel title="Selected run metadata" eyebrow="Run metadata"><MetadataEditor key={selected.id} spectrum={selected} onSave={updated => {
        if (updated.id === 'live') { const run = { ...updated, id: newId() }; addRun(run); setSelectedId(run.id); }
        else { updateRun(updated); }
        notify('Notes saved.');
      }} />{selected.sourceSha256 && <p className="muted" style={{ overflowWrap: 'anywhere' }}>Original file SHA-256: <code>{selected.sourceSha256}</code></p>}</Panel>
      {isBattery(state.sample)&&state.sample.absorber==='Mn'&&state.sample.edge==='K'&&<Panel title="Battery model fit" eyebrow="Descriptive fit" aside={<FlaskConical size={20}/> }>
        <p>Fit the selected raw curve with the current synthetic shape. The model slides over your data to find the best shift. It also fits the height and baseline.</p>
        <div className="equation">μfit(E) = b + a · μsynthetic(E; E₀ + ΔE), a ≥ 0</div>
        <p className="muted">{selected.sigma_mu_cm_inv ? 'Weighted least squares uses the supplied 1/σ² point weights.' : 'No pointwise σ supplied: ordinary unweighted least squares.'} Fits use raw energies; display calibration offsets are excluded. The fitted parameters say nothing about lithium content, oxidation state, structure or instrument calibration.</p>
        <div className="toolbar"><button className="button" disabled={fitProgress !== null} onClick={runFit}>{fitProgress !== null ? 'Fitting…' : 'Fit selected raw spectrum'}</button>{fitProgress !== null && <button className="button secondary" onClick={() => { fitWorker.current?.terminate(); fitWorker.current = null; requestId.current++; setFitProgress(null); notify('Fit cancelled.'); }}>Cancel fit</button>}</div>
        {fitProgress !== null && <div role="status"><progress aria-label="Fit progress" max={1} value={fitProgress}/><p>{Math.round(fitProgress * 100)}% of shift candidates evaluated</p></div>}
        {fit && <><div className="metric-grid"><Metric label="Shift grid result" value={fit.result.shift_eV.toFixed(1)} unit=" eV"/><Metric label="Scale" value={fit.result.scale.toFixed(4)}/><Metric label="Baseline" value={fit.result.baseline_cm_inv.toFixed(3)} unit=" cm⁻¹"/><Metric label="RMSE" value={fit.result.rmse_cm_inv.toPrecision(4)} unit=" cm⁻¹"/></div><p>Reduced χ²: {fit.result.reducedChiSquare === null ? 'unavailable without supplied σ' : fit.result.reducedChiSquare.toPrecision(4)}. {fit.result.boundary && <strong>Boundary solution: inspect identifiability and model mismatch.</strong>}</p><p className="muted">{fit.result.caveat}</p></>}
      </Panel>}
    </div>
    {fit && <Panel title="Fit audit" eyebrow={`${fit.spectrum.name} / Raw energy axis`}><div className="two-col"><Plot series={[{ name: `${spectrumProvenance(fit.spectrum)} · ${fit.spectrum.name}`, color: '#c4ccd6', x: fit.spectrum.energy_eV, y: fit.spectrum.mu_cm_inv, sigma: fit.spectrum.sigma_mu_cm_inv }, { name: 'Battery model fit', color: '#f4c777', x: fit.spectrum.energy_eV, y: fit.result.fitted, dashed: true }]} yLabel="μ (cm⁻¹)" exportName="fit-audit" /><Plot series={[{ name: 'Residual: data − model', color: '#70dfac', x: fit.spectrum.energy_eV, y: fit.result.residuals }]} yLabel="Residual (cm⁻¹)" exportName="fit-residual" /></div></Panel>}
    <Disclosure title="Using these records in research and industry"><p>When two spectra differ, the cause can be the material, the measurement or the processing. Repeat scans, source records, calibration status, untouched raw data and residual plots help you tell which. Use them for exploratory comparison. They are not a basis for manufacturing release decisions.</p><p>Background subtraction adds uncertainty beyond counting statistics, which is one reason to keep processing records and to be cautious with shape fits. The lab does not implement the full methods in <a href="https://arxiv.org/abs/physics/0003086" target="_blank" rel="noreferrer">Klementev, XAFS spectroscopy (2000)</a>. The near-edge oscillation here is a synthetic feature. It is not fitted from EXAFS scattering paths.</p></Disclosure>
    </div></details>
  </div>;
}
