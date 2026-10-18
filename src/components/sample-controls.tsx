'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { COMPOUND_PRESETS } from '@/data/compound-presets';
import { loadXrayData, edgesOf, parseFormula, elementInfo } from '@/lib/xraydata';
import { BATTERY_PRESET, DEFAULT_SAMPLE, batteryFormula, resolveSample, samplePlan, sampleScan, validateSample, type Sample } from '@/lib/sample';
import { useLab } from './lab-context';
import { Num, ScienceText, Tex, Unit, formulaTex } from './tex';
import { Disclosure, TryThis } from './ui';

export function useXrayData() {
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => { let alive = true; loadXrayData().then(() => { if (alive) setReady(true); }).catch(() => { if (alive) setError('X-ray data could not load. Reload to try again.'); }); return () => { alive = false; }; }, []);
  return { ready, error };
}
export function useSampleSpectrum(model = false) {
  const { state } = useLab(), { ready, error } = useXrayData();
  return useMemo(() => {
    if (!ready) return { spectrum: null, info: null, error };
    try { return { spectrum: sampleScan(state, model), info: samplePlan(state.sample), error: '' }; }
    catch (e) { return { spectrum: null, info: null, error: e instanceof Error ? e.message : 'Check the sample.' }; }
  }, [ready, error, state.sample, model, state.x, state.edge, state.shift, state.width, state.whiteLine, state.preEdge, state.oscillation]);
}
export function SampleSummary() {
  const { state } = useLab();
  return <p className="sample-summary"><strong><Tex plain>{formulaTex(state.sample.formula)}</Tex></strong> <span>{state.sample.absorber} <Tex plain>{formulaTex(state.sample.edge)}</Tex> edge · <Num>{String(state.sample.density)}</Num> <Unit>g/cm³</Unit></span> <Link href="/crystal/">Change sample</Link></p>;
}
/** Shown until the X-ray tables load, so the prerendered page already says what it does. */
export function DataLoading({ error, children }: { error: string; children: React.ReactNode }) {
  return <><SampleSummary /><p role="status" className="muted">{error ? <><ScienceText>{error}</ScienceText> <Link href="/crystal/">Choose a sample</Link></> : <>Loading tabulated X-ray data. {children}</>}</p></>;
}
export function SamplePicker({guide=true}:{guide?:boolean}) {
  const { state, set } = useLab(), { ready, error: loadError } = useXrayData();
  const [formula, setFormula] = useState(state.sample.formula), [density, setDensity] = useState(String(state.sample.density)), [error, setError] = useState(''), [chosen, setChosen] = useState(false);
  useEffect(() => { setFormula(state.sample.formula); setDensity(String(state.sample.density)); }, [state.sample]);
  const edges = useMemo(() => ready ? edgesOf(state.sample.formula) : [], [ready, state.sample.formula]);
  const symbols = Object.keys(parseFormula(state.sample.formula));
  const preset = COMPOUND_PRESETS.find(p => p.id === state.sample.preset);
  function apply(sample: Sample) {
    try {
      const checked = validateSample(sample), window = resolveSample(checked);
      set({ sample: checked, energy: Math.max(window.start, Math.min(window.end, window.edge.energy_eV)) });
      setError(''); setChosen(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Check the sample.'); }
  }
  function pickElement(absorber: string, source = state.sample) {
    const options = edgesOf(source.formula).filter(e => e.element === absorber);
    const first = options.find(e => e.edge === 'K' && e.energy_eV > 100 && e.energy_eV < 100000) ?? options.find(e => e.edge === 'L3' && e.energy_eV > 100 && e.energy_eV < 100000) ?? options.find(e => e.energy_eV > 100 && e.energy_eV < 100000) ?? options[options.length - 1];
    if (first) apply({ ...source, absorber, edge: first.edge });
  }
  return <div className="sample-picker">
    <label className="field-label">Sample preset<select aria-label="Sample preset" disabled={!ready} value={state.sample.preset ?? 'custom'} onChange={e => {
      if (e.target.value === 'custom') { set({ sample: { ...state.sample, preset: null } }); return; }
      if (e.target.value === BATTERY_PRESET) { apply({ ...DEFAULT_SAMPLE, formula: batteryFormula(state.x) }); return; }
      const p = COMPOUND_PRESETS.find(p => p.id === e.target.value);
      if (p) apply({ formula: p.formula, density: p.density, absorber: p.absorber, edge: p.edge, preset: p.id });
    }}><option value={BATTERY_PRESET}>LiₓMnO₂ · battery worked example</option>{COMPOUND_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name} · {p.formula}</option>)}<option value="custom">Your formula</option></select></label>
    <form onSubmit={e => {
      e.preventDefault();
      try {
        const composition = parseFormula(formula);
        const sample = { formula, density: Number(density), absorber: state.sample.absorber, edge: state.sample.edge, preset: null };
        const absorber = state.sample.absorber in composition ? state.sample.absorber : Object.keys(composition).sort((a, b) => elementInfo(b).Z - elementInfo(a).Z)[0];
        pickElement(absorber, sample);
      } catch (e) { setError(e instanceof Error ? e.message : 'Check the formula.'); }
    }}>
      <div className="two-col"><label className="field-label" htmlFor="sample-formula">Chemical formula<input id="sample-formula" value={formula} maxLength={240} placeholder="For example, Fe2O3" aria-invalid={!!error} aria-describedby="formula-help sample-error" onChange={e => { setFormula(e.target.value); setError(''); }} /></label>
      <label className="field-label" htmlFor="sample-density">Density (<Unit>g/cm³</Unit>)<input id="sample-density" aria-label="Density (g/cm³)" type="number" min="0.000001" max="1000" step="any" required value={density} onChange={e => setDensity(e.target.value)} /></label></div>
      <p id="formula-help" className="muted">Use element symbols, counts and brackets, such as <Tex plain>{formulaTex('Ca3(PO4)2')}</Tex> or <Tex plain>{formulaTex('CuSO4·5H2O')}</Tex>.</p>
      <p id="sample-error" role={error ? 'alert' : undefined} className="field-error"><ScienceText>{error || loadError}</ScienceText></p>
      <button className="button secondary" type="submit" disabled={!ready}>{ready ? 'Use this formula' : 'Loading X-ray data…'}</button>
    </form>
    {ready && <div className="two-col edge-controls">
      <label className="field-label">Absorber<select aria-label="Absorber" value={state.sample.absorber} onChange={e => pickElement(e.target.value)}>{symbols.map(s => <option key={s} value={s}>{s} · {elementInfo(s).name}</option>)}</select></label>
      <label className="field-label">Absorption edge<select aria-label="Absorption edge" value={state.sample.edge} onChange={e => apply({ ...state.sample, edge: e.target.value })}>{edges.filter(e => e.element === state.sample.absorber).map(e => <option key={e.edge} value={e.edge}>{e.edge} · {e.energy_eV.toLocaleString('en-US')} eV{e.energy_eV <= 100 || e.energy_eV >= 100000 ? ' · outside range' : ''}</option>)}</select></label>
    </div>}
    {guide&&<TryThis steps={['sample']} done={chosen} research={<>Density scales <Tex plain>{'\\mu'}</Tex>. Formula sets mass fractions; it does not set chemical shifts or local structure.</>}>{chosen ? <>The lab now uses <Tex plain>{formulaTex(state.sample.formula)}</Tex>, with the {state.sample.absorber} <Tex plain>{formulaTex(state.sample.edge)}</Tex> edge selected.</> : 'Choose a sample, then pick an element and its absorption edge.'}</TryThis>}
    <Disclosure title="All edges and density source">
      {symbols.map(s => <div key={s}><h3>{s}</h3><p>{edges.filter(e => e.element === s).map((e, i) => <span key={e.edge}>{i > 0 && '; '}<Tex plain>{formulaTex(e.edge)}</Tex> <Num>{e.energy_eV.toLocaleString('en-US')}</Num> <Unit>eV</Unit></span>)}</p></div>)}
      <p>{preset ? <ScienceText>{preset.densitySource}</ScienceText> : (state.sample.preset === BATTERY_PRESET ? <>4.3 <Unit>g/cm³</Unit> is an assumed density for the battery example. Enter the density of your sample for planning.</> : 'Density entered by you. Use the bulk density of your sample.')}</p>
      <p>Tables cover H to Cf (<Tex>{'Z = 1\\text{ to }98'}</Tex>) from 100 <Unit>eV</Unit> to 100 <Unit>keV</Unit>.</p>
    </Disclosure>
  </div>;
}
