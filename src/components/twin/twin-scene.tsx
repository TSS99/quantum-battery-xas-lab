'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Box, Eye, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { Tex } from '../tex';
import { HutchScene } from './hutch-scene';
import { useTwin } from './twin-store';

const Hutch3D = dynamic(() => import('./hutch-3d'), { ssr: false, loading: () => <div className="twin-scene-wait">Loading the 3D hutch…</div> });

const VIEW_KEY = 'xaslab-twin-hutch-view';

/** The 3D view when the browser has WebGL 2 and the user has not chosen the diagram; the choice is kept in this browser. */
function useHutchView() {
  const [webgl, setWebgl] = useState<boolean | null>(null), [diagram, setDiagram] = useState(false);
  useEffect(() => {
    let ok = false;
    try { ok = !!document.createElement('canvas').getContext('webgl2'); } catch { ok = false; }
    setWebgl(ok);
    try { setDiagram(localStorage.getItem(VIEW_KEY) === 'diagram'); } catch { /* storage unavailable: keep the default */ }
  }, []);
  const toggle = () => setDiagram(was => { try { localStorage.setItem(VIEW_KEY, was ? '3d' : 'diagram'); } catch { /* not kept */ } return !was; });
  return { webgl, show3d: webgl === true && !diagram, toggle };
}

/** The beamline hutch on the dark stage, driven by the twin state once the X-ray and optics tables have loaded. */
export function TwinScene() {
  const { store: { twin, view }, dispatch, tables, live } = useTwin();
  const [whole, setWhole] = useState(false), [reset, setReset] = useState(0);
  const { webgl, show3d, toggle } = useHutchView();
  const failed = tables === 'failed' || typeof live === 'string';
  const props = live && typeof live !== 'string' ? { twin, live, labels: view.labels, whole, part: view.part, onPart: (id: typeof view.part) => dispatch({ type: 'part', id }) } : null;
  return <section className={'twin-scene' + (view.labels ? '' : ' no-labels')} aria-labelledby="twin-scene-title" hidden={view.enlarged}>
    <h2 id="twin-scene-title" className="sr-only">Beamline</h2>
    {props ? show3d ? <Hutch3D {...props} reset={reset} /> : <HutchScene {...props} />
      : <div className="twin-scene-wait" role={failed ? 'alert' : undefined}>{tables === 'failed' ? 'The X-ray tables could not be loaded. Reload the page to try again.' : typeof live === 'string' ? 'The beamline could not be computed: ' + live : 'Loading the X-ray tables…'}</div>}
    <div className="twin-scene-foot">
      <details className="twin-note"><summary>About the drawing</summary>{show3d
        ? <p>A 3D model of a generic beamline, not to scale: the long stretches between the source, the optics and the experiment are shortened. Drag to turn the hutch, scroll or pinch to zoom, and use two fingers on a phone. The crystals are drawn at a Bragg angle held between <Tex plain>{'7^\\circ'}</Tex> and <Tex plain>{'40^\\circ'}</Tex> so both stay visible; the readings give the true angle. Readings are expected values from the source, optics, ion chamber and sample models, without noise. The electron-yield model is relative, so the drain current has no reading.</p>
        : <p>Not to scale: the beamline is shortened at the break symbols. The crystals are drawn at a Bragg angle held between <Tex plain>{'7^\\circ'}</Tex> and <Tex plain>{'40^\\circ'}</Tex> so both stay visible; the readings give the true angle. Readings are expected values from the source, optics, ion chamber and sample models, without noise. The electron-yield model is relative, so the drain current has no reading.</p>}</details>
      <div className="twin-scene-tools">
        {webgl && <button type="button" className="twin-icon" aria-pressed={show3d} title={show3d ? 'Show the diagram' : 'Show the 3D view'} onClick={toggle}>
          <Box size={16} aria-hidden="true" /><span className="sr-only">3D view</span>
        </button>}
        {show3d && <button type="button" className="twin-icon" title="Reset the view" onClick={() => setReset(n => n + 1)}><RotateCcw size={16} aria-hidden="true" /><span className="sr-only">Reset view</span></button>}
        <button type="button" className="twin-icon twin-whole" aria-pressed={whole} title={whole ? 'Close-up on this mode' : 'Whole beamline (labels become dots)'} onClick={() => setWhole(!whole)}>
          {whole ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}<span className="sr-only">Whole beamline</span>
        </button>
        <button type="button" className="twin-icon" aria-pressed={view.labels} aria-keyshortcuts="L" title="Labels (L)" onClick={() => dispatch({ type: 'labels' })}><Eye size={16} aria-hidden="true" /><span className="sr-only">Labels</span></button>
      </div>
    </div>
  </section>;
}
