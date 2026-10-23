'use client';
import { useEffect, useState } from 'react';
import { loadXrayData } from '@/lib/xraydata';
import { loadOptics } from '@/lib/twin/tables';

let loaded: Promise<void> | null = null;
let ready = false;
const start = () => loaded ??= Promise.all([loadXrayData(), loadOptics()]).then(() => { ready = true; });
// Start the download as soon as the page code runs in the browser, before React hydrates, so the tables arrive sooner.
if (typeof window !== 'undefined') start().catch(() => { /* reported by the hook */ });

/** Loads the X-ray and optics tables once for the whole page and reports when they are in. */
export function useTables(): 'loading' | 'ready' | 'failed' {
  // Always 'loading' on the first render, as in the prerendered HTML: the early download can finish before hydration.
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    if (ready) { setState('ready'); return; }
    let live = true;
    start().then(() => { if (live) setState('ready'); }, () => { loaded = null; if (live) setState('failed'); });
    return () => { live = false; };
  }, []);
  return state;
}
