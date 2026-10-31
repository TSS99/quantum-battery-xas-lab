'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { pathCurves } from '@/lib/twin/shells';
import { atomName } from '../atoms';
import { Scene, useNearView, type SceneProps } from './scene';

const Wave3D = dynamic(() => import('./wave-3d'), { ssr: false });
/** The electron wavenumber drawn, Å⁻¹: about 95 eV above the edge, where a wave is a little over an ångström long. */
const K = 5;

/** Step 3: the freed electron as a wave in the real crystal, first alone, then with the first shell's echoes. */
export function SceneRipple({ material, first, neighbours }: SceneProps) {
  const [echoes, setEchoes] = useState(false);
  const [stage, near] = useNearView<HTMLDivElement>();
  const curves = useMemo(() => first && pathCurves(first.paths[0], K), [first]);
  if (!first || !curves) return null;
  const element = atomName(material.absorber), neighbour = atomName(first.element!);
  return <Scene id="story-ripple" n={3} title="The freed electron spreads out like a ripple" term="the photoelectron wave"
    body={<p>The knocked out electron is not a tiny ball. It spreads out as a wave, like a ripple on a pond. When it reaches the neighbouring atoms, each one sends a faint echo back.</p>}
    picture={<figure className="story-figure">
      <div ref={stage}>{near ? <Wave3D absorber={material.absorber} neighbours={neighbours} k={K} curves={curves} echoes={echoes} ring={null}
        label={`The electron wave leaving the ${element} atom, drawn on a sheet through the real ${material.formula} crystal${echoes ? `, with the echoes of its ${first.count} nearest ${neighbour} neighbours` : ', alone'}`} />
        : <div className="story-stage" />}</div>
      <p className="story-key"><span><i className="is-crest" />crests</span><span><i className="is-trough" />troughs</span>
        <span>To scale: the nearest {neighbour} atoms are {first.r_A.toFixed(2)} Å away</span></p>
    </figure>}
    control={<button type="button" className="twin-chip is-accent" aria-pressed={echoes} onClick={() => setEchoes(e => !e)}>
      {echoes ? 'Hide the neighbours' : 'Show the neighbours'}</button>} />;
}
