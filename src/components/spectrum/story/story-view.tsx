'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { loadPaths } from '@/lib/twin/exafs';
import { clusterAtoms, groupShells, loadCluster, type ClusterFile } from '@/lib/twin/shells';
import { libraryMaterialId } from '@/lib/twin/sample';
import { SAMPLE_PRESETS } from '@/lib/twin/presets';
import type { XanesFile } from '@/lib/twin/xanes';
import type { FeffMaterial } from '@/lib/twin/types';
import { setAddress, ViewSwitch, type SpectrumView } from '../view-switch';

const SceneShine = dynamic(() => import('./scene-shine').then(m => m.SceneShine));
const SceneJump = dynamic(() => import('./scene-jump').then(m => m.SceneJump));
const SceneRipple = dynamic(() => import('./scene-ripple').then(m => m.SceneRipple));
const SceneEcho = dynamic(() => import('./scene-echo').then(m => m.SceneEcho));
const SceneDistance = dynamic(() => import('./scene-distance').then(m => m.SceneDistance));
const SceneRings = dynamic(() => import('./scene-rings').then(m => m.SceneRings));

/** The scenes in order, with the word the progress rail shows for each. */
const SCENES = [['story-shine', 'Shine'], ['story-jump', 'Jump'], ['story-ripple', 'Ripple'], ['story-echo', 'Echo'], ['story-distance', 'Distance'], ['story-rings', 'Chart']] as const;

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
  // On a narrow screen the rail scrolls sideways; keep the current step in it.
  useEffect(() => { document.querySelector(`.story-rail a[href="#${current}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [current]);
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
