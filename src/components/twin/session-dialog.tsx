'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Copy, Download, Upload, X } from 'lucide-react';
import { download } from '../ui';
import { fromSession, toSession } from '@/lib/twin/twin';
import { formatHash } from './twin-state';
import { storedAcquisition, useTwin } from './twin-store';

/** Save, restore and share the complete local twin session. */
export function SessionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const { store: { twin }, dispatch, acquisitions, setAcquisitions } = useTwin();
  const [message, setMessage] = useState('');
  useEffect(() => {
    const current = dialog.current;
    if (!current) return;
    if (open && !current.open) current.showModal();
    if (!open && current.open) current.close();
  }, [open]);

  const save = () => {
    download('xaslab-twin-session.json', toSession(twin, acquisitions.map(item => item.acquisition)));
    setMessage('Saved the current settings and acquisitions.');
  };
  const load = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      // Parse and validate everything before either state container changes.
      const session = fromSession(await file.text());
      const restored = session.acquisitions.map((acquisition, index) => storedAcquisition(acquisition, index + 1, session.state));
      dispatch({ type: 'load', twin: session.state, locked: [], note: `Session loaded: ${restored.length} acquisition${restored.length === 1 ? '' : 's'} restored.` });
      setAcquisitions(restored);
      setMessage(`Loaded ${file.name} and restored its acquisitions.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    event.target.value = '';
  };
  const copy = async () => {
    const hash = formatHash(twin);
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
    if (url.length > 2000) { setMessage('These settings are too large for a share link. Save a session file instead.'); return; }
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Share link copied. It includes the settings and seed, but no acquisitions.');
    } catch { setMessage('The browser could not copy the link. Use the address bar instead.'); }
  };

  return <dialog ref={dialog} className="twin-dialog" aria-labelledby="twin-session-title" onClose={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="twin-dialog-body">
      <div className="twin-section-head"><h2 id="twin-session-title">Session</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
      <p className="twin-dialog-copy">Session files keep the instrument, sample, scan settings and every acquisition. Share links keep settings only. Files stay in this browser.</p>
      <div className="twin-dialog-actions">
        <button type="button" className="button cta" onClick={save}><Download size={15} aria-hidden="true" />Save session</button>
        <input ref={fileInput} className="sr-only" type="file" accept=".json,application/json" aria-label="Session file" onChange={load} />
        <button type="button" className="button secondary small" onClick={() => fileInput.current?.click()}><Upload size={15} aria-hidden="true" />Load session</button>
        <button type="button" className="button secondary small" onClick={copy}><Copy size={15} aria-hidden="true" />Copy share link</button>
      </div>
      <p className="twin-dialog-status" role="status">{message}</p>
    </div>
  </dialog>;
}
