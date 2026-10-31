'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { libraryFineStructure, ROOM_TEMPERATURE_K } from '@/lib/twin/sample';
import { atomName } from '../atoms';
import { Scene, StorySlider, eV, useNearView, type SceneProps } from './scene';

// three.js loads with this scene, after the page.
const Setup3D = dynamic(() => import('./setup-3d'), { ssr: false });

/** The scan, eV from the edge: far enough above it for the first wiggles to show. */
const FROM = -80, TO = 520;
const W = 520, H = 210, L = 14, R = 14, T = 30, B = 34;

/**
 * Step 1: the measurement, in 3D (setup-3d.tsx). X-rays through the sample to a detector; the energy slider records the spectrum as it moves.
 * The sample is a little over one absorption length thick above the edge, as in the detailed view's explorer
 * (mu x = 0.35 + 1.3 x normalized mu), and mu is the twin's model of this material: FEFF10 near edge, FEFF paths above.
 */
export function SceneShine({ material, xanes, e0, what }: SceneProps) {
  const element = atomName(material.absorber);
  const absorbed = useMemo(() => {
    const model = libraryFineStructure(e0, material, ROOM_TEMPERATURE_K, xanes);
    const mu = Array.from({ length: TO - FROM + 1 }, (_, i) => Math.max(0, model.factor(e0 + FROM + i)));
    const top = Math.max(...mu);
    return mu.map(m => 100 * (1 - Math.exp(-(0.35 + 1.3 * m / top))));
  }, [e0, material, xanes]);
  const [d, setD] = useState(FROM), [reached, setReached] = useState(FROM);
  const now = absorbed[d - FROM], kept = Math.round(100 - now);
  const lo = Math.min(...absorbed), hi = Math.max(...absorbed);
  const px = (x: number) => L + (x - FROM) / (TO - FROM) * (W - L - R), py = (a: number) => H - B - (a - lo) / (hi - lo) * (H - T - B);
  const line = absorbed.slice(0, reached - FROM + 1).map((a, i) => (i ? 'L' : 'M') + px(FROM + i).toFixed(1) + ',' + py(a).toFixed(1)).join('');
  const seen = reached >= 0;
  const [stage, near] = useNearView<HTMLDivElement>();
  return <Scene id="story-shine" n={1} title="Shine X-rays through it and count" term="an absorption spectrum"
    body={<p>We shine X-rays through {what} and count how many come out the other side. Slide the energy up and watch the count. The graph records it as you go.</p>}
    picture={<figure className="story-figure">
      <div ref={stage}>{near ? <Setup3D material={material.id} through={kept / 100}
        label={`The measurement in 3D: X-rays from the beamline pass through ${what} in its holder into the detector. At ${eV(e0 + d)} eV the ${element} absorbs ${Math.round(now)} of every 100 X-rays; ${kept} reach the detector`} />
        : <div className="story-stage is-wide" />}</div>
      <p className="story-key"><span>From the left: the X-ray beam, the {element} sample in its holder, the detector that counts</span></p>
      <p className="story-readout"><span><b>{Math.round(now)}</b> of 100 absorbed</span><span><b>{kept}</b> got through</span></p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`X-rays absorbed against X-ray energy, recorded from ${eV(e0 + FROM)} to ${eV(e0 + reached)} eV${seen ? `, with a jump at ${eV(e0)} eV` : ''}`}>
        <rect width={W} height={H} rx="10" fill="#121a2b" />
        <text x={L + 4} y={T - 10} fill="#a7b1c1" fontSize="15">X-rays absorbed</text>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#35404d" />
        <text x={L} y={H - 10} fill="#a7b1c1" fontSize="14">{eV(e0 + FROM)} eV</text>
        <text x={W - R} y={H - 10} textAnchor="end" fill="#a7b1c1" fontSize="14">{eV(e0 + TO)} eV</text>
        {seen && <g>
          <line x1={px(0)} x2={px(0)} y1={T} y2={H - B} stroke="#8ce3ff" strokeDasharray="4 4" opacity="0.7" />
          <text x={px(0) + 8} y={H - B - 10} fill="#8ce3ff" fontSize="15">the jump, {eV(e0)} eV</text>
        </g>}
        {reached === FROM && <text x={W / 2} y={(T + H - B) / 2} textAnchor="middle" fill="#a7b1c1" fontSize="16">Slide the energy to record the graph</text>}
        {reached >= 200 && <text x={px(200)} y={py(Math.max(...absorbed.slice(100 - FROM, 300 - FROM))) - 14} textAnchor="middle" fill="#a7b1c1" fontSize="15">small wiggles</text>}
        <path d={line} fill="none" stroke="#f3f6fa" strokeWidth="2.4" strokeLinejoin="round" />
        <circle cx={px(d)} cy={py(now)} r="7" fill="#ffc46b" stroke="#121a2b" strokeWidth="2" />
      </svg>
    </figure>}
    control={<StorySlider label="X-ray energy" display={`${eV(e0 + d)} eV`} value={d} min={FROM} max={TO} step={1} onChange={v => { setD(v); setReached(r => Math.max(r, v)); }} />} />;
}
