'use client';
import { useEffect, useState } from 'react';
import { valenceSeries } from '@/lib/twin/oxidation';
import { SAMPLE_PRESETS } from '@/lib/twin/presets';
import { libraryMaterialId, teachingFineStructure } from '@/lib/twin/sample';
import { xanesAt, type XanesFile } from '@/lib/twin/xanes';
import { loadXanes } from '@/lib/twin/xanes-files';
import { Num } from '../tex';

const W = 640, H = 220, L = 46, R = 14, T = 14, B = 40, FROM = -15, TO = 35;
/**
 * Series colours in valence order: one hue, a sequential scale (valence is an order, not a category), from mid blue to
 * light so every step stays visible on the dark plot and higher valence reads brighter.
 */
const SHADES = ['#3d7fd6', '#5b97e0', '#7fb0e8', '#a6c9f0', '#cfe2f7'];

/**
 * The edges of one element's valence series, each at its measured position against the metal and with its own
 * computed (FEFF10) shape where the library has the crystal, so both the shift and the change of shape show; members
 * without a crystal (solutions) get a plain step, dashed. A dot marks each E0.
 */
export function OxidationPanel({ element, edge_eV, currentId }: { element: string; edge_eV: number; currentId: string | null }) {
  const series = valenceSeries(element);
  const [shapes, setShapes] = useState<Record<string, XanesFile>>({});
  useEffect(() => {
    if (!series) return;
    let live = true;
    Promise.all(series.members.map(async m => {
      const sample = SAMPLE_PRESETS.find(p => p.id === m.id)?.sample, id = sample && libraryMaterialId(sample);
      return id ? [m.id, await loadXanes(id).catch(() => null)] as const : null;
    })).then(found => { if (live) setShapes(Object.fromEntries(found.filter(f => f && f[1]) as [string, XanesFile][])); });
    return () => { live = false; };
  }, [element]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!series) return <p className="spectrum-empty">The library has no measured valence series for {element}; Mn, Co, Cu, S and As have one.</p>;
  const plain = (shift: number) => teachingFineStructure(edge_eV + shift, { preEdgeHeight: 0, whiteLineHeight: 0, oscillation: 0 });
  const value = (id: string, shift: number, d: number) => shapes[id] ? xanesAt(shapes[id], d - shift) : plain(shift).factor(edge_eV + d);
  const x = Array.from({ length: (TO - FROM) * 4 + 1 }, (_, i) => FROM + i / 4);
  const top = Math.max(1.1, ...series.members.flatMap(m => x.map(d => value(m.id, m.shift_eV, d)))) * 1.04;
  const px = (d: number) => L + (d - FROM) / (TO - FROM) * (W - L - R), py = (v: number) => H - B - v / top * (H - T - B);
  const shade = (i: number) => SHADES[Math.round(i * (SHADES.length - 1) / Math.max(1, series.members.length - 1))];
  return <div className="oxidation-panel">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${element} edges by valence: ${series.members.map(m => `${m.name} ${m.shift_eV.toFixed(1)} eV`).join(', ')}`}>
      <rect width={W} height={H} rx="8" fill="#172235" />
      {[0, 0.5, 1].map(v => <g key={v}><line x1={L} x2={W - R} y1={py(v)} y2={py(v)} stroke="#35404d" /><text x={L - 6} y={py(v) + 4} textAnchor="end" fill="#a7b1c1" fontSize="12">{v}</text></g>)}
      {[-10, 0, 10, 20, 30].map(d => <text key={d} x={px(d)} y={H - B + 16} textAnchor="middle" fill="#a7b1c1" fontSize="12">{d > 0 ? '+' + d : d}</text>)}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fill="#a7b1c1" fontSize="12">E − E₀ of the metal (eV)</text>
      {series.members.map((m, i) => {
        const d = x.map((e, j) => (j ? 'L' : 'M') + px(e).toFixed(1) + ',' + py(value(m.id, m.shift_eV, e)).toFixed(1)).join('');
        return <g key={m.id}>
          <path d={d} fill="none" stroke={shade(i)} strokeWidth={m.id === currentId ? 3.2 : 2} strokeDasharray={shapes[m.id] ? undefined : '6 4'} />
          <circle cx={px(m.shift_eV)} cy={py(value(m.id, m.shift_eV, m.shift_eV))} r="4" fill={shade(i)} stroke="#172235" strokeWidth="1.5" />
        </g>;
      })}
    </svg>
    <table className="spectrum-table oxidation-table">
      <thead><tr><th scope="col">Sample</th><th scope="col">Valence</th><th scope="col">Edge shift</th></tr></thead>
      <tbody>{series.members.map((m, i) => <tr key={m.id} className={m.id === currentId ? 'is-active' : undefined}>
        <th scope="row"><i style={{ borderTopColor: shade(i), borderTopStyle: shapes[m.id] ? 'solid' : 'dashed' }} aria-hidden="true" />{m.name}</th>
        <td>+<Num>{Number(m.valence.toFixed(2)).toString()}</Num></td>
        <td><Num>{(m.shift_eV > 0 ? '+' : '') + m.shift_eV.toFixed(2)}</Num> eV{m.derived ? ` (${m.derived} by valence)` : ''}</td>
      </tr>)}</tbody>
    </table>
    <p className="spectrum-note">About <Num>{series.perValence_eV.toFixed(1)}</Num> eV per unit of valence, not exactly linear: the shape changes with the neighbours too. Positions measured ({series.source}); shapes computed with FEFF10 for each crystal{series.members.some(m => !shapes[m.id]) ? ', dashed where there is no crystal' : ''}.</p>
  </div>;
}
