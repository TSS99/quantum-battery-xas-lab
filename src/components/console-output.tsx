'use client';
import { useState } from 'react';
import type { ConsoleLine } from '@/lib/console';
import { ScienceText, Tex, formulaTex, texNum, unitTex } from './tex';
import { download } from './ui';

const math: Record<string, string> = {
  'Δμ·d': '\\Delta\\mu\\cdot d', 'μ·d': '\\mu\\cdot d', 'Δμ': '\\Delta\\mu',
  'μ/ρ': '\\mu/\\rho', 'μ': '\\mu', '1/μ': '1/\\mu', '1/e': '1/e',
};
const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Typeset results while command input and exported source remain literal, copyable text. */
export function ConsoleText({ text }: { text: string }) {
  const tokens = /(Δμ·d|μ·d|Δμ|μ\/ρ|1\/μ|1\/e|[μµ]m|μ|(?:mg\/cm²|cm²\/g|g\/cm³|cm⁻¹|cm²|mg|mm|keV|eV)(?!\w)|(?<![\w.])[−+-]?\d[\d,]*(?:\.\d+)?×10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+|(?<!\w)(?:[A-Z][a-z]?\d*(?:\.\d+)?|[()[\]·*])+\d(?:[A-Za-z0-9()[\]·*.]*)(?!\w))/g;
  return <>{text.split(tokens).map((part, i) => {
    if (i % 2 === 0) return <ScienceText key={i}>{part}</ScienceText>;
    let source = math[part];
    if (!source && part.includes('×10')) {
      const [value, power] = part.split('×10');
      source = texNum(value.replace('−', '-')) + '\\times' + '10^{' + [...power].map(c => c === '⁻' ? '-' : superscripts.indexOf(c)).join('') + '}';
    }
    if (!source) source = /^(?:mg|cm|g\/|mm|keV|eV|[μµ]m)/.test(part) ? unitTex(part) : formulaTex(part);
    return <Tex key={i} plain>{source}</Tex>;
  })}</>;
}

function PythonOutput({ line }: { line: Extract<ConsoleLine, { kind: 'code' }> }) {
  const [status, setStatus] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(line.text); setStatus('Python script copied.'); }
    catch { setStatus('Copy is unavailable. Select the script or use Download .py.'); }
  }
  return <div className="console-code">
    <div className="console-code-actions"><span>{line.filename}</span>
      <button type="button" onClick={copy} aria-label={`Copy ${line.filename}`}>Copy</button>
      <button type="button" onClick={() => download(line.filename, line.text, 'text/x-python;charset=utf-8')} aria-label={`Download ${line.filename}`}>Download .py</button>
    </div>
    <pre tabIndex={0} aria-label={`Python source: ${line.filename}`}><code>{line.text}</code></pre>
    <p role="status">{status}</p>
  </div>;
}

export function ConsoleOutput({ line }: { line: ConsoleLine }) {
  if (line.kind === 'code') return <PythonOutput line={line} />;
  if (line.kind === 'row') return <div className="console-row">
    <span><ConsoleText text={line.label} /></span>
    <span><ConsoleText text={line.value} />{line.note && <small><ConsoleText text={line.note} /></small>}</span>
  </div>;
  return <p className={`console-${line.kind}`}><ConsoleText text={line.text} /></p>;
}
