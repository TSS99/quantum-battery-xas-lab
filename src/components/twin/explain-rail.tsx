'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { Num, Tex, Unit } from '../tex';
import type { TwinMode } from '@/lib/twin/types';
import { modeInfo } from './twin-state';
import { useTwin } from './twin-store';
import { TexProse } from './tex-prose';
import { Fold, NARROW_QUERY } from './fold';
import { partOf } from './hutch-parts';
import { PART_PHYSICS, partEquation } from './part-physics';
import type { HutchLive } from './hutch-live';

type StatId = 'energy' | 'flux' | 'trans' | 'edgeStep' | 'i0' | 'it' | 'iref' | 'fluor' | 'dead' | 'dose' | 'resolution' | 'harmonic';

/** The four readings each mode puts under its explanation. */
const STATS: Record<TwinMode, readonly StatId[]> = {
  transmission: ['energy', 'trans', 'edgeStep', 'i0'],
  fluorescence: ['energy', 'fluor', 'dead', 'i0'],
  'electron-yield': ['energy', 'flux', 'trans', 'dose'],
  xrf: ['energy', 'fluor', 'dead', 'flux'],
  mono: ['energy', 'resolution', 'harmonic', 'flux'],
  calibration: ['energy', 'it', 'iref', 'trans'],
  'time-resolved': ['energy', 'trans', 'i0', 'it'],
  damage: ['energy', 'dose', 'flux', 'trans'],
};

const sci = (value: number) => <Num>{value.toExponential(2)}</Num>;
const pct = (fraction: number) => <Num>{(fraction * 100).toFixed(fraction < 0.001 ? 3 : 1) + '%'}</Num>;
const chamberTex = { i0: 'I_0', it: 'I_t', iref: 'I_\\mathrm{ref}' } as const;

/** Label, value and a short note for one reading; the value is a dash when the models give none. */
function stat(id: StatId, live: HutchLive): [ReactNode, ReactNode, ReactNode] {
  switch (id) {
    case 'energy': return ['Photon energy', <><Num>{live.energy_eV.toFixed(1)}</Num> <Unit>eV</Unit></>,
      live.theta_deg === null ? 'Bragg angle out of range' : <>Bragg angle <Tex plain>{`\\theta = ${live.theta_deg.toFixed(3)}^\\circ`}</Tex></>];
    case 'flux': return [<>Flux at <Tex plain>{'I_0'}</Tex></>, live.flux === null ? '—' : <>{sci(live.flux)} <Unit>s^-1</Unit></>, 'photons per second'];
    case 'trans': return ['Sample transmission', live.sampleTransmission === null ? '—' : pct(live.sampleTransmission), 'sample and its windows'];
    case 'edgeStep': return [<>Edge step <Tex plain>{'\\Delta\\mu x'}</Tex></>, live.edgeStep === null ? '—' : <Num>{live.edgeStep.toFixed(2)}</Num>, 'near 1 is ideal'];
    case 'i0': case 'it': case 'iref': {
      const c = live[id];
      return [<><Tex plain>{chamberTex[id]}</Tex> current</>, c ? <>{sci(c.current_A)} <Unit>A</Unit></> : '—',
        c ? c.saturated ? 'amplifier clipped at 10 V' : <>reads <Num>{c.voltage_V.toFixed(3)}</Num> <Unit>V</Unit></> : 'no beam reaches it'];
    }
    case 'fluor': return ['Fluorescence line', live.fluorescence_per_s === null ? '—' : <>{sci(live.fluorescence_per_s)} <Unit>s^-1</Unit></>, 'at the detector, before dead time'];
    case 'dead': return ['Dead time', live.deadFraction === null ? '—' : pct(live.deadFraction), 'events the detector loses'];
    case 'dose': return ['Surface dose rate', live.doseRate_Gy_per_s === null ? '—' : <>{sci(live.doseRate_Gy_per_s)} <Unit>Gy/s</Unit></>, 'where the beam enters'];
    case 'resolution': return [<>Resolution <Tex plain>{'\\Delta E'}</Tex></>, live.deltaE_eV === null ? '—' : <><Num>{live.deltaE_eV.toFixed(2)}</Num> <Unit>eV</Unit></>, 'crystals and beam divergence'];
    case 'harmonic': return ['Harmonic content', live.harmonicFraction === null ? '—' : sci(live.harmonicFraction), 'of the flux at the sample'];
  }
}

/** Left card: what the mode shows (or the part picked in the scene), the last change, and the mode's key readings. */
export function ExplainRail() {
  const { store: { twin, view }, dispatch, live } = useTwin();
  const info = modeInfo(twin.mode);
  const readings = live && typeof live === 'object' ? live : null;
  const part = view.part ? partOf(view.part) : null;
  const card = useRef<HTMLElement>(null);
  // On phones the card sits below the scene, so bring it into view when a part is picked.
  useEffect(() => {
    if (part && matchMedia(NARROW_QUERY).matches) card.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [part]);
  const closePart = () => {
    const id = view.part;
    dispatch({ type: 'part', id: null });
    document.querySelector<HTMLElement>(`[data-part-button="${id}"]`)?.focus();
  };
  const physics = part && PART_PHYSICS[part.id];
  const physicsLive = part && readings && physics?.live ? physics.live(twin, readings) : null;

  return <aside className="twin-card twin-left" aria-label="Explanation">
    {part
      ? <section id="hutch-card" ref={card} className="twin-part" aria-labelledby="hutch-card-title" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closePart(); } }}>
        <p className="twin-kicker">The instrument</p>
        <h2 id="hutch-card-title" className="twin-title">{part.name}</h2>
        <p className="twin-body">{part.role}</p>
        {physics && <div className="twin-physics">
          <Tex block>{partEquation(part.id, twin)}</Tex>
          {physicsLive && <p className="twin-part-live"><TexProse>{physicsLive}</TexProse></p>}
        </div>}
        {physics && <dl className="twin-part-notes">
          <div><dt className="twin-kicker">Typical</dt><dd><TexProse>{physics.typical}</TexProse></dd></div>
          <div><dt className="twin-kicker">What goes wrong</dt><dd><TexProse>{physics.wrong}</TexProse></dd></div>
        </dl>}
        {physics && <p className="twin-source"><TexProse>{physics.source}</TexProse></p>}
        <button type="button" className="twin-chip" onClick={closePart}>Back to {info.name.toLowerCase()}</button>
      </section>
      : <Fold id="twin-looking" title="What you are looking at" level={2} desktopOpen className="twin-looking">
        <p className="twin-title">{info.headline[0]} <em>{info.headline[1]}</em></p>
        <p className="twin-body"><TexProse>{info.looking}</TexProse></p>
      </Fold>}
    <div className="twin-changed">
      <h2 className="twin-kicker">What just changed</h2>
      <p aria-live="polite">{view.change ? <TexProse>{view.change}</TexProse> : 'Nothing yet. Choose a mode or change a control and the effect is described here.'}</p>
    </div>
    {readings && <dl className="twin-stats" aria-label="Live readings">
      {STATS[twin.mode].map(id => { const [label, value, note] = stat(id, readings); return <div key={id}><dt>{label}</dt><dd>{value}</dd><dd className="twin-stat-note">{note}</dd></div>; })}
    </dl>}
  </aside>;
}
