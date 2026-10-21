'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { Num, Tex, Unit, formulaTex } from '../tex';
import { Range } from '../ui';
import { elementInfo, parseFormula } from '@/lib/xraydata';
import { edgeEnergy } from '@/lib/twin/acquire';
import { CHAMBER_FILLS } from '@/lib/twin/chambers';
import { cutoffEnergy_eV } from '@/lib/twin/mirrors';
import { braggAngle_rad } from '@/lib/twin/mono';
import { SAMPLE_PRESETS } from '@/lib/twin/presets';
import { defaultPlan, planDuration, xanesPlan, kOf } from '@/lib/twin/scan';
import { TEMPERATURE_RANGE, energyRange, status, type TwinCommand } from '@/lib/twin/twin';
import type { ChamberConfig, Crystal, EnvironmentConfig, ScanPlan, TwinState } from '@/lib/twin/types';
import { PROFILE_PRESETS } from './twin-state';
import { useTwin } from './twin-store';
import { useTables } from './use-tables';
import { Fold } from './fold';

/** Bragg angle in degrees, or null where the crystal cannot reach the energy. */
const braggDeg = (crystal: Crystal, energy_eV: number) => { try { return braggAngle_rad(crystal, energy_eV) * 180 / Math.PI; } catch { return null; } };

function Rows({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return <dl className="twin-rows">{rows.map(([label, value], i) => <div key={i}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
const q = (value: number | string, unit: string) => <><Num>{String(value)}</Num> <Unit>{unit}</Unit></>;
const sci = (value: number) => <Num>{value.toExponential(2)}</Num>;
const chamberTex = (id: ChamberConfig['id']) => id === 'I0' ? 'I_0' : id === 'It' ? 'I_t' : 'I_\\mathrm{ref}';

/** Chamber fills on offer: the pure gases and the usual nitrogen mixes (src/lib/twin/chambers.ts). */
const FILLS = CHAMBER_FILLS;
const fillOf = (gas: ChamberConfig['gas']) => FILLS.find(f => Object.entries(f.gas).every(([g, x]) => Math.abs((gas[g as keyof typeof gas] ?? 0) - (x ?? 0)) < 1e-9) && Object.keys(gas).filter(g => (gas[g as keyof typeof gas] ?? 0) > 0).length === Object.keys(f.gas).length)?.id ?? 'custom';
const GAINS = [3, 4, 5, 6, 7, 8, 9, 10, 11];
/** Option text cannot hold typeset maths, so powers of ten use Unicode superscripts. */
const power = (n: number) => '10' + [...String(n)].map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
const ENVIRONMENTS: { id: EnvironmentConfig['kind']; label: string }[] = [
  { id: 'ambient', label: 'Ambient air' }, { id: 'cryostat', label: 'Cryostat' }, { id: 'furnace', label: 'Furnace' }, { id: 'operando-cell', label: 'Operando coin cell' }, { id: 'liquid-cell', label: 'Liquid cell' },
];
const PEAKING = [0.25, 0.5, 1, 2, 4, 8];

/** Scan plans on offer, relative to the edge; the current plan shows as "Custom" when it matches none. */
function scanPresets(e0: number): { id: string; label: string; plan: ScanPlan }[] {
  return [
    { id: 'exafs', label: 'EXAFS to k = 12', plan: defaultPlan(e0) },
    { id: 'long', label: 'EXAFS to k = 15', plan: { ...defaultPlan(e0), regions: defaultPlan(e0).regions.map(r => r.space === 'k' ? { ...r, end: 15 } : r) } },
    { id: 'xanes', label: 'XANES, −30 to +70 eV', plan: xanesPlan(e0) },
  ];
}

function EnergyControls() {
  const { store: { twin }, dispatch } = useTwin();
  const [lo, hi] = energyRange(twin);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft.trim() !== '') dispatch({ type: 'energy', energy_eV: Number(draft) }); setDraft(null); };
  const theta = braggDeg(twin.profile.mono.crystal, twin.energy_eV);
  return <>
    <Range label="Photon energy" value={twin.energy_eV} min={lo} max={hi} step={0.5} digits={1} unit="eV" onChange={energy_eV => dispatch({ type: 'energy', energy_eV })} />
    <label className="twin-field"><span>Type an energy in <Unit>eV</Unit></span>
      <input type="number" inputMode="decimal" min={lo} max={hi} step={0.1} value={draft ?? twin.energy_eV.toFixed(1)} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
    </label>
    <Rows rows={[[<>Bragg angle <Tex plain>{'\\theta'}</Tex></>, theta === null ? 'out of range' : <Tex plain>{`${theta.toFixed(3)}^\\circ`}</Tex>]]} />
  </>;
}

/** A free formula, density, absorber and edge, applied together with one button. */
function AnySample({ twin, run }: { twin: TwinState; run: (c: TwinCommand) => void }) {
  const s = twin.sample;
  const [formula, setFormula] = useState(s.formula), [density, setDensity] = useState(String(s.density));
  const [absorber, setAbsorber] = useState(s.absorber), [edge, setEdge] = useState(s.edge);
  const parsed = useMemo(() => { try { return Object.keys(parseFormula(formula)); } catch { return null; } }, [formula]);
  const [lo, hi] = energyRange(twin);
  const edges = useMemo(() => { try { return elementInfo(absorber).edges.filter(e => e.energy_eV >= lo && e.energy_eV <= hi).map(e => e.edge); } catch { return []; } }, [absorber, lo, hi]);
  const valid = parsed !== null && parsed.includes(absorber) && edges.includes(edge) && Number(density) > 0;
  return <div className="twin-any">
    <label className="twin-field">Formula<input value={formula} onChange={e => { setFormula(e.target.value); }} aria-invalid={parsed === null} spellCheck={false} /></label>
    <label className="twin-field"><span>Density in <Unit>g/cm³</Unit></span><input type="number" min={0.0001} step={0.01} value={density} onChange={e => setDensity(e.target.value)} /></label>
    <label className="twin-field">Absorber<select value={absorber} onChange={e => { setAbsorber(e.target.value); setEdge(''); }}>{(parsed ?? [absorber]).map(el => <option key={el}>{el}</option>)}</select></label>
    <label className="twin-field">Edge<select value={edge} onChange={e => setEdge(e.target.value)}><option value="" disabled>Choose an edge</option>{edges.map(e => <option key={e}>{e}</option>)}</select></label>
    {edges.length === 0 && <p className="twin-soon">No {absorber} edge falls inside this profile&apos;s range.</p>}
    <button type="button" className="button secondary small" disabled={!valid} onClick={() => run({ type: 'sample', patch: { formula, density: Number(density), absorber, edge } })}>Use this sample</button>
  </div>;
}

/** Right rail: detector model, profile, and one folding section per component; every control goes through applyCommand. */
export function ControlRail() {
  const { store: { twin, view }, dispatch } = useTwin();
  const tables = useTables();
  const locked = (key: 'profile' | 'sample' | 'mono') => view.locked.includes(key);
  const run = (command: TwinCommand) => dispatch({ type: 'command', command });
  const { profile: p, sample: s, environment: env, scan } = twin;
  const now = useMemo(() => tables === 'ready' ? (() => { try { return status(twin); } catch { return null; } })() : null, [tables, twin]);
  const e0 = useMemo(() => tables === 'ready' ? (() => { try { return edgeEnergy(s); } catch { return null; } })() : null, [tables, s]);
  const plans = e0 === null ? [] : scanPresets(e0);
  const planId = plans.find(x => JSON.stringify(x.plan.regions) === JSON.stringify(scan.regions))?.id ?? 'custom';
  const duration = e0 === null ? null : (() => { try { return planDuration(scan, e0); } catch { return null; } })();
  const presetId = SAMPLE_PRESETS.find(x => x.sample.formula === s.formula && x.sample.absorber === s.absorber && x.sample.edge === s.edge)?.id ?? 'custom';
  const tRange = TEMPERATURE_RANGE[env.kind];
  // The counting window sliders reach as far as the XRF spectrum shows, 1 keV above the beam energy.
  const roiMax = Math.ceil(Math.max(twin.energy_eV + 1000, p.sdd.roi_eV[1]) / 10) * 10;

  const preset = SAMPLE_PRESETS.find(x => x.id === presetId);

  return <aside className="twin-card twin-rail twin-right" aria-label="Controls">
    <h2 className="sr-only">Controls</h2>
    <div className="twin-clarity" role="group" aria-label="Detectors">
      <button type="button" aria-label="Educational" aria-pressed={!twin.realistic} aria-keyshortcuts="C" onClick={() => dispatch({ type: 'realistic', value: false })}><strong>Educational</strong><span>Expected values, clean curves</span></button>
      <button type="button" aria-label="Realistic" aria-pressed={twin.realistic} aria-keyshortcuts="C" onClick={() => dispatch({ type: 'realistic', value: true })}><strong>Realistic</strong><span>Counting noise, drift, glitches</span></button>
    </div>
    <label className="twin-field">Beamline profile
      <select value={p.preset} onChange={e => run({ type: 'profile', id: e.target.value })} disabled={locked('profile')}>
        {PROFILE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
    </label>

    <Fold id="twin-c-source" title="Source">
      <Rows rows={p.source.kind === 'undulator' && p.source.undulator
        ? [['Device', 'Undulator'], ['Ring energy', q(p.source.ring_GeV, 'GeV')], ['Period', q(p.source.undulator.period_mm, 'mm')], ['Periods', String(p.source.undulator.periods)]]
        : [['Device', 'Bending magnet'], ['Ring energy', q(p.source.ring_GeV, 'GeV')], ['Magnetic field', q(p.source.field_T ?? 0, 'T')], ['Horizontal acceptance', q(p.source.hAccept_mrad, 'mrad')]]} />
      <Range label="Ring current" value={p.source.current_mA} min={1} max={500} step={1} unit="mA" onChange={current_mA => run({ type: 'source', current_mA })} />
      {now?.flux != null && <Rows rows={[['Flux into the chambers', <>{sci(now.flux)} <Unit>s^-1</Unit></>]]} />}
    </Fold>

    <Fold id="twin-c-mirrors" title="Mirrors">
      {p.mirrors.map(m => {
        const cutoff = tables === 'ready' ? (() => { try { return cutoffEnergy_eV(m.coating, m.angle_mrad); } catch { return null; } })() : null;
        return <div key={m.id} className="twin-mirror">
          <label className="twin-check"><input type="checkbox" checked={m.inserted} onChange={e => run({ type: 'mirror', id: m.id, inserted: e.target.checked })} />{m.id}, {m.role.replace('-', ' ')}</label>
          <p className="twin-soon">{m.coating} at {q(m.angle_mrad, 'mrad')}{cutoff !== null && <>; reflects up to about {q(Math.round(cutoff), 'eV')}</>}</p>
        </div>;
      })}
      {now?.harmonicFraction != null && <Rows rows={[['Harmonic content at the sample', sci(now.harmonicFraction)]]} />}
    </Fold>

    <Fold id="twin-c-mono" title="Monochromator" desktopOpen>
      <label className="twin-field">Crystals
        <select value={p.mono.crystal} onChange={e => run({ type: 'crystal', crystal: e.target.value as Crystal })} disabled={locked('mono')}>
          {(['Si111', 'Si311', 'Si220'] as const).map(c => <option key={c} value={c}>Si({c.slice(2)})</option>)}
        </select>
      </label>
      <EnergyControls />
      <Range label="Second crystal detune" value={Math.round(p.mono.detune * 100)} min={0} max={100} step={5} unit="%" hint="of the rocking curve width" onChange={pct => run({ type: 'detune', detune: pct / 100 })} />
      {now?.deltaE_eV != null && <Rows rows={[[<>Resolution <Tex plain>{'\\Delta E'}</Tex></>, q(now.deltaE_eV.toFixed(2), 'eV')]]} />}
    </Fold>

    <Fold id="twin-c-chambers" title="Ion chambers">
      {p.chambers.map(c => {
        const reading = now ? (c.id === 'I0' ? now.i0 : c.id === 'It' ? now.it : now.iref) : null;
        const fill = fillOf(c.gas);
        return <fieldset key={c.id} className="twin-chamber">
          <legend><Tex plain>{chamberTex(c.id)}</Tex>, {q(c.length_cm, 'cm')}</legend>
          <label className="twin-field">Gas
            <select value={fill} onChange={e => { const f = FILLS.find(x => x.id === e.target.value); if (f) run({ type: 'gas', chamber: c.id, gas: f.gas }); }}>
              {fill === 'custom' && <option value="custom">Custom mix</option>}
              {FILLS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <label className="twin-field">Amplifier gain
            <select value={Math.round(Math.log10(c.gain_V_per_A))} onChange={e => run({ type: 'gain', chamber: c.id, gain_V_per_A: 10 ** Number(e.target.value) })}>
              {GAINS.map(g => <option key={g} value={g}>{power(g)} V/A</option>)}
            </select>
          </label>
          {reading && <p className={'twin-soon' + (reading.saturated ? ' twin-alert' : '')}>Absorbs <Num>{(reading.absorbedFraction * 100).toFixed(1) + '%'}</Num>, reads {reading.saturated ? 'OVER (clipped at 10 V)' : q(reading.voltage_V.toFixed(3), 'V')}</p>}
        </fieldset>;
      })}
      <button type="button" className="button secondary small" disabled={tables !== 'ready'} onClick={() => run({ type: 'autoGain' })}>Auto gain</button>
    </Fold>

    <Fold id="twin-c-sample" title="Sample" desktopOpen>
      <div className="twin-chipset" role="group" aria-label="Preset">
        {SAMPLE_PRESETS.map(x => <button key={x.id} type="button" className="twin-chip" aria-pressed={presetId === x.id} disabled={tables !== 'ready' || locked('sample')} onClick={() => run({ type: 'samplePreset', id: x.id })}>{x.name}</button>)}
        {presetId === 'custom' && <span className="twin-chip is-current">Your sample</span>}
      </div>
      {preset && <p className="twin-soon">{preset.story}</p>}
      <Rows rows={[['Material', <><Tex plain>{formulaTex(s.formula)}</Tex>, {s.form}</>], ['Edge', <>{s.absorber} <Tex plain>{formulaTex(s.edge)}</Tex>{e0 !== null && <>, {q(e0.toFixed(1), 'eV')}</>}</>]]} />
      <Range label="Thickness" value={s.thickness_um} min={0.1} max={Math.max(2000, s.thickness_um)} step={0.1} digits={1} unit="μm" onChange={thickness_um => run({ type: 'thickness', thickness_um })} />
      {now?.edgeStep != null && <Rows rows={[['Edge step', <Num>{now.edgeStep.toFixed(2)}</Num>], [<>Total <Tex plain>{'\\mu x'}</Tex> here</>, <Num>{now.muX!.toFixed(2)}</Num>]]} />}
      <Range label="Pinholes" value={Math.round(s.pinholeFraction * 100)} min={0} max={30} step={1} unit="%" hint="of the beam misses the sample" onChange={pct => run({ type: 'sample', patch: { pinholeFraction: pct / 100 } })} />
      <Range label="Thickness spread" value={Math.round(s.thicknessSpread * 100)} min={0} max={50} step={1} unit="%" hint="relative standard deviation" onChange={pct => run({ type: 'sample', patch: { thicknessSpread: pct / 100 } })} />
      {tables === 'ready' && !locked('sample') && <details className="twin-details"><summary>Any formula</summary><AnySample key={s.formula + s.absorber + s.edge} twin={twin} run={run} /></details>}
    </Fold>

    <Fold id="twin-c-environment" title="Environment">
      <div className="twin-chipset" role="group" aria-label="Setting">
        {ENVIRONMENTS.map(x => <button key={x.id} type="button" className="twin-chip" aria-pressed={env.kind === x.id} onClick={() => run({ type: 'environment', kind: x.id })}>{x.label}</button>)}
      </div>
      <Range label="Temperature" value={env.temperature_K} min={tRange[0]} max={tRange[1]} step={1} unit="K" onChange={temperature_K => run({ type: 'temperature', temperature_K })} />
      {env.windows.length > 0 && <p className="twin-soon">Beam passes {env.windows.length} windows of {q(env.windows[0].thickness_um, 'μm')} <Tex plain>{formulaTex(env.windows[0].formula)}</Tex> (Kapton).</p>}
    </Fold>

    <Fold id="twin-c-dose" title="Beam size and dose">
      <Range label="Beam width" value={p.beam_um[0]} min={5} max={2000} step={5} unit="μm" hint="FWHM at the sample" onChange={w => run({ type: 'beam', beam_um: [w, p.beam_um[1]] })} />
      <Range label="Beam height" value={p.beam_um[1]} min={5} max={2000} step={5} unit="μm" hint="FWHM at the sample" onChange={h => run({ type: 'beam', beam_um: [p.beam_um[0], h] })} />
      <Range label="Fresh spots per scan" value={scan.spots ?? 1} min={1} max={50} step={1} hint="move the sample between points, or use a flow cell" onChange={spots => run({ type: 'scan', plan: { ...scan, spots } })} />
      {now?.doseRate_Gy_per_s != null && <Rows rows={[
        ['Surface dose rate', <>{sci(now.doseRate_Gy_per_s)} <Unit>Gy/s</Unit></>],
        ...(duration ? [['Dose per spot, whole scan', <>{sci(now.doseRate_Gy_per_s * duration.total_s / (scan.spots ?? 1))} <Unit>Gy</Unit></>]] as [ReactNode, ReactNode][] : []),
      ]} />}
    </Fold>

    <Fold id="twin-c-sdd" title="Fluorescence detector">
      <Range label="Distance from the sample" value={p.sdd.distance_mm} min={5} max={500} step={1} unit="mm" onChange={distance_mm => run({ type: 'sdd', patch: { distance_mm } })} />
      <label className="twin-field">Peaking time
        <select value={p.sdd.peaking_us} onChange={e => run({ type: 'sdd', patch: { peaking_us: Number(e.target.value) } })}>
          {/* A dead time applied from Calibrate from data can fall between the standard settings; it is listed too. */}
          {[...new Set([...PEAKING, p.sdd.peaking_us])].sort((a, b) => a - b).map(t => <option key={t} value={t}>{PEAKING.includes(t) ? `${t} μs` : `${+t.toFixed(3)} μs (fitted)`}</option>)}
        </select>
      </label>
      <Range label="Exit angle" value={p.sdd.exitAngle_deg} min={1} max={90} step={1} unit="°" hint="between the sample surface and the detector" onChange={exitAngle_deg => run({ type: 'sdd', patch: { exitAngle_deg } })} />
      <label className="twin-check"><input type="checkbox" checked={p.sdd.soller} onChange={e => run({ type: 'sdd', patch: { soller: e.target.checked } })} />Soller slits</label>
      {now?.deadFraction != null && <p className={'twin-soon' + (now.deadFraction > 0.5 ? ' twin-alert' : '')}>Input rate {sci(now.icr!)} <Unit>s^-1</Unit>, dead time <Num>{(now.deadFraction * 100).toFixed(1) + '%'}</Num></p>}
      <Range label="Counting window from" value={p.sdd.roi_eV[0]} min={0} max={roiMax} step={10} unit="eV" onChange={from => run({ type: 'sdd', patch: { roi_eV: [from, p.sdd.roi_eV[1]] } })} />
      <Range label="Counting window to" value={p.sdd.roi_eV[1]} min={0} max={roiMax} step={10} unit="eV" hint="also set by dragging on the XRF spectrum" onChange={to => run({ type: 'sdd', patch: { roi_eV: [p.sdd.roi_eV[0], to] } })} />
      <Rows rows={[['Elements', String(p.sdd.elements)]]} />
    </Fold>

    <Fold id="twin-c-scan" title="Scan">
      <label className="twin-field">Plan
        <select value={planId} onChange={e => { const x = plans.find(pl => pl.id === e.target.value); if (x) run({ type: 'scan', plan: { ...x.plan, repeats: scan.repeats, kind: scan.kind } }); }} disabled={!plans.length}>
          {planId === 'custom' && <option value="custom">Custom</option>}
          {plans.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <div className="twin-switch" role="group" aria-label="Scan kind">
        <button type="button" aria-pressed={scan.kind === 'step'} onClick={() => run({ type: 'scan', plan: { ...scan, kind: 'step' } })}>Step</button>
        <button type="button" aria-pressed={scan.kind === 'continuous'} onClick={() => run({ type: 'scan', plan: { ...scan, kind: 'continuous' } })}>Continuous</button>
      </div>
      <Range label="Dwell per point" value={scan.regions[0].dwell_s} min={0.1} max={10} step={0.1} digits={1} unit="s" onChange={dwell_s => run({ type: 'scan', plan: { ...scan, regions: scan.regions.map(r => ({ ...r, dwell_s })) } })} />
      <Range label="Repeats" value={scan.repeats} min={1} max={20} step={1} onChange={repeats => run({ type: 'scan', plan: { ...scan, repeats } })} />
      <Rows rows={[
        ...scan.regions.map((r, i): [ReactNode, ReactNode] => [`Region ${i + 1}`, r.space === 'E'
          ? <><Num>{String(r.start)}</Num> to <Num>{String(r.end)}</Num> <Unit>eV</Unit>, steps of {q(+r.step.toFixed(3), 'eV')}</>
          : <><Tex plain>{`k = ${+r.start.toFixed(2)}\\text{ to }${r.end}\\ \\mathring{\\mathrm{A}}^{-1}`}</Tex>, steps of <Tex plain>{`${r.step}\\ \\mathring{\\mathrm{A}}^{-1}`}</Tex></>]),
        ...(duration ? [['Points', <Num key="n">{String(duration.points)}</Num>], ['Beamline time', q((duration.total_s / 60).toFixed(1), 'min')]] as [ReactNode, ReactNode][] : []),
        ['Random seed', String(twin.seed)],
      ]} />
      {e0 !== null && scan.regions.some(r => r.space === 'k') && <p className="twin-soon">The k grid starts {q(Math.round((scan.regions.find(r => r.space === 'k')!.start / kOf(e0 + 1, e0)) ** 2), 'eV')} above the edge.</p>}
    </Fold>
  </aside>;
}
