'use client';
import { useEffect, useMemo, useState } from 'react';
import { Tex } from '../tex';
import { loadXrayData } from '@/lib/xraydata';
import { loadOptics } from '@/lib/twin/tables';
import { HutchScene } from './hutch-scene';
import { hutchLive } from './hutch-live';
import { useTwin } from './twin-store';

/** The beamline hutch, driven by the twin state once the X-ray and optics tables have loaded. */
export function TwinScene() {
  const { store: { twin, view }, dispatch } = useTwin();
  const [tables, setTables] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => { Promise.all([loadXrayData(), loadOptics()]).then(() => setTables('ready'), () => setTables('failed')); }, []);
  const live = useMemo(() => {
    if (tables !== 'ready') return null;
    try { return hutchLive(twin); } catch (error) { return error instanceof Error ? error.message : String(error); }
  }, [tables, twin]);
  const failed = tables === 'failed' || typeof live === 'string';
  return <section className={'twin-scene' + (view.labels ? '' : ' no-labels')} aria-labelledby="twin-scene-title" hidden={view.enlarged}>
    <div className="twin-section-head">
      <h2 id="twin-scene-title">Beamline</h2>
      <button type="button" className="button secondary small" aria-pressed={view.labels} aria-keyshortcuts="L" onClick={() => dispatch({ type: 'labels' })}>Labels</button>
    </div>
    {live && typeof live !== 'string' ? <HutchScene twin={twin} live={live} labels={view.labels} />
      : <div className="twin-scene-wait" role={failed ? 'alert' : undefined}>{tables === 'failed' ? 'The X-ray tables could not be loaded. Reload the page to try again.' : typeof live === 'string' ? 'The beamline could not be computed: ' + live : 'Loading the X-ray tables…'}</div>}
    <p className="twin-note">Not to scale: the beamline is shortened at the break symbols. The crystals are drawn at a Bragg angle held between <Tex plain>{'7^\\circ'}</Tex> and <Tex plain>{'40^\\circ'}</Tex> so both stay visible; the readings give the true angle. Readings are expected values from the source, optics, ion chamber and sample models, without noise. The reference foil is not modelled yet, so the beam is not dimmed after it and <Tex plain>{'I_\\mathrm{ref}'}</Tex> shows no reading; the electron-yield model is relative, so the drain current has none either.</p>
  </section>;
}
