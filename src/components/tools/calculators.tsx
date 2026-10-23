'use client';
// The live calculators on the /tools/ pages. They load the same X-ray and optics tables as the twin and call the
// functions in src/lib/tools.ts, so the numbers match the tables printed on each page.
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Metric } from '../ui';
import { Num, Tex, Unit, formulaTex } from '../tex';
import { useTables } from '../twin/use-tables';
import { elementInfo, parseFormula } from '@/lib/xraydata';
import { FILL_TARGETS, type ChamberRole } from '@/lib/twin/chambers';
import { MIRROR_COATINGS } from '@/lib/twin/mirrors';
import type { MirrorCoating } from '@/lib/twin/types';
import { DAMAGE_KIND_LABEL, GAS_EXAMPLE_EDGES, dosePlan, edgeOf, gasPlan, mirrorChoice, mixLabel, selfAbsorption } from '@/lib/tools';
import { Duration, Percent, Quantity, sig } from './format';

/** A number typed as text, so half-typed values such as "1e" do not jump; parsed when the result is computed. */
function NumberField({ label, unit, value, onChange, hint }: { label: string; unit?: string; value: string; onChange: (v: string) => void; hint?: ReactNode }) {
  const id = useId();
  return <label className="field-label" htmlFor={id}>
    <span>{label}{unit && <> (<Unit>{unit}</Unit>)</>}</span>
    <input id={id} aria-label={unit ? `${label} (${unit})` : label} inputMode="decimal" autoComplete="off" spellCheck={false} value={value} onChange={e => onChange(e.target.value)} aria-describedby={hint ? id + '-hint' : undefined} />
    {hint && <small id={id + '-hint'} className="muted">{hint}</small>}
  </label>;
}

function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return <label className="field-label">{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value as T)}>
    {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
  </select></label>;
}

const positive = (text: string, label: string) => {
  const value = Number(text.trim());
  if (!text.trim() || !Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be a number above zero.`);
  return value;
};

/** The shared frame: the inputs, then either the result, a loading line or what is wrong with the inputs. */
function Calculator({ title, inputs, run }: { title: string; inputs: ReactNode; run: () => ReactNode }) {
  const tables = useTables();
  let body: ReactNode, error = '';
  if (tables === 'ready') { try { body = run(); } catch (e) { error = (e as Error).message; } }
  return <section className="panel tool-calculator" aria-labelledby="calculator-title">
    <h2 id="calculator-title">{title}</h2>
    <div className="tool-inputs">{inputs}</div>
    <div className="tool-result" aria-live="polite">
      {tables === 'loading' && <p className="muted">Loading the X-ray tables…</p>}
      {tables === 'failed' && <p className="field-error" role="alert">The X-ray tables could not be loaded. Reload the page to try again.</p>}
      {error ? <p className="field-error" role="alert">{error}</p> : body}
    </div>
  </section>;
}

/* ---------- Ion chamber gas ---------- */

const ROLES = [['I0', 'I0, before the sample'], ['It', 'It, after the sample'], ['Iref', 'Iref, after the reference foil']] as const;

export function GasCalculator() {
  const [energy, setEnergy] = useState('8979'), [length, setLength] = useState('15'), [role, setRole] = useState<ChamberRole>('I0');
  useTables(); // re-render once the tables are in, so the edge picker can match the energy
  const presets = [['', 'Type an energy'] as const, ...GAS_EXAMPLE_EDGES.map(([label]) => [label, label] as const)];
  const preset = GAS_EXAMPLE_EDGES.find(([, el, edge]) => { try { return String(Math.round(edgeOf(el, edge))) === energy; } catch { return false; } })?.[0] ?? '';
  return <Calculator title="Find the fill" inputs={<>
    <SelectField label="Edge" value={preset} options={presets} onChange={label => { const e = GAS_EXAMPLE_EDGES.find(([l]) => l === label); if (e) setEnergy(String(Math.round(edgeOf(e[1], e[2])))); }} />
    <NumberField label="Energy" unit="eV" value={energy} onChange={setEnergy} />
    <NumberField label="Active length" unit="cm" value={length} onChange={setLength} hint="The plate length, often 10 to 30 cm." />
    <SelectField label="Chamber" value={role} options={ROLES} onChange={setRole} />
  </>} run={() => {
    const plan = gasPlan(positive(energy, 'Energy'), positive(length, 'Length'), role), t = FILL_TARGETS[role];
    return <>
      <div className="metric-grid">
        <Metric label="Suggested fill" value={mixLabel(plan.suggestion.mix)} />
        <Metric label="Absorbs" value={<Percent value={plan.suggestion.absorbed} />} />
        <Metric label="Target" value={<><Percent value={t.min} digits={0} /> to <Percent value={t.max} digits={0} /></>} />
      </div>
      <div className="table-wrap edge-table-wrap" role="region" aria-label="Standard fills" tabIndex={0}><table className="edge-table">
        <caption>Fraction of the beam each standard fill absorbs at this energy and length, at <Num>1</Num> atm and <Num>295</Num> <Unit>K</Unit>.</caption>
        <thead><tr><th scope="col">Fill</th><th scope="col" className="num">Absorbed</th><th scope="col">For {role}</th></tr></thead>
        <tbody>{plan.fills.map(f => <tr key={f.id}><th scope="row">{f.label}</th><td className="num"><Percent value={f.absorbed} /></td><td>{f.absorbed < t.min ? 'too little' : f.absorbed > t.max ? 'too much' : 'in range'}</td></tr>)}</tbody>
      </table></div>
    </>;
  }} />;
}

/* ---------- Harmonic rejection mirror ---------- */

export function MirrorCalculator() {
  const [energy, setEnergy] = useState('9000'), [coating, setCoating] = useState<MirrorCoating>('Rh');
  return <Calculator title="Find the angle" inputs={<>
    <NumberField label="Fundamental energy" unit="eV" value={energy} onChange={setEnergy} />
    <SelectField label="Coating" value={coating} options={MIRROR_COATINGS.map(c => [c, c] as const)} onChange={setCoating} />
  </>} run={() => {
    const e = positive(energy, 'Energy'), choice = mirrorChoice(coating, e);
    if (!choice.ok) return <p role="status">{choice.reason}</p>;
    return <div className="metric-grid">
      <Metric label="Mirror angle" value={<Quantity value={choice.angle_mrad} unit="mrad" />} />
      <Metric label="Cutoff (50 % reflectivity)" value={choice.cutoff_eV ? <Quantity value={choice.cutoff_eV / 1000} unit="keV" /> : 'outside the table'} />
      <Metric label={<>Reflected at <Num>{sig(e / 1000)}</Num> <Unit>keV</Unit></>} value={<Percent value={choice.fundamental} />} />
      <Metric label={<>Reflected at <Num>{sig(3 * e / 1000)}</Num> <Unit>keV</Unit> (third harmonic)</>} value={<Percent value={choice.harmonic} digits={2} />} />
    </div>;
  }} />;
}

/* ---------- Self absorption ---------- */

/** Emission line groups as written: Ka becomes Kα, Lb becomes Lβ. */
const lineName = (group: string) => group.replace(/a$/, 'α').replace(/b$/, 'β').replace(/g$/, 'γ');

export function SelfAbsorptionCalculator() {
  const [formula, setFormula] = useState('NiO'), [density, setDensity] = useState('3.5'), [thickness, setThickness] = useState('200');
  const [absorber, setAbsorber] = useState('Ni'), [edge, setEdge] = useState('K');
  const [incidence, setIncidence] = useState('45'), [exit, setExit] = useState('45');
  const tables = useTables();
  // The absorber list follows the formula once the tables are in; an unreadable formula keeps the last list.
  const elements = useMemo(() => { if (tables !== 'ready') return [absorber]; try { return Object.keys(parseFormula(formula)); } catch { return [absorber]; } }, [tables, formula, absorber]);
  const edges = useMemo(() => tables === 'ready' && elements.includes(absorber) ? elementInfo(absorber).edges.filter(e => e.energy_eV > 1000 && e.energy_eV < 1e5).map(e => e.edge) : [edge], [tables, elements, absorber, edge]);
  return <Calculator title="Estimate it" inputs={<>
    <label className="field-label">Chemical formula<input aria-label="Chemical formula" autoComplete="off" spellCheck={false} value={formula} onChange={e => setFormula(e.target.value)} /></label>
    <NumberField label="Density" unit="g/cm³" value={density} onChange={setDensity} hint="Of the sample as packed: a pressed pellet is often half the crystal density." />
    <NumberField label="Thickness" unit="µm" value={thickness} onChange={setThickness} />
    <SelectField label="Absorber" value={absorber} options={elements.map(s => [s, s] as const)} onChange={s => { setAbsorber(s); setEdge('K'); }} />
    <SelectField label="Edge" value={edges.includes(edge) ? edge : edges[0]} options={edges.map(e => [e, e] as const)} onChange={setEdge} />
    <NumberField label="Incidence angle" unit="°" value={incidence} onChange={setIncidence} hint="Between the beam and the sample surface." />
    <NumberField label="Exit angle" unit="°" value={exit} onChange={setExit} hint="Between the sample surface and the detector." />
  </>} run={() => {
    const chosenEdge = edges.includes(edge) ? edge : edges[0];
    if (!elements.includes(absorber)) throw new Error(`${absorber} is not in ${formula}.`);
    if (!chosenEdge) throw new Error(`${absorber} has no edge between 1 and 100 keV.`);
    const result = selfAbsorption({ formula, density: positive(density, 'Density'), thickness_um: positive(thickness, 'Thickness'), absorber, edge: chosenEdge, incidence_deg: positive(incidence, 'Incidence angle'), exit_deg: positive(exit, 'Exit angle') });
    const exafs = result.points[1].kept;
    return <>
      <div className="metric-grid">
        {result.points.map(p => <Metric key={p.label} label={`${p.label} shows`} value={<Percent value={p.kept} />} />)}
        <Metric label="Depth exponent" value={<Num>{sig(result.exponent)}</Num>} />
      </div>
      <p>{exafs > 0.95 ? 'Self absorption is small here: the fluorescence follows the absorber.' : exafs > 0.8
        ? 'Noticeable self absorption: correct for it, or make the sample thinner or more dilute.'
        : 'Strong self absorption: the fluorescence badly understates the fine structure. Measure in transmission, dilute the sample, make it much thinner, or use a grazing exit angle.'}
        {' '}The <Tex plain>{formulaTex(absorber)}</Tex> {lineName(result.line.group)} line is at <Quantity value={result.line.energy_eV} unit="eV" />.</p>
    </>;
  }} />;
}

/* ---------- Dose ---------- */

export function DoseCalculator() {
  const [flux, setFlux] = useState('1e12'), [energy, setEnergy] = useState('9000'), [h, setH] = useState('100'), [v, setV] = useState('100');
  const [formula, setFormula] = useState('Fe2O3'), [density, setDensity] = useState('2.6'), [thickness, setThickness] = useState('20');
  return <Calculator title="Work out the dose" inputs={<>
    <NumberField label="Flux on the sample" unit="photons/s" value={flux} onChange={setFlux} hint="Type 1e12 for 10¹² photons per second." />
    <NumberField label="Energy" unit="eV" value={energy} onChange={setEnergy} />
    <NumberField label="Beam width" unit="µm" value={h} onChange={setH} />
    <NumberField label="Beam height" unit="µm" value={v} onChange={setV} />
    <label className="field-label">Chemical formula<input aria-label="Chemical formula" autoComplete="off" spellCheck={false} value={formula} onChange={e => setFormula(e.target.value)} /></label>
    <NumberField label="Density" unit="g/cm³" value={density} onChange={setDensity} />
    <NumberField label="Thickness" unit="µm" value={thickness} onChange={setThickness} />
  </>} run={() => {
    const plan = dosePlan({ flux: positive(flux, 'Flux'), energy_eV: positive(energy, 'Energy'), beam_um: [positive(h, 'Beam width'), positive(v, 'Beam height')], formula, density: positive(density, 'Density'), thickness_um: positive(thickness, 'Thickness') });
    return <>
      <div className="metric-grid">
        <Metric label="Mean dose rate" value={<Quantity value={plan.meanRate_Gy_per_s} unit="Gy/s" />} />
        <Metric label="At the front face" value={<Quantity value={plan.surfaceRate_Gy_per_s} unit="Gy/s" />} />
        <Metric label="Flux density" value={<Quantity value={plan.fluxDensity_per_s_mm2} unit="photons/s/mm²" />} />
        <Metric label="Absorbed power" value={<Quantity value={plan.absorbedPower_W * 1000} unit="mW" />} />
      </div>
      <div className="table-wrap edge-table-wrap" role="region" aria-label="Time to damage" tabIndex={0}><table className="edge-table">
        <caption>Time to reach the teaching damage dose of each kind of sample at the mean dose rate. Real thresholds vary by orders of magnitude; measure your own.</caption>
        <thead><tr><th scope="col">Sample kind</th><th scope="col" className="num">Dose</th><th scope="col" className="num">Time</th></tr></thead>
        <tbody>{plan.timeTo.map(t => <tr key={t.kind}><th scope="row">{DAMAGE_KIND_LABEL[t.kind]}</th><td className="num"><Quantity value={t.dose_Gy} unit="Gy" /></td><td className="num"><Duration seconds={t.seconds} /></td></tr>)}</tbody>
      </table></div>
    </>;
  }} />;
}
