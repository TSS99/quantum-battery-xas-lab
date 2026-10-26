'use client';
import { memo, useCallback, useDeferredValue, useEffect, useRef, useState, type ComponentType } from 'react';
import { Box, Camera, Expand, Eye, Maximize2, Minimize2, Play, RotateCcw, Shrink, Square, Video } from 'lucide-react';
import { Tex } from '../tex';
import { HutchScene } from './hutch-scene';
import { useTwin } from './twin-store';

const Diagram = memo(HutchScene);
type Hutch3DView = ComponentType<import('./hutch-3d').Hutch3DProps>;
/** The 3D code and its textures, fetched once; the view switches over only when both are in. */
let loading3D: Promise<Hutch3DView> | null = null;
const load3D = () => loading3D ??= import('./hutch-3d').then(async m => { await m.texturesReady; return m.default; }).catch(error => { loading3D = null; throw error; });

// Renamed in v1.9.1 so a diagram chosen before then no longer overrides the 3D default.
const VIEW_KEY = 'xaslab-twin-hutch-view-2';
const POSTER = (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/images/twin/hutch-poster.webp';

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
  return { webgl, diagram, show3d: webgl === true && !diagram, toggle };
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
  // The guided tour plays in the scene; recorded, it downloads as a video when it ends. Recording needs MediaRecorder
  // and a canvas stream, which every current desktop browser has.
  const [tour, setTour] = useState<'play' | 'record' | null>(null), [canRecord, setCanRecord] = useState(false);
  const touring = useRef(tour);
  useEffect(() => { touring.current = tour; });
  useEffect(() => setCanRecord(typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype), []);
  const onTour = useCallback((end: 'stopped' | 'done', video: Blob | null) => {
    const recording = touring.current === 'record';
    setTour(null);
    if (!recording) return;
    if (end === 'stopped') { dispatch({ type: 'note', text: 'Recording stopped. No video was saved.' }); return; }
    if (!video) { dispatch({ type: 'note', text: 'The tour could not be recorded in this browser.' }); return; }
    const url = URL.createObjectURL(video), a = document.createElement('a');
    a.href = url; a.download = 'xas-lab-beamline-tour.' + (video.type.includes('mp4') ? 'mp4' : 'webm'); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    dispatch({ type: 'note', text: 'Saved the guided tour as a video.' });
  }, [dispatch]);
  const { webgl, diagram, show3d, toggle } = useHutchView();
  const failed = tables === 'failed' || typeof live === 'string';
  // The 3D view is the default: its code and textures load alongside the X-ray tables, and a still of the hutch stands
  // in until both are in. The diagram shows only when chosen, without WebGL 2, or if the 3D code fails to load.
  const [three, setThree] = useState<{ view: Hutch3DView } | 'failed' | null>(null);
  useEffect(() => {
    if (!show3d || three) return;
    let on = true;
    load3D().then(view => { if (on) setThree({ view }); }, () => { if (on) setThree('failed'); });
    return () => { on = false; };
  }, [show3d, three]);
  const useDiagram = webgl === false || diagram || three === 'failed';
  const Three = three && three !== 'failed' ? three.view : null;
  // The drawing follows a deferred copy of the state: the controls answer at once, and the drawing, the heaviest part
  // of the page, catches up in the background without holding up the next key press or drag.
  const shownTwin = useDeferredValue(twin), shownLive = useDeferredValue(live);
  const onPart = useCallback((id: typeof view.part) => dispatch({ type: 'part', id }), [dispatch]);
  const props = shownLive && typeof shownLive !== 'string' ? { twin: shownTwin, live: shownLive, labels: view.labels, whole, part: view.part, onPart } : null;
  return <section className={'twin-scene' + (view.labels ? '' : ' no-labels')} aria-labelledby="twin-scene-title" hidden={view.enlarged} aria-busy={!!props && show3d && !three}>
    <h2 id="twin-scene-title" className="sr-only">Beamline</h2>
    {failed ? <div className="twin-scene-wait" role="alert">{tables === 'failed' ? 'The X-ray tables could not be loaded. Reload the page to try again.' : 'The beamline could not be computed: ' + live}</div>
      : props && show3d && Three ? <Three {...props} reset={reset} shot={shot} onShot={onShot} tour={tour} onTour={onTour} />
      : props && useDiagram ? <Diagram {...props} />
      : <div className="twin-scene-poster" role="img" aria-label="The 3D hutch is loading">
        <img src={POSTER} alt="" width={1280} height={720} decoding="async" fetchPriority="high" />
        <span>{props ? 'Loading the 3D hutch…' : 'Loading the X-ray tables…'}</span>
      </div>}
    <div className="twin-scene-foot">
      <details className="twin-note"><summary>About the drawing</summary>{show3d && Three
        ? <p>A 3D model of a generic beamline. The hardware is drawn at real size (one scene unit is a centimetre), but the long stretches between the source, the optics and the experiment are shortened; the beam's size follows the real distances. X-rays are invisible: the dots are packets of photons in a false energy colour, slowed about a hundred million times, and every reflection, absorption and emission they show follows the twin's models. The ion chamber and tank fronts are drawn as windows so you can see inside. Drag to turn the hutch, scroll or pinch to zoom, and use two fingers on a phone. The crystals are drawn at a Bragg angle held between <Tex plain>{'7^\\circ'}</Tex> and <Tex plain>{'40^\\circ'}</Tex> so both stay visible; the readings give the true angle. Readings are expected values from the source, optics, ion chamber and sample models, without noise. The electron-yield model is relative, so the drain current has no reading.</p>
        : <p>Not to scale: the beamline is shortened at the break symbols. The crystals are drawn at a Bragg angle held between <Tex plain>{'7^\\circ'}</Tex> and <Tex plain>{'40^\\circ'}</Tex> so both stay visible; the readings give the true angle. Readings are expected values from the source, optics, ion chamber and sample models, without noise. The electron-yield model is relative, so the drain current has no reading.</p>}</details>
      <div className="twin-scene-tools">
        {webgl && <button type="button" className="twin-icon" aria-pressed={show3d} title={show3d ? 'Show the diagram' : 'Show the 3D view'} onClick={toggle}>
          <Box size={16} aria-hidden="true" /><span className="sr-only">3D view</span>
        </button>}
        {show3d && Three && <button type="button" className="twin-icon" aria-pressed={tour === 'play'} title={tour === 'play' ? 'Stop the tour (Escape)' : 'Guided tour'} disabled={tour === 'record'} onClick={() => setTour(tour === 'play' ? null : 'play')}>
          {tour === 'play' ? <Square size={15} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}<span className="sr-only">Guided tour</span>
        </button>}
        {show3d && Three && canRecord && <button type="button" className="twin-icon" aria-pressed={tour === 'record'} title={tour === 'record' ? 'Stop recording (Escape)' : 'Record the tour as a video'} disabled={tour === 'play'} onClick={() => tour === 'record' ? onTour('stopped', null) : setTour('record')}>
          {tour === 'record' ? <Square size={15} aria-hidden="true" /> : <Video size={16} aria-hidden="true" />}<span className="sr-only">Record the tour</span>
        </button>}
        {show3d && Three && <button type="button" className="twin-icon" title="Save a 4K image of this view" disabled={shooting} onClick={() => { setShooting(true); setShot(n => n + 1); }}><Camera size={16} aria-hidden="true" /><span className="sr-only">Save 4K image</span></button>}
        <button type="button" className="twin-icon" aria-pressed={view.cinema} title={view.cinema ? 'Show the panels again (Escape)' : 'Scene only'} onClick={() => dispatch({ type: 'cinema' })}>{view.cinema ? <Shrink size={16} aria-hidden="true" /> : <Expand size={16} aria-hidden="true" />}<span className="sr-only">Scene only</span></button>
        {show3d && Three && <button type="button" className="twin-icon" title="Reset the view" onClick={() => setReset(n => n + 1)}><RotateCcw size={16} aria-hidden="true" /><span className="sr-only">Reset view</span></button>}
        <button type="button" className="twin-icon twin-whole" aria-pressed={whole} title={whole ? 'Close-up on this mode' : 'Whole beamline (labels become dots)'} onClick={() => setWhole(!whole)}>
          {whole ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}<span className="sr-only">Whole beamline</span>
        </button>
        <button type="button" className="twin-icon" aria-pressed={view.labels} aria-keyshortcuts="L" title="Labels (L)" onClick={() => dispatch({ type: 'labels' })}><Eye size={16} aria-hidden="true" /><span className="sr-only">Labels</span></button>
      </div>
    </div>
  </section>;
}
