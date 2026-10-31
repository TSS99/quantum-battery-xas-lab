'use client';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft, ChevronLeft, ChevronRight, Compass, Link2, X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { valenceSeries } from '@/lib/twin/oxidation';
import { loadPaths, sigma2Einstein } from '@/lib/twin/exafs';
import { ROOM_TEMPERATURE_K, einsteinTemperature_K, libraryMaterialId } from '@/lib/twin/sample';
import { SAMPLE_GROUPS, SAMPLE_PRESETS } from '@/lib/twin/presets';
import { clusterAtoms, groupShells, loadCluster, shellSpectra, transform, type ClusterAtom, type ClusterFile, type Shell, type ShellTweak } from '@/lib/twin/shells';
import { SPECTRUM_CHANNEL, type SpectrumMessage } from '@/lib/twin/spectrum-link';
import type { XanesFile } from '@/lib/twin/xanes';
import type { FeffMaterial } from '@/lib/twin/types';
import { Num, Tex } from '../tex';
import { TexProse } from '../twin/tex-prose';
import type { ShellCurve, Stick } from './shell-plot';
import type { WiggleCurve } from './read-cards';
import { atomName, SHELL_COLORS } from './atoms';
import { setAddress, ViewSwitch, type SpectrumView } from './view-switch';


// three.js loads after the page, like the twin's hutch.
const ClusterView = dynamic(() => import('./cluster-view'), { ssr: false, loading: () => <p className="spectrum-empty">Loading the 3D cluster…</p> });
// The wave, the "what if" controls and the neighbour comparison sit below the first screen and load after it.
const WavePanel = dynamic(() => import('./wave-panel').then(m => m.WavePanel));
const WhatIf = dynamic(() => import('./what-if').then(m => m.WhatIf));
const NeighbourPanel = dynamic(() => import('./neighbour-panel').then(m => m.NeighbourPanel));
const NearEdgePanel = dynamic(() => import('./near-edge-panel').then(m => m.NearEdgePanel));
const OxidationPanel = dynamic(() => import('./oxidation-panel').then(m => m.OxidationPanel));
const XasExplorer = dynamic(() => import('./xas-explorer').then(m => m.XasExplorer), { loading: () => <p className="spectrum-empty">Loading the explorer…</p> });
const ReadCards = dynamic(() => import('./read-cards').then(m => m.ReadCards));
const DistanceStrip = dynamic(() => import('./distance-strip').then(m => m.DistanceStrip));
const ShellPlot = dynamic(() => import('./shell-plot').then(m => m.ShellPlot), { loading: () => <p className="spectrum-empty">Loading the plot…</p> });

/** The page in reading order: how XAS works, then the edge, valence, the atoms and shells, the wave, what if. */
const CHAPTERS = [['spectrum-explorer', 'How XAS works'], ['spectrum-read', 'Reading it'], ['spectrum-edge', 'The edge'], ['spectrum-oxidation', 'Valence'],
  ['spectrum-atoms', 'Atoms'], ['spectrum-plots', 'Shells'], ['spectrum-wave', 'The wave'], ['spectrum-whatif', 'What if']] as const;

const FAR = { color: '#8a929c', dash: '2 4' }, MULTIPLE = { color: '#9085e9', dash: '7 4' };
/** Multiple scattering paths drawn in 3D when that group is chosen, strongest first. */
const MS_DRAWN = 8;
/** Stacked: a lane per shell; Overlay: one axis; Build up: shells added one at a time until they make the total. */
type View = 'stacked' | 'overlay' | 'build';
const VIEWS: [View, string][] = [['stacked', 'Stacked'], ['overlay', 'Overlay'], ['build', 'Build up']];

const presets = SAMPLE_PRESETS.filter(p => libraryMaterialId(p.sample));
type TwinState = Extract<SpectrumMessage, { type: 'state' }>;

/** "4 O at 1.96 Å": shells of one kind can repeat (two 2 O shells in CuO), so the name carries the distance. On the plots, "4 O". */
const shellLabel = (s: Shell) => s.kind === 'shell' ? `${s.count} ${s.element} at ${s.r_A.toFixed(2)} Å` : s.kind === 'far' ? 'Farther atoms' : 'Multiple scattering';
const shortLabel = (s: Shell) => s.kind === 'shell' ? `${s.count} ${s.element}` : shellLabel(s);
const peakOf = (y: number[]) => y.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Every panel, for students and scientists; the story (story/story-view.tsx) is the default view. */
export function DetailedView({ onView }: { onView: (view: SpectrumView) => void }) {
  const [presetId, setPresetId] = useState('cu-foil');
  const [twin, setTwin] = useState<TwinState | null>(null);
  const [follow, setFollow] = useState(true);
  const [material, setMaterial] = useState<FeffMaterial | null>(null);
  const [cluster, setCluster] = useState<ClusterFile | null>(null);
  const [xanes, setXanes] = useState<XanesFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null);
  // "What if": changes to shells, a temperature of your own, and the k the electron wave is drawn at.
  const [tweaks, setTweaks] = useState<Record<string, ShellTweak>>({}), [ownTemperature, setOwnTemperature] = useState<number | null>(null);
  const [waveK, setWaveK] = useState(6);
  // How the shells are drawn, the k weight of the plots and of the transform, and how many groups Build up has added.
  const [view, setView] = useState<View>('stacked');
  const [kweight, setKweight] = useState(2);
  const [added, setAdded] = useState(1);
  const [measured, setMeasured] = useState<{ id: string; k: number[]; chi: number[]; label: string } | null>(null);
  const [showFar, setShowFar] = useState(false);
  const [tour, setTour] = useState<number | null>(null);
  const reduced = useReducedMotion();

  // A sample named in the address, and the twin's state when this window was opened from it.
  useEffect(() => {
    const named = new URLSearchParams(window.location.search).get('sample');
    if (named && presets.some(p => p.id === named)) setPresetId(named);
    const channel = new BroadcastChannel(SPECTRUM_CHANNEL);
    channel.onmessage = (event: MessageEvent<SpectrumMessage>) => { if (event.data?.type === 'state') setTwin(event.data); };
    channel.postMessage({ type: 'hello' } satisfies SpectrumMessage);
    return () => channel.close();
  }, []);

  const preset = presets.find(p => p.id === presetId) ?? presets[0];
  const fromTwin = follow && twin !== null;
  const sample = fromTwin ? twin.sample : preset.sample;
  const sampleTemperature = fromTwin ? twin.temperature_K : ROOM_TEMPERATURE_K, temperature_K = ownTemperature ?? sampleTemperature;
  const materialId = libraryMaterialId(sample);
  const scan = fromTwin && twin.scan && twin.scan.materialId === materialId ? twin.scan : null;

  useEffect(() => {
    if (!materialId) { setMaterial(null); setCluster(null); return; }
    let live = true;
    setError(null);
    // The near edge loaders are their own chunk, out of the page's first load.
    Promise.all([loadPaths(materialId), loadCluster(materialId), import('@/lib/twin/xanes-files').then(f => f.loadXanes(materialId))]).then(([m, c, x]) => {
      if (!live) return;
      setMaterial(m); setCluster(c); setXanes(x); setSiteId(m.sites[0].id); setSelected(null); setHover(null); setTweaks({}); setOwnTemperature(null);
    }, e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [materialId]);

  // A measured spectrum of the same material, where the Larch examples have one (Cu, Ni, Pt, Fe2O3, FeO).
  useEffect(() => {
    if (!materialId) return;
    let live = true;
    import('@/data/twin/measured/chi-references.json').then(file => {
      const ref = file.default.references.find(r => r.id === materialId);
      if (!live || !ref) return;
      const [what, , ...where] = ref.description.split(', ');
      setMeasured({ id: ref.id, k: ref.chi.map((_, i) => i * ref.k_step), chi: ref.chi, label: `measured ${what} (${where.join(', ')})` });
    });
    return () => { live = false; };
  }, [materialId]);

  const ready = material && cluster && xanes && material.id === materialId && cluster.id === materialId && xanes.id === materialId ? { material, cluster, xanes } : null;
  const shells = useMemo(() => ready ? groupShells(ready.material) : [], [ready?.material]);
  // Sliders recompute the path sum; deferring keeps them smooth.
  const shownTweaks = useDeferredValue(tweaks), shownTemperature = useDeferredValue(temperature_K);
  const changed = Object.keys(shownTweaks).length > 0 || shownTemperature !== sampleTemperature;
  const spectra = useMemo(() => ready ? shellSpectra(ready.material, shells, shownTemperature, scan?.kmax, shownTweaks, kweight) : null, [ready?.material, shells, shownTemperature, scan?.kmax, shownTweaks, kweight]);
  const base = useMemo(() => ready && changed ? shellSpectra(ready.material, shells, sampleTemperature, scan?.kmax, {}, kweight) : spectra, [ready?.material, shells, sampleTemperature, scan?.kmax, changed, spectra, kweight]);
  const site = siteId && ready?.material.sites.some(s => s.id === siteId) ? siteId : ready?.material.sites[0].id ?? null;
  const shown = shells.filter(s => s.siteId === site);
  const atoms = useMemo(() => ready && site ? clusterAtoms(ready.cluster, site, shells) : [], [ready?.cluster, site, shells]);
  const colors = useMemo(() => {
    const out: Record<string, string> = {};
    shown.filter(s => s.kind === 'shell').forEach((s, i) => { out[s.id] = SHELL_COLORS[i]; });
    for (const s of shown) if (s.kind === 'far') out[s.id] = FAR.color; else if (s.kind === 'ms') out[s.id] = MULTIPLE.color;
    return out;
  }, [shown]);
  // Pointing highlights a shell; the explanation follows the chosen one, so text does not reflow under the pointer.
  const active = hover ?? selected;
  const activeShell = shown.find(s => s.id === active) ?? null, chosen = shown.find(s => s.id === selected) ?? null;

  const frame = { following: fromTwin, linked: twin !== null, onFollow: () => setFollow(true), presetId, pick: (id: string) => { setPresetId(id); setFollow(false); setAddress({ sample: id }); }, onTour: () => setTour(0), onView };
  if (!materialId) return <Frame {...frame}>
    <p className="spectrum-empty">{sample.formula} at the {sample.absorber} {sample.edge} edge has no FEFF paths in the twin&apos;s library, so its spectrum cannot be split into shells. Choose a library sample above.</p>
  </Frame>;
  if (error) return <Frame {...frame}><p className="twin-warning" role="alert">The paths could not load: {error}</p></Frame>;
  if (!ready || !spectra || !site) return <Frame {...frame}><p className="spectrum-empty">Loading the paths…</p></Frame>;

  const m = ready.material;
  const weigh = (y: number[], k = spectra.k) => y.map((v, i) => v * k[i] ** kweight);
  const toR = (k: number[], chi: number[]) => transform(k, chi, spectra.window.kmax, kweight);
  // Other absorber sites add to the total; their share is one curve.
  const others = m.sites.length > 1 ? spectra.k.map((_, i) => spectra.total[i] - shown.reduce((s, sh) => s + spectra.chi[sh.id][i], 0)) : null;
  const othersR = others ? toR(spectra.k, others).magnitude : null;
  const curve = (s: Shell, y: number[]): ShellCurve => ({ id: s.id, color: colors[s.id], dash: s.kind === 'far' ? FAR.dash : s.kind === 'ms' ? MULTIPLE.dash : undefined, y, label: shortLabel(s) });
  const kCurves = shown.map(s => curve(s, weigh(spectra.chi[s.id])));
  const rCurves = shown.map(s => curve(s, spectra.magnitude[s.id]));
  if (others && othersR) { kCurves.push({ id: 'others', color: UNUSED_SITE, dash: '1 3', y: weigh(others), label: 'Other sites' }); rCurves.push({ id: 'others', color: UNUSED_SITE, dash: '1 3', y: othersR, label: 'Other sites' }); }
  const labelAt = Object.fromEntries(shown.filter(s => s.kind === 'shell').map(s => [s.id, spectra.peak_A[s.id]]));
  // Build up: the first `count` groups in distance order and their sum; the full total stays behind as a ghost.
  const count = Math.min(Math.max(1, added), shown.length), newest = shown[count - 1];
  const partial = view === 'build' ? spectra.k.map((_, i) => shown.slice(0, count).reduce((s, sh) => s + spectra.chi[sh.id][i], 0)) : null;
  const partialR = partial ? toR(spectra.k, partial).magnitude : null;
  // The twin's scan when this window follows one, else the measured spectrum of this material, where there is one.
  const scanned = scan ? { k: scan.k, chi: scan.chi, label: `your scan #${scan.n}` } : measured?.id === materialId ? measured : null;
  const scannedR = scanned ? toR(scanned.k, scanned.chi) : null;
  const maxCount = Math.max(1, ...shown.filter(s => s.kind === 'shell').map(s => s.count));
  const sticks: Stick[] = shown.filter(s => s.kind === 'shell' && (view !== 'build' || shown.indexOf(s) < count))
    .map(s => ({ id: s.id, x: s.r_A + (tweaks[s.id]?.deltar_A ?? 0), peak: spectra.peak_A[s.id], share: s.count / maxCount, color: colors[s.id] }));
  // The wiggle card: this sample's nearest and farthest named shells, each scaled to its own largest wiggle.
  const named = shown.filter(s => s.kind === 'shell'), farthest = named.at(-1) ?? null;
  const wiggle = (s: Shell): WiggleCurve => {
    const y = spectra.chi[s.id].map((v, i) => v * spectra.k[i] ** 2), top = Math.max(...y.map(Math.abs)) || 1;
    return { label: `${s.count} ${s.element} at ${s.r_A.toFixed(2)} Å`, k: spectra.k, y: y.map(v => v / top) };
  };
  const wiggleNear = named[0] && farthest && farthest.r_A - named[0].r_A > 0.3 ? wiggle(named[0]) : null, wiggleFar = wiggleNear ? wiggle(farthest!) : null;
  const pick = (id: string) => setSelected(current => current === id ? null : id);
  const legs = activeShell ? legsOf(activeShell, atoms) : [];
  const einsteinSigma2 = (s: Shell) => s.paths.reduce((sum, p) => sum + p.degen * sigma2Einstein(p, einsteinTemperature_K(m.id), temperature_K), 0) / s.count;
  const sigma2Of = (s: Shell) => tweaks[s.id]?.sigma2_A2 ?? einsteinSigma2(s);
  const sigma2 = chosen && chosen.kind === 'shell' ? sigma2Of(chosen) : null;
  // The wave and the "what if" controls act on the chosen shell, or the first one.
  const focus = (chosen?.kind === 'shell' ? chosen : null) ?? shown.find(s => s.kind === 'shell') ?? null;
  const ghostK = changed && base ? [{ y: weigh(base.total), color: '#a7b1c1', id: 'total' }, ...(focus ? [{ y: weigh(base.chi[focus.id]), color: colors[focus.id], id: focus.id }] : [])] : [];
  const ghostR = changed && base ? [{ y: base.totalR, color: '#a7b1c1', id: 'total' }, ...(focus ? [{ y: base.magnitude[focus.id], color: colors[focus.id], id: focus.id }] : [])] : [];
  const building = view === 'build' && partial && partialR;
  const resetAll = () => { setTweaks({}); setOwnTemperature(null); };
  const shift_eV = sample.edgeShift_eV ?? 0;
  const currentPreset = fromTwin ? presets.find(p => libraryMaterialId(p.sample) === materialId && (p.sample.edgeShift_eV ?? 0) === shift_eV)?.id ?? null : presetId;
  const series = valenceSeries(m.absorber);
  const first = shown.find(s => s.kind === 'shell') ?? null;
  const steps = tourSteps(m, shift_eV, series?.perValence_eV ?? null, first, first ? spectra.peak_A[first.id] : 0);
  const step = tour === null ? null : steps[Math.min(tour, steps.length - 1)];

  return <Frame {...frame}
    site={m.sites.length > 1 ? { ids: m.sites.map(s => s.id), value: site, set: id => { setSiteId(id); setSelected(null); } } : undefined}>
    {step && <TourBar step={step} index={tour!} count={steps.length} target={step.target} reduced={!!reduced}
      onGo={i => { setTour(i); if (steps[i]?.shell && first) setSelected(first.id); if (steps[i]?.k) setWaveK(steps[i].k!); }} onClose={() => setTour(null)} />}
    <nav className="spectrum-chapters" aria-label="Chapters">
      {CHAPTERS.map(([id, label], i) => <button key={id} type="button" className="twin-chip" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })}><span className="spectrum-chapter-n">{i + 1}</span>{label}</button>)}
    </nav>
    <div className="spectrum-grid">
      <section id="spectrum-explorer" className="twin-card spectrum-panel spectrum-explorer" aria-labelledby="spectrum-explorer-title">
        <h2 id="spectrum-explorer-title" className="twin-kicker">How XAS works · {m.formula}</h2>
        <p className="spectrum-lede">X-ray absorption spectroscopy shines X-rays of rising energy through a sample and records how much it absorbs. Scan the energy and watch what happens inside one {atomName(m.absorber)} atom.</p>
        <XasExplorer material={m} xanes={ready.xanes} shift_eV={shift_eV} temperature_K={temperature_K} shell={first} />
      </section>
      <section id="spectrum-read" className="twin-card spectrum-panel spectrum-read" aria-labelledby="spectrum-read-title">
        <h2 id="spectrum-read-title" className="twin-kicker">Reading a spectrum</h2>
        <ReadCards near={wiggleNear} far={wiggleFar} />
      </section>
      {/* Each sticky panel sits in a cell as tall as its row, so it stays beside its taller neighbour and stops there. */}
      <div className="spectrum-sticky-cell spectrum-3d-cell">
      <section id="spectrum-atoms" className="twin-card spectrum-panel spectrum-3d" aria-labelledby="spectrum-cluster-title">
        <h2 id="spectrum-cluster-title" className="twin-kicker">Around the {m.absorber} atom · {m.formula}</h2>
        <ClusterView atoms={atoms} colors={colors} faint={shown.filter(s => s.kind === 'far').map(s => s.id)} active={active} legs={legs} onHover={setHover} onSelect={pick}
          hideFar={!showFar} sphere={activeShell?.kind === 'shell' ? { radius: activeShell.r_A + (tweaks[activeShell.id]?.deltar_A ?? 0), color: colors[activeShell.id], label: `${activeShell.count} ${activeShell.element} · ${activeShell.r_A.toFixed(2)} Å` } : null}
          label={`${m.formula}: the ${atoms.length - 1} atoms within ${ready.cluster.rmax_A} angstrom of the ${atomName(m.absorber)} absorber, coloured by shell`} />
        <div className="spectrum-cluster-bar">
          <p className="spectrum-note">White: the {atomName(m.absorber)} atom that absorbs. Point at a shell to see it as a sphere at its distance. Drag to turn.</p>
          <button type="button" className="twin-chip" aria-pressed={showFar} onClick={() => setShowFar(v => !v)}>Show farther atoms</button>
        </div>
        <DistanceStrip atoms={atoms} shells={shown} colors={colors} active={active} onHover={setHover} onSelect={pick} absorber={atomName(m.absorber)} rmax={ready.cluster.rmax_A} />
      </section>
      </div>
      <section id="spectrum-plots" className="twin-card spectrum-panel" aria-labelledby="spectrum-plots-title">
        <h2 id="spectrum-plots-title" className="twin-kicker">The spectrum, shell by shell</h2>
        <div className="spectrum-plot-controls">
          <div className="spectrum-seg" role="group" aria-label="How the shells are drawn">
            {VIEWS.map(([id, label]) => <button key={id} type="button" className="twin-chip" aria-pressed={view === id} onClick={() => { setView(id); setAdded(1); }}>{label}</button>)}
          </div>
          <div className="spectrum-seg" role="group" aria-label="k weight">
            <span>Weight</span>
            {[1, 2, 3].map(w => <button key={w} type="button" className="twin-chip" aria-pressed={kweight === w} aria-label={`k weight ${w}`} onClick={() => setKweight(w)}><Tex plain>{`k^${w}`}</Tex></button>)}
          </div>
        </div>
        {view === 'build' && <div className="spectrum-build">
          <button type="button" className="twin-chip" disabled={count <= 1} onClick={() => setAdded(count - 1)}>Take one away</button>
          <button type="button" className="twin-chip is-accent" disabled={count >= shown.length} onClick={() => setAdded(count + 1)}>Add the next group</button>
          <span aria-live="polite">{count} of {shown.length}: {shown.slice(0, count).map(shortLabel).join(' + ')}{count === shown.length && !others ? ' = the whole spectrum' : ''}</span>
        </div>}
        <ShellPlot x={spectra.k} xMax={Math.min(14, spectra.window.kmax + 1)} mode={view === 'stacked' ? 'stacked' : 'overlay'}
          curves={building ? [curve(newest, weigh(spectra.chi[newest.id]))] : kCurves} total={building ? weigh(partial) : weigh(spectra.total)}
          scan={scanned && !building ? { x: scanned.k, y: weigh(scanned.chi, scanned.k), label: scanned.label } : null}
          selected={building ? newest.id : active} onHover={setHover} onSelect={pick} xLabel="k (Å⁻¹)" yTex={String.raw`k^{${kweight}}\chi(k)\ (\mathring{\mathrm{A}}^{-${kweight}})`}
          title={`k to the ${kweight} times chi of k for ${m.formula}, split into ${shown.length} shells`} band={{ from: spectra.window.kmin, to: spectra.window.kmax, label: 'Transform window' }}
          ghosts={building ? [{ y: weigh(spectra.total), color: '#a7b1c1', id: 'total' }] : ghostK} markers={[{ x: waveK, text: `k = ${waveK.toFixed(1)}`, color: '#8ce3ff' }]} />
        <ShellPlot x={spectra.r} xMax={6} mode={view === 'stacked' ? 'stacked' : 'overlay'}
          curves={building ? [curve(newest, spectra.magnitude[newest.id])] : rCurves} total={building ? partialR : spectra.totalR}
          scan={scannedR && !building ? { x: scannedR.r, y: scannedR.magnitude, label: scanned!.label } : null}
          selected={building ? newest.id : active} onHover={setHover} onSelect={pick} xLabel="R (Å), not phase corrected" yTex={String.raw`|\chi(R)|\ (\mathring{\mathrm{A}}^{-${kweight + 1}})`}
          title={`magnitude of chi of R for ${m.formula}, split into ${shown.length} shells; bars at the true distances`} labelAt={building ? {} : labelAt}
          ghosts={building ? [{ y: spectra.totalR, color: '#a7b1c1', id: 'total' }] : ghostR} sticks={sticks} />
        <p className="spectrum-legend">
          <span><i style={{ borderTopColor: '#d4dae3' }} />{building ? `Sum of the ${count} groups added` : 'Total (all paths)'}</span>
          {building && <span><i style={{ borderTopColor: '#a7b1c1', borderTopStyle: 'dashed' }} />All paths</span>}
          {scanned && !building && <span><i style={{ borderTopColor: '#8ce3ff', borderTopStyle: 'dotted' }} />{scanned.label[0].toUpperCase() + scanned.label.slice(1)}</span>}
          {(building ? [newest] : shown).map(s => <span key={s.id}><i style={{ borderTopColor: colors[s.id], borderTopStyle: s.kind === 'shell' ? 'solid' : s.kind === 'far' ? 'dotted' : 'dashed' }} />{shellLabel(s)}</span>)}
          {others && !building && <span><i style={{ borderTopColor: UNUSED_SITE, borderTopStyle: 'dotted' }} />Other sites</span>}
          {changed && !building && <span><i style={{ borderTopColor: '#a7b1c1', borderTopStyle: 'dashed' }} />Before your changes</span>}
          <span><i className="spectrum-legend-bar" aria-hidden="true" />Bars: true distances, height by number of atoms</span>
        </p>
      </section>
      <div className="spectrum-sticky-cell spectrum-explain-cell">
        <section className="twin-card spectrum-panel spectrum-explain" aria-live="polite" aria-labelledby="spectrum-explain-title">
          <h2 id="spectrum-explain-title" className="twin-kicker">{chosen ? shellLabel(chosen) : 'How to read it'}</h2>
          <Explain shell={chosen} absorber={m.absorber} peak={chosen ? spectra.peak_A[chosen.id] : 0} sigma2={sigma2} temperature_K={temperature_K}
            share={chosen ? peakOf(spectra.magnitude[chosen.id]) / peakOf(spectra.totalR) : 0} />
        </section>
      </div>
      <section className="twin-card spectrum-panel spectrum-table-wrap" aria-labelledby="spectrum-table-title">
        <h2 id="spectrum-table-title" className="twin-kicker">Shells{m.sites.length > 1 ? ` of site ${site}` : ''}</h2>
        <table className="spectrum-table">
          <thead><tr><th scope="col">Shell</th><th scope="col">Neighbours</th><th scope="col">True <Tex plain>R</Tex></th><th scope="col">Peak in <Tex plain>{'|\\chi(R)|'}</Tex></th></tr></thead>
          <tbody>{shown.map(s => <tr key={s.id} className={active === s.id ? 'is-active' : undefined}>
            <th scope="row"><button type="button" aria-pressed={selected === s.id} onClick={() => pick(s.id)} onFocus={() => setHover(s.id)} onBlur={() => setHover(null)}
              onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)}>
              <i style={{ borderTopColor: colors[s.id], borderTopStyle: s.kind === 'shell' ? 'solid' : s.kind === 'far' ? 'dotted' : 'dashed' }} aria-hidden="true" />{shellLabel(s)}</button></th>
            <td>{s.kind === 'ms' ? <><Num>{String(s.count)}</Num> paths</> : <><Num>{String(s.count)}</Num> {s.kind === 'shell' ? atomName(s.element!) : 'atoms'}</>}</td>
            <td>{s.kind === 'shell' ? <><Num>{s.r_A.toFixed(2)}</Num> Å</> : <><Num>{Math.min(...s.paths.map(p => p.reff)).toFixed(1)}</Num> to <Num>{Math.max(...s.paths.map(p => p.reff)).toFixed(1)}</Num> Å</>}</td>
            <td>{s.kind === 'shell' ? <><Num>{spectra.peak_A[s.id].toFixed(2)}</Num> Å</> : 'spread'}</td>
          </tr>)}</tbody>
        </table>
      </section>
      <section id="spectrum-edge" className="twin-card spectrum-panel spectrum-edge" aria-labelledby="spectrum-edge-title">
        <h2 id="spectrum-edge-title" className="twin-kicker">Around the edge</h2>
        <NearEdgePanel material={m} xanes={ready.xanes} shift_eV={shift_eV} temperature_K={temperature_K} />
      </section>
      <section id="spectrum-oxidation" className="twin-card spectrum-panel spectrum-oxidation" aria-labelledby="spectrum-oxidation-title">
        <h2 id="spectrum-oxidation-title" className="twin-kicker">The edge and valence · {m.absorber}</h2>
        <OxidationPanel element={m.absorber} edge_eV={m.edge_energy_eV} currentId={currentPreset} />
      </section>
      {focus && <section id="spectrum-wave" className="twin-card spectrum-panel spectrum-wave" aria-labelledby="spectrum-wave-title">
        <h2 id="spectrum-wave-title" className="twin-kicker">The electron wave · {shellLabel(focus)}</h2>
        <WavePanel shell={focus} absorber={m.absorber} atoms={atoms.filter(a => a.shellId === focus.id).map(a => a.xyz)} deltar_A={tweaks[focus.id]?.deltar_A ?? 0} k={waveK} setK={setWaveK} color={colors[focus.id]}
          chi={spectra.chi[focus.id][Math.round(waveK / (spectra.k[1] - spectra.k[0]))]} />
      </section>}
      {focus && <div className="spectrum-sticky-cell spectrum-whatif-cell">
        <section id="spectrum-whatif" className="twin-card spectrum-panel spectrum-whatif" aria-labelledby="spectrum-whatif-title">
          <h2 id="spectrum-whatif-title" className="twin-kicker">What if · {shellLabel(focus)}</h2>
          <WhatIf shell={focus} tweak={tweaks[focus.id] ?? {}} setTweak={t => setTweaks(all => ({ ...all, [focus.id]: t }))} sigma2_A2={sigma2Of(focus)}
            temperature_K={temperature_K} setTemperature={setOwnTemperature} spectra={spectra} base={base ?? spectra} onReset={resetAll} changed={changed} />
        </section>
      </div>}
      {focus && <section className="twin-card spectrum-panel spectrum-neighbour" aria-labelledby="spectrum-neighbour-title">
        <h2 id="spectrum-neighbour-title" className="twin-kicker">Light and heavy neighbours</h2>
        <NeighbourPanel path={focus.paths[0]} color={colors[focus.id]} />
      </section>}
      <details className="twin-card spectrum-panel spectrum-model">
        <summary>Model and sources</summary>
        <ul className="spectrum-model-list">
          <li><TexProse>{`Shells and plots: the FEFF6L paths of ${m.formula} the twin uses, $S_0^2 = 0.9$, $\\sigma^2$ from an Einstein model at ${temperature_K.toFixed(0)} K. Transform as in the twin's Results, Hanning window from $k = ${spectra.window.kmin}$ to $${spectra.window.kmax.toFixed(1)}\\ \\mathring{\\mathrm{A}}^{-1}$, here weighted by $k^{${kweight}}$ (the Results use $k^2$). The near edge is left out of the shells.`}</TexProse></li>
          <li>Near edge: FEFF10 full multiple scattering for this crystal, placed at the sample&apos;s edge. Against measured Cu, Ni and Pt foil, Fe₂O₃ and FeO it is within normalized RMS 0.10 to 0.15; peak heights can be off by a third (oxide white lines run tall).</li>
          {series && <li>Valence: edge positions measured beside the metal ({series.source}).</li>}
          <li>Neighbours: FEFF&apos;s backscattering amplitude |F(k)| of a first shell path, each scaled to its own maximum.</li>
          <li>Wave map: a spherical wave model with FEFF&apos;s amplitude, phases and mean free path; the echo&apos;s sign at the absorber is checked against χ(k).</li>
          <li>Measured overlays: the xraylarch examples (MIT), background removed with Larch&apos;s AUTOBK.</li>
        </ul>
      </details>
    </div>
  </Frame>;
}

interface TourStep { title: string; text: string; target: string; shell?: boolean; k?: number }

/** Five steps from the edge to a bond distance, each with this sample's numbers; the valence step only where a series exists. */
function tourSteps(m: FeffMaterial, shift_eV: number, perValence: number | null, first: Shell | null, peak: number): TourStep[] {
  const name = atomName(m.absorber), e0 = m.edge_energy_eV + shift_eV;
  const steps: TourStep[] = [{ title: 'How XAS works', target: 'spectrum-explorer', text: `X-rays of rising energy pass through the sample. Press Scan the energy: below the edge little is absorbed; at the edge the X-ray frees a ${name} core electron and absorption jumps; above it, the freed electron's echo makes the wiggles.` },
    { title: 'The edge', target: 'spectrum-edge', text: `Absorption jumps at E₀ = ${e0.toFixed(1)} eV, where the X-ray can free a ${name} ${m.edge === 'K' ? '1s' : '2p'} electron. Below it ${name} hardly absorbs; above it, it does.` }];
  if (perValence !== null) steps.push({ title: 'Valence moves the edge', target: 'spectrum-oxidation', text: `Across ${name} compounds the edge moves about ${perValence.toFixed(1)} eV per unit of valence: the more electrons the atom has given away, the harder its core electron is held.` });
  if (first) {
    const el = atomName(first.element!);
    steps.push(
      { title: 'The wiggles', target: 'spectrum-wave', shell: true, k: 6, text: `Above the edge the freed electron is a wave. Its echo from the ${first.count} ${el} neighbours comes back in or out of step as k changes, so absorption wiggles. Move k and watch.` },
      { title: 'Shells become peaks', target: 'spectrum-plots', shell: true, text: `A Fourier transform turns the wiggles into peaks, one per shell. The first, ${first.count} ${el} at ${first.r_A.toFixed(2)} Å, peaks at ${peak.toFixed(2)} Å.` },
      { title: 'From peak to distance', target: 'spectrum-whatif', shell: true, text: `That peak sits ${(first.r_A - peak).toFixed(2)} Å from the true distance, because the wave's phase shifts as it leaves and reflects; a fit with the calculated phase gives the true distance back. Move the distance: the peak follows it, and the height falls as 1/R².` },
    );
  }
  return steps;
}

/** The tour's bar: the step, Back and Next, and where it points (scrolled into view and outlined). */
function TourBar({ step, index, count, target, reduced, onGo, onClose }: { step: TourStep; index: number; count: number; target: string; reduced: boolean; onGo: (i: number) => void; onClose: () => void }) {
  useEffect(() => {
    const el = document.getElementById(target);
    el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    el?.classList.add('is-tour-target');
    return () => el?.classList.remove('is-tour-target');
  }, [target, reduced]);
  return <aside className="spectrum-tour" aria-label="Guided tour" aria-live="polite">
    <p className="twin-kicker">Step {index + 1} of {count} · {step.title}</p>
    <p className="spectrum-tour-text">{step.text}</p>
    <div className="spectrum-tour-actions">
      <button type="button" className="twin-chip" disabled={index === 0} onClick={() => onGo(index - 1)}><ChevronLeft size={14} aria-hidden="true" />Back</button>
      {index < count - 1
        ? <button type="button" className="twin-chip is-accent" onClick={() => onGo(index + 1)}>Next<ChevronRight size={14} aria-hidden="true" /></button>
        : <button type="button" className="twin-chip is-accent" onClick={onClose}>Done</button>}
      <button type="button" className="twin-icon" aria-label="Close the tour" onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </div>
  </aside>;
}

/** The other absorber sites' share, drawn grey. */
const UNUSED_SITE = '#5d6672';

/** Lines for the active shell: absorber to each of its atoms, or the shortest multiple scattering paths, closed. */
function legsOf(shell: Shell, atoms: ClusterAtom[]): [number, number, number][][] {
  if (shell.kind !== 'ms') return atoms.filter(a => a.shellId === shell.id).map(a => [[0, 0, 0], a.xyz]);
  return [...shell.paths].sort((a, b) => a.reff - b.reff).slice(0, MS_DRAWN).map(p => [...p.geometry.map(g => g.xyz_A), p.geometry[0].xyz_A]);
}

function Explain({ shell, absorber, peak, sigma2, temperature_K, share }: { shell: Shell | null; absorber: string; peak: number; sigma2: number | null; temperature_K: number; share: number }) {
  const name = atomName(absorber);
  if (!shell) return <div className="spectrum-prose">
    <p>The {name} atom sends out an electron wave and each neighbour echoes part of it back. In step or out of step, the echo nudges absorption up or down: the wiggles, <Tex plain>{'\\chi(k)'}</Tex>. Each distance becomes one peak in <Tex plain>{'|\\chi(R)|'}</Tex>. Choose a shell, peak or atom to read about it.</p>
  </div>;
  if (shell.kind === 'ms') return <div className="spectrum-prose">
    <p>Paths where the electron bounces off two or more atoms before it returns. They are strongest along straight lines of atoms, where the nearer atom focuses the wave onto the farther one. The lines drawn are the {Math.min(MS_DRAWN, shell.paths.length)} shortest.</p>
    <p>They make <Num>{(100 * share).toFixed(0)}</Num> % of the tallest peak&apos;s height on their own and mostly fall beyond the first shells, which is why distances past the first shell are hard to read from <Tex plain>{'|\\chi(R)|'}</Tex> alone.</p>
  </div>;
  if (shell.kind === 'far') return <div className="spectrum-prose">
    <p><Num>{String(shell.count)}</Num> atoms farther out, from <Num>{Math.min(...shell.paths.map(p => p.reff)).toFixed(1)}</Num> to <Num>{Math.max(...shell.paths.map(p => p.reff)).toFixed(1)}</Num> Å. Their waves are weaker (the wave spreads out and loses strength with distance) and overlap one another, so they blur into the tail of <Tex plain>{'|\\chi(R)|'}</Tex>.</p>
  </div>;
  const element = atomName(shell.element!), offset = shell.r_A - peak;
  return <div className="spectrum-prose">
    <p><Num>{String(shell.count)}</Num> {element} atoms at <Num>{shell.r_A.toFixed(2)}</Num> Å from the {name} atom. The wave reflected by them makes the wiggle drawn in colour, one period every <Tex plain>{`\\pi/R \\approx ${(Math.PI / shell.r_A).toFixed(2)}\\ \\mathring{\\mathrm{A}}^{-1}`}</Tex>: farther neighbours wiggle faster.</p>
    {offset > 0.1
      ? <p>In <Tex plain>{'|\\chi(R)|'}</Tex> it peaks at <Num>{peak.toFixed(2)}</Num> Å, <Num>{offset.toFixed(2)}</Num> Å short of the true distance. The wave&apos;s phase shifts as it leaves the {name} atom and as it reflects, and that shift grows with <Tex plain>k</Tex>, which pulls the peak in. A fit with the calculated phase recovers the true distance.</p>
      : <p>In <Tex plain>{'|\\chi(R)|'}</Tex> it peaks at <Num>{peak.toFixed(2)}</Num> Å, close to the true distance. {element[0].toUpperCase() + element.slice(1)} is a heavy scatterer whose phase does not grow steadily with <Tex plain>k</Tex>, so the usual pull to shorter distance nearly vanishes here.</p>}
    {sigma2 !== null && <p>Its height grows with the number of atoms (<Num>{String(shell.count)}</Num>) and falls with their thermal blur, <Tex plain>{`\\sigma^2 = ${sigma2.toFixed(4)}\\ \\mathring{\\mathrm{A}}^2`}</Tex> at <Num>{temperature_K.toFixed(0)}</Num> K, which damps the wiggle most at high <Tex plain>k</Tex>.</p>}
  </div>;
}

/** Header with the sample and site pickers and the link to the twin. `following`: showing the twin's sample; `linked`: the twin has answered. */
function Frame({ children, following, linked, onFollow, presetId, pick, site, onTour, onView }: {
  children: React.ReactNode; following: boolean; linked: boolean; onFollow: () => void; presetId: string; pick: (id: string) => void; onTour: () => void; onView: (view: SpectrumView) => void;
  site?: { ids: string[]; value: string; set: (id: string) => void };
}) {
  return <>
    <header className="spectrum-head">
      <div>
        <p className="twin-kicker">XAS Lab · Beamline twin</p>
        <h1 className="twin-title">Read the <em>spectrum</em></h1>
      </div>
      <div className="spectrum-controls">
        <ViewSwitch view="detailed" onChange={onView} />
        <label>Sample <select name="sample" value={following ? '' : presetId} onChange={e => pick(e.target.value)}>
          {following && <option value="">From the twin</option>}
          {SAMPLE_GROUPS.map(g => {
            const items = presets.filter(p => p.group === g);
            return items.length ? <optgroup key={g} label={g}>{items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null;
          })}
        </select></label>
        {site && <label>Absorber site <select name="site" value={site.value} onChange={e => site.set(e.target.value)}>{site.ids.map(id => <option key={id} value={id}>{id}</option>)}</select></label>}
        {linked && !following && <button type="button" className="twin-chip" onClick={onFollow}><Link2 size={14} aria-hidden="true" />Follow the twin</button>}
        {following && <span className="twin-chip is-accent"><Link2 size={14} aria-hidden="true" />Following the twin</span>}
        <button type="button" className="twin-chip is-accent" onClick={onTour}><Compass size={14} aria-hidden="true" />Guided tour</button>
        <Link className="twin-chip" href="/twin/"><ArrowLeft size={14} aria-hidden="true" />Beamline twin</Link>
      </div>
    </header>
    {children}
  </>;
}
