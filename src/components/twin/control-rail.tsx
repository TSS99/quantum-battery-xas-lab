'use client';
import { useState, type ReactNode } from 'react';
import { Num, Tex, Unit, formulaTex } from '../tex';
import { Range } from '../ui';
import type { ChamberConfig, Crystal } from '@/lib/twin/types';
import { braggAngle_rad } from '@/lib/twin/mono';
import { PROFILE_PRESETS, presetOf } from './twin-state';
import { useTwin } from './twin-store';
import { Fold } from './fold';

/** Bragg angle in degrees, or null where the crystal cannot reach the energy. */
const braggDeg = (crystal: Crystal, energy_eV: number) => { try { return braggAngle_rad(crystal, energy_eV) * 180 / Math.PI; } catch { return null; } };

function Rows({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return <dl className="twin-rows">{rows.map(([label, value], i) => <div key={i}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
const Soon = () => <p className="twin-soon">Controls for this part are coming next.</p>;
const q = (value: number | string, unit: string) => <><Num>{String(value)}</Num> <Unit>{unit}</Unit></>;
const gas = (mix: ChamberConfig['gas']) => Object.entries(mix).map(([name, fraction], i) => <span key={name}>{i > 0 && ', '}{fraction !== 1 && <><Num>{String(Math.round(fraction! * 100))}</Num> <Unit>%</Unit> </>}<Tex plain>{formulaTex(name)}</Tex></span>);

function EnergyControls() {
  const { store: { twin }, dispatch } = useTwin();
  const [lo, hi] = presetOf(twin).range_eV;
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft.trim() !== '') dispatch({ type: 'energy', energy_eV: Number(draft) }); setDraft(null); };
  const theta = braggDeg(twin.profile.mono.crystal, twin.energy_eV);
  return <>
    <Range label="Photon energy" value={twin.energy_eV} min={lo} max={hi} step={0.5} digits={1} unit="eV" onChange={energy_eV => dispatch({ type: 'energy', energy_eV })} />
    <label className="twin-field"><span>Type an energy in <Unit>eV</Unit></span>
      <input type="number" inputMode="decimal" min={lo} max={hi} step={0.1} value={draft ?? twin.energy_eV.toFixed(1)} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
    </label>
    <Rows rows={[
      [<>Bragg angle <Tex plain>{'\\theta'}</Tex></>, theta === null ? 'out of range' : <Tex plain>{`${theta.toFixed(2)}^\\circ`}</Tex>],
      ['Second crystal detune', <><Num>{String(twin.profile.mono.detune * 100)}</Num> <Unit>%</Unit> of the rocking curve width</>],
    ]} />
  </>;
}

/** Right rail: detector model, profile preset and one folding section per component. Energy is live; the rest shows the preset. */
export function ControlRail() {
  const { store: { twin }, dispatch } = useTwin();
  const { profile: p, sample: s, environment: env, scan } = twin;
  return <aside className="twin-rail twin-right" aria-label="Controls">
    <h2 className="sr-only">Controls</h2>
    <div className="twin-switch" role="group" aria-label="Detectors">
      <button type="button" aria-pressed={!twin.realistic} aria-keyshortcuts="C" onClick={() => dispatch({ type: 'realistic', value: false })}>Educational</button>
      <button type="button" aria-pressed={twin.realistic} aria-keyshortcuts="C" onClick={() => dispatch({ type: 'realistic', value: true })}>Realistic</button>
    </div>
    <label className="twin-field">Beamline profile
      <select value={p.preset} onChange={e => dispatch({ type: 'command', command: { type: 'profile', id: e.target.value } })}>
        {PROFILE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
    </label>
    <Fold id="twin-c-source" title="Source">
      <Rows rows={p.source.kind === 'undulator' && p.source.undulator
        ? [['Device', 'Undulator'], ['Ring energy', q(p.source.ring_GeV, 'GeV')], ['Ring current', q(p.source.current_mA, 'mA')], ['Period', q(p.source.undulator.period_mm, 'mm')], ['Periods', String(p.source.undulator.periods)]]
        : [['Device', 'Bending magnet'], ['Ring energy', q(p.source.ring_GeV, 'GeV')], ['Ring current', q(p.source.current_mA, 'mA')], ['Magnetic field', q(p.source.field_T ?? 0, 'T')], ['Horizontal acceptance', q(p.source.hAccept_mrad, 'mrad')]]} />
      <Soon />
    </Fold>
    <Fold id="twin-c-mirrors" title="Mirrors">
      <Rows rows={p.mirrors.map(m => [<>{m.id}, {m.role.replace('-', ' ')}</>, <>{m.coating} coating, {q(m.angle_mrad, 'mrad')}, {m.inserted ? 'in the beam' : 'out'}</>])} />
      <Soon />
    </Fold>
    <Fold id="twin-c-mono" title="Monochromator" desktopOpen>
      <Rows rows={[['Crystals', <>Two <Tex plain>{`\\mathrm{Si}(${p.mono.crystal.slice(2)})`}</Tex></>]]} />
      <EnergyControls />
      <p className="twin-soon">Crystal choice and detune are coming next.</p>
    </Fold>
    <Fold id="twin-c-chambers" title="Ion chambers">
      <Rows rows={p.chambers.map(c => [<Tex plain>{c.id === 'I0' ? 'I_0' : c.id === 'It' ? 'I_t' : 'I_\\mathrm{ref}'}</Tex>, <>{q(c.length_cm, 'cm')} of {gas(c.gas)}, gain {q(c.gain_V_per_A.toExponential(0), 'V/A')}</>])} />
      <Soon />
    </Fold>
    <Fold id="twin-c-sample" title="Sample">
      <Rows rows={[['Material', <><Tex plain>{formulaTex(s.formula)}</Tex> {s.form}</>], ['Thickness', q(s.thickness_um, 'μm')], ['Density', q(s.density, 'g/cm³')], ['Edge', <>{s.absorber} <Tex plain>{formulaTex(s.edge)}</Tex></>]]} />
      <Soon />
    </Fold>
    <Fold id="twin-c-environment" title="Environment">
      <Rows rows={[['Setting', env.kind === 'ambient' ? 'Ambient air' : env.kind], ['Temperature', q(env.temperature_K, 'K')]]} />
      <Soon />
    </Fold>
    <Fold id="twin-c-sdd" title="Fluorescence detector">
      <Rows rows={[['Elements', String(p.sdd.elements)], ['Distance', q(p.sdd.distance_mm, 'mm')], ['Area per element', q(p.sdd.area_mm2, 'mm²')], ['Peaking time', q(p.sdd.peaking_us, 'μs')], ['Counting window', <><Num>{String(p.sdd.roi_eV[0])}</Num> to <Num>{String(p.sdd.roi_eV[1])}</Num> <Unit>eV</Unit></>]]} />
      <Soon />
    </Fold>
    <Fold id="twin-c-scan" title="Scan">
      <Rows rows={[
        ['Kind', scan.kind === 'step' ? 'Step scan' : 'Continuous scan'],
        ...scan.regions.map((r, i): [ReactNode, ReactNode] => [`Region ${i + 1}`, r.space === 'E'
          ? <><Num>{String(r.start)}</Num> to <Num>{String(r.end)}</Num> <Unit>eV</Unit> from the edge, steps of {q(r.step, 'eV')}</>
          : <><Tex plain>{`k = ${r.start}\\text{ to }${r.end}\\ \\mathring{\\mathrm{A}}^{-1}`}</Tex>, steps of <Tex plain>{`${r.step}\\ \\mathring{\\mathrm{A}}^{-1}`}</Tex></>]),
        ['Dwell', <>{q(scan.regions[0].dwell_s, 's')} per point{scan.regions.some(r => r.kWeight) && <>, longer at high <Tex plain>k</Tex></>}</>],
        ['Repeats', String(scan.repeats)],
        ['Random seed', String(twin.seed)],
      ]} />
      <Soon />
    </Fold>
  </aside>;
}
