'use client';
import { useState } from 'react';
import { useLab } from './lab-context';
import { Tex } from './tex';
export function ActiveSpacePlan() {
  const { complete } = useLab(), [selected, setSelected] = useState(['Mn 3d', 'Li 2s', 'O 2p', 'O 1s']), [used, setUsed] = useState(false);
  const groups = [['Mn 3d', 10], ['Li 2s', 4], ['O 2p', 3], ['O 1s', 1]] as const;
  const orbitals = groups.reduce((n, [name, count]) => n + (selected.includes(name) ? count : 0), 0);
  return <div id="active-space"><h3>The paper’s active-space example</h3><p>Choose which orbital groups to keep from <Tex plain>{'\\mathrm{Li_4Mn_2O}'}</Tex>. Each spatial orbital uses two system qubits.</p>
    <div className="toolbar">{groups.map(([name, count]) => <label className="check-control" key={name}><input type="checkbox" checked={selected.includes(name)} onChange={e => { setSelected(s => e.target.checked ? [...s, name] : s.filter(v => v !== name)); setUsed(false); }} />{name} ({count})</label>)}</div>
    <p aria-live="polite">{orbitals} spatial orbitals; {orbitals * 2} system qubits.</p>
    <p className="muted">The paper uses all 18 orbitals and 22 electrons. This counts orbitals only; it does not build electronic integrals. The browser solver accepts at most six qubits.</p>
    <button className="button secondary" disabled={orbitals === 0} onClick={() => { complete(['active']); setUsed(true); }}>Use this space in the plan</button>{used && <p role="status">Space noted. Supply a reduced Hamiltonian on the Quantum page to run it.</p>}
  </div>;
}
