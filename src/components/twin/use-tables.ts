'use client';
import { useEffect, useState } from 'react';
import { loadXrayData } from '@/lib/xraydata';
import { loadOptics } from '@/lib/twin/tables';

let loaded: Promise<void> | null = null;
let ready = false;

/** Loads the X-ray and optics tables once for the whole page and reports when they are in. */
export function useTables(): 'loading' | 'ready' | 'failed' {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(ready ? 'ready' : 'loading');
  useEffect(() => {
    if (ready) return;
    loaded ??= Promise.all([loadXrayData(), loadOptics()]).then(() => { ready = true; });
    let live = true;
    loaded.then(() => { if (live) setState('ready'); }, () => { loaded = null; if (live) setState('failed'); });
    return () => { live = false; };
  }, []);
  return state;
}
