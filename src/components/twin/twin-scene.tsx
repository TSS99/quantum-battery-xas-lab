'use client';
import { memo, useCallback, useDeferredValue, useEffect, useRef, useState, type ComponentType } from 'react';
import { Box, Camera, Eye, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { Tex } from '../tex';
import { HutchScene } from './hutch-scene';
import { useTwin } from './twin-store';

const Diagram = memo(HutchScene);
type Hutch3DView = ComponentType<import('./hutch-3d').Hutch3DProps>;
/** The 3D code and its textures, fetched once; the view switches over only when both are in. */
let loading3D: Promise<Hutch3DView> | null = null;
const load3D = () => loading3D ??= import('./hutch-3d').then(async m => { await m.texturesReady; return m.default; }).catch(error => { loading3D = null; throw error; });

const VIEW_KEY = 'xaslab-twin-hutch-view';

/** The 3D view when the browser has WebGL 2 and the user has not chosen the diagram; the choice is kept in this browser. */
function useHutchView() {
  const [webgl, setWebgl] = useState<boolean | null>(null), [diagram, setDiagram] = useState(false);
  useEffect(() => {
    let ok = false;
    try { ok = !!document.createElement('canvas').getContext('webgl2'); } catch { ok = false; }
    setWebgl(ok);
    let diagram = false;
    try { diagram = localStorage.getItem(VIEW_KEY) === 'diagram'; } catch { /* storage unavailable: keep the default */ }
    setDiagram(diagram);
  }, []);
  const toggle = () => setDiagram(was => { try { localStorage.setItem(VIEW_KEY, was ? '3d' : 'diagram'); } catch { /* not kept */ } return !was; });
  return { webgl, show3d: webgl === true && !diagram, toggle };
}

/** The beamline hutch on the dark stage, driven by the twin state once the X-ray and optics tables have loaded. */
export function TwinScene() {
  const { store: { twin, view }, dispatch, tables, live } = useTwin();
  const [whole, setWhole] = useState(false), [reset, setReset] = useState(0), [shot, setShot] = useState(0), [shooting, setShooting] = useState(false);
  // The 4K image downloads as a PNG named after the mode and energy, and the change note says what was saved. The
  // callback reads them from a ref so it stays the same function: a new one on every step would redraw the 3D view.
  const named = useRef(twin);
  useEffect(() => { named.current = twin; });
  const onShot = useCallback((image: Blob | null, width: number, height: number) => {
    setShooting(false);
    if (!image) { dispatch({ type: 'note', text: 'The 4K image could not be made in this browser.' }); return; }
    const url = URL.createObjectURL(image), a = document.createElement('a'), { mode, energy_eV } = named.current;
    a.href = url; a.download = `xas-lab-hutch-${mode}-${energy_eV.toFixed(0)}eV-${width}x${height}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    dispatch({ type: 'note', text: `Saved a ${width} by ${height} pixel image of the hutch.` });
  }, [dispatch]);
  const { webgl, show3d, toggle } = useHutchView();
  const failed = tables === 'failed' || typeof live === 'string';
  // The diagram shows as soon as the X-ray tables are in; the 3D view loads after them (so it never delays the first
  // drawing) and takes over once its code and textures have arrived. Until then the scene says it is busy.
  const [three, setThree] = useState<{ view: Hutch3DView } | 'failed' | null>(null);
  const tablesIn = !!live && typeof live !== 'string';
  useEffect(() => {
    if (!show3d || !tablesIn || three) return;
    let on = true;
    load3D().then(view => { if (on) setThree({ view }); }, () => { if (on) setThree('failed'); });
    return () => { on = false; };
  }, [show3d, tablesIn, three]);
  const Three = three && three !== 'failed' ? three.view : null;
  // The drawing follows a deferred copy of the state: the controls answer at once, and the drawing, the heaviest part
  // of the page, catches up in the background without holding up the next key press or drag.
  const shownTwin = useDeferredValue(twin), shownLive = useDeferredValue(live);
  const onPart = useCallback((id: typeof view.part) => dispatch({ type: 'part', id }), [dispatch]);
  const props = shownLive && typeof shownLive !== 'string' ? { twin: shownTwin, live: shownLive, labels: view.labels, whole, part: view.part, onPart } : null;
  return <section className={'twin-scene' + (view.labels ? '' : ' no-labels')} aria-labelledby="twin-scene-title" hidden={view.enlarged} aria-busy={!!props && show3d && !three}>
    <h2 id="twin-scene-title" className="sr-only">Beamline</h2>
    {props ? show3d && Three ? <Three {...props} reset={reset} shot={shot} onShot={onShot} /> : <Diagram {...props} />
      : <div className="twin-scene-wait" role={failed ? 'alert' : undefined}>{tables === 'failed' ? 'The X-ray tables could not be loaded. Reload the page to try again.' : typeof live === 'string' ? 'The beamline could not be computed: ' + live : 'Loading the X-ray tables…'}</div>}
    <div className="twin-scene-foot">
      <details className="twin-note"><summary>About the drawing</summary>{show3d && Three
        ? <p>A 3D model of a generic beamline. The hardware is drawn at real size (one scene unit is a centimetre), but the long stretches between the source, the optics and the experiment are shortened; the beam's size follows the real distances. X-rays are invisible: the dots are packets of photons in a false energy colour, slowed about a hundred million times, and every reflection, absorption and emission they show follows the twin's models. The ion chamber and tank fronts are drawn as windows so you can see inside. Drag to turn the hutch, scroll or pinch to zoom, and use two fingers on a phone. The crystals are drawn at a Bragg angle held between <Tex plain>{'7^\\circ'}</Tex> and <Tex plain>{'40^\\circ'}</Tex> so both stay visible; the readings give the true angle. Readings are expected values from the source, optics, ion chamber and sample models, without noise. The electron-yield model is relative, so the drain current has no reading.</p>
        : <p>Not to scale: the beamline is shortened at the break symbols. The crystals are drawn at a Bragg angle held between <Tex plain>{'7^\\circ'}</Tex> and <Tex plain>{'40^\\circ'}</Tex> so both stay visible; the readings give the true angle. Readings are expected values from the source, optics, ion chamber and sample models, without noise. The electron-yield model is relative, so the drain current has no reading.</p>}</details>
      <div className="twin-scene-tools">
        {webgl && <button type="button" className="twin-icon" aria-pressed={show3d} title={show3d ? 'Show the diagram' : 'Show the 3D view'} onClick={toggle}>
          <Box size={16} aria-hidden="true" /><span className="sr-only">3D view</span>
        </button>}
        {show3d && Three && <button type="button" className="twin-icon" title="Save a 4K image of this view" disabled={shooting} onClick={() => { setShooting(true); setShot(n => n + 1); }}><Camera size={16} aria-hidden="true" /><span className="sr-only">Save 4K image</span></button>}
        {show3d && Three && <button type="button" className="twin-icon" title="Reset the view" onClick={() => setReset(n => n + 1)}><RotateCcw size={16} aria-hidden="true" /><span className="sr-only">Reset view</span></button>}
        <button type="button" className="twin-icon twin-whole" aria-pressed={whole} title={whole ? 'Close-up on this mode' : 'Whole beamline (labels become dots)'} onClick={() => setWhole(!whole)}>
          {whole ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}<span className="sr-only">Whole beamline</span>
        </button>
        <button type="button" className="twin-icon" aria-pressed={view.labels} aria-keyshortcuts="L" title="Labels (L)" onClick={() => dispatch({ type: 'labels' })}><Eye size={16} aria-hidden="true" /><span className="sr-only">Labels</span></button>
      </div>
    </div>
  </section>;
}
