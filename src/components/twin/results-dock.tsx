'use client';
import { useRef, type KeyboardEvent } from 'react';
import { Tex } from '../tex';
import { Chevron } from '../chevron';
import { RESULT_TABS, type ResultTab } from './twin-state';
import { useTwin } from './twin-store';
import { TexProse } from './tex-prose';

/** Tab labels: `name` is the accessible name, `tex` the typeset label when it has maths, `shows` the empty state. */
const TABS: Record<ResultTab, { name: string; tex?: string; shows: string }> = {
  live: { name: 'Live channels', shows: String.raw`The currents in $I_0$, $I_t$ and $I_\mathrm{ref}$ and the fluorescence count rate against time, with saturation and gain warnings.` },
  mu: { name: 'μ(E)', tex: String.raw`\mu(E)`, shows: String.raw`The absorption $\mu(E)$, built point by point as the scan runs.` },
  normalized: { name: 'Normalized', shows: String.raw`$\mu(E)$ scaled to an edge step of 1, with the edge energy $E_0$ and the step marked.` },
  derivative: { name: 'Derivative', shows: String.raw`$d\mu/dE$, whose first peak marks $E_0$ and the energy calibration point.` },
  chik: { name: 'χ(k)', tex: String.raw`\chi(k)`, shows: String.raw`The EXAFS $\chi(k)$ after background removal, weighted by $k^n$, with its noise level $\varepsilon_k$.` },
  chir: { name: '|χ(R)|', tex: String.raw`|\chi(R)|`, shows: String.raw`$|\chi(R)|$, the Fourier transform of $k^n\chi(k)$, with its noise level $\varepsilon_R$.` },
  xrf: { name: 'XRF spectrum', shows: String.raw`The fluorescence detector's energy spectrum at the current $E$: emission lines, elastic and Compton scatter, and the counting window.` },
  rocking: { name: 'Rocking curve', shows: String.raw`The intensity as the second crystal turns through the reflection, for the fundamental and its harmonics.` },
};

/** Bottom dock: result tabs, Acquire and Enlarge. The tabs stay empty until the scan engine is connected. */
export function ResultsDock() {
  const { store: { view }, dispatch } = useTwin();
  const tabs = useRef<HTMLDivElement>(null);
  // Arrow keys, Home and End move between tabs (automatic activation, roving tabindex).
  function onTabKey(event: KeyboardEvent) {
    const i = RESULT_TABS.indexOf(view.tab), n = RESULT_TABS.length;
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    dispatch({ type: 'tab', tab: RESULT_TABS[next] });
    tabs.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
  return <section className="twin-dock" aria-labelledby="twin-results-title">
    <div className="twin-section-head">
      <h2 id="twin-results-title">Results</h2>
      <div className="twin-dock-actions">
        <button type="button" className="button secondary small" aria-pressed={view.enlarged} aria-keyshortcuts="X" onClick={() => dispatch({ type: 'enlarge' })}>Enlarge</button>
        <button type="button" className="button cta" aria-keyshortcuts="I" onClick={() => dispatch({ type: 'acquire' })}>Acquire<Chevron /></button>
      </div>
    </div>
    <div className="twin-tabs" role="tablist" aria-label="Result views" ref={tabs} onKeyDown={onTabKey}>
      {RESULT_TABS.map(tab => <button key={tab} type="button" role="tab" id={`twin-tab-${tab}`} aria-controls="twin-result-panel" aria-selected={view.tab === tab} tabIndex={view.tab === tab ? 0 : -1} aria-label={TABS[tab].tex ? TABS[tab].name : undefined} onClick={() => dispatch({ type: 'tab', tab })}>
        {TABS[tab].tex ? <Tex plain>{TABS[tab].tex!}</Tex> : TABS[tab].name}
      </button>)}
    </div>
    <div className="twin-tabpanel" role="tabpanel" id="twin-result-panel" aria-labelledby={`twin-tab-${view.tab}`} tabIndex={0}>
      <p><TexProse>{TABS[view.tab].shows}</TexProse></p>
      <p className="twin-empty">Empty for now: no scan has run, because the scan engine is not connected yet.</p>
    </div>
  </section>;
}
