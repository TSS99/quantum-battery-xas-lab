'use client';
import dynamic from 'next/dynamic';
import { MotionConfig } from 'motion/react';
import { Offline } from './offline';
const MotionNotice = dynamic(() => import('./motion-notice').then(m => m.MotionNotice), { ssr: false });

/** Every page runs full screen, like an instrument: no site header or footer. */
export function Shell({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user"><a className="skip-link" href="#main">Skip to the beamline</a>
    <main id="main" tabIndex={-1} className="bare-main">{children}</main><MotionNotice /><Offline /></MotionConfig>;
}
