'use client';
import Link from 'next/link';
import { useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import { Tex } from './tex';
import { RevealText } from './landing';
import type { ValidationCard } from '@/lib/validation-cards';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface Layer { file: string }
interface ShowcaseModule { href: string; title: string; text: string; layers: Layer[] }

/** Captured from the built site at 2x (see scripts/make-showcase.mjs). The last layer is the front one. The stack is aria-hidden; the copy carries the meaning. */
const MODULES: ShowcaseModule[] = [
  { href: '/beamline/', title: 'XAS beamline', text: 'Scan the photon energy across an absorption edge and watch the transmitted beam. The drawing follows the light from source to detector.',
    layers: [{ file: 'beamline-scan' }, { file: 'beamline-scene' }] },
  { href: '/spectra/', title: 'Spectra studio', text: 'Save a curve, change the sample and compare. The derivative view marks where the edge sits. You can also import your own data.',
    layers: [{ file: 'spectra-plot' }, { file: 'spectra-derivative' }] },
  { href: '/quantum/', title: 'Quantum dynamics', text: 'Kick a small spin system, follow its motion in time and Fourier transform the signal into a spectrum. Exact and Trotter evolution sit side by side, with the circuit shown gate by gate.',
    layers: [{ file: 'quantum-circuit' }, { file: 'quantum-spectrum' }] },
];

/** A tilted stack of real screenshots. Entrance and drift follow the scroll position, smoothed; static with reduced motion. */
function IsoStack({ layers }: { layers: Layer[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const smooth = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: .4 });
  const rotateX = useTransform(smooth, [0, .5], [62, 50]);
  const rotateZ = useTransform(smooth, [0, .5], [-42, -30]);
  const y = useTransform(smooth, [0, .5, 1], [90, 0, -50]);
  const opacity = useTransform(smooth, [0, .3], [0, 1]);
  const spread = useTransform(smooth, [0, .5, 1], [.4, 1, 1.15]);
  const still = useMotionValue(1);
  const style = reduce ? { rotateX: 50, rotateZ: -30 } : { rotateX, rotateZ, y, opacity };
  return <div ref={ref} className="iso-stage" aria-hidden="true">
    <motion.div className="iso-stack" style={style}>
      {layers.map((layer, i) => <IsoLayer key={layer.file} layer={layer} index={i} spread={reduce ? still : spread} />)}
    </motion.div>
  </div>;
}
function IsoLayer({ layer, index, spread }: { layer: Layer; index: number; spread: MotionValue<number> }) {
  const z = useTransform(spread, v => index * 70 * v);
  return <motion.div className="iso-layer" style={{ z, x: index * 18, y: index * -26 }}>
    <img src={`${BASE}/showcase/${layer.file}.webp`} alt="" loading="lazy" decoding="async" width={1280} height={800} />
  </motion.div>;
}

export function ModuleShowcase() {
  return <section className="showcase" aria-labelledby="showcase-title">
    <RevealText id="showcase-title" text="Three places to work" />
    {MODULES.map(m => <div className="module-row showcase-row" key={m.href}>
      <div className="module-row-copy"><Link className="module-row-title" href={m.href}>{m.title}<span className="row-chev" aria-hidden="true">›</span></Link><p>{m.text}</p></div>
      <IsoStack layers={m.layers} />
    </div>)}
  </section>;
}

function Bar({ value, lead }: { value: number; lead: boolean }) {
  return <span className="vbar" aria-hidden="true"><span className={lead ? 'lead' : undefined} style={{ width: Math.max(2, value * 100) + '%' }} /></span>;
}

export function ValidationCards({ cards }: { cards: ValidationCard[] }) {
  return <section className="landing-section validation-section" aria-labelledby="validation-title">
    <RevealText id="validation-title" text="Checked, with the numbers shown" />
    <div className="validation-cards">{cards.map(card => <article className="vcard" key={card.id}>
      <h3>{card.title}</h3>
      <p>{card.description}</p>
      <div className="vcard-metric">{card.metric}</div>
      <ul className="vcard-rows">{card.rows.map((row, i) => <li key={row.name}>
        <span className="vname">{row.name}</span><span className="vvalue"><Tex plain>{row.value}</Tex></span>
        <Bar value={row.bar} lead={i === 0} />
      </li>)}</ul>
      <p className="vcard-note">{card.barMeaning}</p>
      <Link className="button secondary" href="/validation/">View more<span className="sr-only"> about {card.title}</span></Link>
    </article>)}</div>
  </section>;
}
