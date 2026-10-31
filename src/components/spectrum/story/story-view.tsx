'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { loadPaths } from '@/lib/twin/exafs';
import { clusterAtoms, groupShells, loadCluster, type ClusterFile } from '@/lib/twin/shells';
import { libraryMaterialId } from '@/lib/twin/sample';
import { SAMPLE_PRESETS } from '@/lib/twin/presets';
import type { XanesFile } from '@/lib/twin/xanes';
import type { FeffMaterial } from '@/lib/twin/types';
import { setAddress, ViewSwitch, type SpectrumView } from '../view-switch';

// The scenes come with this view, so the page does not grow above the reader as they arrive; each 3D picture loads
// its three.js when it comes near, in a box of its own size.
import { SceneShine } from './scene-shine';
import { SceneJump } from './scene-jump';
import { SceneRipple } from './scene-ripple';
import { SceneEcho } from './scene-echo';
import { SceneDistance } from './scene-distance';
import { SceneRings } from './scene-rings';
import { SceneCharge } from './scene-charge';

/** The scenes in order, with the word the progress rail shows for each. */
const SCENES = [['story-shine', 'Shine'], ['story-jump', 'Jump'], ['story-ripple', 'Ripple'], ['story-echo', 'Echo'], ['story-distance', 'Distance'], ['story-rings', 'Chart'], ['story-charge', 'Charge']] as const;

/** The materials offered, in plain words; another library sample named in the address is offered by its own name. */
const STORY_SAMPLES = [
  { id: 'cu-foil', name: 'Copper', what: 'a thin copper foil' },
  { id: 'cuo-pellet', name: 'Black copper oxide', what: 'a thin layer of black copper oxide' },
  { id: 'pt-foil', name: 'Platinum', what: 'a thin platinum foil' },
  { id: 'fe2o3-pellet', name: 'Rust (iron oxide)', what: 'a thin layer of rust' },
  { id: 'licoo2-pellet', name: 'Phone battery material', what: 'a thin layer of phone battery material' },
  { id: 'mno2-pellet', name: 'Battery manganese oxide', what: 'a thin layer of battery manganese oxide' },
];
const library = SAMPLE_PRESETS.filter(p => libraryMaterialId(p.sample));

/**
 * The story view: what an X-ray absorption spectrum is and what it tells, one idea per scene, from the same computed
 * data as the detailed view (FEFF paths, FEFF10 near edges).
 */
export function StoryView({ onView }: { onView: (view: SpectrumView) => void }) {
  const [presetId, setPresetId] = useState(() => {
    const named = new URLSearchParams(window.location.search).get('sample');
    return named && library.some(p => p.id === named) ? named : 'cu-foil';
  });
  const preset = library.find(p => p.id === presetId)!, materialId = libraryMaterialId(preset.sample)!;
  const [data, setData] = useState<{ material: FeffMaterial; xanes: XanesFile; cluster: ClusterFile } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([loadPaths(materialId), import('@/lib/twin/xanes-files').then(f => f.loadXanes(materialId)), loadCluster(materialId)])
      .then(([material, xanes, cluster]) => { if (live) setData({ material, xanes, cluster }); }, e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [materialId]);
  const current = useCurrentScene();
  // On a narrow screen the rail scrolls sideways; keep the current step in it. Only the rail moves: scrollIntoView on
  // a link in a sticky bar would scroll the page back to the bar's place in the flow.
  useEffect(() => {
    const link = document.querySelector<HTMLElement>(`.story-rail a[href="#${current}"]`), rail = link?.parentElement;
    if (link && rail) rail.scrollTo({ left: link.offsetLeft - (rail.clientWidth - link.offsetWidth) / 2 });
  }, [current]);
  const offered = STORY_SAMPLES.some(s => s.id === presetId) ? STORY_SAMPLES : [...STORY_SAMPLES, { id: preset.id, name: preset.name, what: `the ${preset.name}` }];
  const what = offered.find(s => s.id === presetId)!.what;
  const ready = data && data.material.id === materialId ? data : null;
  // The story reads the first absorber site: its shells, the nearest one, and that shell's atoms.
  const site = useMemo(() => {
    if (!ready) return null;
    const siteId = ready.material.sites[0].id, shells = groupShells(ready.material).filter(s => s.siteId === siteId);
    const first = shells.find(s => s.kind === 'shell') ?? null, named = shells.filter(s => s.kind === 'shell').map(s => s.id);
    const atoms = clusterAtoms(ready.cluster, siteId, shells);
    const neighbours = first ? atoms.filter(a => a.shellId === first.id).map(a => ({ element: a.element, xyz: a.xyz })) : [];
    const crystal = [atoms[0], ...atoms.filter(a => a.shellId && named.includes(a.shellId))].map(a => ({ element: a.element, xyz: a.xyz, ring: a.shellId ? named.indexOf(a.shellId) : -1 }));
    return { shells, first, neighbours, crystal };
  }, [ready]);
  const props = ready && site && { material: ready.material, xanes: ready.xanes, e0: ready.material.edge_energy_eV + (preset.sample.edgeShift_eV ?? 0), what, ...site };

  return <div className="story">
    <header className="story-head">
      <div>
        <p className="twin-kicker">XAS Lab · Beamline twin</p>
        <h1 className="twin-title story-title">Read the <em>spectrum</em></h1>
        <p className="story-lede">How a beam of X-rays tells us which atoms sit next to each other, and how far apart they are. {SCENES.length} short steps.</p>
      </div>
      <div className="story-tools">
        <ViewSwitch view="simple" onChange={onView} />
        <label className="story-pick">Material <select name="sample" value={presetId} onChange={e => { setPresetId(e.target.value); setAddress({ sample: e.target.value }); }}>
          {offered.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <Link className="twin-chip" href="/twin/"><ArrowLeft size={14} aria-hidden="true" />Beamline twin</Link>
      </div>
    </header>
    <nav className="story-rail" aria-label="Steps">
      {SCENES.map(([id, word], i) => <a key={id} href={`#${id}`} aria-current={current === id ? 'step' : undefined}><span>{i + 1}</span>{word}</a>)}
    </nav>
    {error && <p className="twin-warning" role="alert">The data could not load: {error}</p>}
    {!props && !error && <p className="spectrum-empty">Loading…</p>}
    {props && <>
      <SceneShine {...props} />
      <SceneJump {...props} />
      <SceneRipple {...props} />
      <SceneEcho {...props} />
      <SceneDistance {...props} />
      <SceneRings {...props} />
      <SceneCharge {...props} />
      <section className="story-end" aria-labelledby="story-end-title">
        <h2 id="story-end-title" className="story-h">What one spectrum tells you</h2>
        <div className="story-end-cards">
          <div><p className="story-step">Where the jump is</p><p>How many electrons the atom has given away. Step 7.</p></div>
          <div><p className="story-step">The wiggles</p><p>Which atoms sit next to it, and how far away. Steps 4 to 6.</p></div>
        </div>
        <div className="story-end-actions">
          <button type="button" className="twin-chip is-accent" onClick={() => onView('detailed')}>See every detail</button>
          <Link className="twin-chip" href="/twin/">Try it on the beamline twin</Link>
        </div>
        <details className="story-sources">
          <summary>How this is drawn</summary>
          <ul>
            <li>The spectra are calculated, not sketched: the near edge with FEFF10 for each crystal, the wiggles with the FEFF paths the beamline twin uses, at room temperature.</li>
            <li>The atoms are the real crystal, the same atom positions FEFF used.</li>
            <li>The single atom&apos;s electron cloud follows Slater&apos;s rules, with its sizes squeezed so the innermost layer shows; the true ratio is given on screen.</li>
            <li>The wave and its echoes use FEFF&apos;s strength, phase shifts and electron range for each neighbour.</li>
            <li>The distance chart takes out each ring&apos;s phase shift, so its bumps stand at the true distances; the Detailed view shows the usual chart, with peaks a little short.</li>
            <li>The edge positions of the series were measured beside the metal; the sources are named in the Detailed view.</li>
            <li>Developed using Distribution: FEFF10.0 Copyright (c) 2020 FEFF Project, University of Washington and SLAC National Accelerator Laboratory.</li>
          </ul>
        </details>
      </section>
    </>}
  </div>;
}

/** The scene crossing the middle of the window, for the progress rail. */
function useCurrentScene() {
  const [current, setCurrent] = useState<string>(SCENES[0][0]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setCurrent(e.target.id);
    }, { rootMargin: '-45% 0px -50% 0px' });
    // The scenes load after the frame; look for them until they are all there.
    const watch = () => SCENES.forEach(([id]) => { const el = document.getElementById(id); if (el) observer.observe(el); });
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, []);
  return current;
}
