'use client';
import { useState } from 'react';
import { Eye, Maximize2, Minimize2 } from 'lucide-react';
import { Tex } from '../tex';
import { HutchScene } from './hutch-scene';
import { useTwin } from './twin-store';

/** The beamline hutch on the dark stage, driven by the twin state once the X-ray and optics tables have loaded. */
export function TwinScene() {
  const { store: { twin, view }, dispatch, tables, live } = useTwin();
  const [whole, setWhole] = useState(false);
  const failed = tables === 'failed' || typeof live === 'string';
  return <section className={'twin-scene' + (view.labels ? '' : ' no-labels')} aria-labelledby="twin-scene-title" hidden={view.enlarged}>
    <h2 id="twin-scene-title" className="sr-only">Beamline</h2>
    {live && typeof live !== 'string' ? <HutchScene twin={twin} live={live} labels={view.labels} whole={whole} part={view.part} onPart={id => dispatch({ type: 'part', id })} />
      : <div className="twin-scene-wait" role={failed ? 'alert' : undefined}>{tables === 'failed' ? 'The X-ray tables could not be loaded. Reload the page to try again.' : typeof live === 'string' ? 'The beamline could not be computed: ' + live : 'Loading the X-ray tables…'}</div>}
    <div className="twin-scene-foot">
      <details className="twin-note"><summary>About the drawing</summary><p>Not to scale: the beamline is shortened at the break symbols. The crystals are drawn at a Bragg angle held between <Tex plain>{'7^\\circ'}</Tex> and <Tex plain>{'40^\\circ'}</Tex> so both stay visible; the readings give the true angle. Readings are expected values from the source, optics, ion chamber and sample models, without noise. The electron-yield model is relative, so the drain current has no reading.</p></details>
      <div className="twin-scene-tools">
        <button type="button" className="twin-icon twin-whole" aria-pressed={whole} title={whole ? 'Close-up on this mode' : 'Whole beamline (labels become dots)'} onClick={() => setWhole(!whole)}>
          {whole ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}<span className="sr-only">Whole beamline</span>
        </button>
        <button type="button" className="twin-icon" aria-pressed={view.labels} aria-keyshortcuts="L" title="Labels (L)" onClick={() => dispatch({ type: 'labels' })}><Eye size={16} aria-hidden="true" /><span className="sr-only">Labels</span></button>
      </div>
    </div>
  </section>;
}
