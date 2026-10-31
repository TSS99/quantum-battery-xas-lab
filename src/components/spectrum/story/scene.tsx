'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Shell } from '@/lib/twin/shells';
import type { FeffMaterial } from '@/lib/twin/types';
import type { XanesFile } from '@/lib/twin/xanes';
import type { Neighbour } from './wave-3d';

/**
 * What every scene gets: the chosen material's FEFF paths and computed near edge, its edge energy, its name in words,
 * the shells of its first absorber site, the nearest of them, and that shell's atoms from the FEFF cluster.
 */
export interface SceneProps { material: FeffMaterial; xanes: XanesFile; e0: number; what: string; shells: Shell[]; first: Shell | null; neighbours: Neighbour[] }

/** 8979 as "8,979": energies in eV, read aloud and on screen the same way everywhere. */
export const eV = (value: number) => Math.round(value).toLocaleString('en-US');

/**
 * One scene of the story: a step number, a headline, a few plain sentences and the field's name for the idea, beside
 * one picture with at most one control under it.
 */
export function Scene({ id, n, title, body, term, picture, control }: {
  id: string; n: number; title: string; body: ReactNode; term: string; picture: ReactNode; control?: ReactNode;
}) {
  return <section id={id} className="story-scene" aria-labelledby={`${id}-title`}>
    <div className="story-words">
      <p className="story-step">Step {n}</p>
      <h2 id={`${id}-title`} className="story-h">{title}</h2>
      <div className="story-body">{body}</div>
      <p className="story-term">Scientists call this <strong>{term}</strong></p>
    </div>
    <div className="story-picture">
      {picture}
      {control && <div className="story-control">{control}</div>}
    </div>
  </section>;
}

export function StorySlider({ label, display, value, min, max, step, onChange }: {
  label: string; display: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  const id = useId();
  return <div className="story-slider">
    <label htmlFor={id}>{label} <output htmlFor={id}>{display}</output></label>
    <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={display} onChange={e => onChange(+e.target.value)} />
  </div>;
}

/**
 * Whether an element is within a screen of the window: the 3D pictures mount only then and unmount when far away, so
 * the page never holds more than a couple of WebGL contexts and an idle scene costs nothing.
 */
export function useNearView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '100% 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, near] as const;
}
