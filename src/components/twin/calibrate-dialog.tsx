'use client';
import { cloneElement, isValidElement, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { download } from '../ui';
import { Num, Tex, Unit } from '../tex';
import {
  calibrateText, generateMysteryInstrument, profileFromJson, profileToJson, validateTwinProfile,
  type CalibrationOverrides, type CalibrationReport, type CalibrationResult, type MysteryInstrument, type MysteryTruth,
} from '@/lib/twin/calibrate';
import type { ChamberGas, TwinProfile } from '@/lib/twin/types';
import { TexProse } from './tex-prose';
import { useTwin } from './twin-store';

const cloneProfile = (profile: TwinProfile): TwinProfile => JSON.parse(JSON.stringify(profile)) as TwinProfile;
const GAS: ChamberGas[] = ['N2', 'He', 'Ar', 'Kr'];

/** A labelled field; its control is named after the label, which also lets the browser tell the fields apart. */
function Field({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  const control = isValidElement<{ name?: string }>(children) ? cloneElement(children, { name: label.toLowerCase().replace(/[^a-z0-9]+/g, '-') }) : children;
  return <label className="twin-profile-field"><span>{label}{unit && <small><Unit>{unit}</Unit></small>}</span>{control}</label>;
}

function Numeric({ value, min, max, step = 'any', name, onChange }: { value: number; min: number; max: number; step?: number | 'any'; name?: string; onChange: (value: number) => void }) {
  return <><input type="number" name={name} value={String(value)} min={min} max={max} step={step} title={`Allowed range: ${min} to ${max}`} onChange={event => onChange(Number(event.target.value))} /><small className="twin-field-range">Range <Num>{String(min)}</Num> to <Num>{String(max)}</Num></small></>;
}

function OptionalNumeric({ value, min, max, step = 'any', placeholder, name, onChange }: { value?: number; min: number; max: number; step?: number | 'any'; placeholder: string; name?: string; onChange: (value: number | undefined) => void }) {
  return <><input type="number" name={name} value={value ?? ''} min={min} max={max} step={step} placeholder={placeholder} title={`Allowed range: ${min} to ${max}`} onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))} /><small className="twin-field-range">Range <Num>{String(min)}</Num> to <Num>{String(max)}</Num></small></>;
}

function ProfileEditor({ profile, onChange }: { profile: TwinProfile; onChange: (profile: TwinProfile) => void }) {
  const edit = (change: (draft: TwinProfile) => void) => { const draft = cloneProfile(profile); change(draft); onChange(draft); };
  return <div className="twin-profile-editor">
    <fieldset><legend>Profile</legend><div className="twin-profile-grid">
      <Field label="Format"><input value={profile.format} readOnly /></Field>
      <Field label="Name"><input value={profile.name} onChange={event => edit(p => { p.name = event.target.value; })} /></Field>
      <Field label="Preset id"><input value={profile.preset} onChange={event => edit(p => { p.preset = event.target.value; })} /></Field>
    </div></fieldset>

    <fieldset><legend>Source</legend><div className="twin-profile-grid">
      <Field label="Kind"><select value={profile.source.kind} onChange={event => edit(p => {
        p.source.kind = event.target.value as TwinProfile['source']['kind'];
        if (p.source.kind === 'undulator') { p.source.undulator ??= { period_mm: 27, periods: 74, K: 2 }; delete p.source.field_T; }
        else { p.source.field_T ??= 1; delete p.source.undulator; }
      })}><option value="bending-magnet">Bending magnet</option><option value="undulator">Undulator</option></select></Field>
      <Field label="Ring energy" unit="GeV"><Numeric value={profile.source.ring_GeV} min={0.1} max={10} onChange={value => edit(p => { p.source.ring_GeV = value; })} /></Field>
      <Field label="Ring current" unit="mA"><Numeric value={profile.source.current_mA} min={1} max={500} onChange={value => edit(p => { p.source.current_mA = value; })} /></Field>
      {profile.source.kind === 'bending-magnet' && <Field label="Magnetic field" unit="T"><Numeric value={profile.source.field_T ?? 1} min={0.01} max={3} onChange={value => edit(p => { p.source.field_T = value; })} /></Field>}
      <Field label="Horizontal acceptance" unit="mrad"><Numeric value={profile.source.hAccept_mrad} min={0.001} max={10} onChange={value => edit(p => { p.source.hAccept_mrad = value; })} /></Field>
      <Field label="Vertical divergence" unit="μrad"><Numeric value={profile.source.vDiv_urad} min={0.1} max={1000} onChange={value => edit(p => { p.source.vDiv_urad = value; })} /></Field>
      {profile.source.kind === 'undulator' && profile.source.undulator && <>
        <Field label="Undulator period" unit="mm"><Numeric value={profile.source.undulator.period_mm} min={5} max={100} onChange={value => edit(p => { p.source.undulator!.period_mm = value; })} /></Field>
        <Field label="Undulator periods"><Numeric value={profile.source.undulator.periods} min={1} max={500} step={1} onChange={value => edit(p => { p.source.undulator!.periods = value; })} /></Field>
        <Field label="Undulator K"><Numeric value={profile.source.undulator.K} min={0} max={5} onChange={value => edit(p => { p.source.undulator!.K = value; })} /></Field>
      </>}
    </div></fieldset>

    <fieldset><legend>Mirrors</legend>{profile.mirrors.map((mirror, index) => <div className="twin-profile-row" key={`${mirror.id}-${index}`}>
      <Field label="Id"><input value={mirror.id} onChange={event => edit(p => { p.mirrors[index].id = event.target.value; })} /></Field>
      <Field label="Role"><select value={mirror.role} onChange={event => edit(p => { p.mirrors[index].role = event.target.value as typeof mirror.role; })}><option value="collimating">Collimating</option><option value="focusing">Focusing</option><option value="harmonic-rejection">Harmonic rejection</option></select></Field>
      <Field label="Coating"><select value={mirror.coating} onChange={event => edit(p => { p.mirrors[index].coating = event.target.value as typeof mirror.coating; })}>{['Si', 'Rh', 'Pt', 'Ni'].map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Angle" unit="mrad"><Numeric value={mirror.angle_mrad} min={0.1} max={20} onChange={value => edit(p => { p.mirrors[index].angle_mrad = value; })} /></Field>
      <label className="twin-check"><input type="checkbox" checked={mirror.inserted} onChange={event => edit(p => { p.mirrors[index].inserted = event.target.checked; })} />Inserted</label>
    </div>)}</fieldset>

    <fieldset><legend>Monochromator</legend><div className="twin-profile-grid">
      <Field label="Crystal"><select value={profile.mono.crystal} onChange={event => edit(p => { p.mono.crystal = event.target.value as typeof profile.mono.crystal; })}>{['Si111', 'Si311', 'Si220'].map(value => <option key={value} value={value}>{value.replace(/^Si(\d+)$/, 'Si($1)')}</option>)}</select></Field>
      <Field label="Energy correction" unit="eV"><Numeric value={profile.mono.offset_eV} min={-100} max={100} onChange={value => edit(p => { p.mono.offset_eV = value; })} /></Field>
      <Field label="Detune fraction"><Numeric value={profile.mono.detune} min={0} max={1} step={0.01} onChange={value => edit(p => { p.mono.detune = value; })} /></Field>
      <Field label="Glitch seed"><Numeric value={profile.mono.glitchSeed} min={0} max={4294967295} step={1} onChange={value => edit(p => { p.mono.glitchSeed = value; })} /></Field>
    </div></fieldset>

    <fieldset><legend>Ion chambers</legend>{profile.chambers.map((chamber, index) => <div className="twin-profile-row twin-profile-chamber" key={index}>
      <Field label="Channel"><select value={chamber.id} onChange={event => edit(p => { p.chambers[index].id = event.target.value as typeof chamber.id; })}><option value="I0">I₀</option><option value="It">Iₜ</option><option value="Iref">Iref</option></select></Field>
      <Field label="Length" unit="cm"><Numeric value={chamber.length_cm} min={1} max={100} onChange={value => edit(p => { p.chambers[index].length_cm = value; })} /></Field>
      <Field label="Gain" unit="V/A"><Numeric value={chamber.gain_V_per_A} min={1e3} max={1e11} onChange={value => edit(p => { p.chambers[index].gain_V_per_A = value; })} /></Field>
      <Field label="Dark current" unit="A"><Numeric value={chamber.dark_A} min={-1e-6} max={1e-6} onChange={value => edit(p => { p.chambers[index].dark_A = value; })} /></Field>
      {GAS.map(gas => <Field key={gas} label={`${gas} fraction`}><Numeric value={chamber.gas[gas] ?? 0} min={0} max={1} step={0.01} onChange={value => edit(p => { p.chambers[index].gas[gas] = value; })} /></Field>)}
    </div>)}</fieldset>

    <fieldset><legend>Fluorescence detector</legend><div className="twin-profile-grid">
      <Field label="Elements"><Numeric value={profile.sdd.elements} min={1} max={128} step={1} onChange={value => edit(p => { p.sdd.elements = value; })} /></Field>
      <Field label="Distance" unit="mm"><Numeric value={profile.sdd.distance_mm} min={5} max={5000} onChange={value => edit(p => { p.sdd.distance_mm = value; })} /></Field>
      <Field label="Area per element" unit="mm^2"><Numeric value={profile.sdd.area_mm2} min={0.01} max={10000} onChange={value => edit(p => { p.sdd.area_mm2 = value; })} /></Field>
      <Field label="Peaking time" unit="μs"><Numeric value={profile.sdd.peaking_us} min={0.05} max={32} onChange={value => edit(p => { p.sdd.peaking_us = value; })} /></Field>
      <Field label="ROI lower energy" unit="eV"><Numeric value={profile.sdd.roi_eV[0]} min={0} max={100000} onChange={value => edit(p => { p.sdd.roi_eV[0] = value; })} /></Field>
      <Field label="ROI upper energy" unit="eV"><Numeric value={profile.sdd.roi_eV[1]} min={0} max={100000} onChange={value => edit(p => { p.sdd.roi_eV[1] = value; })} /></Field>
      <Field label="Exit angle" unit="°"><Numeric value={profile.sdd.exitAngle_deg} min={1} max={90} onChange={value => edit(p => { p.sdd.exitAngle_deg = value; })} /></Field>
      <label className="twin-check"><input type="checkbox" checked={profile.sdd.soller} onChange={event => edit(p => { p.sdd.soller = event.target.checked; })} />Soller slits</label>
      <label className="twin-check"><input type="checkbox" checked={!!profile.sdd.filter} onChange={event => edit(p => { p.sdd.filter = event.target.checked ? { formula: 'Al', density: 2.7, thickness_um: 25 } : undefined; })} />Detector filter</label>
      {profile.sdd.filter && <>
        <Field label="Filter formula"><input value={profile.sdd.filter.formula} onChange={event => edit(p => { p.sdd.filter!.formula = event.target.value; })} /></Field>
        <Field label="Filter density" unit="g/cm^3"><Numeric value={profile.sdd.filter.density} min={1e-6} max={30} onChange={value => edit(p => { p.sdd.filter!.density = value; })} /></Field>
        <Field label="Filter thickness" unit="μm"><Numeric value={profile.sdd.filter.thickness_um} min={0.001} max={1e5} onChange={value => edit(p => { p.sdd.filter!.thickness_um = value; })} /></Field>
      </>}
    </div></fieldset>

    <fieldset><legend>Beam and stability</legend><div className="twin-profile-grid">
      <Field label="Horizontal beam FWHM" unit="μm"><Numeric value={profile.beam_um[0]} min={1} max={10000} onChange={value => edit(p => { p.beam_um[0] = value; })} /></Field>
      <Field label="Vertical beam FWHM" unit="μm"><Numeric value={profile.beam_um[1]} min={1} max={10000} onChange={value => edit(p => { p.beam_um[1] = value; })} /></Field>
      <Field label="I0 relative noise"><Numeric value={profile.stability.i0Noise} min={0} max={0.2} step={0.0001} onChange={value => edit(p => { p.stability.i0Noise = value; })} /></Field>
      <Field label="Energy drift" unit="eV/h"><Numeric value={profile.stability.drift_eV_per_h} min={-20} max={20} onChange={value => edit(p => { p.stability.drift_eV_per_h = value; })} /></Field>
    </div></fieldset>
  </div>;
}

function resultDigits(result: CalibrationResult) {
  return result.kind === 'harmonic-fraction' ? 3 : result.kind === 'dead-time' ? 4 : 3;
}

/** Two significant figures when the uncertainty is below the value's last shown digit, so it never reads as zero. */
const uncertaintyText = (u: number, digits: number) => u === 0 || u >= 10 ** -digits ? u.toFixed(digits) : u.toPrecision(2);

function ResultTable({ results }: { results: CalibrationResult[] }) {
  return <table className="twin-calibration-results"><thead><tr><th scope="col">Quantity</th><th scope="col">Fit</th><th scope="col">Verdict</th></tr></thead><tbody>
    {results.map(result => <tr key={result.kind}><th scope="row">{result.kind === 'dead-time' ? <Tex plain>{'\\tau'}</Tex> : result.label}</th><td><Num>{result.value.toFixed(resultDigits(result))}</Num> <Tex plain>{'\\pm'}</Tex> <Num>{Number.isFinite(result.uncertainty) ? uncertaintyText(result.uncertainty, resultDigits(result)) : 'not estimated'}</Num> <Unit>{result.unit === 'us' ? 'μs' : result.unit}</Unit></td><td><TexProse>{result.verdict}</TexProse><details><summary>Method</summary><p><TexProse>{result.method}</TexProse></p></details></td></tr>)}
  </tbody></table>;
}

/** Calibration workflow and full profile editor, kept inside the existing console dialog style. */
export function CalibrateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null), profileInput = useRef<HTMLInputElement>(null);
  const { store: { twin, view }, dispatch } = useTwin();
  const [page, setPage] = useState<'calibrate' | 'profile'>('calibrate');
  const [draft, setDraft] = useState(() => cloneProfile(twin.profile));
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [truth, setTruth] = useState<MysteryTruth | null>(null);
  const [mysteryFile, setMysteryFile] = useState<MysteryInstrument | null>(null);
  const [message, setMessage] = useState('');
  const [seed, setSeed] = useState(twin.seed);
  const [overrides, setOverrides] = useState<CalibrationOverrides>({});
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) { setDraft(cloneProfile(twin.profile)); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open, twin.profile]);

  const analyse = (value: string, name: string, mysteryTruth: MysteryTruth | null = null) => {
    try {
      const next = calibrateText(value, twin, overrides, name);
      setReport(next); setTruth(mysteryTruth); setMessage(`${next.results.length} calibration fits completed.`);
    } catch (error) { setReport(null); setTruth(null); setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const loadCalibration = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    analyse(await file.text(), file.name); event.target.value = '';
  };
  const tryMystery = () => {
    try {
      const mystery = generateMysteryInstrument(twin, seed);
      setMysteryFile(mystery);
      analyse(mystery.text, mystery.filename, mystery.truth);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const applyResults = () => {
    if (!report) return;
    const offset = report.results.find(result => result.kind === 'energy-offset');
    const tau = report.results.find(result => result.kind === 'dead-time');
    // Rounded to 1 meV and 0.1 ns, well inside the fit uncertainties, so the profile holds readable numbers.
    const offset_eV = offset && Number(offset.value.toFixed(3)), peaking_us = tau && Number(tau.value.toFixed(4));
    if (offset_eV !== undefined) dispatch({ type: 'command', command: { type: 'monoOffset', offset_eV } });
    if (peaking_us !== undefined) dispatch({ type: 'command', command: { type: 'sdd', patch: { peaking_us } } });
    // The profile editor shows a draft taken when the dialog opened; carry the applied values into it too.
    setDraft(current => {
      const next = cloneProfile(current);
      if (offset_eV !== undefined) next.mono.offset_eV = offset_eV;
      if (peaking_us !== undefined) next.sdd.peaking_us = peaking_us;
      return next;
    });
    setMessage(`Applied ${[offset && 'energy correction', tau && 'processor dead time'].filter(Boolean).join(' and ')} to the profile.`);
  };
  const loadProfile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { setDraft(profileFromJson(await file.text())); setMessage(`${file.name} passed profile validation.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    event.target.value = '';
  };
  const applyProfile = () => {
    try {
      const profile = validateTwinProfile(draft);
      dispatch({ type: 'load', twin: { ...twin, profile }, locked: view.locked, note: `Instrument profile loaded: ${profile.name}.` });
      setMessage(`Applied profile ${profile.name}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const mysteryGrade = truth && report ? report.results.map(result => {
    const target = result.kind === 'energy-offset' ? truth.energyOffset_eV : result.kind === 'harmonic-fraction' ? 100 * truth.harmonicFraction : result.kind === 'dead-time' ? truth.deadTime_us : null;
    if (target === null) return null;
    const tolerance = result.kind === 'energy-offset' ? 0.05 : result.kind === 'harmonic-fraction' ? Math.abs(target) * 0.1 : Math.abs(target) * 0.05;
    return { kind: result.kind, pass: Math.abs(result.value - target) <= tolerance };
  }).filter(Boolean) as { kind: string; pass: boolean }[] : [];

  return <dialog ref={dialog} className="twin-dialog twin-calibrate-dialog" aria-labelledby="twin-calibrate-title" onClose={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="twin-dialog-body">
      <div className="twin-section-head"><h2 id="twin-calibrate-title">Calibrate from data</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
      <div className="twin-switch" role="group" aria-label="Calibration dialog view"><button type="button" aria-pressed={page === 'calibrate'} onClick={() => setPage('calibrate')}>Data fits</button><button type="button" aria-pressed={page === 'profile'} onClick={() => setPage('profile')}>Profile editor</button></div>
      {page === 'calibrate' ? <>
        <p className="twin-dialog-copy">Load XDI or named plain columns. Files stay in this browser. Blank fields use XDI metadata, then the current twin where applicable. The energy result is the correction added to recorded energies.</p>
        <div className="twin-calibration-inputs">
          <Field label="Tabulated reference edge" unit="eV"><OptionalNumeric value={overrides.tabulatedEdge_eV} min={100} max={100000} placeholder="From XDI" onChange={value => setOverrides(current => ({ ...current, tabulatedEdge_eV: value }))} /></Field>
          <Field label="Sample formula"><input value={overrides.formula ?? ''} placeholder={`From XDI or ${twin.sample.formula}`} onChange={event => setOverrides(current => ({ ...current, formula: event.target.value || undefined }))} /></Field>
          <Field label="Sample density" unit="g/cm^3"><OptionalNumeric value={overrides.density_g_cm3} min={1e-6} max={30} placeholder={`From XDI or ${twin.sample.density}`} onChange={value => setOverrides(current => ({ ...current, density_g_cm3: value }))} /></Field>
          <Field label="Sample thickness" unit="μm"><OptionalNumeric value={overrides.thickness_um} min={0.001} max={1e5} placeholder={`From XDI or ${twin.sample.thickness_um}`} onChange={value => setOverrides(current => ({ ...current, thickness_um: value }))} /></Field>
          <Field label="SDD elements"><OptionalNumeric value={overrides.elements} min={1} max={128} step={1} placeholder={`From XDI or ${twin.profile.sdd.elements}`} onChange={value => setOverrides(current => ({ ...current, elements: value }))} /></Field>
        </div>
        <div className="twin-dialog-actions">
          <input ref={fileInput} name="calibration-file" className="sr-only" type="file" accept=".xdi,.txt,.dat,.csv,text/plain" aria-label="Calibration data file" onChange={loadCalibration} />
          <button type="button" className="button cta" onClick={() => fileInput.current?.click()}><Upload size={15} aria-hidden="true" />Load data file</button>
          <Field label="Mystery seed"><Numeric value={seed} min={0} max={4294967295} step={1} onChange={setSeed} /></Field>
          <button type="button" className="button secondary small" onClick={tryMystery}>Try mystery instrument</button>
          {mysteryFile && <button type="button" className="button secondary small" onClick={() => download(mysteryFile.filename, mysteryFile.text, 'text/plain')}><Download size={15} aria-hidden="true" />Download mystery XDI</button>}
        </div>
        {report && <>
          <ResultTable results={report.results} />
          {mysteryGrade.length > 0 && <p className="twin-mystery-grade">Mystery check: {mysteryGrade.every(item => item.pass) ? 'all recovered within tolerance' : 'one or more fits missed the recovery tolerance'}.</p>}
          {report.warnings.length > 0 && <ul className="twin-calibration-warnings">{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          <button type="button" className="button cta" disabled={!report.results.some(result => result.kind === 'energy-offset' || result.kind === 'dead-time')} onClick={applyResults}>Apply to profile</button>
        </>}
      </> : <>
        <p className="twin-dialog-copy">All profile values show their stored units and accepted ranges. JSON imports are rejected if any field is missing or outside its range.</p>
        <div className="twin-dialog-actions">
          <input ref={profileInput} name="instrument-profile" className="sr-only" type="file" accept=".json,application/json" aria-label="Instrument profile file" onChange={loadProfile} />
          <button type="button" className="button secondary small" onClick={() => profileInput.current?.click()}><Upload size={15} aria-hidden="true" />Import JSON</button>
          <button type="button" className="button secondary small" onClick={() => download('xaslab-twin-profile.json', profileToJson(draft))}><Download size={15} aria-hidden="true" />Export JSON</button>
          <button type="button" className="button cta" onClick={applyProfile}>Apply profile</button>
        </div>
        <ProfileEditor profile={draft} onChange={setDraft} />
      </>}
      <p className="twin-dialog-status" role="status">{message}</p>
    </div>
  </dialog>;
}
