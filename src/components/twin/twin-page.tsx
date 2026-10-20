'use client';
import { useEffect, useRef, useState, type Dispatch } from 'react';
import { Keyboard } from 'lucide-react';
import { energyChange, shortcutAction, type TwinAction } from './twin-state';
import { TwinProvider, useTwin } from './twin-store';
import { ModeBar } from './mode-bar';
import { TwinScene } from './twin-scene';
import { ResultsDock } from './results-dock';
import { ExplainRail } from './explain-rail';
import { ControlRail } from './control-rail';
import { ShortcutsDialog } from './shortcuts-dialog';
import { NARROW_QUERY } from './fold';

// Inputs that take typed text; the others (buttons, checkboxes, sliders) leave the shortcut keys free.
const KEY_FREE_INPUTS = ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'];
function typingIn(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest('textarea, select, [role="textbox"]') ||
    target instanceof HTMLInputElement && !KEY_FREE_INPUTS.includes(target.type));
}

/** Page shortcuts (keys 1 to 8, C, L, I, X, [ and ]), never while typing and never inside a dialog. */
function useShortcuts(dispatch: Dispatch<TwinAction>) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('dialog')) return;
      if (typingIn(event.target)) return;
      if (event.key === 'Escape') { dispatch({ type: 'enlarge', value: false }); return; }
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
  const keysButton = useRef<HTMLButtonElement>(null);
  useShortcuts(dispatch);
  useEnergyNote(twin.energy_eV, dispatch);
  const closeKeys = () => { setKeysOpen(false); keysButton.current?.focus(); };
  return <div className={'twin-page' + (view.enlarged ? ' is-enlarged' : '') + (view.leftHidden ? ' left-hidden' : '') + (view.rightHidden ? ' right-hidden' : '')}>
    <header className="twin-head">
      <div>
        <h1>Beamline twin</h1>
        <p>Run a simulated XAS beamline in the browser: pick a measurement mode, set the energy, press Acquire and watch the spectrum build from what each detector records. In this preview the instrument models, scans and downloads work; the full control set, the physics cards and the training scenarios come next.</p>
      </div>
      <div className="twin-head-actions">
        <button type="button" className="button secondary small twin-rail-toggle" aria-pressed={!view.leftHidden} aria-keyshortcuts="[" onClick={() => dispatch({ type: 'rail', side: 'left' })}>Explanation</button>
        <button type="button" className="button secondary small twin-rail-toggle" aria-pressed={!view.rightHidden} aria-keyshortcuts="]" onClick={() => dispatch({ type: 'rail', side: 'right' })}>Controls</button>
        <button type="button" className="button secondary small" ref={keysButton} aria-haspopup="dialog" onClick={() => setKeysOpen(true)}><Keyboard size={16} aria-hidden="true" />Keyboard shortcuts</button>
      </div>
    </header>
    <ModeBar />
    <TwinScene />
    <ResultsDock />
    <ExplainRail />
    <ControlRail />
    <ShortcutsDialog open={keysOpen} onClose={closeKeys} />
  </div>;
}

export function TwinPage() {
  return <TwinProvider><TwinLayout /></TwinProvider>;
}
