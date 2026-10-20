'use client';
import { modeInfo } from './twin-state';
import { useTwin } from './twin-store';
import { TexProse } from './tex-prose';
import { Fold } from './fold';

/** Left rail: what the current mode shows, then a polite live line after each change. */
export function ExplainRail() {
  const { store: { twin, view } } = useTwin();
  const info = modeInfo(twin.mode);
  return <aside className="twin-rail twin-left" aria-label="Explanation">
    <Fold id="twin-looking" title="What you are looking at" level={2} desktopOpen>
      <p className="twin-looking-mode">{info.name} <span>· {info.group}</span></p>
      <p><TexProse>{info.looking}</TexProse></p>
    </Fold>
    <div className="twin-changed">
      <h2>What just changed</h2>
      <p aria-live="polite">{view.change ? <TexProse>{view.change}</TexProse> : 'Nothing yet. Choose a mode or change a control and the effect is described here.'}</p>
    </div>
  </aside>;
}
