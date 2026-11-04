'use client';
/**
 * What the selected problem would cost on a fault tolerant quantum computer (src/data/quantum/estimates.json, written
 * by scripts/quantum/estimates.py): logical qubits, Toffoli gates, run time, which announced machine generations it
 * fits, a machine of your own, and the classical cost of the same answer. Every number is a model; the page says so.
 */
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Plot } from '../plot';
import { download } from '../ui';

interface Machine { id: string; name: string; year: number; logical_qubits: number; gates: number; source: string }
interface Cost {
  orbitals: number; logical_qubits: number; toffoli_longest_circuit: number; toffoli_whole_spectrum: number; circuits: number;
  seconds_sequential_1MHz: number; seconds_active_volume_1MHz: number; fits: Record<string, boolean>; classical_hours_paper_model: number;
}
interface Row extends Cost { id: string; title: string; instance_hash: string; classical_seconds_here: number | null }
export interface Estimates { pennylane: string; settings: Record<string, number | string>; machines: Machine[]; problems: Row[]; curve: Cost[] }

const sci = (x: number) => { const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(1)}×10${String(e).replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d])}`; };
const duration = (seconds: number) => seconds < 120 ? `${Math.round(seconds)} s` : seconds < 7200 ? `${Math.round(seconds / 60)} min`
  : seconds < 3 * 86400 ? `${(seconds / 3600).toFixed(1)} hours` : seconds < 730 * 86400 ? `${Math.round(seconds / 86400)} days` : `${(seconds / 3.156e7).toFixed(0)} years`;

function report(row: Row, est: Estimates): string {
  const lines = [
    `# Quantum readiness report: ${row.title}`, '',
    `Problem \`${row.id}\`, instance hash \`${row.instance_hash}\`, ${row.orbitals} active orbitals.`,
    `Estimated with PennyLane ${est.pennylane} (scripts/quantum/estimates.py), the circuit model of Fomichev et al. 2025, Table I.`, '',
    '| Quantity | Value |', '| --- | --- |',
    `| Logical qubits | ${row.logical_qubits} |`,
    `| Toffoli gates, longest circuit | ${row.toffoli_longest_circuit.toExponential(3)} |`,
    `| Toffoli gates, whole spectrum (${row.circuits} circuits) | ${row.toffoli_whole_spectrum.toExponential(3)} |`,
    `| Run time, one Toffoli per microsecond | ${duration(row.seconds_sequential_1MHz)} |`,
    `| Run time, active volume layout at 1 MHz (scaled from the paper) | ${duration(row.seconds_active_volume_1MHz)} |`,
    ...est.machines.map(m => `| Fits ${m.name} (${m.logical_qubits} logical qubits, ${m.gates.toExponential(0)} gates, announced for ${m.year}) | ${row.fits[m.id] ? 'yes' : 'no'} |`),
    `| Classical, the paper's rough restricted active space model | ${duration(row.classical_hours_paper_model * 3600)} |`,
    ...(row.classical_seconds_here !== null ? [`| Classical, exact Lanczos reference on the build PC | ${duration(row.classical_seconds_here)} |`] : []), '',
    '## Settings', '', ...Object.entries(est.settings).map(([k, v]) => `* ${k}: ${v}`), '',
    'These are models. Machine generations are vendor targets, not machines that exist; a fit counts Toffoli gates only.',
    'The classical model is the paper\'s own, which it calls optimistic. Absolute edge energies of these small models',
    'are 6 to 30 eV above experiment.', '',
  ];
  return lines.join('\n');
}

export function CostCard({ id }: { id: string }) {
  const [est, setEst] = useState<Estimates | null>(null);
  const [qubits, setQubits] = useState(200), [gates, setGates] = useState(1e8), [rate, setRate] = useState(1e6);
  useEffect(() => { void import('@/data/quantum/estimates.json').then(m => setEst(m.default as unknown as Estimates)); }, []);
  const row = est?.problems.find(p => p.id === id);
  if (!est || !row) return <section className="twin-card qx-card qx-wide"><h2 className="twin-kicker">Cost on a fault tolerant quantum computer</h2><p className="qx-note">Loading…</p></section>;
  const fitsYours = row.logical_qubits <= qubits && row.toffoli_longest_circuit <= gates;
  const curve = est.curve;
  const hours = (s: number) => Math.log10(s / 3600);
  return <section className="twin-card qx-card qx-wide" aria-labelledby="qx-cost">
    <h2 id="qx-cost" className="twin-kicker">Cost on a fault tolerant quantum computer</h2>
    <dl className="qx-facts qx-readout">
      <div><dt>Logical qubits</dt><dd>{row.logical_qubits}</dd></div>
      <div><dt>Toffolis, longest circuit</dt><dd>{sci(row.toffoli_longest_circuit)}</dd></div>
      <div><dt>Toffolis, whole spectrum</dt><dd>{sci(row.toffoli_whole_spectrum)}</dd></div>
      <div><dt>Run time, one Toffoli per microsecond</dt><dd>{duration(row.seconds_sequential_1MHz)}</dd></div>
      <div><dt>Run time, active volume layout</dt><dd>{duration(row.seconds_active_volume_1MHz)}</dd></div>
      <div><dt>Classical, the paper&apos;s model</dt><dd>{duration(row.classical_hours_paper_model * 3600)}</dd></div>
    </dl>
    <ul className="qx-machines">
      {est.machines.map(m => <li key={m.id} data-fits={row.fits[m.id]}><strong>{m.name}</strong>, announced for {m.year}: {m.logical_qubits.toLocaleString('en')} logical qubits, {sci(m.gates)} gates.{' '}
        {row.fits[m.id] ? 'This problem fits.' : row.logical_qubits > m.logical_qubits ? 'Too few qubits.' : 'Its longest circuit is too long.'}</li>)}
    </ul>
    <fieldset className="qx-yours">
      <legend>Your machine</legend>
      <label>Logical qubits <input type="number" min={1} value={qubits} onChange={e => setQubits(+e.target.value || 0)} /></label>
      <label>Gates per circuit <input type="number" min={1} step="any" value={gates} onChange={e => setGates(+e.target.value || 0)} /></label>
      <label>Toffolis per second <input type="number" min={1} step="any" value={rate} onChange={e => setRate(+e.target.value || 1)} /></label>
      <p className="qx-note" role="status">{fitsYours ? `Fits. The whole spectrum takes ${duration(row.toffoli_whole_spectrum / rate)} at this rate, one Toffoli after another.`
        : row.logical_qubits > qubits ? `Does not fit: it needs ${row.logical_qubits} logical qubits.` : `Does not fit: its longest circuit has ${sci(row.toffoli_longest_circuit)} Toffoli gates.`}</p>
    </fieldset>
    <Plot exportName={`quantum-cost-${id}`} xLabel="Active orbitals, N" yLabel="log₁₀ hours" height={220}
      series={[
        { name: 'Quantum, active volume layout', color: '#8ce3ff', x: curve.map(c => c.orbitals), y: curve.map(c => hours(c.seconds_active_volume_1MHz)) },
        { name: 'Quantum, one Toffoli per µs', color: '#8ce3ff', dash: 'dashed', x: curve.map(c => c.orbitals), y: curve.map(c => hours(c.seconds_sequential_1MHz)) },
        { name: 'Classical, the paper’s model', color: '#ffc46b', x: curve.map(c => c.orbitals), y: curve.map(c => hours(c.classical_hours_paper_model * 3600)) },
      ]} />
    <p className="qx-note">This problem has {row.orbitals} active orbitals. Below about 14, classical methods are cheaper than the quantum algorithm, as the paper also found; above it the classical cost grows exponentially and the quantum one as about N³.
      {row.classical_seconds_here !== null && ` Its exact reference took ${duration(row.classical_seconds_here)} on the PC that built this library.`}{' '}
      Everything here is a model: machine generations are announced targets, a fit counts Toffoli gates only, and the classical curve is the paper&apos;s own rough estimate, which it calls optimistic.</p>
    <div className="qx-actions"><button type="button" className="twin-chip" onClick={() => download(`quantum-readiness-${id}.md`, report(row, est), 'text/markdown')}>
      <Download size={14} aria-hidden="true" />Download the readiness report</button></div>
  </section>;
}
