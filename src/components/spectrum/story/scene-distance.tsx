'use client';
import { useDeferredValue, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { chiPath, ETOK } from '@/lib/twin/exafs';
import { ROOM_TEMPERATURE_K } from '@/lib/twin/sample';
import { pathCurves, tweakedParameters } from '@/lib/twin/shells';
import { atomName } from '../atoms';
import { Scene, StorySlider, eV, useNearView, type SceneProps } from './scene';

const Wave3D = dynamic(() => import('./wave-3d'), { ssr: false, loading: () => <div className="story-stage" /> });
const FROM = 30, TO = 500, K = 5, SPAN = 0.6;
const W = 520, H = 150, L = 12, R = 12, T = 22, B = 30;

/**
 * Step 5: the wiggle speed is the distance. The slider moves the nearest shell (the "what if" distance change of the
 * detailed view); the line is that shell's chi(k), k^2 weighted, against energy above the edge, with the crystal's own
 * line faint behind it, and the wiggles are counted as the line's crests.
 */
export function SceneDistance({ material, e0, first, neighbours, shells }: SceneProps) {
  const [delta, setDelta] = useState(0);
  const shown = useDeferredValue(delta);
  const [stage, near] = useNearView<HTMLDivElement>();
  const energies = useMemo(() => Array.from({ length: (TO - FROM) / 2 + 1 }, (_, i) => FROM + 2 * i), []);
  const line = useMemo(() => (deltar: number) => {
    if (!first) return [];
    const ks = energies.map(e => Math.sqrt(ETOK * e));
    const params = tweakedParameters(material, shells, ROOM_TEMPERATURE_K, { [first.id]: { deltar_A: deltar } });
    const sum = ks.map(() => 0);
    for (const p of first.paths) chiPath(p, params.paths![`${first.siteId}/${p.id}`], ks).forEach((v, i) => { sum[i] += v * ks[i] ** 2; });
    return sum;
  }, [material, shells, first, energies]);
  const base = useMemo(() => line(0), [line]), now = useMemo(() => line(shown), [line, shown]);
  if (!first) return null;
  const top = Math.max(...base.map(Math.abs), ...now.map(Math.abs)) || 1;
  const crests = now.filter((v, i) => i > 0 && i < now.length - 1 && v > now[i - 1] && v >= now[i + 1] && v > 0.05 * top).length;
  const px = (e: number) => L + (e - FROM) / (TO - FROM) * (W - L - R), py = (y: number) => T + (H - T - B) / 2 * (1 - y / top);
  const path = (ys: number[]) => ys.map((y, i) => (i ? 'L' : 'M') + px(energies[i]).toFixed(1) + ',' + py(y).toFixed(1)).join('');
  const distance = first.r_A + delta, neighbour = atomName(first.element!);
  const moved = neighbours.map(n => { const r = Math.hypot(...n.xyz), f = (r + delta) / r; return { element: n.element, xyz: n.xyz.map(v => v * f) as [number, number, number] }; });
  return <Scene id="story-distance" n={5} title="Faster wiggles mean farther neighbours" term="the bond length"
    body={<p>Drag the neighbours farther out and watch the wiggles bunch up. More of them squeeze into the same stretch of energy. Count the wiggles and you know how far apart the atoms are.</p>}
    picture={<figure className="story-figure">
      <div ref={stage}>{near ? <Wave3D absorber={material.absorber} neighbours={moved} k={K} curves={pathCurves(first.paths[0], K)} echoes ring={null}
        label={`The ${atomName(material.absorber)} atom and its ${first.count} nearest ${neighbour} neighbours, moved to ${distance.toFixed(2)} angstrom`} />
        : <div className="story-stage" />}</div>
      <p className="story-readout"><span><b>{crests}</b> wiggles</span><span><b>{distance.toFixed(2)}</b> Å apart</span></p>
      <div className="story-plot"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The wiggle of the ${neighbour} neighbours at ${distance.toFixed(2)} angstrom: ${crests} wiggles from ${eV(e0 + FROM)} to ${eV(e0 + TO)} eV`}>
        <line className="story-axis" x1={L} x2={W - R} y1={py(0)} y2={py(0)} />
        {delta !== 0 && <path d={path(base)} fill="none" stroke="#8a9ab0" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.6" />}
        <path className="story-trace" d={path(now)} strokeWidth="2" />
        <text x={L + 4} y={T - 6} fill="#8a9ab0" fontSize="14">{delta !== 0 ? 'dashed: the real crystal' : 'the real crystal'}</text>
        <text x={W - R} y={H - B + 18} textAnchor="end" fill="#8a9ab0" fontSize="14">higher energy →</text>
      </svg></div>
      <p className="story-key"><span>1 Å, one ångström, is a ten billionth of a metre: about the width of an atom</span></p>
    </figure>}
    control={<StorySlider label={`Distance to the ${neighbour} neighbours`} display={`${distance.toFixed(2)} Å`} value={delta} min={-SPAN} max={SPAN} step={0.01} onChange={setDelta} />} />;
}
