'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, FlaskConical, Plus, Trash2, Upload } from 'lucide-react';
import { useLab } from './lab-context';
import { Plot, type Series } from './plot';
import { Badge, Disclosure, Metric, Panel, Range, download } from './ui';
import { MAX_SPECTRUM_BYTES, estimateEdge, parseSpectrum, snapshotSpectrum, spectrumManifest, spectrumProvenance, spectrumToCSV, spectrumToJSON, spectrumView, validateSpectrum, type FitResult, type Spectrum, type SpectrumView } from '@/lib/spectra';
import { SYNTHETIC_DISCLOSURE, type XASParams } from '@/lib/xas';

const colors = ['#a28aff', '#70dfac', '#f4c777', '#ff686b', '#6dc5f5', '#ef9dde'];
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
      if (!offset.trim()) throw new Error('Enter a calibration offset in eV, including zero if appropriate.');
      if (!name.trim()) throw new Error('Enter a run name.');
      onSave(validateSpectrum({ ...spectrum, name: name.trim(), sampleId, notes, calibration: { reference, offset_eV: Number(offset), status } }));
    } catch (issue) { setError(errorText(issue)); }
  }}>
    <label>Run name<input value={name} maxLength={200} onChange={event => setName(event.target.value)} /></label>
    <label>Sample ID<input value={sampleId} maxLength={200} placeholder="Your sample or batch identifier" onChange={event => setSampleId(event.target.value)} /></label>
    <label>Calibration status<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="uncalibrated">Uncalibrated / unknown</option><option value="user-declared">User-declared reference</option></select></label>
    <div className="two-col"><label>Reference / method<input value={reference} maxLength={512} placeholder="Foil, standard and procedure" onChange={event => setReference(event.target.value)} /></label><label>Energy offset (eV)<input type="number" min={-1000} max={1000} step="any" value={offset} onChange={event => setOffset(event.target.value)} /></label></div>
    <label>Acquisition / processing notes<textarea value={notes} maxLength={8000} rows={3} placeholder="Date, mode, cycle, SOC, temperature, units and uncertainty source when known. Leave unknown facts unknown." onChange={event => setNotes(event.target.value)} /></label>
    <p className="muted">Saving a reference records your declaration; it does not verify calibration. Offset metadata never changes raw energies. Use the explicit display-offset switch above to view a correction.</p>
    {error && <p className="callout" role="alert">{error}</p>}
    <button type="submit" className="button secondary small">{spectrum.id === 'live' ? 'Save as a new run' : 'Save run metadata'}</button>
  </form>;
}

export function SpectraPanel() {
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
  const shapeKey = JSON.stringify([state.x, state.edge, state.shift, state.width, state.whiteLine, state.preEdge, state.oscillation]);
  const live = useMemo(() => ({ ...snapshotSpectrum(state, 'Live • synthetic'), id: 'live' }), [shapeKey]); // Only shape controls change a spectrum.
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
    const run = snapshotSpectrum(state); addRun(run); setSelectedId(run.id); notify('Synthetic snapshot saved. Raw data and model parameters are retained.');
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
      addRun(run); setSelectedId(run.id); notify(`${spectrumProvenance(run)}. ${run.energy_eV.length} rows imported; original bytes ${sourceSha256 ? 'hashed' : 'could not be hashed on this origin'}.`);
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
    const id = ++requestId.current, parameters = { ...live.parameters! }, target = validateSpectrum(selected);
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
      worker.onerror = () => { setError('The fit worker could not run. Reload the page and check browser worker support. Your spectra are preserved.'); setFitProgress(null); worker.terminate(); fitWorker.current = null; };
      worker.postMessage({ id, spectrum: target, params: parameters });
    } catch (issue) { setError(errorText(issue)); setFitProgress(null); }
  }

  return <div className="module-content">
    <div className="callout"><strong>{SYNTHETIC_DISCLOSURE}</strong> Imported files remain user supplied. Experimental origin, calibration and uncertainty are not independently verified.</div>
    <div className="toolbar"><button className="button" onClick={snapshot}><Plus size={16}/>Snapshot live spectrum</button><label className="button secondary"><Upload size={16}/>{importing ? 'Validating file…' : 'Import CSV / JSON'}<input type="file" accept=".csv,.json,text/csv,application/json" disabled={importing} onChange={importFile} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} aria-label="Import spectrum CSV or JSON" /></label><span className="muted">Up to 12 saved runs • 20,000 rows / file • 5 MB maximum</span></div>
    {error && <p className="callout" role="alert">{error}</p>}
    <div className="two-col">
      <Panel title="Spectral comparison" eyebrow="SYNCHRONIZED WORKSPACE" aside={<Badge tone="amber">{view}</Badge>}>
        <div className="toolbar" role="group" aria-label="Spectrum transform">{(['raw', 'normalized', 'derivative'] as const).map(mode => <button key={mode} className={`button small ${view === mode ? '' : 'secondary'}`} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'raw' ? 'Raw μ' : mode === 'normalized' ? 'Normalize' : 'Derivative'}</button>)}</div>
        <Plot series={plotted.series} yLabel={yLabel} exportName={`spectra-${view}`} height={310} />
        {plotted.problems.map(problem => <p className="callout" key={problem} role="status">{problem}</p>)}
        <div className="toolbar"><label><input type="checkbox" checked={showLive} onChange={event => setShowLive(event.target.checked)} /> Live synthetic overlay</label><label><input type="checkbox" checked={applyOffset} onChange={event => setApplyOffset(event.target.checked)} /> Apply user-declared offsets to display</label></div>
        <p className="muted">{view === 'raw' ? 'Shading shows supplied ±1σ pointwise uncertainty where available; it does not include unspecified systematic errors.' : view === 'normalized' ? 'Simple first/last 10% endpoint-window normalization. No polynomial background fit or uncertainty propagation.' : 'Three-point unequal-grid derivative; endpoints use two points. No smoothing or uncertainty propagation.'} {applyOffset ? 'Displayed E = raw E + declared offset. Raw exports are unchanged.' : 'Calibration offsets are metadata only; raw energy axes are displayed.'}</p>
      </Panel>
      <Panel title="Live model & selection" className="control-panel" eyebrow="ONE CONNECTED EXPERIMENT">
        <Range label="Lithium loading x" value={state.x} min={0} max={1} step={0.01} digits={2} onChange={x => set({ x })} />
        <Range label="Illustrative edge shift per x" value={state.shift} min={-10} max={10} step={0.1} digits={1} unit="eV" onChange={shift => set({ shift })} hint="Assumed synthetic relationship; no measured valence calibration." />
        <label>Selected run<select value={selected.id} onChange={event => setSelectedId(event.target.value)}>{allSpectra.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <Badge tone={selected.provenance === 'synthetic' ? 'violet' : 'amber'}>{spectrumProvenance(selected)}</Badge>
        <label>Operational edge method<select value={edgeMethod} onChange={event => setEdgeMethod(event.target.value as typeof edgeMethod)}><option value="derivative">Maximum numerical derivative</option><option value="half-height">First normalized half-height crossing</option></select></label>
        <div className="metric-grid"><Metric label="Operational edge · displayed axis" value={edge === null ? 'Undefined' : (edge + appliedOffset).toFixed(2)} unit={edge === null ? '' : ' eV'} /><Metric label="Calibration" value={selected.calibration?.status === 'user-declared' ? 'Declared' : 'Unknown'} /></div>
        <p className="muted">An operational edge is not a unique chemical fingerprint. Pre-edge features, noise, sampling and processing can change these estimates. Displayed decimals are numerical output, not an uncertainty claim.</p>
        {edgeError && <p className="callout">{edgeError}</p>}
      </Panel>
    </div>
    <Panel title="Run ledger" eyebrow="IDENTITY / TRACEABILITY / EXPORTS">
      <div className="table-wrap"><table><thead><tr><th scope="col">Overlay</th><th scope="col">Run / sample</th><th scope="col">Provenance</th><th scope="col">Calibration</th><th scope="col">Actions</th></tr></thead><tbody>{allSpectra.map((item, index) => <tr key={item.id}><td>{item.id === 'live' ? <span style={{ color: colors[0] }}>LIVE</span> : <input type="checkbox" checked={!hidden.includes(item.id)} aria-label={`Show ${item.name}`} onChange={event => setHidden(current => event.target.checked ? current.filter(id => id !== item.id) : [...current, item.id])} />}</td><td><button className="text-button" onClick={() => setSelectedId(item.id)} style={{ color: colors[index % colors.length] }}>{item.name}</button><small>{item.sampleId || 'No sample identifier'}</small></td><td>{spectrumProvenance(item)}</td><td>{item.calibration?.status ?? 'uncalibrated'}<small>{item.calibration?.offset_eV ?? 0} eV offset {applyOffset && item.calibration?.status === 'user-declared' ? 'applied to display' : 'metadata only'}</small></td><td>{item.id !== 'live' && <button className="icon-button" aria-label={`Remove ${item.name}`} onClick={() => { removeRun(item.id); if (selectedId === item.id) setSelectedId('live'); }}><Trash2 size={15}/></button>}</td></tr>)}</tbody></table></div>
      <p className="muted">Runs stay in this browser session. Export important data before reloading. Adding a thirteenth saved run removes the oldest from this in-memory ledger.</p>
      <div className="toolbar"><button className="button secondary small" onClick={() => download(`${filename(selected.name)}-raw.csv`, spectrumToCSV(selected), 'text/csv')}><Download size={14}/>Raw CSV</button><button className="button secondary small" onClick={() => download(`${filename(selected.name)}-raw.json`, spectrumToJSON(selected))}>Raw JSON</button><button className="button secondary small" onClick={exportView}>Current view CSV</button><button className="button secondary small" onClick={() => { try { download(`${filename(selected.name)}-manifest.json`, JSON.stringify(spectrumManifest(selected, state, view, applyOffset, fit && fit.spectrum.id === selected.id ? { parameters: fit.parameters, result: fit.result } : undefined), null, 2)); } catch (issue) { setError(errorText(issue)); } }}>Run manifest</button></div>
      <Disclosure title="Accepted import format and data integrity"><p>CSV headers must be <code>energy_eV,mu_cm_inv</code>, optionally <code>sigma_mu_cm_inv</code>. Energies must strictly increase; coefficients must be absolute linear coefficients in cm⁻¹. Dimensionless optical depth and normalized absorption are different quantities and are rejected as substitutes. JSON uses those array field names, or the versioned envelope produced by Raw JSON.</p><p>Original numerical arrays are preserved through all display operations. Imports receive a new internal ID. On supported secure origins, SHA-256 records the original file bytes; it is an integrity fingerprint, not proof of measurement authenticity. Metadata can contain notes supplied by you and should be reviewed before sharing.</p></Disclosure>
    </Panel>
    <div className="two-col">
      <Panel title="Selected run metadata" eyebrow="RESEARCH RECORD"><MetadataEditor key={selected.id} spectrum={selected} onSave={updated => {
        if (updated.id === 'live') { const run = { ...updated, id: newId() }; addRun(run); setSelectedId(run.id); }
        else { updateRun(updated); }
        notify('Metadata saved. Raw energies and absorption values remain unchanged.');
      }} />{selected.sourceSha256 && <p className="muted" style={{ overflowWrap: 'anywhere' }}>Original file SHA-256: <code>{selected.sourceSha256}</code></p>}</Panel>
      <Panel title="Illustrative shape fit" eyebrow="BROWSER WORKER / DESCRIPTIVE ONLY" aside={<FlaskConical size={20}/> }>
        <p>Fit the selected raw curve with the current synthetic shape. Search a shift of ±10 eV in 0.1 eV steps, with a nonnegative amplitude and constant baseline solved at each step.</p>
        <div className="equation">μfit(E) = b + a · μsynthetic(E; E₀ + ΔE), a ≥ 0</div>
        <p className="muted">{selected.sigma_mu_cm_inv ? 'Weighted least squares uses the supplied 1/σ² point weights.' : 'No pointwise σ supplied: ordinary unweighted least squares.'} Fits use raw energies; display calibration offsets are excluded. These parameters do not infer lithium content, oxidation state, structure or instrument calibration.</p>
        <div className="toolbar"><button className="button" disabled={fitProgress !== null} onClick={runFit}>{fitProgress !== null ? 'Fitting…' : 'Fit selected raw spectrum'}</button>{fitProgress !== null && <button className="button secondary" onClick={() => { fitWorker.current?.terminate(); fitWorker.current = null; requestId.current++; setFitProgress(null); notify('Fit cancelled.'); }}>Cancel fit</button>}</div>
        {fitProgress !== null && <div role="status"><progress aria-label="Fit progress" max={1} value={fitProgress}/><p>{Math.round(fitProgress * 100)}% of shift candidates evaluated</p></div>}
        {fit && <><div className="metric-grid"><Metric label="Shift grid result" value={fit.result.shift_eV.toFixed(1)} unit=" eV"/><Metric label="Scale" value={fit.result.scale.toFixed(4)}/><Metric label="Baseline" value={fit.result.baseline_cm_inv.toFixed(3)} unit=" cm⁻¹"/><Metric label="RMSE" value={fit.result.rmse_cm_inv.toPrecision(4)} unit=" cm⁻¹"/></div><p>Reduced χ²: {fit.result.reducedChiSquare === null ? 'unavailable without supplied σ' : fit.result.reducedChiSquare.toPrecision(4)}. {fit.result.boundary && <strong>Boundary solution: inspect identifiability and model mismatch.</strong>}</p><p className="muted">{fit.result.caveat}</p></>}
      </Panel>
    </div>
    {fit && <Panel title="Fit audit" eyebrow={`${fit.spectrum.name} / RAW ENERGY AXIS`}><div className="two-col"><Plot series={[{ name: `${spectrumProvenance(fit.spectrum)} · ${fit.spectrum.name}`, color: '#a28aff', x: fit.spectrum.energy_eV, y: fit.spectrum.mu_cm_inv, sigma: fit.spectrum.sigma_mu_cm_inv }, { name: 'Illustrative shape fit', color: '#f4c777', x: fit.spectrum.energy_eV, y: fit.result.fitted, dashed: true }]} yLabel="μ (cm⁻¹)" exportName="fit-audit" /><Plot series={[{ name: 'Residual: data − model', color: '#70dfac', x: fit.spectrum.energy_eV, y: fit.result.residuals }]} yLabel="Residual (cm⁻¹)" exportName="fit-residual" /></div></Panel>}
    <Disclosure title="Why this matters in research and industry"><p>Repeat-scan comparison, source records, explicit calibration status, raw-data preservation and residual inspection help teams discuss whether a difference comes from the material, measurement or processing. This workspace supports an auditable exploratory handoff; it is not qualified for manufacturing release decisions.</p><p>Background choices introduce uncertainty beyond counting statistics. This is a motivation for retaining processing records and avoiding overconfident shape fits; the lab does not implement the full methods in <a href="https://arxiv.org/abs/physics/0003086" target="_blank" rel="noreferrer">Klementev, XAFS spectroscopy (2000)</a>. The near-edge oscillation is a synthetic feature, not an EXAFS scattering-path fit.</p></Disclosure>
  </div>;
}
