'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { atomCloud } from '@/lib/twin/atom-cloud';
import { atomName } from '../atoms';
import { Scene, StorySlider, eV, useNearView, type SceneProps } from './scene';

// three.js loads with this scene, after the page.
const Atom3D = dynamic(() => import('./atom-3d'), { ssr: false });

const FROM = -40, TO = 40;
/** The energy meter: a bar for the X-ray's energy, the line where it is enough. */
const MTOP = 34, MH = 210;

/**
 * Step 2: the edge, on one atom in 3D. Below it the X-ray cannot free the core electron and passes by; at it the
 * electron leaves its layer (the innermost for a K edge, the second for an L edge) and the X-ray is used up.
 */
export function SceneJump({ material, e0 }: SceneProps) {
  const element = atomName(material.absorber), kEdge = material.edge === 'K';
  const Z = material.sites[0].paths[0].geometry[0].atomic_number;
  const [d, setD] = useState(-25);
  const [stage, near] = useNearView<HTMLDivElement>();
  const free = d >= 0, fill = (d - FROM) / (TO - FROM) * MH, needed = MTOP + MH / 2;
  // How much smaller the drawn layer really is than the atom, from the same Slater cloud the picture draws.
  const smaller = useMemo(() => {
    const cloud = atomCloud(Z, 1);
    return Math.max(...cloud.map(s => s.meanR_A)) / cloud.find(s => kEdge ? s.n === 1 : s.n === 2 && s.l === 1)!.meanR_A;
  }, [Z, kEdge]);
  return <Scene id="story-jump" n={2} title={`At one energy, ${element} suddenly absorbs more`} term="the absorption edge"
    body={<p>At {eV(e0)} eV an X-ray has just enough energy to knock an electron out of the {kEdge ? 'innermost' : 'second'} layer of a {element} atom. Above that energy, far more X-rays are absorbed. Each element jumps at its own energy.</p>}
    picture={<figure className="story-figure">
      <div className="story-stage-row" ref={stage}>
        {near ? <Atom3D Z={Z} kEdge={kEdge} free={free}
          label={`A ${element} atom in 3D, its electrons as a cloud. At ${eV(e0 + d)} eV: ${free ? `enough energy, an electron of the ${kEdge ? 'innermost' : 'second'} layer leaves as a wave and the X-ray is used up` : 'not enough energy, the X-ray passes by'}`} />
          : <div className="story-stage" />}
        <svg className="story-meter" viewBox="0 0 112 260" role="img" aria-label={`X-ray energy ${eV(e0 + d)} eV; ${eV(e0)} eV needed`}>
          <text x="28" y="20" textAnchor="middle" fill="#a7b1c1" fontSize="14">energy</text>
          <rect x="14" y={MTOP} width="28" height={MH} rx="4" fill="#1d283e" />
          <rect x="14" y={MTOP + MH - fill} width="28" height={fill} rx="4" fill="#ffc46b" />
          <line x1="6" x2="50" y1={needed} y2={needed} stroke="#8ce3ff" strokeWidth="2" strokeDasharray="5 4" />
          <text x="54" y={needed + 4} fill="#8ce3ff" fontSize="13">needed</text>
        </svg>
      </div>
      <p className="story-key"><span><i className="is-core" />{kEdge ? 'Bright centre: the innermost electrons' : 'Bright shell: the second layer'}</span><span><i />Haze: the outer layers</span>
        <span>Inner layers drawn larger: really {Math.round(smaller)} times smaller than the atom</span></p>
      <p className="story-caption" aria-live="polite">{free
        ? <><b>{eV(e0 + d)} eV</b> is enough. The electron is knocked out and the X-ray is used up.</>
        : <><b>{eV(e0 + d)} eV</b> is not enough to free it. The X-ray passes by.</>}</p>
    </figure>}
    control={<StorySlider label="X-ray energy" display={`${eV(e0 + d)} eV`} value={d} min={FROM} max={TO} step={0.5} onChange={setD} />} />;
}
