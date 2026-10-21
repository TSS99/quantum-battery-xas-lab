'use client';
import { useEffect, useRef, useState, type Dispatch } from 'react';
import Link from 'next/link';
import { ArrowLeft, FlaskConical, FolderArchive, GraduationCap, Keyboard, PanelLeft, PanelRight, SquareTerminal } from 'lucide-react';
import { energyChange, shortcutAction, type TwinAction } from './twin-state';
import { TwinProvider, useTwin } from './twin-store';
import { ModeBar } from './mode-bar';
import { TwinScene } from './twin-scene';
import { ResultsDock } from './results-dock';
import { ExplainRail } from './explain-rail';
import { ControlRail } from './control-rail';
import { ShortcutsDialog } from './shortcuts-dialog';
import { CalibrateDialog } from './calibrate-dialog';
import { SessionDialog } from './session-dialog';
import { Training } from './training';
import { NARROW_QUERY } from './fold';

// Inputs that take typed text; the others (buttons, checkboxes, sliders) leave the shortcut keys free.
const KEY_FREE_INPUTS = ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'];
function typingIn(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest('textarea, select, [role="textbox"]') ||
    target instanceof HTMLInputElement && !KEY_FREE_INPUTS.includes(target.type));
}

/** Page shortcuts (keys 1 to 8, C, L, I, X, T, Space, [ and ]), never while typing and never inside a dialog. */
function useShortcuts(dispatch: Dispatch<TwinAction>) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('dialog')) return;
      if (typingIn(event.target)) return;
      if (event.key === 'Escape') { dispatch({ type: 'enlarge', value: false }); return; }
      if (event.key === ' ') {
        // Space pauses or resumes a running scan, except on controls that Space itself operates.
        if (event.repeat || event.target instanceof Element && event.target.closest('button, a, summary, [role="tab"], [role="slider"], [tabindex]')) return;
        const pause = document.querySelector<HTMLButtonElement>('[data-scan-pause]');
        if (pause) { event.preventDefault(); pause.click(); }
        return;
      }
      const action = event.repeat ? null : shortcutAction(event.key);
      // The one-column layout always shows both rails, so [ and ] would announce a change that does not happen.
      if (!action || action.type === 'rail' && matchMedia(NARROW_QUERY).matches) return;
      event.preventDefault();
      dispatch(action);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
}

/** Describes the energy once the slider or field settles, so screen readers hear one line rather than every step. */
function useEnergyNote(energy_eV: number, dispatch: Dispatch<TwinAction>) {
  const described = useRef(energy_eV);
  useEffect(() => {
    if (energy_eV === described.current) return;
    const timer = setTimeout(() => { described.current = energy_eV; dispatch({ type: 'note', text: energyChange(energy_eV) }); }, 400);
    return () => clearTimeout(timer);
  }, [energy_eV, dispatch]);
}

function TwinLayout() {
  const { store: { twin, view }, dispatch } = useTwin();
  const [keysOpen, setKeysOpen] = useState(false);
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const keysButton = useRef<HTMLButtonElement>(null);
  const calibrateButton = useRef<HTMLButtonElement>(null);
  const sessionButton = useRef<HTMLButtonElement>(null);
  useShortcuts(dispatch);
  useEnergyNote(twin.energy_eV, dispatch);
  const closeKeys = () => { setKeysOpen(false); keysButton.current?.focus(); };
  const closeCalibrate = () => { setCalibrateOpen(false); calibrateButton.current?.focus(); };
  const closeSession = () => { setSessionOpen(false); sessionButton.current?.focus(); };
  return <div className={'twin-app' + (view.enlarged ? ' is-enlarged' : '') + (view.leftHidden ? ' left-hidden' : '') + (view.rightHidden ? ' right-hidden' : '')}>
    <div className="twin-col twin-col-left">
      <header className="twin-hero">
        <nav aria-label="Breadcrumb" className="twin-crumbs"><ol>
          <li><Link href="/">XAS Lab</Link></li>
          <li><Link href="/twin/" aria-current="page">Beamline twin</Link><span className="preview-badge">Preview</span></li>
        </ol></nav>
        <h1>Beamline <em>twin</em></h1>
        <p className="twin-intro">A working X-ray absorption beamline. Every reading comes from tabulated cross sections and optics: the beam crosses the mirrors, the monochromator, the sample and the detectors as it would at a synchrotron.</p>
        <p className="twin-hint">Pick any label on the beamline for the physics of that part.</p>
        <div className="twin-chips">
          <Link className="twin-chip" href="/"><ArrowLeft size={14} aria-hidden="true" />XAS Lab</Link>
          <Link className="twin-chip" href="/validation/">Methods</Link>
        </div>
      </header>
      <Training />
      <ExplainRail />
    </div>
    <div className="twin-col twin-col-centre">
      <ModeBar />
      <TwinScene />
      <ResultsDock />
    </div>
    <div className="twin-col twin-col-right">
      <div className="twin-toolbar twin-card" role="group" aria-label="Page tools">
        <p className="twin-kicker" aria-hidden="true">Controls</p>
        <div className="twin-toolbar-buttons">
          <button type="button" className="twin-chip is-accent" aria-haspopup="dialog" aria-keyshortcuts="T" onClick={() => dispatch({ type: 'training', open: true })}><GraduationCap size={15} aria-hidden="true" />Training</button>
          <button type="button" className="twin-icon" ref={sessionButton} aria-haspopup="dialog" title="Session" onClick={() => setSessionOpen(true)}><FolderArchive size={16} aria-hidden="true" /><span className="sr-only">Session</span></button>
          <button type="button" className="twin-icon" ref={calibrateButton} aria-haspopup="dialog" title="Calibrate from data" onClick={() => setCalibrateOpen(true)}><FlaskConical size={16} aria-hidden="true" /><span className="sr-only">Calibrate from data</span></button>
          <button type="button" className="twin-icon" aria-haspopup="dialog" aria-keyshortcuts="`" title="Console (`)" onClick={() => window.dispatchEvent(new Event('xaslab:console'))}><SquareTerminal size={16} aria-hidden="true" /><span className="sr-only">Console</span></button>
          <button type="button" className="twin-icon" ref={keysButton} aria-haspopup="dialog" title="Keyboard shortcuts" onClick={() => setKeysOpen(true)}><Keyboard size={16} aria-hidden="true" /><span className="sr-only">Keyboard shortcuts</span></button>
          <button type="button" className="twin-icon twin-rail-toggle" aria-pressed={!view.leftHidden} aria-keyshortcuts="[" title="Explanation ([)" onClick={() => dispatch({ type: 'rail', side: 'left' })}><PanelLeft size={16} aria-hidden="true" /><span className="sr-only">Explanation</span></button>
          <button type="button" className="twin-icon twin-rail-toggle" aria-pressed={!view.rightHidden} aria-keyshortcuts="]" title="Controls (])" onClick={() => dispatch({ type: 'rail', side: 'right' })}><PanelRight size={16} aria-hidden="true" /><span className="sr-only">Controls</span></button>
        </div>
      </div>
      <ControlRail />
    </div>
    <ShortcutsDialog open={keysOpen} onClose={closeKeys} />
    <CalibrateDialog open={calibrateOpen} onClose={closeCalibrate} />
    <SessionDialog open={sessionOpen} onClose={closeSession} />
  </div>;
}

export function TwinPage() {
  return <TwinProvider><TwinLayout /></TwinProvider>;
}
