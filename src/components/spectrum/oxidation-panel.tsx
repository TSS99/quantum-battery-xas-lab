'use client';
import { valenceSeries } from '@/lib/twin/oxidation';
import { teachingFineStructure } from '@/lib/twin/sample';
import { Num } from '../tex';

const W = 640, H = 220, L = 46, R = 14, T = 14, B = 40, FROM = -12, TO = 24;
/**
 * Series colours in valence order: one hue, a sequential scale (valence is an order, not a category), from mid blue to
 * light so every step stays visible on the dark plot and higher valence reads brighter.
 */
const SHADES = ['#3d7fd6', '#5b97e0', '#7fb0e8', '#a6c9f0', '#cfe2f7'];

/**
 * The edges of one element's valence series, each at its measured position against the metal, drawn with the same
 * edge shape so only the position differs; and the shift against valence, with its slope from the measured members.
 */
export function OxidationPanel({ element, edge_eV, currentId }: { element: string; edge_eV: number; currentId: string | null }) {
  const series = valenceSeries(element);
  if (!series) return <p className="spectrum-empty">The library has no measured valence series for {element}; Mn, Co, Cu, S and As have one.</p>;
  const edge = (shift: number) => teachingFineStructure(edge_eV + shift, { preEdgeHeight: 0, whiteLineHeight: 0, oscillation: 0 });
  const x = Array.from({ length: (TO - FROM) * 5 + 1 }, (_, i) => FROM + i / 5);
  const px = (d: number) => L + (d - FROM) / (TO - FROM) * (W - L - R), py = (v: number) => H - B - v / 1.1 * (H - T - B);
  return <div className="oxidation-panel">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${element} edges by valence: ${series.members.map(m => `${m.name} ${m.shift_eV.toFixed(1)} eV`).join(', ')}`}>
      <rect width={W} height={H} rx="8" fill="#172235" />
      {[0, 0.5, 1].map(v => <g key={v}><line x1={L} x2={W - R} y1={py(v)} y2={py(v)} stroke="#35404d" /><text x={L - 6} y={py(v) + 4} textAnchor="end" fill="#a7b1c1" fontSize="12">{v}</text></g>)}
      {[-10, -5, 0, 5, 10, 15, 20].map(d => <text key={d} x={px(d)} y={H - B + 16} textAnchor="middle" fill="#a7b1c1" fontSize="12">{d > 0 ? '+' + d : d}</text>)}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fill="#a7b1c1" fontSize="12">E − E₀ of the metal (eV)</text>
      {series.members.map((m, i) => {
        const shape = edge(m.shift_eV), d = x.map((e, j) => (j ? 'L' : 'M') + px(e).toFixed(1) + ',' + py(shape.factor(edge_eV + e)).toFixed(1)).join('');
        return <path key={m.id} d={d} fill="none" stroke={SHADES[Math.round(i * (SHADES.length - 1) / Math.max(1, series.members.length - 1))]} strokeWidth={m.id === currentId ? 3.2 : 2} strokeDasharray={m.derived ? '6 4' : undefined} />;
      })}
    </svg>
    <table className="spectrum-table oxidation-table">
      <thead><tr><th scope="col">Sample</th><th scope="col">Valence</th><th scope="col">Edge shift</th></tr></thead>
      <tbody>{series.members.map((m, i) => <tr key={m.id} className={m.id === currentId ? 'is-active' : undefined}>
        <th scope="row"><i style={{ borderTopColor: SHADES[Math.round(i * (SHADES.length - 1) / Math.max(1, series.members.length - 1))], borderTopStyle: m.derived ? 'dashed' : 'solid' }} aria-hidden="true" />{m.name}</th>
        <td>+<Num>{Number(m.valence.toFixed(2)).toString()}</Num></td>
        <td><Num>{(m.shift_eV > 0 ? '+' : '') + m.shift_eV.toFixed(2)}</Num> eV{m.derived ? ` (${m.derived} by valence)` : ''}</td>
      </tr>)}</tbody>
    </table>
    <p className="spectrum-note">About <Num>{series.perValence_eV.toFixed(1)}</Num> eV per unit of valence across the measured samples: each electron removed leaves the core electron more tightly bound, so the edge moves up. It is not exactly linear; the edge&apos;s shape changes with the neighbours too ({series.members.some(m => m.shift_eV < 0 && m.valence > 0) ? 'here the oxide sits with the metal at half the edge step' : 'compare the steps between members'}). Source: {series.source}. The curves share one edge shape so only their positions differ.</p>
  </div>;
}
