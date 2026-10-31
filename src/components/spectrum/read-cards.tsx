'use client';
import { useEffect, useState } from 'react';
import { xanesAt, type XanesFile } from '@/lib/twin/xanes';
import { nearEdgeMarks } from '@/lib/twin/xanes-features';
import { loadXanes } from '@/lib/twin/xanes-files';

/*
 * Reading a spectrum, one feature at a time: each card draws the same feature for two materials or two states and
 * says what the difference means, with a link to the panel where it can be tried on this sample. Edge shape is two
 * computed library spectra (FEFF10, Cr2O3 and K2CrO4 on FEFF's own energy scale); the others use the textbook forms
 * (an arctangent edge, the EXAFS term N sin(2kR) exp(-2 sigma^2 k^2)).
 */
const W = 220, H = 84, PAD = 8;

interface Card { title: string; read: string; target: string; a: (x: number) => number; b: (x: number) => number; range: [number, number]; legend: [string, string] }

const step = (x: number, at: number) => 0.5 + Math.atan((x - at) / 1.2) / Math.PI;
const peak = (x: number, at: number, w: number) => Math.exp(-0.5 * ((x - at) / w) ** 2);
const wiggle = (k: number, R: number, N: number, s2: number) => N * Math.sin(2 * k * R) * Math.exp(-2 * s2 * k * k) / 4;

const CARDS: Card[] = [
  { title: 'Edge position', read: 'Higher oxidation state, edge moves up in energy: a few eV per unit of valence.', target: 'spectrum-oxidation',
    a: x => step(x, 0), b: x => step(x, 4), range: [-10, 14], legend: ['lower valence', 'higher valence'] },
  { title: 'Edge shape', read: 'A site without a centre of symmetry (a tetrahedron) shows a stronger pre-edge than an octahedron.', target: 'spectrum-edge',
    a: x => step(x, 0) + 0.05 * peak(x, -8, 0.8) + 0.35 * peak(x, 3, 1.6), b: x => step(x, 0) + 0.3 * peak(x, -8, 0.8) + 0.15 * peak(x, 3, 1.6), range: [-14, 14], legend: ['octahedral', 'tetrahedral'] },
  { title: 'Wiggle speed', read: 'Farther neighbours wiggle faster: one period every π/R in k.', target: 'spectrum-whatif',
    a: k => wiggle(k, 2.0, 4, 0.003), b: k => wiggle(k, 2.6, 4, 0.003), range: [3, 11], legend: ['R = 2.0 Å', 'R = 2.6 Å'] },
  { title: 'Wiggle height', read: 'More neighbours, a taller wiggle: the height grows with their number.', target: 'spectrum-whatif',
    a: k => wiggle(k, 2.2, 4, 0.004), b: k => wiggle(k, 2.2, 8, 0.004), range: [3, 11], legend: ['4 neighbours', '8 neighbours'] },
  { title: 'Wiggle fade', read: 'Heat or disorder blurs the distance, so the wiggles die away at high k.', target: 'spectrum-whatif',
    a: k => wiggle(k, 2.2, 6, 0.002), b: k => wiggle(k, 2.2, 6, 0.012), range: [3, 13], legend: ['cold, ordered', 'hot or disordered'] },
];

function Sketch({ card }: { card: Card }) {
  const xs = Array.from({ length: 121 }, (_, i) => card.range[0] + (card.range[1] - card.range[0]) * i / 120);
  const ya = xs.map(card.a), yb = xs.map(card.b), all = [...ya, ...yb];
  const lo = Math.min(...all), hi = Math.max(...all);
  const px = (i: number) => PAD + i / 120 * (W - 2 * PAD), py = (v: number) => H - PAD - (v - lo) / (hi - lo || 1) * (H - 2 * PAD);
  const line = (ys: number[]) => ys.map((v, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(v).toFixed(1)).join('');
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sketch: ${card.legend[0]} against ${card.legend[1]}`}>
    <rect width={W} height={H} rx="6" fill="#121a2b" />
    <path d={line(ya)} fill="none" stroke="#a7b1c1" strokeWidth="1.8" strokeDasharray="5 4" />
    <path d={line(yb)} fill="none" stroke="#8ce3ff" strokeWidth="2.2" />
  </svg>;
}

/** The geometry card from the computed chromium spectra: octahedral Cr2O3 against tetrahedral K2CrO4. */
function geometryCard(oct: XanesFile, tet: XanesFile): Card {
  const shift = tet.feff_e0_eV - oct.feff_e0_eV;
  const a = nearEdgeMarks(oct).preEdge?.height ?? 0, b = nearEdgeMarks(tet).preEdge?.height ?? 0;
  return { title: 'Edge shape', target: 'spectrum-edge', range: [-12, 22], legend: ['Cr₂O₃, octahedral', 'K₂CrO₄, tetrahedral'],
    a: x => xanesAt(oct, x), b: x => xanesAt(tet, x - shift),
    read: `No centre of symmetry, a strong pre-edge: tetrahedral chromate's is ${a > 0 ? `${Math.round(b / a)}×` : 'far above'} the octahedral oxide's. Computed (FEFF10).` };
}

export function ReadCards() {
  const [chromium, setChromium] = useState<Card | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([loadXanes('cr2o3'), loadXanes('k2cro4')]).then(([oct, tet]) => { if (live) setChromium(geometryCard(oct, tet)); }, () => undefined);
    return () => { live = false; };
  }, []);
  const cards = CARDS.map(c => c.title === 'Edge shape' && chromium ? chromium : c);
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
