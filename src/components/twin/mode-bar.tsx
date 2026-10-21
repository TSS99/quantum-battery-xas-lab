'use client';
import { useEffect, useRef } from 'react';
import { MODES } from './twin-state';
import { useTwin } from './twin-store';

const GROUPS = ['Measure', 'Tune', 'Learn'] as const;

/** The eight modes in three groups, keys 1 to 8. On phones the bar is one sticky row that scrolls sideways. */
export function ModeBar() {
  const { store: { twin }, dispatch } = useTwin();
  const bar = useRef<HTMLDivElement>(null);
  // Keep the chosen mode in view when a number key picks one that is scrolled out of the row.
  useEffect(() => {
    const row = bar.current, button = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !button || row.scrollWidth <= row.clientWidth) return;
    if (button.offsetLeft < row.scrollLeft || button.offsetLeft + button.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: button.offsetLeft - 16 });
  }, [twin.mode]);
  return <div className="twin-modes twin-card" ref={bar} role="group" aria-label="Modes">
    {GROUPS.map(group => <div key={group} className="twin-mode-group" role="group" aria-labelledby={`twin-group-${group}`}>
      <span id={`twin-group-${group}`} className="twin-mode-group-name">{group}</span>
      <div className="twin-mode-buttons">{MODES.filter(m => m.group === group).map(m =>
        <button key={m.id} type="button" className="twin-mode" aria-pressed={twin.mode === m.id} aria-keyshortcuts={m.key} onClick={() => dispatch({ type: 'mode', mode: m.id })}>
          {m.name}<kbd aria-hidden="true">{m.key}</kbd>
        </button>)}
      </div>
    </div>)}
  </div>;
}
