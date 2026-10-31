'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { valenceSeries, type ValenceSeries } from '@/lib/twin/oxidation';
import { SAMPLE_PRESETS } from '@/lib/twin/presets';
import { libraryMaterialId } from '@/lib/twin/sample';
import { xanesAt, type XanesFile } from '@/lib/twin/xanes';
import { atomName } from '../atoms';
import { Scene, eV, useNearView, type SceneProps } from './scene';

const Atom3D = dynamic(() => import('./atom-3d'), { ssr: false, loading: () => <div className="story-stage" /> });
const W = 520, H = 210, L = 12, R = 12, T = 26, B = 32, FROM = -12, TO = 30;
/** Atomic numbers of the elements that have a series; copper's K edge (xraydb), for when copper stands in. */
const Z: Record<string, number> = { Mn: 25, Co: 27, Cu: 29 }, COPPER_K_EV = 8979;

/**
 * A series that tells the story cleanly: measured beside the metal, with the edge rising as electrons are given away.
 * The element's own when it does (Cu, Co); copper's otherwise (Mn's MnO sits with the metal at half the edge step).
 */
function storySeries(element: string): ValenceSeries {
  const own = valenceSeries(element);
  const rises = own && Z[element] && own.members.filter(m => !m.derived).every((m, i, all) => i === 0 || m.shift_eV > all[i - 1].shift_eV);
  return rises ? own! : valenceSeries('Cu')!;
}

/**
 * Step 7: the edge moves with the electrons given away. Each member's computed (FEFF10) near edge is drawn at its
 * measured position; the chosen one bright with its jump marked, and the atom in 3D as that ion (atom-cloud.ts).
 */
export function SceneCharge({ material }: SceneProps) {
  const series = useMemo(() => storySeries(material.absorber), [material.absorber]);
  const own = series.element === material.absorber;
  const [chosen, setChosen] = useState(() => Math.max(0, series.members.findIndex(m => libraryMaterialId(SAMPLE_PRESETS.find(p => p.id === m.id)!.sample) === material.id)));
  const [shapes, setShapes] = useState<Record<string, XanesFile>>({});
  const [stage, near] = useNearView<HTMLDivElement>();
  useEffect(() => {
    let live = true;
    import('@/lib/twin/xanes-files').then(f => Promise.all(series.members.map(async m => {
      const id = libraryMaterialId(SAMPLE_PRESETS.find(p => p.id === m.id)!.sample);
      return id ? [m.id, await f.loadXanes(id).catch(() => null)] as const : null;
    }))).then(found => { if (live) setShapes(Object.fromEntries(found.filter(x => x && x[1]) as [string, XanesFile][])); });
    return () => { live = false; };
  }, [series]);
  const member = series.members[Math.min(chosen, series.members.length - 1)];
  const element = atomName(series.element), metalEdge = own ? material.edge_energy_eV : COPPER_K_EV;
  const xs = Array.from({ length: (TO - FROM) * 4 + 1 }, (_, i) => FROM + i / 4);
  const drawn = series.members.filter(m => shapes[m.id]);
  const top = Math.max(1.1, ...drawn.flatMap(m => xs.map(d => xanesAt(shapes[m.id], d - m.shift_eV)))) * 1.04;
  const px = (d: number) => L + (d - FROM) / (TO - FROM) * (W - L - R), py = (v: number) => H - B - v / top * (H - T - B);
  const path = (m: typeof member) => xs.map((d, i) => (i ? 'L' : 'M') + px(d).toFixed(1) + ',' + py(xanesAt(shapes[m.id], d - m.shift_eV)).toFixed(1)).join('');
  const given = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(1);
  const what = (m: typeof member) => m.valence === 0 ? `${element} metal` : m.name.replace(/ (pellet|foil)$/, '');
  return <Scene id="story-charge" n={7} title="Give electrons away and the jump moves up" term="the oxidation state"
    body={<p>When {element} joins with oxygen, it gives some of its electrons away. The ones left are held more tightly, so the jump moves to a higher energy. The metal in a battery does this every time the battery charges.</p>}
    picture={<figure className="story-figure">
      <div ref={stage}>{near ? <Atom3D Z={Z[series.element]} kEdge free={false} beam={false} charge={member.valence}
        label={`A ${element} atom in 3D that has given ${given(member.valence)} electrons away: its outer cloud ${member.valence > 0 ? 'is smaller' : 'is whole'}`} />
        : <div className="story-stage" />}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The ${element} jump for ${what(member)}: ${member.shift_eV >= 0 ? '+' : ''}${member.shift_eV.toFixed(1)} eV from the metal's`}>
        <rect width={W} height={H} rx="10" fill="#121a2b" />
        <line x1={px(0)} x2={px(0)} y1={T} y2={H - B} stroke="#35404d" strokeDasharray="4 4" />
        <text x={px(0) + 6} y={T - 8} fill="#a7b1c1" fontSize="14">the metal&apos;s jump, {eV(metalEdge)} eV</text>
        {drawn.filter(m => m !== member).map(m => <path key={m.id} d={path(m)} fill="none" stroke="#a7b1c1" strokeWidth="1.3" opacity="0.35" />)}
        {shapes[member.id] && <>
          <path d={path(member)} fill="none" stroke="#f3f6fa" strokeWidth="2.6" />
          <circle cx={px(member.shift_eV)} cy={py(xanesAt(shapes[member.id], 0))} r="6.5" fill="#ffc46b" stroke="#121a2b" strokeWidth="2" />
        </>}
        <text x={L} y={H - 10} fill="#a7b1c1" fontSize="14">X-ray energy →</text>
      </svg>
      <p className="story-caption" aria-live="polite"><b>{what(member)}</b>: {member.valence === 0 ? <>no electrons given away. This is where the jump starts.</>
        : <>{given(member.valence)} {member.valence === 1 ? 'electron' : 'electrons'} given away. The jump sits <b>{member.shift_eV.toFixed(1)} eV</b> above the metal&apos;s.</>}</p>
      {!own && <p className="story-key"><span>Shown with copper, where the jump was measured beside the metal for each.</span></p>}
    </figure>}
    control={<div className="story-choice" role="group" aria-label="Electrons given away">
      <span>Electrons given away</span>
      {series.members.map((m, i) => <button key={m.id} type="button" className="twin-chip" aria-pressed={i === chosen} onClick={() => setChosen(i)}>{given(m.valence)}</button>)}
    </div>} />;
}
