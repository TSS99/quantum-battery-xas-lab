'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { completeInput, runCommand, WELCOME, type ConsoleLine } from '@/lib/console';
import { loadXrayData } from '@/lib/xraydata';
import { useLab } from './lab-context';
import { ConsoleOutput } from './console-output';

interface Entry { id: number; command?: string; lines: readonly ConsoleLine[] }

export default function LabConsole({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, set, complete } = useLab(), router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null), inputRef = useRef<HTMLInputElement>(null), outputRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null), nextId = useRef(1);
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, lines: WELCOME }]);
  const [input, setInput] = useState(''), [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null), draft = useRef('');
  const [suggestions, setSuggestions] = useState<string[]>([]), [dataStatus, setDataStatus] = useState('Loading X-ray tables…');
  // A second Tab leaves the input, including when completion is ambiguous.
  const lastCompletion = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadXrayData().then(() => { if (alive) setDataStatus('X-ray tables ready.'); })
      .catch(() => { if (alive) setDataStatus('X-ray tables could not load. Reload to retry. Help and open still work.'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const panel = dialog.current!;
    if (open && !panel.open) {
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      panel.showModal();
      inputRef.current?.focus();
    } else if (!open && panel.open) {
      panel.close();
      if (restoreFocus.current?.isConnected) restoreFocus.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (open && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [entries, open]);

  function submit() {
    const command = input.trim();
    if (!command) return;
    const result = runCommand(command, { sample: state.sample, energy: state.energy });
    setHistory(previous => [...previous.slice(-99), command]);
    setHistoryIndex(null); draft.current = ''; setInput(''); setSuggestions([]); lastCompletion.current = null;
    const entry = { id: nextId.current++, command, lines: result.lines };
    setEntries(previous => result.effect?.type === 'clear' ? [] : [...previous.slice(-79), entry]);
    if (result.effect?.type === 'sample') {
      set({ sample: result.effect.sample, energy: result.effect.energy });
      complete(['sample']);
    } else if (result.effect?.type === 'navigate') {
      router.push(result.effect.href);
      onClose();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && history.length) {
      event.preventDefault();
      if (historyIndex === null) draft.current = input;
      const index = historyIndex ?? history.length;
      const next = Math.max(0, Math.min(history.length, index + (event.key === 'ArrowUp' ? -1 : 1)));
      setHistoryIndex(next === history.length ? null : next);
      setInput(next === history.length ? draft.current : history[next]);
      setSuggestions([]); lastCompletion.current = null;
    } else if (event.key === 'Tab' && !event.shiftKey && event.currentTarget.selectionStart === input.length && event.currentTarget.selectionEnd === input.length) {
      if (lastCompletion.current === input) { lastCompletion.current = null; return; }
      const completed = completeInput(input);
      if (completed.input !== input || completed.options.length) {
        event.preventDefault(); setInput(completed.input); setSuggestions(completed.options);
        lastCompletion.current = completed.input;
      }
    }
  }

  return <dialog ref={dialog} id="lab-console" className="lab-console" aria-labelledby="console-title" aria-describedby="console-help"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="console-header"><h2 id="console-title"><span aria-hidden="true">&gt;_</span> Console</h2>
      <button type="button" onClick={onClose} aria-label="Close console">Close <kbd>Esc</kbd></button>
    </header>
    <div ref={outputRef} className="console-output" role="log" aria-label="Console output" aria-live="polite" aria-relevant="additions" tabIndex={0}>
      {entries.map(entry => <div className="console-entry" key={entry.id}>
        {entry.command && <p className="console-command"><span aria-hidden="true">❯ </span>{entry.command}</p>}
        {entry.lines.map((line, index) => <ConsoleOutput key={index} line={line} />)}
      </div>)}
    </div>
    <div className="console-footer">
      <p className="console-data-status" role="status">{dataStatus}</p>
      <form onSubmit={event => { event.preventDefault(); submit(); }} className="console-form">
        <label htmlFor="console-input" className="sr-only">Console command</label>
        <span className="console-prompt" aria-hidden="true">❯<span className="console-caret" /></span>
        <input ref={inputRef} id="console-input" value={input} maxLength={1000} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          aria-describedby="console-help console-suggestions" onKeyDown={onKeyDown}
          onChange={event => { setInput(event.target.value); setHistoryIndex(null); setSuggestions([]); lastCompletion.current = null; }} />
        <button type="submit">Run</button>
      </form>
      <p id="console-suggestions" role="status">{suggestions.join('  ')}</p>
      <p id="console-help">Enter runs · ↑ ↓ history · Tab completes · Tab again moves focus</p>
    </div>
  </dialog>;
}
