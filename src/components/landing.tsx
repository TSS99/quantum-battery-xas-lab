'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Chevron } from './chevron';

const ease = [0.2, 0.7, 0.2, 1] as const;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** Words rise and fade in one after another; with reduced motion they simply appear. */
export function RevealText({ text, as = 'h2', className, inView = true, delay = 0, id }: { text: string; as?: 'h1' | 'h2' | 'p'; className?: string; inView?: boolean; delay?: number; id?: string }) {
  const Tag = motion[as];
  const words = text.split(' ');
  const word = { hidden: { opacity: 0, y: 12 }, shown: (i: number) => ({ opacity: 1, y: 0, transition: { duration: .6, ease, delay: delay + i * .04 } }) };
  const trigger = inView ? { whileInView: 'shown', viewport: { once: true, margin: '-10% 0px' } } : { animate: 'shown' };
  return <Tag id={id} className={className} initial="hidden" {...trigger} aria-label={text}>
    {words.map((w, i) => <motion.span key={i} className="reveal-word" custom={i} variants={word} aria-hidden="true">{w}{i < words.length - 1 ? ' ' : ''}</motion.span>)}
  </Tag>;
}

/** Original dusk scene of a ring-shaped light source, drawn in SVG (no photographs of other sites). */
function DuskScene() {
  return <svg className="hero-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="dusk-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b4553" /><stop offset=".45" stopColor="#5b6573" /><stop offset=".66" stopColor="#8a7466" /><stop offset=".78" stopColor="#4e4a4c" /><stop offset="1" stopColor="#141516" /></linearGradient>
      <radialGradient id="dusk-glow" cx=".5" cy=".7" r=".6"><stop offset="0" stopColor="#d79a6e" stopOpacity=".35" /><stop offset="1" stopColor="#d79a6e" stopOpacity="0" /></radialGradient>
      <linearGradient id="dusk-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a3434" /><stop offset="1" stopColor="#151515" /></linearGradient>
      <linearGradient id="dusk-ring" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5e5f63" /><stop offset="1" stopColor="#26272a" /></linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#dusk-sky)" />
    <rect width="1600" height="900" fill="url(#dusk-glow)" />
    <path d="M0 640 C 180 600 300 560 430 590 S 700 540 860 575 S 1150 520 1300 560 S 1500 590 1600 570 V900 H0Z" fill="#433c3b" opacity=".75" />
    <path d="M0 690 C 220 650 380 660 520 680 S 820 640 1000 665 S 1320 640 1600 660 V900 H0Z" fill="url(#dusk-hill)" />
    {/* The storage ring and its beamline halls lie flat on the valley floor, seen from far away (y squashed for perspective). */}
    <g transform="translate(800 748) scale(1 .2)">
      {[-150, -115, -80, -35, 20, 60, 105, 140].map(a => <rect key={a} x="330" y="-14" width={a % 2 ? 230 : 300} height="28" rx="6" fill="#2a2b2e" transform={`rotate(${a})`} />)}
      <circle r="345" fill="#1f2023" />
      <circle r="330" cy="-55" fill="url(#dusk-ring)" />
      <circle r="300" cy="-55" fill="#232427" />
      <circle r="225" cy="-55" fill="#2c2b29" />
      <circle r="300" cy="-55" fill="none" stroke="#ffcf9a" strokeOpacity=".25" strokeWidth="9" />
      {[0, 40, 80, 125, 170, 215, 260, 305].map(a => <rect key={a} x="312" y="-60" width="8" height="10" fill="#ffd9a8" opacity=".75" transform={`rotate(${a} 0 -55)`} />)}
    </g>
    <path d="M0 780 C 300 750 500 790 800 770 S 1300 760 1600 790 V900 H0Z" fill="#111" />
  </svg>;
}

export function LandingHero() {
  return <section className="landing-hero" aria-labelledby="landing-title">
    <motion.div className="hero-bg" initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.8, ease }}>
      <DuskScene />
      <img
        className="hero-image"
        src={`${basePath}/images/hero-synchrotron-dusk.webp`}
        srcSet={`${basePath}/images/hero-synchrotron-dusk-960.webp 960w, ${basePath}/images/hero-synchrotron-dusk.webp 1920w`}
        sizes="100vw"
        width="1920"
        height="1080"
        alt=""
        fetchPriority="high"
        decoding="async"
      />
    </motion.div>
    <motion.div className="hero-grain" initial={{ opacity: 0 }} animate={{ opacity: .24 }} transition={{ duration: 1 }} aria-hidden="true" />
    <div className="hero-content">
      <RevealText as="h1" id="landing-title" text="The X-ray absorption lab that runs in your browser" inView={false} delay={.3} className="hero-title" />
      <motion.p className="hero-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .9 }}>Plan samples for any material, follow the beam through a real beamline, process and fit spectra, and see the quantum workflow behind XAS.</motion.p>
      <motion.div className="hero-actions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: 1.1, ease }}>
        <Link className="button cta" href="/crystal/">Start with a sample<Chevron /></Link>
        <Link className="button secondary" href="/twin/">Operate the beamline twin</Link>
        <Link className="button secondary" href="/validation/">How it is checked</Link>
      </motion.div>
    </div>
    <div className="hero-line" aria-hidden="true" />
  </section>;
}

export function StatementBand({ text }: { text: string }) {
  return <section className="statement-band"><div className="statement-inner"><RevealText text={text} /></div></section>;
}

export function CtaBand() {
  return <section className="cta-band">
    <RevealText text="Measure smarter before your next beamtime" />
    <p>Free, open source and private: nothing you type or import leaves your computer.</p>
    <Link className="button cta" href="/crystal/">Open the lab<Chevron /></Link>
  </section>;
}
