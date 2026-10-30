'use client';
import { useEffect, useState } from 'react';
import { loadPaths } from '@/lib/twin/exafs';
import { groupShells, pathCurves } from '@/lib/twin/shells';
import type { FeffPath } from '@/lib/twin/types';
import { Num, Tex } from '../tex';
import { atomName } from './atoms';

/** Neighbours to compare, each from the first shell of a library material: light, middle and heavy. */
const REFERENCES = [['cuo', 'O', '#3987e5'], ['cu', 'Cu', '#d95926'], ['pt', 'Pt', '#199e70']] as const;
const W = 560, H = 200, L = 40, R = 12, T = 12, B = 34, K_MAX = 16;

interface Curve { element: string; color: string; k: number[]; f: number[]; peakK: number; dips: number[] }

function curveOf(path: FeffPath, color: string): Curve {
  const k = Array.from({ length: 151 }, (_, i) => 1 + i * 0.1);
  const f = k.map(kk => pathCurves(path, kk).amplitude), max = Math.max(...f);
  const dips = k.filter((kk, i) => i > 0 && i < k.length - 1 && f[i] < f[i - 1] && f[i] < f[i + 1] && kk > 3).map(kk => +kk.toFixed(1));
  return { element: path.geometry[1].label, color, k, f: f.map(v => v / max), peakK: k[f.indexOf(max)], dips };
}

/**
 * How strongly a neighbour reflects the electron wave against k: FEFF's effective backscattering amplitude |F(k)| of
 * a first shell path, each scaled to its own maximum so the shapes compare. Light atoms reflect at low k only; heavy
 * ones keep reflecting out to high k, with dips.
 */
export function NeighbourPanel({ path, color }: { path: FeffPath; color: string }) {
  const [refs, setRefs] = useState<Curve[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all(REFERENCES.map(async ([id, , c]) => {
      const m = await loadPaths(id);
      const first = groupShells(m).find(s => s.id.endsWith('/s1'))!;
      return curveOf(first.paths[0], c);
    })).then(c => { if (live) setRefs(c); }, () => undefined);
    return () => { live = false; };
  }, []);
  const own = curveOf(path, color);
  const curves = [...refs.filter(c => c.element !== own.element), own];
  const px = (k: number) => L + (k - 1) / (K_MAX - 1) * (W - L - R), py = (v: number) => H - B - v * (H - T - B);
  const line = (c: Curve) => c.f.map((v, i) => (i ? 'L' : 'M') + px(c.k[i]).toFixed(1) + ',' + py(v).toFixed(1)).join('');
  const describe = (c: Curve) => `${atomName(c.element)}: largest near k = ${c.peakK.toFixed(1)}${c.dips.length ? `, dips near ${c.dips.join(' and ')}` : ''}`;
  return <div className="neighbour-panel">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`How strongly each neighbour reflects the electron wave against k. ${curves.map(describe).join('. ')}.`}>
      <rect width={W} height={H} rx="8" fill="#172235" />
      {[0, 0.5, 1].map(v => <line key={v} x1={L} x2={W - R} y1={py(v)} y2={py(v)} stroke="#35404d" />)}
      {[2, 4, 6, 8, 10, 12, 14, 16].map(k => <text key={k} x={px(k)} y={H - B + 16} textAnchor="middle" fill="#a7b1c1" fontSize="12">{k}</text>)}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fill="#a7b1c1" fontSize="12">k (Å⁻¹)</text>
      {curves.map(c => <path key={c.element} d={line(c)} fill="none" stroke={c.color} strokeWidth={c === own ? 2.8 : 1.8} strokeDasharray={c === own ? undefined : '6 4'} />)}
    </svg>
    <ul className="neighbour-legend">{curves.map(c => <li key={c.element}><i style={{ borderTopColor: c.color, borderTopStyle: c === own ? 'solid' : 'dashed' }} aria-hidden="true" />{describe(c)}{c === own ? ' (this shell)' : ''}</li>)}</ul>
    <p className="spectrum-note">Light neighbours reflect the electron mostly at low <Tex plain>k</Tex>; heavy ones keep reflecting it at high <Tex plain>k</Tex>, which is why weighting by <Tex plain>{'k^2'}</Tex> or <Tex plain>{'k^3'}</Tex> brings heavy neighbours out, and why the shape of <Tex plain>{'\\chi(k)'}</Tex> tells light from heavy neighbours at the same distance. Each curve is FEFF&apos;s <Tex plain>{'|F(k)|'}</Tex> for a first shell, scaled to its own largest value; <Num>1</Num> is that maximum.</p>
  </div>;
}
