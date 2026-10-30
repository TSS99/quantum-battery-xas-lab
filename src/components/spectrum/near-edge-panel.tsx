'use client';
import { ETOK } from '@/lib/twin/exafs';
import { libraryFineStructure } from '@/lib/twin/sample';
import { defaultNearEdgeFeatures } from '@/lib/xas-general';
import type { FeffMaterial } from '@/lib/twin/types';
import { Num, Tex } from '../tex';
import { atomName } from './atoms';

const W = 640, H = 230, L = 46, R = 14, T = 16, B = 40, FROM = -25, TO = 70;

/**
 * The spectrum around the edge, normalized, with its parts named: pre-edge peak, edge, white line, and where the
 * shells' wiggles take over (k = 2 per angstrom). Its shape is the twin's: the near edge a labelled teaching model,
 * the same for every material, the wiggles the FEFF path sum; the edge position is the measured one where the sample
 * has a chemical shift.
 */
export function NearEdgePanel({ material, shift_eV, temperature_K }: { material: FeffMaterial; shift_eV: number; temperature_K: number }) {
  const e0 = material.edge_energy_eV + shift_eV;
  const model = libraryFineStructure(e0, material, temperature_K);
  const features = defaultNearEdgeFeatures(e0);
  const x = Array.from({ length: (TO - FROM) * 4 + 1 }, (_, i) => FROM + i / 4), y = x.map(d => model.factor(e0 + d));
  const top = Math.max(...y) * 1.08;
  const px = (d: number) => L + (d - FROM) / (TO - FROM) * (W - L - R), py = (v: number) => H - B - v / top * (H - T - B);
  const line = y.map((v, i) => (i ? 'L' : 'M') + px(x[i]).toFixed(1) + ',' + py(v).toFixed(1)).join('');
  const kStart = 2 * 2 / ETOK;
  const marks = [
    { at: -features.preEdgeOffset_eV, label: 'pre-edge' },
    { at: 0, label: 'edge E₀' },
    { at: features.whiteLineOffset_eV, label: 'white line' },
  ];
  const name = atomName(material.absorber);
  return <div className="near-edge-panel">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Normalized absorption of ${material.formula} from 25 eV below to 70 eV above the ${material.absorber} ${material.edge} edge at ${e0.toFixed(1)} eV, with the pre-edge, the edge, the white line and the start of the fine structure marked`}>
      <rect width={W} height={H} rx="8" fill="#172235" />
      <rect x={px(kStart)} y={T} width={px(TO) - px(kStart)} height={H - T - B} fill="#9cc5e8" opacity=".06" />
      <text x={px(TO) - 6} y={T + 14} textAnchor="end" fill="#a7b1c1" fontSize="12">EXAFS: the shells&apos; wiggles</text>
      <text x={px(FROM) + 6} y={T + 14} fill="#a7b1c1" fontSize="12">XANES</text>
      {[0, 0.5, 1].map(v => <g key={v}><line x1={L} x2={W - R} y1={py(v)} y2={py(v)} stroke="#35404d" /><text x={L - 6} y={py(v) + 4} textAnchor="end" fill="#a7b1c1" fontSize="12">{v}</text></g>)}
      {[-20, 0, 20, 40, 60].map(d => <text key={d} x={px(d)} y={H - B + 16} textAnchor="middle" fill="#a7b1c1" fontSize="12">{d > 0 ? '+' + d : d}</text>)}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fill="#a7b1c1" fontSize="12">E − E₀ (eV)</text>
      <path d={line} fill="none" stroke="#d4dae3" strokeWidth="2.2" />
      {marks.map(m => {
        // Labels sit above their point, or beside it where that would leave the frame (the white line is the top).
        const v = model.factor(e0 + m.at), above = py(v) - 30 >= T + 14;
        const lx = above ? px(m.at) : px(m.at) + 10, ly = above ? py(v) - 30 : py(v) + 4;
        return <g key={m.label}>{above && <line x1={px(m.at)} x2={px(m.at)} y1={py(v) - 6} y2={py(v) - 26} stroke="#8ce3ff" />}
          <circle cx={px(m.at)} cy={py(v)} r="3" fill="#8ce3ff" />
          <text x={lx} y={ly} textAnchor={above ? 'middle' : 'start'} fill="#f3f6fa" fontSize="12.5" paintOrder="stroke" stroke="#172235" strokeWidth="3">{m.label}</text></g>;
      })}
    </svg>
    <ul className="near-edge-list">
      <li><strong>Edge, <Tex plain>E_0</Tex> = <Num>{e0.toFixed(1)}</Num> eV.</strong> The photon now has enough energy to free a {name} {material.edge === 'K' ? '1s' : '2p'} electron, so absorption jumps.{shift_eV ? <> In this sample it sits <Num>{(shift_eV > 0 ? '+' : '') + shift_eV.toFixed(1)}</Num> eV from the metal&apos;s, a measured shift: higher valence binds the core electron harder.</> : null}</li>
      <li><strong>Pre-edge.</strong> A small peak below the edge: the core electron jumping into empty bound states. In transition metals it grows when the site loses its centre of symmetry (a tetrahedron rather than an octahedron).</li>
      <li><strong>White line.</strong> The strong peak just above the edge: many empty states the electron can reach. It grows with the number of empty states, so oxides usually show a taller white line than their metal.</li>
      <li><strong>Fine structure.</strong> From about <Num>{kStart.toFixed(0)}</Num> eV above the edge (<Tex plain>{'k = 2\\ \\mathring{\\mathrm{A}}^{-1}'}</Tex>) the electron has enough energy that single reflections off the neighbours dominate: the wiggles split into shells below.</li>
    </ul>
    <p className="spectrum-note">The edge position is the sample&apos;s; the pre-edge and white line are the twin&apos;s labelled teaching shapes, the same for every material (it does not compute near-edge spectra); the wiggles are the FEFF path sum.</p>
  </div>;
}
