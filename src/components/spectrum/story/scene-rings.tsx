'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { bumpMagnitude, correctedTransform } from '@/lib/twin/distance-chart';
import { ROOM_TEMPERATURE_K } from '@/lib/twin/sample';
import { shellSpectra } from '@/lib/twin/shells';
import { atomName, SHELL_COLORS } from '../atoms';
import { Scene, useNearView, type SceneProps } from './scene';

const Crystal3D = dynamic(() => import('./crystal-3d'), { ssr: false });
const W = 520, H = 200, L = 12, R = 12, T = 34, B = 30, RMAX = 6.2;

/**
 * Step 6: the wiggles unmixed. Each named shell's chi(k) is transformed with its own phase taken out
 * (distance-chart.ts), so its bump sits at the true distance; the rings are added one at a time, in 3D and on the chart.
 */
export function SceneRings({ material, shells, crystal }: SceneProps) {
  const named = useMemo(() => shells.filter(s => s.kind === 'shell'), [shells]);
  const [added, setAdded] = useState(1);
  const [stage, near] = useNearView<HTMLDivElement>();
  const chart = useMemo(() => {
    const spectra = shellSpectra(material, shells, ROOM_TEMPERATURE_K);
    const bumps = named.map(s => correctedTransform(spectra.k, spectra.chi[s.id], s.paths[0], spectra.window, 2, RMAX));
    const each = bumps.map(b => bumpMagnitude([b]));
    return { r: bumps[0]?.r ?? [], bumps, each, full: bumpMagnitude(bumps), peaks: each.map(m => bumps[0].r[m.indexOf(Math.max(...m))]) };
  }, [material, shells, named]);
  if (!named.length) return null;
  const count = Math.min(added, named.length), total = bumpMagnitude(chart.bumps.slice(0, count)), newest = named[count - 1];
  const top = Math.max(...chart.full, ...chart.each.flat(), ...total) * 1.08;
  const px = (r: number) => L + r / RMAX * (W - L - R), py = (v: number) => H - B - v / top * (H - T - B);
  const path = (ys: number[]) => ys.map((y, i) => (i ? 'L' : 'M') + px(chart.r[i]).toFixed(1) + ',' + py(y).toFixed(1)).join('');
  const area = (ys: number[]) => `${path(ys)}L${px(chart.r.at(-1)!).toFixed(1)},${py(0)}L${px(0)},${py(0)}Z`;
  const element = atomName(material.absorber);
  return <Scene id="story-rings" n={6} title="Unmix the wiggles into a distance chart" term="a Fourier transform"
    body={<p>A real crystal has rings of neighbours at several distances, and their wiggles mix. A computer unmixes them into a chart of bumps: one bump for each ring, at that ring&apos;s distance.</p>}
    picture={<figure className="story-figure">
      <div ref={stage}>{near ? <Crystal3D atoms={crystal} colors={SHELL_COLORS} added={count} radius={newest.r_A}
        label={`The real ${material.formula} crystal round the ${element} atom in 3D, with ${count} of its ${named.length} rings of neighbours lit`} />
        : <div className="story-stage" />}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Distance chart: bumps at ${chart.peaks.slice(0, count).map(p => `${p.toFixed(2)} angstrom`).join(', ')}`}>
        <rect width={W} height={H} rx="10" fill="#121a2b" />
        <line x1={L} x2={W - R} y1={py(0)} y2={py(0)} stroke="#35404d" />
        <path d={path(chart.full)} fill="none" stroke="#a7b1c1" strokeWidth="1.2" strokeDasharray="3 4" opacity="0.5" />
        {chart.each.slice(0, count).map((m, i) => <path key={i} d={area(m)} fill={SHELL_COLORS[i]} opacity="0.35" />)}
        <path d={path(total)} fill="none" stroke="#f3f6fa" strokeWidth="2" />
        {named.slice(0, count).map((s, i) => <text key={s.id} x={px(chart.peaks[i])} y={Math.max(16, py(chart.each[i][chart.r.indexOf(chart.peaks[i])]) - 8)}
          textAnchor="middle" fill="#f3f6fa" fontSize="13">{s.count} {s.element}</text>)}
        <text x={L} y={H - 8} fill="#a7b1c1" fontSize="14">distance from the {element} atom →</text>
        <text x={W - R} y={H - 8} textAnchor="end" fill="#a7b1c1" fontSize="14">{RMAX.toFixed(0)} Å</text>
      </svg>
      <p className="story-caption" aria-live="polite">{count < named.length
        ? <>Ring {count}: <b>{newest.count} {atomName(newest.element!)}</b> atoms at <b>{newest.r_A.toFixed(2)} Å</b>. Dashed: all {named.length} rings together.</>
        : <>All {named.length} rings together: each bump stands at its ring&apos;s distance.</>}</p>
    </figure>}
    control={<button type="button" className="twin-chip is-accent" onClick={() => setAdded(count < named.length ? count + 1 : 1)}>
      {count < named.length ? 'Add the next ring' : 'Start again'}</button>} />;
}
