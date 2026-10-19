'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { useLab } from './lab-context';
import { Num, ScienceText, Tex, Unit } from './tex';
import { Plot, type Series } from './plot';
import { Disclosure, Metric, download } from './ui';
import { MAX_BEAMLINE_BYTES, declaredEdge, guessColumns, layoutKey, metadataField, parseBeamlineFile, type BeamlineTable, type ColumnGuess, type ColumnMapping } from '@/lib/beamline-files';
import { larchScript, muFromTable, processingNotes, processingRecord, savedCurve, type MuScan, type ReductionRequest, type ReductionResult, type SourceFile } from '@/lib/measured-data';
import { validateSpectrum, type Spectrum } from '@/lib/spectra';
import { ELEMENT_SYMBOLS, elementInfo } from '@/lib/xraydata';
import { LARCH_PORT_VERSION, type PreEdgeParams } from '@/lib/xas-reduction';

const MAX_FILES = 20;
const SCAN_COLORS = ['#9cc5e8', '#74dcaa', '#d5c6ad', '#ff8a8f', '#b49cff', '#7fd8cf'];
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The file could not be read.';
const newId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fileBase = (name: string) => name.replace(/\.[^.]+$/, '');
const safeName = (name: string) => fileBase(name).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'measured';
const signed = (value: number, digits = 2) => (value >= 0 ? '+' : '') + value.toFixed(digits);
const sha256 = async (bytes: ArrayBuffer) => globalThis.crypto?.subtle ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('') : undefined;

interface Loaded { id: string; table: BeamlineTable; include: boolean; sha256?: string; example: boolean }
export interface Done { result: ReductionResult; request: Omit<ReductionRequest, 'scans'>; scans: MuScan[]; sources: SourceFile[] }

type ParamKey = 'e0' | 'pre1' | 'pre2' | 'norm1' | 'norm2' | 'step';
const PARAM_FIELDS: { key: ParamKey; label: string; tex: string; hint: string }[] = [
  { key: 'e0', label: 'E0 (eV)', tex: 'E_0', hint: 'absolute energy' },
  { key: 'pre1', label: 'pre1 (eV)', tex: '\\text{pre1}', hint: 'relative to E0' },
  { key: 'pre2', label: 'pre2 (eV)', tex: '\\text{pre2}', hint: 'relative to E0' },
  { key: 'norm1', label: 'norm1 (eV)', tex: '\\text{norm1}', hint: 'relative to E0' },
  { key: 'norm2', label: 'norm2 (eV)', tex: '\\text{norm2}', hint: 'relative to E0' },
  { key: 'step', label: 'Edge step', tex: '\\Delta\\mu_0', hint: 'fixed jump' },
];
const BLANK_PARAMS: Record<ParamKey | 'nnorm' | 'nvict', string> = { e0: '', pre1: '', pre2: '', norm1: '', norm2: '', step: '', nnorm: '', nvict: '0' };

function stripGuess(guess: ColumnGuess): ColumnMapping {
  const { energy, energyUnit, mode, i0, it, fluorescence, iref } = guess;
  return { energy, energyUnit, mode, i0, it, fluorescence, iref };
}

/** Column choices for one file layout; every file with the same column labels shares them. */
export function MappingEditor({ files, mapping, guess, onChange }: { files: Loaded[]; mapping: ColumnMapping; guess: ColumnGuess; onChange: (mapping: ColumnMapping) => void }) {
  const table = files[0].table;
  const options = table.labels.map((label, i) => <option key={i} value={i}>{label}{table.units[i] ? ` (${table.units[i]})` : ''}</option>);
  const pick = (value: string) => value === '' ? null : Number(value);
  const set = (patch: Partial<ColumnMapping>) => onChange({ ...mapping, ...patch });
  const medianText = (i: number) => Number.isFinite(guess.medians[i]) ? String(Number(guess.medians[i].toPrecision(3))) : 'no numbers';
  return <fieldset className="mapping">
    <legend>Columns of {files[0].table.name}{files.length > 1 ? ` and ${files.length - 1} more file${files.length > 2 ? 's' : ''} with the same layout` : ''}</legend>
    <div className="param-grid">
      <label className="field-label">Energy column<select value={mapping.energy} onChange={event => set({ energy: Number(event.target.value) })}>{options}</select></label>
      <label className="field-label">Energy unit<select value={mapping.energyUnit} onChange={event => set({ energyUnit: event.target.value as ColumnMapping['energyUnit'] })}><option value="eV">eV</option><option value="keV">keV (multiplied by 1000)</option></select></label>
      <label className="field-label">Signal<select value={mapping.mode} onChange={event => set({ mode: event.target.value as ColumnMapping['mode'] })}><option value="transmission">Transmission</option><option value="fluorescence">Fluorescence</option></select></label>
      <label className="field-label">I0 (incident)<select value={mapping.i0 ?? ''} onChange={event => set({ i0: pick(event.target.value) })}><option value="">None</option>{options}</select></label>
      <label className="field-label">It (after the sample)<select value={mapping.it ?? ''} onChange={event => set({ it: pick(event.target.value) })}><option value="">None</option>{options}</select></label>
      <label className="field-label">Iref (after the reference foil)<select value={mapping.iref ?? ''} onChange={event => set({ iref: pick(event.target.value) })}><option value="">None</option>{options}</select></label>
    </div>
    {mapping.mode === 'fluorescence' && <fieldset className="channel-list"><legend>Fluorescence channels to sum</legend>
      {table.labels.map((label, i) => i === mapping.energy || i === mapping.i0 || i === mapping.it || i === mapping.iref ? null : <label key={i} className="check-control"><input type="checkbox" checked={mapping.fluorescence.includes(i)} onChange={event => set({ fluorescence: event.target.checked ? [...mapping.fluorescence, i].sort((a, b) => a - b) : mapping.fluorescence.filter(c => c !== i) })} />{label} <small className="muted">median <Num>{medianText(i)}</Num>{guess.excluded.some(item => item.column === i) ? ', looks dead' : ''}</small></label>)}
    </fieldset>}
    <p className="muted"><Tex>{mapping.mode === 'transmission' ? '\\mu(E) = \\ln(I_0/I_t)' : '\\mu(E) = \\textstyle\\sum_j I_{f,j}\\,/\\,I_0'}</Tex>{mapping.iref !== null && <>; reference foil <Tex>{'\\mu_{\\mathrm{ref}}(E) = \\ln(I_t/I_{\\mathrm{ref}})'}</Tex></>}. Proposed from the column names{guess.excluded.length ? '; a channel whose median is below 1 % of the strongest channel was left out' : ''}. Check before you trust it.</p>
  </fieldset>;
}

type Params = typeof BLANK_PARAMS;

/** Calibration table, merge, normalization and save controls for one processed result. */
export function MeasuredResults({ done, view, onView, params, onParams, mergeKind, onMergeKind, name, onName, onSave, sampleEdge }: {
  done: Done; view: 'mu' | 'norm' | 'flat'; onView: (view: 'mu' | 'norm' | 'flat') => void;
  params: Params; onParams: Dispatch<SetStateAction<Params>>; mergeKind: 'cubic' | 'linear'; onMergeKind: (kind: 'cubic' | 'linear') => void;
  name: string; onName: (name: string) => void; onSave: (quantity: 'normalized' | 'flattened') => void;
  /** The lab sample's absorber and edge, such as "Mn K"; the live curve and the scores use it. */
  sampleEdge: string;
}) {
  const { result } = done, norm = result.norm;
  const fluorescence = done.sources[0]?.mapping.mode === 'fluorescence';
  const muLabel = fluorescence ? 'μ(E) = If/I0' : 'μ(E) = ln(I0/It)';
  const muTex = fluorescence ? '\\mu(E) = I_f/I_0\\ (\\text{arbitrary units})' : '\\mu(E) = \\ln(I_0/I_t)';
  const mainSeries: Series[] = view === 'mu' ? [
    { name: result.merged ? 'Merged μ(E)' : 'μ(E)', color: '#c4ccd6', x: norm.energy, y: result.mu },
    { name: 'Pre-edge line', color: '#9cc5e8', x: norm.energy, y: norm.preEdge, dashed: true },
    { name: 'Post-edge curve', color: '#74dcaa', x: norm.energy, y: norm.postEdge, dashed: true },
  ] : [{ name: view === 'norm' ? 'Normalized μ(E)' : 'Flattened μ(E)', color: '#c4ccd6', x: norm.energy, y: view === 'norm' ? norm.norm : norm.flat }];
  const references = useMemo(() => {
    if (!done.request.calibration) return [];
    const { energy: tab } = done.request.calibration;
    return done.scans.flatMap((scan, i) => {
      const shift = done.result.scans[i].shift, x: number[] = [], y: number[] = [];
      scan.energy.forEach((value, j) => { const e = value + shift; if (e >= tab - 20 && e <= tab + 40) { x.push(e); y.push(scan.muRef![j]); } });
      if (x.length < 2) return [];
      const low = Math.min(...y), span = Math.max(...y) - low || 1;
      return [{ name: scan.name, color: SCAN_COLORS[i % SCAN_COLORS.length], x, y: y.map(value => (value - low) / span) }];
    });
  }, [done]);
  const stepAt = (scan: MuScan, e0: number) => { const i = scan.energy.findIndex(value => value >= e0); return i > 0 && i < scan.energy.length - 1 ? (scan.energy[i + 1] - scan.energy[i - 1]) / 2 : NaN; };

  return <>
    <div className="table-wrap"><table>
      <caption>Calibration of each scan{done.request.calibration ? <> to the {done.request.calibration.label} edge at <Num>{done.request.calibration.energy.toFixed(1)}</Num> <Unit>eV</Unit></> : ' (not calibrated)'}</caption>
      <thead><tr><th scope="col">Scan</th><th scope="col">Foil <Tex plain>{'E_0'}</Tex> (<Unit>eV</Unit>)</th><th scope="col">Shift (<Unit>eV</Unit>)</th><th scope="col">Grid step at <Tex plain>{'E_0'}</Tex> (<Unit>eV</Unit>)</th><th scope="col">Sample <Tex plain>{'E_0'}</Tex> (<Unit>eV</Unit>)</th></tr></thead>
      <tbody>{result.scans.map((scan, i) => <tr key={scan.name}><td>{scan.name}</td><td>{scan.e0Ref === null ? 'None' : <Num>{scan.e0Ref.toFixed(2)}</Num>}</td><td><Num>{signed(scan.shift)}</Num></td><td>{scan.e0Ref === null ? 'None' : <Num>{stepAt(done.scans[i], scan.e0Ref).toFixed(2)}</Num>}</td><td><Num>{scan.e0Sample.toFixed(2)}</Num></td></tr>)}</tbody>
    </table></div>
    {references.length > 0 && <Plot series={references} cursor={done.request.calibration!.energy} yLabel="Reference foil, scaled 0 to 1 in this window" yTex={'\\mu_{\\mathrm{ref}}\\ \\text{scaled to } [0, 1]'} yUnit="" exportName="measured-reference-foils" height={200} />}
    {references.length > 0 && <p className="muted">After the shift each foil curve should rise at the tabulated edge (dashed marker). Each curve is scaled to 0 to 1 inside this window for display only. The shift is only as fine as the energy grid at the foil edge.</p>}

    <h3>4. Merge</h3>
    {result.merged ? <>
      <label className="field-label merge-kind">Interpolation onto the first scan&rsquo;s grid<select value={mergeKind} onChange={event => onMergeKind(event.target.value as typeof mergeKind)}><option value="cubic">Cubic spline (Larch default)</option><option value="linear">Linear</option></select></label>
      <div className="two-col">
        <Plot series={result.scans.map((scan, i) => ({ name: scan.name, color: SCAN_COLORS[i % SCAN_COLORS.length], x: scan.energy, y: scan.mu }))} yLabel={muLabel} yTex={muTex} yUnit="" exportName="measured-scans" height={220} cursor={norm.e0} />
        <Plot series={[{ name: 'Spread across scans', color: '#ffc46b', x: result.merged.energy, y: result.merged.std.map(value => value / norm.edgeStep) }]} yLabel="Spread / edge step" yTex={'\\sigma(E)/\\Delta\\mu_0'} yUnit="" exportName="measured-spread" height={220} cursor={norm.e0} />
      </div>
      <p className="muted">Each calibrated scan is interpolated onto the first scan&rsquo;s energy grid and averaged; the grid stops one point before the end of the shortest scan (Larch <code>merge_groups</code>). The spread is the standard deviation across the <Num>{String(result.scans.length)}</Num> scans, dividing by <Tex plain>{'N'}</Tex> as Larch does, in units of the edge step. {result.spread !== null && <>Its median over the post-edge fit range is <Num>{result.spread.toPrecision(2)}</Num>. With few scans this is a rough noise estimate; it is not stored as an uncertainty and excludes calibration, thickness and self-absorption errors.</>}</p>
    </> : <p className="muted">One scan is selected, so nothing is merged. Load repeated scans of the same sample to merge them.</p>}

    <h3>5. Normalization</h3>
    <div className="param-grid">
      {PARAM_FIELDS.map(field => <label key={field.key} className="field-label"><span><Tex plain>{field.tex}</Tex>{field.key !== 'step' && <> (<Unit>eV</Unit>)</>}</span><input type="number" step="any" inputMode="decimal" aria-label={field.label} placeholder="Larch default" value={params[field.key]} onChange={event => onParams(current => ({ ...current, [field.key]: event.target.value }))} /><small className="muted">{field.hint}</small></label>)}
      <label className="field-label"><span>Post-edge degree <Tex plain>{'n_{\\mathrm{norm}}'}</Tex></span><select aria-label="nnorm" value={params.nnorm} onChange={event => onParams(current => ({ ...current, nnorm: event.target.value }))}><option value="">Larch default</option>{[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <label className="field-label"><span>Pre-edge exponent <Tex plain>{'n_{\\mathrm{vict}}'}</Tex></span><select aria-label="nvict" value={params.nvict} onChange={event => onParams(current => ({ ...current, nvict: event.target.value }))}>{[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
    </div>
    <div className="toolbar"><button className="button secondary small" onClick={() => onParams(BLANK_PARAMS)}>Reset to Larch defaults</button><span className="muted">Used: <Tex plain>{`E_0 = ${norm.e0.toFixed(2)}`}</Tex> <Unit>eV</Unit>, pre-edge <Num>{String(norm.pre1)}</Num> to <Num>{String(norm.pre2)}</Num> <Unit>eV</Unit>, post-edge <Num>{String(norm.norm1)}</Num> to <Num>{norm.norm2.toFixed(1)}</Num> <Unit>eV</Unit>, <Tex plain>{`n_{\\mathrm{norm}} = ${norm.nnorm},\\ n_{\\mathrm{vict}} = ${norm.nvict}`}</Tex>{norm.npre === 0 ? '; fewer than 3 points in the pre-edge range, so the pre-edge is a constant' : ''}.</span></div>
    <div className="metric-grid"><Metric label={<Tex plain>{'E_0'}</Tex>} value={norm.e0.toFixed(2)} unit=" eV" /><Metric label={<>Edge step <Tex plain>{'\\Delta\\mu_0'}</Tex></>} value={norm.edgeStep.toPrecision(4)} />{result.merged && <Metric label="Scans merged" value={String(result.scans.length)} />}</div>
    <div className="toolbar" role="group" aria-label="Measured data view">{([['mu', 'μ(E) with fit lines'], ['norm', 'Normalized'], ['flat', 'Flattened']] as const).map(([mode, text]) => <button key={mode} className={`button small ${view === mode ? '' : 'secondary'}`} aria-pressed={view === mode} onClick={() => onView(mode)}>{text}</button>)}</div>
    <Plot series={mainSeries} cursor={norm.e0} height={300} exportName={`measured-${view}`} yUnit=""
      yLabel={view === 'mu' ? muLabel : view === 'norm' ? 'Normalized μ(E) (dimensionless)' : 'Flattened μ(E) (dimensionless)'}
      yTex={view === 'mu' ? muTex : view === 'norm' ? '\\text{Normalized } \\mu(E)' : '\\text{Flattened } \\mu(E)'}
      bands={view === 'mu' ? [{ from: norm.e0 + norm.pre1, to: norm.e0 + norm.pre2, label: 'pre-edge' }, { from: norm.e0 + norm.norm1, to: norm.e0 + norm.norm2, label: 'post-edge' }] : []} />
    {view === 'mu' && <p className="muted">Shaded: the pre-edge and post-edge fit ranges. Dashed lines: the fitted pre-edge line and post-edge curve, extended over the whole scan. The marker is at <Tex plain>{'E_0'}</Tex>.</p>}
    <div className="equation"><Tex block>{'\\mu_{\\mathrm{norm}}(E) =\\frac{\\mu(E) - \\mu_{\\mathrm{pre}}(E)}{\\Delta\\mu_0}, \\qquad \\Delta\\mu_0 = \\mu_{\\mathrm{post}}(E_0) - \\mu_{\\mathrm{pre}}(E_0)'}</Tex></div>
    <Disclosure title="How the pre-edge line, post-edge curve and flattening are fitted">
      <p>The pre-edge line is a least-squares fit of <Tex plain>{'\\mu(E)\\,E^{n_{\\mathrm{vict}}} = a + bE'}</Tex> over <Tex plain>{'[E_0 + \\text{pre1},\\ E_0 + \\text{pre2})'}</Tex>, so <Tex plain>{'\\mu_{\\mathrm{pre}}(E) = (a + bE)\\,E^{-n_{\\mathrm{vict}}}'}</Tex>. The post-edge curve adds a polynomial of degree <Tex plain>{'n_{\\mathrm{norm}}'}</Tex> fitted to <Tex plain>{'\\mu - \\mu_{\\mathrm{pre}}'}</Tex> over <Tex plain>{'[E_0 + \\text{norm1},\\ E_0 + \\text{norm2})'}</Tex>. Both are evaluated at the grid point nearest <Tex plain>{'E_0'}</Tex> to give the edge step.</p>
      <p>Above <Tex plain>{'E_0'}</Tex> the flattened curve removes the shape of the post-edge curve: <Tex plain>{'\\mu_{\\mathrm{flat}} = \\mu_{\\mathrm{norm}} - r(E) + r(E_0)'}</Tex> with <Tex plain>{'r = (\\mu_{\\mathrm{post}} - \\mu_{\\mathrm{pre}})/\\Delta\\mu_0'}</Tex>. This is Larch&rsquo;s <code>flat</code>; its quadratic alternative <code>flat_alt</code> is not computed.</p>
      <p>Larch defaults when a field is blank: <Tex plain>{'E_0'}</Tex> from <code>find_e0</code>; pre1 is the second energy point relative to <Tex plain>{'E_0'}</Tex>, rounded to <Num>5</Num> <Unit>eV</Unit> (to <Num>2</Num> <Unit>eV</Unit> when <Tex plain>{'E_0'}</Tex> is within the first <Num>21</Num> points), and pre2 is half of it; norm2 is the last energy relative to <Tex plain>{'E_0'}</Tex>, rounded to <Num>5</Num> <Unit>eV</Unit> and kept inside the data; norm1 is the smaller of <Num>25</Num> <Unit>eV</Unit> and norm2/15 rounded to <Num>5</Num> <Unit>eV</Unit>; <Tex plain>{'n_{\\mathrm{norm}}'}</Tex> is <Num>2</Num>, or <Num>1</Num> when the post-edge range is shorter than <Num>300</Num> <Unit>eV</Unit>, or <Num>0</Num> below <Num>30</Num> <Unit>eV</Unit>. An <Tex plain>{'E_0'}</Tex> outside the data is replaced by <code>find_e0</code>.</p>
      <p>The browser code is a port of xraylarch {LARCH_PORT_VERSION}. Unit tests compare it with Larch output for the example files: <Tex plain>{'E_0'}</Tex> and the fit ranges agree exactly, and normalized values agree to about <Tex plain>{'10^{-11}'}</Tex>.</p>
    </Disclosure>
    {result.warnings.map(warning => <p key={warning} className="callout" role="status"><ScienceText>{warning}</ScienceText></p>)}

    <h3>6. Save and export</h3>
    <label className="field-label">Curve name<input value={name} maxLength={150} onChange={event => onName(event.target.value)} /></label>
    <div className="toolbar">
      <button className="button" onClick={() => onSave('normalized')}><Plus size={16} />Save normalized curve</button>
      <button className="button secondary" onClick={() => onSave('flattened')}><Plus size={16} />Save flattened curve</button>
      <button className="button secondary small" onClick={() => download(`${safeName(name)}-processing.json`, JSON.stringify(processingRecord(done.sources, done.request, result, done.scans), null, 2))}><Download size={14} />Processing record</button>
      <button className="button secondary small" onClick={() => download(`${safeName(name)}-larch.py`, larchScript(done.sources.map(source => ({ name: source.table.name, format: source.table.format, mapping: source.mapping })), done.request, result), 'text/x-python')}><Download size={14} />Larch script</button>
    </div>
    {done.request.calibration && done.request.calibration.label !== sampleEdge && <p className="callout" role="status">The lab sample is set to the {sampleEdge} edge, so the live curve and the scores cover a different energy range. To compare with the model, choose a sample with the {done.request.calibration.label} edge on the <Link href="/crystal/">Sample page</Link>. Saved curves are kept while you move between pages, until you reload.</p>}
    <p className="muted">Saved curves appear with the other curves (the buttons above the Measured data panel and Saved curves under Data tools), so you can overlay, score and fit them. They are dimensionless, marked as normalized or flattened, and keep the processing record in their notes. The Larch script repeats these steps with xraylarch on your own computer, for a record that does not depend on this site.</p>
  </>;
}

export function MeasuredData({ onSaved }: { onSaved: (spectrum: Spectrum) => void }) {
  const { state, notify } = useLab();
  const [files, setFiles] = useState<Loaded[]>([]);
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({});
  const [guesses, setGuesses] = useState<Record<string, ColumnGuess>>({});
  const [calibrate, setCalibrate] = useState(true);
  const [element, setElement] = useState(state.sample.absorber);
  const [edge, setEdge] = useState(state.sample.edge);
  const [mergeKind, setMergeKind] = useState<'cubic' | 'linear'>('cubic');
  const [params, setParams] = useState(BLANK_PARAMS);
  const [view, setView] = useState<'mu' | 'norm' | 'flat'>('mu');
  const [done, setDone] = useState<Done | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(''), [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const worker = useRef<Worker | null>(null), requestId = useRef(0);
  useEffect(() => () => worker.current?.terminate(), []);

  const included = files.filter(file => file.include);
  const layouts = useMemo(() => {
    const groups = new Map<string, Loaded[]>();
    for (const file of files.filter(item => item.include)) groups.set(layoutKey(file.table), [...(groups.get(layoutKey(file.table)) ?? []), file]);
    return [...groups.entries()];
  }, [files]);
  const prepared = useMemo(() => {
    const sources: SourceFile[] = [], scans: MuScan[] = [], problems: string[] = [];
    for (const file of files.filter(item => item.include)) {
      const mapping = mappings[layoutKey(file.table)];
      try { scans.push(muFromTable(file.table, mapping)); sources.push({ table: file.table, mapping, sha256: file.sha256, example: file.example }); }
      catch (issue) { problems.push(errorText(issue)); }
    }
    return { sources, scans, problems };
  }, [files, mappings]);
  const edgeOptions = useMemo(() => { try { return elementInfo(element).edges; } catch { return []; } }, [element]);
  const target = useMemo(() => {
    const found = edgeOptions.find(item => item.edge === edge);
    return found ? { label: `${element} ${edge}`, energy: found.energy_eV } : null;
  }, [edgeOptions, element, edge]);
  const preEdge = useMemo(() => {
    const out: PreEdgeParams = {}, bad: string[] = [];
    for (const field of PARAM_FIELDS) {
      const text = params[field.key].trim();
      if (!text) continue;
      const value = Number(text);
      if (Number.isFinite(value)) out[field.key] = value; else bad.push(field.label);
    }
    if (params.nnorm !== '') out.nnorm = Number(params.nnorm);
    out.nvict = Number(params.nvict);
    return { out, bad };
  }, [params]);
  const missingReference = calibrate && prepared.scans.some(scan => !scan.muRef);
  const blocked = !prepared.scans.length ? 'Choose at least one file.' : prepared.problems.length ? prepared.problems.join(' ')
    : missingReference ? 'Calibration needs It and Iref in every file. Map them, or turn calibration off.'
    : calibrate && !target ? 'Choose the element and edge of the reference foil.'
    : preEdge.bad.length ? `Enter a number or leave blank: ${preEdge.bad.join(', ')}.` : '';

  useEffect(() => {
    if (blocked) { requestId.current++; setBusy(false); setDone(null); return; }
    const settings: Omit<ReductionRequest, 'scans'> = { calibration: calibrate ? target : null, merge: mergeKind, preEdge: preEdge.out };
    const { scans, sources } = prepared, id = ++requestId.current;
    const timer = setTimeout(() => {
      setBusy(true);
      try {
        const current = worker.current ?? new Worker(new URL('../workers/reduction.worker.ts', import.meta.url));
        worker.current = current;
        current.onmessage = (event: MessageEvent<{ id: number; result?: ReductionResult; error?: string }>) => {
          if (event.data.id !== requestId.current) return;
          setBusy(false);
          if (event.data.result) { setError(''); setDone({ result: event.data.result, request: settings, scans, sources }); }
          else { setDone(null); setError(event.data.error ?? 'The scans could not be processed.'); }
        };
        current.onerror = () => { setBusy(false); setDone(null); setError('The processing worker stopped. Your files are still listed; change a setting to try again.'); current.terminate(); worker.current = null; };
        current.postMessage({ id, request: { ...settings, scans } });
      } catch (issue) { setBusy(false); setError(errorText(issue)); }
    }, 250);
    return () => clearTimeout(timer);
  }, [blocked, prepared, calibrate, target, mergeKind, preEdge]);

  function addFiles(items: { name: string; text: string; sha256?: string; example: boolean }[], replace = false) {
    const added: Loaded[] = [], problems: string[] = [];
    for (const item of items) {
      try { added.push({ id: newId(), table: parseBeamlineFile(item.text, item.name), include: true, sha256: item.sha256, example: item.example }); }
      catch (issue) { problems.push(errorText(issue)); }
    }
    setLoadError(problems.join(' '));
    if (!added.length) return;
    setFiles(current => [...(replace ? [] : current), ...added].slice(-MAX_FILES));
    setMappings(current => { const next = { ...current }; for (const file of added) next[layoutKey(file.table)] ??= stripGuess(guessColumns(file.table)); return next; });
    setGuesses(current => { const next = { ...current }; for (const file of added) next[layoutKey(file.table)] ??= guessColumns(file.table); return next; });
    const declared = added.map(file => declaredEdge(file.table)).find(Boolean);
    if (declared) { setElement(declared.element); setEdge(declared.edge); }
    const first = added[0].table;
    if (replace || !name) setName((first.format === 'xdi' ? metadataField(first, 'Sample.name') : undefined) ?? fileBase(first.name));
    if (replace) { setDone(null); setParams(BLANK_PARAMS); }
  }
  async function openFiles(event: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(event.target.files ?? []); event.target.value = '';
    if (!list.length) return;
    setReading(true);
    try {
      const tooBig = list.filter(file => file.size > MAX_BEAMLINE_BYTES).map(file => file.name);
      const items = await Promise.all(list.filter(file => file.size <= MAX_BEAMLINE_BYTES).map(async file => {
        const bytes = await file.arrayBuffer();
        return { name: file.name, text: new TextDecoder('utf-8').decode(bytes), sha256: await sha256(bytes), example: false };
      }));
      addFiles(items);
      if (tooBig.length) setLoadError(`Larger than 5 MB, not read: ${tooBig.join(', ')}.`);
    } catch (issue) { setLoadError(errorText(issue)); }
    finally { setReading(false); }
  }
  async function loadExample(which: 'fe' | 'cu') {
    setReading(true);
    try {
      const { default: examples } = await import('@/data/xas-reduction/examples.json');
      const chosen = which === 'fe' ? examples.files.slice(0, 3) : examples.files.slice(3, 4);
      addFiles(chosen.map(file => ({ name: file.name, text: file.text, example: true })), true);
      if (which === 'cu') { setElement('Cu'); setEdge('K'); }   // column text carries no element field
      notify(which === 'fe' ? 'Loaded three synthetic Fe K transmission scans.' : 'Loaded a synthetic Cu K fluorescence scan.');
    } catch (issue) { setLoadError(errorText(issue)); }
    finally { setReading(false); }
  }
  function save(quantity: 'normalized' | 'flattened') {
    if (!done) return;
    try {
      const notes = processingNotes(done.sources, done.request, done.result, done.scans);
      const label = (name.trim() || 'Measured data') + (done.result.merged ? ` · ${done.result.scans.length} scans merged` : '') + ` · ${quantity}`;
      const curve = validateSpectrum(savedCurve(done.result, quantity, { id: newId(), name: label, sources: done.sources, notes, calibration: done.request.calibration }));
      onSaved(curve);
      notify(`Saved "${curve.name}" to your curves.`);
    } catch (issue) { setError(errorText(issue)); }
  }

  return <section className="panel measured" aria-labelledby="measured-title">
    <div className="panel-head"><div><span className="eyebrow">Beamline files to normalized <Tex plain>{'\\mu(E)'}</Tex></span><h2 id="measured-title">Measured data</h2></div></div>
    <p>Turn raw beamline files into calibrated, merged and normalized spectra, with the same steps and defaults as xraylarch (<code>find_e0</code>, <code>merge_groups</code>, <code>pre_edge</code>). Files are read by this browser tab and never uploaded.</p>

    <h3>1. Files</h3>
    <div className="toolbar">
      <label className="button"><Upload size={16} />{reading ? 'Reading files…' : 'Open beamline files'}<input type="file" multiple disabled={reading} onChange={openFiles} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} aria-label="Open beamline files (XDI or column text)" /></label>
      <button className="button secondary" disabled={reading} onClick={() => loadExample('fe')}>Fe K example: 3 transmission scans</button>
      <button className="button secondary" disabled={reading} onClick={() => loadExample('cu')}>Cu K example: fluorescence</button>
    </div>
    <p className="muted">XDI 1.0, or text with comment lines (<code>#</code> <code>;</code> <code>%</code> <code>!</code>) followed by columns of numbers. Up to {MAX_FILES} files of 5 <Unit>MB</Unit> and 20,000 rows each. The examples are synthetic, made from model curves with counting noise, and replace the loaded files.</p>
    {loadError && <p className="callout" role="alert"><ScienceText>{loadError}</ScienceText></p>}
    {files.length > 0 && <div className="table-wrap"><table>
      <caption>Loaded files. Unchecked files are left out of the merge.</caption>
      <thead><tr><th scope="col">Use</th><th scope="col">File</th><th scope="col">Rows</th><th scope="col">Columns</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>{files.map(file => <tr key={file.id}>
        <td><input type="checkbox" checked={file.include} aria-label={`Use ${file.table.name}`} onChange={event => setFiles(current => current.map(item => item.id === file.id ? { ...item, include: event.target.checked } : item))} /></td>
        <td>{file.table.name}<small>{file.table.format === 'xdi' ? file.table.version : 'Column text'}{file.example ? ', synthetic example' : ''}</small></td>
        <td><Num>{String(file.table.columns[0].length)}</Num>{file.table.paddedRows > 0 && <small>{file.table.paddedRows} short rows padded</small>}</td>
        <td>{file.table.labels.join(', ')}</td>
        <td><button className="icon-button" aria-label={`Remove ${file.table.name}`} onClick={() => setFiles(current => current.filter(item => item.id !== file.id))}><Trash2 size={15} /></button></td>
      </tr>)}</tbody>
    </table></div>}

    {included.length > 0 && <>
      <h3>2. Columns and <Tex plain>{'\\mu(E)'}</Tex></h3>
      {layouts.map(([key, group]) => mappings[key] && guesses[key] && <MappingEditor key={key} files={group} mapping={mappings[key]} guess={guesses[key]} onChange={mapping => setMappings(current => ({ ...current, [key]: mapping }))} />)}
      {prepared.scans.some(scan => scan.removed.nonFinite || scan.removed.repeated || scan.removed.reordered) && <ul className="muted">{prepared.scans.map(scan => {
        const parts = [scan.removed.nonFinite && `${scan.removed.nonFinite} rows with undefined values (zero or negative counts) removed`, scan.removed.repeated && `${scan.removed.repeated} rows with a repeated energy removed`, scan.removed.reordered && 'rows sorted by energy'].filter(Boolean);
        return parts.length ? <li key={scan.name}>{scan.name}: {parts.join('; ')}.</li> : null;
      })}</ul>}

      <h3>3. Energy calibration</h3>
      <label className="check-control"><input type="checkbox" checked={calibrate} onChange={event => setCalibrate(event.target.checked)} />Calibrate each scan with its reference foil</label>
      {calibrate && <div className="param-grid">
        <label className="field-label">Foil element<select value={element} onChange={event => { const symbol = event.target.value; setElement(symbol); try { const first = elementInfo(symbol).edges; setEdge(first.find(item => item.edge === 'K' && item.energy_eV > 100)?.edge ?? first[0]?.edge ?? 'K'); } catch { /* the edge list stays empty */ } }}>{ELEMENT_SYMBOLS.map(symbol => <option key={symbol} value={symbol}>{symbol}</option>)}</select></label>
        <label className="field-label">Edge<select value={edge} onChange={event => setEdge(event.target.value)}>{edgeOptions.map(item => <option key={item.edge} value={item.edge}>{item.edge}, {item.energy_eV.toFixed(1)} eV</option>)}</select></label>
      </div>}
      <p className="muted">{calibrate ? <>For each scan, <Tex plain>{'E_{0,\\mathrm{ref}}'}</Tex> of the foil is the energy of the largest <Tex plain>{'d\\mu_{\\mathrm{ref}}/dE'}</Tex> (Larch <code>find_e0</code>, a grid point). The shift <Tex plain>{'\\Delta E = E_{\\mathrm{tab}} - E_{0,\\mathrm{ref}}'}</Tex> moves it to the tabulated edge (XrayDB, Elam, Ravel and Sieber 2002) and is added to the sample energies of the same scan. The tabulated value is a convention; some laboratories use other foil values.</> : 'Energies are used as recorded.'}</p>

      {blocked && <p className="callout" role="status"><ScienceText>{blocked}</ScienceText></p>}
      {error && !blocked && <p className="callout" role="alert"><ScienceText>{error}</ScienceText></p>}
      {busy && <p className="muted" role="status">Processing in a background worker…</p>}

      {done && <MeasuredResults done={done} view={view} onView={setView} params={params} onParams={setParams} mergeKind={mergeKind} onMergeKind={setMergeKind} name={name} onName={setName} onSave={save} sampleEdge={`${state.sample.absorber} ${state.sample.edge}`} />}
    </>}
  </section>;
}
