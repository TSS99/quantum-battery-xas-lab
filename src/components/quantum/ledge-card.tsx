'use client';
/**
 * Mn L edges (/quantum/): the manganese 2p absorption of three oxidation states with and without spin orbit coupling,
 * exact and as the time domain algorithm measures it with shots (src/lib/quantum/ledge.ts). The ions sit in crystal
 * fields of point charges; the page says what that leaves out.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plot } from '../plot';
import { seededRandom } from '@/lib/xas';
import { ledgeSpectra, loadLedge, type LedgeData } from '@/lib/quantum/ledge';

const STATES = [
  { id: 'mn2-oct', label: 'Mn²⁺' },
  { id: 'mn3-oct', label: 'Mn³⁺' },
  { id: 'mn4-li2mno3', label: 'Mn⁴⁺' },
];
const ALPHA = 1.3384;
const sci = (x: number) => { const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(1)}×10${String(e).replace(/-/, '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d])}`; };

export default function LedgeCard({ shots, seed }: { shots: number; seed: number }) {
  const [state, setState] = useState('mn4-li2mno3');
  const [spinOrbit, setSpinOrbit] = useState(true);
  const [data, setData] = useState<LedgeData | null>(null);
  useEffect(() => {
    let stale = false;
    void loadLedge(state).then(d => { if (!stale) setData(d); });
    return () => { stale = true; };
  }, [state]);

  const ready = data && data.id === state ? data : null;
  const result = useMemo(() => ready ? ledgeSpectra(ready, spinOrbit, shots, ALPHA, seededRandom(seed)) : null, [ready, spinOrbit, shots, seed]);
  const edge = ready ? (spinOrbit ? ready.spin_orbit : ready.spin_free) : null;

  return <section className="twin-card qx-card qx-wide" aria-labelledby="qx-ledge">
    <h2 id="qx-ledge" className="twin-kicker">Mn L edges, with spin orbit coupling</h2>
    <div className="qx-rixs-controls">
      <div className="twin-switch qx-three" role="group" aria-label="Manganese oxidation state">
        {STATES.map(s => <button key={s.id} type="button" aria-pressed={state === s.id} onClick={() => setState(s.id)}>{s.label}</button>)}
      </div>
      <div className="twin-switch" role="group" aria-label="Spin orbit coupling">
        <button type="button" aria-pressed={spinOrbit} onClick={() => setSpinOrbit(true)}>Spin orbit on</button>
        <button type="button" aria-pressed={!spinOrbit} onClick={() => setSpinOrbit(false)}>Off</button>
      </div>
    </div>
    {result && ready && edge ? <>
      <Plot exportName={`quantum-mn-l-${state}-${spinOrbit ? 'spin-orbit' : 'spin-free'}`} xLabel="Photon energy, this model (eV)" yLabel="Absorption, exact peak at 1" height={260}
        series={[
          { name: 'Exact', color: '#ffc46b', x: result.energies_eV, y: result.exact },
          { name: `Measured, ${shots.toLocaleString('en')} shots`, color: '#8ce3ff', x: result.energies_eV, y: result.measured },
        ]} />
      <dl className="qx-facts qx-readout">
        {spinOrbit ? <>
          <div><dt>L₃, centroid</dt><dd>{edge.l3_eV!.toFixed(2)} eV</dd></div>
          <div><dt>L₂ above L₃</dt><dd>{(edge.l2_eV! - edge.l3_eV!).toFixed(2)} eV</dd></div>
          <div><dt>L₃ share</dt><dd>{(100 * edge.l3_share!).toFixed(1)} %</dd></div>
        </> : <>
          <div><dt>One 2p edge, centroid</dt><dd>{edge.centroid_eV!.toFixed(2)} eV</dd></div>
          <div><dt>Strongest</dt><dd>{edge.strongest_eV.toFixed(2)} eV</dd></div>
          <div><dt>L₃ share</dt><dd>no L₃ or L₂</dd></div>
        </>}
        <div><dt>Strongest, measured</dt><dd>{result.peak_eV.measured.toFixed(2)} eV</dd></div>
        <div><dt>Largest difference</dt><dd>{(100 * result.difference).toFixed(1)} % of the peak</dd></div>
        <div><dt>Product formula error</dt><dd>{(100 * edge.trotter_error).toFixed(1)} % of G(0)</dd></div>
      </dl>
      <p className="qx-note">
        {ready.why} The 2p hole splits into 2p₃/₂ and 2p₁/₂, so the edge splits into L₃ and L₂ about 11 eV apart, as measured, but only with spin orbit coupling: switch it off and one edge is left. The Hamiltonian is then complex and no longer keeps the spin, so the {ready.spin_orbitals} spin orbitals of the Mn 2p and 3d shells are the qubits, and the same Hadamard tests read the spectrum, {ready.settings.trotter_steps} product formula steps per time point. The six oxygens are point charges here, a crystal field without covalency. The two trends measured across manganese oxides come out: L₃ moves up and its share falls as the valence rises (Qiao et al. 2013). But absolute energies sit some 10 eV above experiment, as for the oxygen K edge models, and the steps between the states are larger than measured. Bringing the oxygens in is step 12.
        {` On a fault tolerant machine this is about ${sci(ready.cost.toffoli_whole_spectrum)} Toffoli gates on ${ready.cost.logical_qubits} logical qubits for the whole spectrum.`}
      </p>
    </> : <p className="qx-note">Loading…</p>}
  </section>;
}
