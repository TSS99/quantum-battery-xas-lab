'use client';
import { useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** Registers the offline worker and offers "Install app" where the browser supports it. */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const installed = matchMedia('(display-mode: standalone)').matches;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'precached') return;
      setStatus(event.data.failed ? 'Some files could not be saved for offline use.' : 'Available offline.');
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).then(() => navigator.serviceWorker.ready).then(registration => {
      // Only the installed app downloads everything for offline use; web visitors cache what they open.
      if (installed) registration.active?.postMessage({ type: 'precache-all' });
    }).catch(() => { /* Without a worker the site still works online. */ });
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const onInstalled = () => { setPrompt(null); setStatus('Installed. Open XAS Lab from your apps.'); };
    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', onInstalled);
    return () => { navigator.serviceWorker.removeEventListener('message', onMessage); removeEventListener('beforeinstallprompt', onPrompt); removeEventListener('appinstalled', onInstalled); };
  }, []);
  return <>
    {prompt && <button className="text-button" onClick={async () => { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>Install app</button>}
    {status && <span role="status">{status}</span>}
  </>;
}
