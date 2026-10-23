'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { COMMAND_EXAMPLES, blockedBy, parseCommand, type CommandIntent } from '@/lib/twin/command-bar';
import { useTwin } from './twin-store';

/**
 * The typed command bar (the / key): "set energy 8979", "detune 30 %", "acquire 3 scans". A command with a corrected
 * typo is shown first and runs on a second Enter. The opener gets the focus back on close.
 */
export function CommandBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { store: { twin, view }, dispatch } = useTwin();
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState<CommandIntent[] | null>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) { setText(''); setMessage(''); setPending(null); d.showModal(); input.current?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);

  const run = (intents: CommandIntent[]) => {
    for (const intent of intents) {
      if (intent.type !== 'acquire') { dispatch({ type: 'command', command: intent }); continue; }
      if (intent.repeats) dispatch({ type: 'command', command: { type: 'scan', plan: { ...twin.scan, repeats: intent.repeats } } });
      dispatch({ type: 'acquire' });
    }
    onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) { run(pending); return; }
    let parsed: ReturnType<typeof parseCommand>;
    try { parsed = parseCommand(text, twin); } catch (error) { setMessage((error as Error).message); return; }
    if (!parsed.ok) { setMessage(parsed.error); return; }
    const lock = blockedBy(parsed.intents, view.locked);
    if (lock) { setMessage(`The training task has locked the ${lock === 'mono' ? 'monochromator' : lock} controls.`); return; }
    if (parsed.corrected) { setPending(parsed.intents); setMessage(`Did you mean "${parsed.understood}"? Press Enter to run it.`); return; }
    run(parsed.intents);
  };

  return <dialog ref={dialog} className="twin-dialog twin-command" aria-labelledby="twin-command-title" onClose={onClose} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <form className="twin-dialog-body" onSubmit={submit}>
      <div className="twin-section-head">
        <h2 id="twin-command-title">Command</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      <label className="twin-field">Type a command and press Enter
        <input ref={input} autoComplete="off" spellCheck={false} value={text} placeholder="set energy 8979" aria-describedby="twin-command-message twin-command-examples"
          onChange={e => { setText(e.target.value); setPending(null); setMessage(''); }} />
      </label>
      <p id="twin-command-message" className="twin-note" role="status">{message}</p>
      <p id="twin-command-examples" className="twin-note">For example: {COMMAND_EXAMPLES.slice(0, 8).map((c, i) => <span key={c}>{i ? ', ' : ''}<code>{c}</code></span>)}.</p>
    </form>
  </dialog>;
}
