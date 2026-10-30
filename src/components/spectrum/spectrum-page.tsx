'use client';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft, Link2 } from 'lucide-react';
import { loadPaths, sigma2Einstein } from '@/lib/twin/exafs';
import { ROOM_TEMPERATURE_K, einsteinTemperature_K, libraryMaterialId } from '@/lib/twin/sample';
import { SAMPLE_GROUPS, SAMPLE_PRESETS } from '@/lib/twin/presets';
import { clusterAtoms, groupShells, loadCluster, shellSpectra, transform, type ClusterAtom, type ClusterFile, type Shell, type ShellTweak } from '@/lib/twin/shells';
import { SPECTRUM_CHANNEL, type SpectrumMessage } from '@/lib/twin/spectrum-link';
import type { FeffMaterial } from '@/lib/twin/types';
import { Num, Tex } from '../tex';
import { TexProse } from '../twin/tex-prose';
import { ShellPlot, type ShellCurve } from './shell-plot';
import { atomName } from './atoms';


// three.js loads after the page, like the twin's hutch.
const ClusterView = dynamic(() => import('./cluster-view'), { ssr: false, loading: () => <p className="spectrum-empty">Loading the 3D cluster…</p> });
// The wave, the "what if" controls and the neighbour comparison sit below the first screen and load after it.
const WavePanel = dynamic(() => import('./wave-panel').then(m => m.WavePanel));
const WhatIf = dynamic(() => import('./what-if').then(m => m.WhatIf));
const NeighbourPanel = dynamic(() => import('./neighbour-panel').then(m => m.NeighbourPanel));

/** Shell colours in distance order: the validated dark categorical slots (dataviz palette), fixed per position, never cycled. */
const SHELL_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
const FAR = { color: '#8a929c', dash: '2 4' }, MULTIPLE = { color: '#9085e9', dash: '7 4' };
/** Multiple scattering paths drawn in 3D when that group is chosen, strongest first. */
const MS_DRAWN = 8;

const presets = SAMPLE_PRESETS.filter(p => libraryMaterialId(p.sample));
type TwinState = Extract<SpectrumMessage, { type: 'state' }>;

/** "4 O at 1.96 Å": shells of one kind can repeat (two 2 O shells in CuO), so the name carries the distance. On the plots, "4 O". */
const shellLabel = (s: Shell) => s.kind === 'shell' ? `${s.count} ${s.element} at ${s.r_A.toFixed(2)} Å` : s.kind === 'far' ? 'Farther atoms' : 'Multiple scattering';
const shortLabel = (s: Shell) => s.kind === 'shell' ? `${s.count} ${s.element}` : shellLabel(s);
const peakOf = (y: number[]) => y.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

export function SpectrumPage() {
  const [presetId, setPresetId] = useState('cu-foil');
  const [twin, setTwin] = useState<TwinState | null>(null);
  const [follow, setFollow] = useState(true);
  const [material, setMaterial] = useState<FeffMaterial | null>(null);
  const [cluster, setCluster] = useState<ClusterFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null);
  // "What if": changes to shells, a temperature of your own, and the k the electron wave is drawn at.
  const [tweaks, setTweaks] = useState<Record<string, ShellTweak>>({}), [ownTemperature, setOwnTemperature] = useState<number | null>(null);
  const [waveK, setWaveK] = useState(6);

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
    Promise.all([loadPaths(materialId), loadCluster(materialId)]).then(([m, c]) => {
      if (!live) return;
      setMaterial(m); setCluster(c); setSiteId(m.sites[0].id); setSelected(null); setHover(null); setTweaks({}); setOwnTemperature(null);
    }, e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [materialId]);

  const ready = material && cluster && material.id === materialId && cluster.id === materialId ? { material, cluster } : null;
  const shells = useMemo(() => ready ? groupShells(ready.material) : [], [ready?.material]);
  // Sliders recompute the path sum; deferring keeps them smooth.
  const shownTweaks = useDeferredValue(tweaks), shownTemperature = useDeferredValue(temperature_K);
  const changed = Object.keys(shownTweaks).length > 0 || shownTemperature !== sampleTemperature;
  const spectra = useMemo(() => ready ? shellSpectra(ready.material, shells, shownTemperature, scan?.kmax, shownTweaks) : null, [ready?.material, shells, shownTemperature, scan?.kmax, shownTweaks]);
  const base = useMemo(() => ready && changed ? shellSpectra(ready.material, shells, sampleTemperature, scan?.kmax) : spectra, [ready?.material, shells, sampleTemperature, scan?.kmax, changed, spectra]);
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

  const frame = { following: fromTwin, linked: twin !== null, onFollow: () => setFollow(true), presetId, pick: (id: string) => { setPresetId(id); setFollow(false); } };
  if (!materialId) return <Frame {...frame}>
    <p className="spectrum-empty">{sample.formula} at the {sample.absorber} {sample.edge} edge has no FEFF paths in the twin&apos;s library, so its spectrum cannot be split into shells. Choose a library sample above.</p>
  </Frame>;
  if (error) return <Frame {...frame}><p className="twin-warning" role="alert">The paths could not load: {error}</p></Frame>;
  if (!ready || !spectra || !site) return <Frame {...frame}><p className="spectrum-empty">Loading the paths…</p></Frame>;

  const m = ready.material;
  const k2 = (y: number[]) => y.map((v, i) => v * spectra.k[i] ** 2);
  // Other absorber sites add to the total; their share is one curve.
  const others = m.sites.length > 1 ? spectra.k.map((_, i) => spectra.total[i] - shown.reduce((s, sh) => s + spectra.chi[sh.id][i], 0)) : null;
  const othersR = others ? transform(spectra.k, others, spectra.window.kmax).magnitude : null;
  const curve = (s: Shell, y: number[]): ShellCurve => ({ id: s.id, color: colors[s.id], dash: s.kind === 'far' ? FAR.dash : s.kind === 'ms' ? MULTIPLE.dash : undefined, y, label: shortLabel(s) });
  const kCurves = shown.map(s => curve(s, k2(spectra.chi[s.id])));
  const rCurves = shown.map(s => curve(s, spectra.magnitude[s.id]));
  if (others && othersR) { kCurves.push({ id: 'others', color: UNUSED_SITE, dash: '1 3', y: k2(others), label: 'Other sites' }); rCurves.push({ id: 'others', color: UNUSED_SITE, dash: '1 3', y: othersR, label: 'Other sites' }); }
  const labelAt = Object.fromEntries(shown.filter(s => s.kind === 'shell').map(s => [s.id, spectra.peak_A[s.id]]));
  const pick = (id: string) => setSelected(current => current === id ? null : id);
  const legs = activeShell ? legsOf(activeShell, atoms) : [];
  const einsteinSigma2 = (s: Shell) => s.paths.reduce((sum, p) => sum + p.degen * sigma2Einstein(p, einsteinTemperature_K(m.id), temperature_K), 0) / s.count;
  const sigma2Of = (s: Shell) => tweaks[s.id]?.sigma2_A2 ?? einsteinSigma2(s);
  const sigma2 = chosen && chosen.kind === 'shell' ? sigma2Of(chosen) : null;
  // The wave and the "what if" controls act on the chosen shell, or the first one.
  const focus = (chosen?.kind === 'shell' ? chosen : null) ?? shown.find(s => s.kind === 'shell') ?? null;
  const ghostK = changed && base ? [{ y: k2(base.total), color: '#a7b1c1' }, ...(focus ? [{ y: k2(base.chi[focus.id]), color: colors[focus.id] }] : [])] : [];
  const ghostR = changed && base ? [{ y: base.totalR, color: '#a7b1c1' }, ...(focus ? [{ y: base.magnitude[focus.id], color: colors[focus.id] }] : [])] : [];
  const resetAll = () => { setTweaks({}); setOwnTemperature(null); };

  return <Frame {...frame}
    site={m.sites.length > 1 ? { ids: m.sites.map(s => s.id), value: site, set: id => { setSiteId(id); setSelected(null); } } : undefined}>
    <div className="spectrum-grid">
      <section className="twin-card spectrum-panel spectrum-3d" aria-labelledby="spectrum-cluster-title">
        <h2 id="spectrum-cluster-title" className="twin-kicker">Around the {m.absorber} atom · {m.formula}</h2>
        <ClusterView atoms={atoms} colors={colors} faint={shown.filter(s => s.kind === 'far').map(s => s.id)} active={active} legs={legs} onHover={setHover} onSelect={pick}
          label={`${m.formula}: the ${atoms.length - 1} atoms within ${ready.cluster.rmax_A} angstrom of the ${atomName(m.absorber)} absorber, coloured by shell`} />
        <p className="spectrum-note">White: the {atomName(m.absorber)} atom that absorbs the X-ray. Coloured: the shells in the table. Pale grey: farther atoms; dark grey: atoms whose paths are too weak to keep. Drag to turn.</p>
      </section>
      <section className="twin-card spectrum-panel" aria-labelledby="spectrum-plots-title">
        <h2 id="spectrum-plots-title" className="twin-kicker">The spectrum, shell by shell</h2>
        <ShellPlot x={spectra.k} xMax={Math.min(14, spectra.window.kmax + 1)} curves={kCurves} total={k2(spectra.total)} scan={scan ? { x: scan.k, y: scan.chi.map((c, i) => c * scan.k[i] ** 2) } : null}
          selected={active} onHover={setHover} onSelect={pick} xLabel="k (Å⁻¹)" yTex={String.raw`k^2\chi(k)\ (\mathring{\mathrm{A}}^{-2})`}
          title={`k squared chi of k for ${m.formula}, split into ${shown.length} shells`} band={{ from: spectra.window.kmin, to: spectra.window.kmax, label: 'Transform window' }}
          ghosts={ghostK} markers={[{ x: waveK, text: `k = ${waveK.toFixed(1)}`, color: '#8ce3ff' }]} />
        <ShellPlot x={spectra.r} xMax={6} curves={rCurves} total={spectra.totalR} scan={scan ? { x: scan.r, y: scan.magnitude } : null}
          selected={active} onHover={setHover} onSelect={pick} xLabel="R (Å), not phase corrected" yTex={String.raw`|\chi(R)|\ (\mathring{\mathrm{A}}^{-3})`}
          title={`magnitude of chi of R for ${m.formula}, split into ${shown.length} shells`} labelAt={labelAt} ghosts={ghostR}
          markers={activeShell && activeShell.kind === 'shell' ? [{ x: activeShell.r_A, text: `true ${activeShell.r_A.toFixed(2)} Å`, color: colors[activeShell.id], dashed: true }] : []} />
        <p className="spectrum-legend">
          <span><i style={{ borderTopColor: '#d4dae3' }} />Total (all paths)</span>
          {scan && <span><i style={{ borderTopColor: '#8ce3ff', borderTopStyle: 'dotted' }} />Your scan #{scan.n}</span>}
          {shown.map(s => <span key={s.id}><i style={{ borderTopColor: colors[s.id], borderTopStyle: s.kind === 'shell' ? 'solid' : s.kind === 'far' ? 'dotted' : 'dashed' }} />{shellLabel(s)}</span>)}
          {others && <span><i style={{ borderTopColor: UNUSED_SITE, borderTopStyle: 'dotted' }} />Other sites</span>}
          {changed && <span><i style={{ borderTopColor: '#a7b1c1', borderTopStyle: 'dashed' }} />Before your changes</span>}
        </p>
      </section>
      <section className="twin-card spectrum-panel spectrum-explain" aria-live="polite" aria-labelledby="spectrum-explain-title">
        <h2 id="spectrum-explain-title" className="twin-kicker">{chosen ? shellLabel(chosen) : 'How to read it'}</h2>
        <Explain shell={chosen} absorber={m.absorber} peak={chosen ? spectra.peak_A[chosen.id] : 0} sigma2={sigma2} temperature_K={temperature_K}
          share={chosen ? peakOf(spectra.magnitude[chosen.id]) / peakOf(spectra.totalR) : 0} />
      </section>
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
        <p className="spectrum-note"><TexProse>{`Model: the FEFF paths of ${m.formula} the twin uses, $S_0^2 = 0.9$, $\\sigma^2$ from an Einstein model at ${temperature_K.toFixed(0)} K. Transform as in the twin's Results: $k^2$ weight, Hanning window from $k = ${spectra.window.kmin}$ to $${spectra.window.kmax.toFixed(1)}\\ \\mathring{\\mathrm{A}}^{-1}$. The near edge region is left out.`}</TexProse></p>
      </section>
      {focus && <section className="twin-card spectrum-panel spectrum-wave" aria-labelledby="spectrum-wave-title">
        <h2 id="spectrum-wave-title" className="twin-kicker">The electron wave · {shellLabel(focus)}</h2>
        <WavePanel shell={focus} absorber={m.absorber} deltar_A={tweaks[focus.id]?.deltar_A ?? 0} k={waveK} setK={setWaveK} color={colors[focus.id]}
          chi={spectra.chi[focus.id][Math.round(waveK / (spectra.k[1] - spectra.k[0]))]} />
      </section>}
      {focus && <section className="twin-card spectrum-panel spectrum-whatif" aria-labelledby="spectrum-whatif-title">
        <h2 id="spectrum-whatif-title" className="twin-kicker">What if · {shellLabel(focus)}</h2>
        <WhatIf shell={focus} tweak={tweaks[focus.id] ?? {}} setTweak={t => setTweaks(all => ({ ...all, [focus.id]: t }))} sigma2_A2={sigma2Of(focus)}
          temperature_K={temperature_K} setTemperature={setOwnTemperature} spectra={spectra} base={base ?? spectra} onReset={resetAll} changed={changed} />
      </section>}
      {focus && <section className="twin-card spectrum-panel spectrum-neighbour" aria-labelledby="spectrum-neighbour-title">
        <h2 id="spectrum-neighbour-title" className="twin-kicker">Light and heavy neighbours</h2>
        <NeighbourPanel path={focus.paths[0]} color={colors[focus.id]} />
      </section>}
    </div>
  </Frame>;
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
    <p>When the {name} atom absorbs an X-ray it sends out an electron wave. Each neighbour reflects part of that wave back. Coming home in step or out of step with itself, the returning wave makes absorption a little stronger or weaker, so the spectrum wiggles: that is <Tex plain>{'\\chi(k)'}</Tex>.</p>
    <p>Neighbours at one distance wiggle together, and a Fourier transform turns each group into a peak in <Tex plain>{'|\\chi(R)|'}</Tex>. Point at a peak, an atom or a row to see which neighbours make it; choose one to read about it here.</p>
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
function Frame({ children, following, linked, onFollow, presetId, pick, site }: {
  children: React.ReactNode; following: boolean; linked: boolean; onFollow: () => void; presetId: string; pick: (id: string) => void;
  site?: { ids: string[]; value: string; set: (id: string) => void };
}) {
  return <div className="twin-app spectrum-app">
    <header className="spectrum-head">
      <div>
        <p className="twin-kicker">XAS Lab · Beamline twin</p>
        <h1 className="twin-title">Read the <em>spectrum</em></h1>
      </div>
      <div className="spectrum-controls">
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
        <Link className="twin-chip" href="/twin/"><ArrowLeft size={14} aria-hidden="true" />Beamline twin</Link>
      </div>
    </header>
    {children}
  </div>;
}
