'use client';
import { useEffect, useState } from 'react';
import { BeamScene } from '../beamline-scene';
import { Tex } from '../tex';
import { elementInfo, loadXrayData, transmittance } from '@/lib/xraydata';
import { useTwin } from './twin-store';

/** Photons into the sample assumed by the stand-in drawing until the source model is connected. */
const INCIDENT = 1e5;

/** Stand-in scene: the quick beamline drawing, driven by the twin energy and sample. The full hutch scene replaces it. */
export function TwinScene() {
  const { store: { twin, view }, dispatch } = useTwin();
  const [tables, setTables] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => { loadXrayData().then(() => setTables('ready'), () => setTables('failed')); }, []);
  const { sample, energy_eV } = twin;
  let scene = null;
  if (tables === 'ready') {
    const edge = elementInfo(sample.absorber).edges.find(e => e.edge === sample.edge);
    const fraction = transmittance(sample.formula, sample.density, sample.thickness_um, energy_eV);
    scene = <BeamScene energy={energy_eV} edgeEnergy={edge?.energy_eV ?? NaN} transmittance={fraction} incident={INCIDENT} transmitted={INCIDENT * fraction} thickness={sample.thickness_um} scanning={false} formula={sample.formula} absorber={sample.absorber} edge={sample.edge} />;
  }
  return <section className={'twin-scene' + (view.labels ? '' : ' no-labels')} aria-labelledby="twin-scene-title" hidden={view.enlarged}>
    <div className="twin-section-head">
      <h2 id="twin-scene-title">Beamline</h2>
      <button type="button" className="button secondary small" aria-pressed={view.labels} aria-keyshortcuts="L" onClick={() => dispatch({ type: 'labels' })}>Labels</button>
    </div>
    {scene ?? <div className="twin-scene-wait" role={tables === 'failed' ? 'alert' : undefined}>{tables === 'failed' ? 'The X-ray tables could not be loaded. Reload the page to try again.' : 'Loading the X-ray tables…'}</div>}
    <p className="twin-note">A stand-in for the full hutch scene, which comes next. Absorption is tabulated; the counts assume <Tex plain>{'10^5'}</Tex> photons into the sample because the source model is not connected yet.</p>
  </section>;
}
