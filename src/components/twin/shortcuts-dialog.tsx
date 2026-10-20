'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { MODES } from './twin-state';

const KEYS: [string, string][] = [
  ...MODES.map((m): [string, string] => [m.key, `${m.name} mode`]),
  ['C', 'Switch between Educational and Realistic detectors'],
  ['L', 'Show or hide the scene labels'],
  ['I', 'Acquire'],
  ['T', 'Open the training scenarios'],
  ['X', 'Enlarge or shrink the results'],
  ['Escape', 'Shrink the enlarged results'],
  ['[', 'Show or hide the explanation (wide windows)'],
  [']', 'Show or hide the controls (wide windows)'],
  ['`', 'Open the console'],
];

/** Modal list of the twin shortcuts. The opener gets the focus back on close. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return <dialog ref={dialog} className="twin-dialog" aria-labelledby="twin-keys-title" onClose={onClose} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <div className="twin-dialog-body">
      <div className="twin-section-head">
        <h2 id="twin-keys-title">Keyboard shortcuts</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      <p>The keys work anywhere on the page except while you type in a field.</p>
      <table className="twin-keys">
        <thead><tr><th scope="col">Key</th><th scope="col">Action</th></tr></thead>
        <tbody>{KEYS.map(([key, action]) => <tr key={key}><td><kbd>{key}</kbd></td><td>{action}</td></tr>)}</tbody>
      </table>
    </div>
  </dialog>;
}
