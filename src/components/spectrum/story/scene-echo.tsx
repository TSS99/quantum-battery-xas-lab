'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ETOK } from '@/lib/twin/exafs';
import { ROOM_TEMPERATURE_K } from '@/lib/twin/sample';
import { pathCurves, shellSpectra } from '@/lib/twin/shells';
import { echoAtAbsorber } from '@/lib/twin/wave-field';
import { atomName } from '../atoms';
import { Scene, StorySlider, eV, useNearView, type SceneProps } from './scene';

const Wave3D = dynamic(() => import('./wave-3d'), { ssr: false, loading: () => <div className="story-stage" /> });
/** eV above the edge: from where the wave is first a clean echo to where the wiggles have faded. */
const FROM = 30, TO = 500;
const W = 520, H = 150, L = 12, R = 12, T = 22, B = 30;

/**
 * Step 4: the echoes make the wiggles. The energy slider sets the electron's wavelength; the ring round the absorber
 * shows how the first shell's echo meets it (sin(2kR + phase), the sign of that shell's chi(k)), and the line below is
 * that shell's chi(k), weighted by k squared, against energy above the edge, with a dot at the slider.
 */
export function SceneEcho({ material, e0, first, neighbours, shells }: SceneProps) {
  // Start where the echo is clearly in step, a little above 80 eV.
  const [d, setD] = useState(() => {
    for (let e = 80; first && e < TO; e++) { const k = Math.sqrt(ETOK * e); if (echoAtAbsorber(k, first.r_A, pathCurves(first.paths[0], k)) > 0.6) return e; }
    return 100;
  });
  const [stage, near] = useNearView<HTMLDivElement>();
  const wiggle = useMemo(() => {
    if (!first) return null;
    const spectra = shellSpectra(material, shells, ROOM_TEMPERATURE_K), dk = spectra.k[1] - spectra.k[0];
    const at = (e: number) => { const k = Math.sqrt(ETOK * e), i = Math.min(spectra.k.length - 2, Math.floor(k / dk)), f = k / dk - i; return k * k * (spectra.chi[first.id][i] * (1 - f) + spectra.chi[first.id][i + 1] * f); };
    const xs = Array.from({ length: TO - FROM + 1 }, (_, i) => FROM + i), ys = xs.map(at);
    return { at, xs, ys, top: Math.max(...ys.map(Math.abs)) };
  }, [material, shells, first]);
  if (!first || !wiggle) return null;
  const k = Math.sqrt(ETOK * d), curves = pathCurves(first.paths[0], k), echo = echoAtAbsorber(k, first.r_A, curves);
  const element = atomName(material.absorber), neighbour = atomName(first.element!);
  const verdict = echo > 0.3 ? 'in step' : echo < -0.3 ? 'out of step' : 'between';
  const px = (e: number) => L + (e - FROM) / (TO - FROM) * (W - L - R), py = (y: number) => T + (H - T - B) / 2 * (1 - y / wiggle.top);
  const line = wiggle.xs.map((e, i) => (i ? 'L' : 'M') + px(e).toFixed(1) + ',' + py(wiggle.ys[i]).toFixed(1)).join('');
  return <Scene id="story-echo" n={4} title="In step or out of step: the wiggles" term="EXAFS, the wiggles"
    body={<p>When the echo gets back in step with the wave, {element} absorbs a little more. Out of step, a little less. Raise the energy and the ripples get shorter, so it flips back and forth. That makes the small wiggles.</p>}
    picture={<figure className="story-figure">
      <div ref={stage}>{near ? <Wave3D absorber={material.absorber} neighbours={neighbours} k={k} curves={curves} echoes ring={echo}
        label={`The electron wave and the echoes of the ${first.count} nearest ${neighbour} atoms at ${eV(e0 + d)} eV: the echoes meet the ${element} atom ${verdict}`} />
        : <div className="story-stage" />}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The wiggle of the nearest ${neighbour} atoms against X-ray energy, now ${wiggle.at(d) > 0 ? 'above the middle: more absorbed' : 'below the middle: less absorbed'}`}>
        <rect width={W} height={H} rx="10" fill="#121a2b" />
        <line x1={L} x2={W - R} y1={py(0)} y2={py(0)} stroke="#35404d" />
        <text x={L + 4} y={T - 6} fill="#8ce3ff" fontSize="14">more absorbed</text>
        <text x={L + 4} y={H - B + 18} fill="#ff9650" fontSize="14">less absorbed</text>
        <text x={W - R} y={H - B + 18} textAnchor="end" fill="#a7b1c1" fontSize="14">higher energy →</text>
        <path d={line} fill="none" stroke="#f3f6fa" strokeWidth="2" />
        <circle cx={px(d)} cy={py(wiggle.at(d))} r="7" fill="#ffc46b" stroke="#121a2b" strokeWidth="2" />
      </svg>
      <p className="story-caption" aria-live="polite"><b>{eV(e0 + d)} eV</b>: the echoes arrive {verdict === 'between' ? 'between in step and out of step' : verdict}, so {element} absorbs {verdict === 'in step' ? 'a little more' : verdict === 'out of step' ? 'a little less' : 'about the average'}.</p>
    </figure>}
    control={<StorySlider label="X-ray energy" display={`${eV(e0 + d)} eV`} value={d} min={FROM} max={TO} step={1} onChange={setD} />} />;
}
