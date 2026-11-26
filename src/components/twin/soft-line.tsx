'use client';
/**
 * The twin's soft X-ray beamline (step 11 of docs/PLAN-quantum.md): the 3D beamline with its part cards above the
 * measurement of step 5 (the quantum page's beamline card), which drives it: the energy turns the grating, the
 * resolving power opens or closes the exit slit, and the detection lights its detector.
 */
import dynamic from 'next/dynamic';
import { useState } from 'react';
import MeasureCard from '../quantum/measure-card';
import { CFF, GRATING_LINES_PER_MM, exitSlitGap_um, gratingAngles, relativeFlux, softPart, type SoftPartId, type SoftSettings } from './soft-parts';

const Soft3D = dynamic(() => import('./soft-3d'), { ssr: false, loading: () => <div className="soft-canvas soft-empty">Loading the beamline…</div> });

function facts(id: SoftPartId, s: SoftSettings): string[] {
  if (id === 'pgm') {
    const g = gratingAngles(s.energy_eV);
    return [`${GRATING_LINES_PER_MM} lines per mm, first order, cff ${CFF}`, `At ${s.energy_eV.toFixed(1)} eV: incidence ${g.alpha_deg.toFixed(2)}°, diffraction ${g.beta_deg.toFixed(2)}° from the grating normal`,
      `Plane mirror at ${g.mirror_grazing_deg.toFixed(2)}° grazing`];
  }
  if (id === 'exit-slit') return [`Gap ${exitSlitGap_um(s.resolvingPower).toFixed(1)} um for E/ΔE = ${s.resolvingPower.toLocaleString('en')}`,
    `${relativeFlux(s.resolvingPower).toFixed(2)} times the flux at 25 um (model: resolving power inverse in the gap, flux in proportion)`];
  if (id === 'drain') return [s.detection === 'tey' ? 'Reading: total electron yield' : 'Idle: the measurement reads fluorescence'];
  if (id === 'sdd') return [s.detection === 'fy' ? 'Reading: total fluorescence yield' : 'Idle: the measurement reads electron yield'];
  return [];
}

export function SoftLine() {
  const [settings, setSettings] = useState<SoftSettings>({ energy_eV: 560, resolvingPower: 5000, detection: 'tey' });
  const [open, setOpen] = useState<SoftPartId | null>(null);
  const part = open && softPart(open);
  return <div className="soft-line">
    <section className="twin-card soft-scene" aria-labelledby="soft-title">
      <h2 id="soft-title" className="twin-kicker">Soft X-ray beamline, for the oxygen K edge</h2>
      <Soft3D settings={settings} open={open} onPart={setOpen} />
      {part ? <div id="soft-card" className="soft-card" role="region" aria-label={part.name}>
        <h3>{part.name}</h3>
        <p>{part.role}</p>
        {facts(part.id, settings).length > 0 && <ul>{facts(part.id, settings).map(f => <li key={f}>{f}</li>)}</ul>}
      </div> : <p className="soft-hint">Pick any label on the beamline for what that part does. Drag to turn the view.</p>}
    </section>
    <div className="soft-measure"><MeasureCard id="li2mno3-o2-k" onBeamline={setSettings} /></div>
  </div>;
}
