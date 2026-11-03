'use client';
import { useEffect } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** Registers the offline worker (public/sw.js, built by scripts/make-sw.mjs). The browser offers its own Install. */
export function Offline() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    // The desktop app ships every file and needs no worker; in WebView2 a worker cannot even reach the app's files (its
    // requests skip the app's asset handler), so one left from an earlier version is removed.
    if (process.env.NEXT_PUBLIC_DESKTOP) { navigator.serviceWorker.getRegistrations().then(all => all.forEach(r => r.unregister()), () => undefined); return; }
    const installed = matchMedia('(display-mode: standalone)').matches;
    let cancelled = false;
    const register = () => {
      if (cancelled) return;
      navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).then(() => navigator.serviceWorker.ready).then(registration => {
        // Only the installed app downloads everything for offline use; web visitors cache what they open.
        if (installed) registration.active?.postMessage({ type: 'precache-all' });
      }).catch(() => { /* Without a worker the site still works online. */ });
    };
    // Register once the page has loaded and gone quiet, so the worker's own downloads never compete with the page's.
    const whenIdle = () => { if ('requestIdleCallback' in window) requestIdleCallback(register, { timeout: 4000 }); else setTimeout(register, 2500); };
    if (document.readyState === 'complete') whenIdle(); else addEventListener('load', whenIdle, { once: true });
    return () => { cancelled = true; removeEventListener('load', whenIdle); };
  }, []);
  return null;
}
