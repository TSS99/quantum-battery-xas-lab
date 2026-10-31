'use client';
import { useEffect, useState } from 'react';
import { SAMPLE_PRESETS } from '@/lib/twin/presets';
import { xanesAt, type XanesFile } from '@/lib/twin/xanes';
import { nearEdgeMarks } from '@/lib/twin/xanes-features';
import { loadXanes } from '@/lib/twin/xanes-files';

/*
 * Reading a spectrum, one feature at a time, each from real library data: the edge position (computed Cu and CuO at
 * their measured edges), the edge shape (computed Cr2O3 and K2CrO4 on FEFF's energy scale) and the wiggle speed (this
 * sample's nearest and farthest shells). Each card links to the panel where it can be tried on this sample.
 */
const W = 220, H = 84, PAD = 8;

interface Card { title: string; read: string; target: string; a: (x: number) => number; b: (x: number) => number; range: [number, number]; legend: [string, string] }
/** A curve of the page's own spectra, for the wiggle card. */
export interface WiggleCurve { label: string; k: number[]; y: number[] }

const at = (k: number[], y: number[]) => (x: number) => { const i = Math.max(0, Math.min(k.length - 2, Math.floor((x - k[0]) / (k[1] - k[0])))); return y[i] + (y[i + 1] - y[i]) * (x - k[i]) / (k[i + 1] - k[i]); };
const shift = (id: string) => SAMPLE_PRESETS.find(p => p.id === id)?.sample.edgeShift_eV ?? 0;

function Sketch({ card }: { card: Card }) {
  const xs = Array.from({ length: 121 }, (_, i) => card.range[0] + (card.range[1] - card.range[0]) * i / 120);
  const ya = xs.map(card.a), yb = xs.map(card.b), all = [...ya, ...yb];
  const lo = Math.min(...all), hi = Math.max(...all);
  const px = (i: number) => PAD + i / 120 * (W - 2 * PAD), py = (v: number) => H - PAD - (v - lo) / (hi - lo || 1) * (H - 2 * PAD);
  const line = (ys: number[]) => ys.map((v, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(v).toFixed(1)).join('');
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${card.legend[0]} against ${card.legend[1]}`}>
    <rect width={W} height={H} rx="6" fill="#121a2b" />
    <path d={line(ya)} fill="none" stroke="#a7b1c1" strokeWidth="1.8" strokeDasharray="5 4" />
    <path d={line(yb)} fill="none" stroke="#8ce3ff" strokeWidth="2.2" />
  </svg>;
}

export function ReadCards({ near, far }: { near: WiggleCurve | null; far: WiggleCurve | null }) {
  const [edges, setEdges] = useState<Record<string, XanesFile> | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(['cu', 'cuo', 'cr2o3', 'k2cro4'].map(loadXanes)).then(([cu, cuo, cr2o3, k2cro4]) => { if (live) setEdges({ cu, cuo, cr2o3, k2cro4 }); }, () => undefined);
    return () => { live = false; };
  }, []);
  const cards: Card[] = [];
  if (edges) {
    const cuo = shift('cuo-pellet') - shift('cu-foil');
    cards.push({ title: 'Edge position', target: 'spectrum-oxidation', range: [-10, 25], legend: ['Cu metal', 'CuO, Cu(II)'],
      a: x => xanesAt(edges.cu, x), b: x => xanesAt(edges.cuo, x - cuo),
      read: `Valence up, edge up: CuO's edge sits ${cuo.toFixed(1)} eV above copper's.` });
    const oct = nearEdgeMarks(edges.cr2o3).preEdge?.height ?? 0, tet = nearEdgeMarks(edges.k2cro4).preEdge?.height ?? 0;
    const offset = edges.k2cro4.feff_e0_eV - edges.cr2o3.feff_e0_eV;
    cards.push({ title: 'Edge shape', target: 'spectrum-edge', range: [-18, 22], legend: ['Cr₂O₃, octahedral', 'K₂CrO₄, tetrahedral'],
      a: x => xanesAt(edges.cr2o3, x), b: x => xanesAt(edges.k2cro4, x - offset),
      read: `No centre of symmetry, a strong pre-edge: K₂CrO₄'s is ${oct > 0 ? `${Math.round(tet / oct)}×` : 'far above'} Cr₂O₃'s.` });
  }
  if (near && far) cards.push({ title: 'Wiggle speed', target: 'spectrum-plots', range: [3, 11], legend: [near.label, far.label],
    a: at(near.k, near.y), b: at(far.k, far.y), read: 'Farther neighbours wiggle faster: the speed of a wiggle is a distance.' });
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  return <ul className="read-cards">
    {cards.map(card => <li key={card.title} className="read-card">
      <h3>{card.title}</h3>
      <Sketch card={card} />
      <p className="read-card-legend"><span><i className="is-a" aria-hidden="true" />{card.legend[0]}</span><span><i className="is-b" aria-hidden="true" />{card.legend[1]}</span></p>
      <p>{card.read}</p>
      <button type="button" className="twin-chip" onClick={() => jump(card.target)}>Try it on this sample</button>
    </li>)}
  </ul>;
}
