'use client';
/**
 * EELS (/quantum/): the core loss spectrum for a chosen direction of the momentum transfer q, in the dipole limit, from
 * the same problem (src/lib/quantum/eels.ts). An oriented sample needs the off-diagonal Hadamard tests as well as the
 * three of XAS; averaged over orientations it is the XAS spectrum again. Kunitsa et al., arXiv 2508.15935.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plot } from '../plot';
import { seededRandom } from '@/lib/xas';
import type { Pack } from '@/lib/quantum/packs';
import { eelsSpectra, loadEels, type EelsData } from '@/lib/quantum/eels';

const DIRECTIONS = [
  { id: 'x', label: 'x', q: [1, 0, 0] },
  { id: 'y', label: 'y', q: [0, 1, 0] },
  { id: 'z', label: 'z', q: [0, 0, 1] },
  { id: 'xyz', label: '(1, 1, 1)', q: [1, 1, 1].map(v => v / Math.sqrt(3)) },
];
/** What the axes mean for each problem (its own frame, the atoms in its pack). */
const FRAMES: Record<string, string> = {
  'h2o-o-k-sto3g': 'The molecule lies in the yz plane with z along the bisector of the H–O–H angle.',
  'co-o-k-sto3g': 'The bond lies along z.',
};
const ALPHA = 1.3384;
const sci = (x: number) => { const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(1)}×10${String(e).replace(/-/, '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d])}`; };

interface CostRow { id: string; toffoli_whole_spectrum: number; seconds_active_volume_1MHz: number; eels: { toffoli_whole_spectrum: number; seconds_active_volume_1MHz: number } }

export default function EelsCard({ id, pack, shots, seed }: { id: string; pack: Pack; shots: number; seed: number }) {
  const [data, setData] = useState<EelsData | null>(null);
  const [direction, setDirection] = useState('xyz');
  const [cost, setCost] = useState<CostRow | null>(null);
  useEffect(() => {
    let stale = false;
    setData(null);
    void loadEels(id).then(d => { if (!stale) setData(d); });
    void import('@/data/quantum/estimates.json').then(m => { if (!stale) setCost((m.default.problems as unknown as CostRow[]).find(p => p.id === id) ?? null); });
    return () => { stale = true; };
  }, [id]);

  const q = DIRECTIONS.find(d => d.id === direction)!.q;
  const result = useMemo(() => data && data.id === pack.id ? eelsSpectra(data, pack, q, shots, ALPHA, seededRandom(seed)) : null, [data, pack, q, shots, seed]);

  return <section className="twin-card qx-card qx-wide" aria-labelledby="qx-eels">
    <h2 id="qx-eels" className="twin-kicker">Electron energy loss, for an oriented sample</h2>
    <div className="twin-switch qx-directions" role="group" aria-label="Direction of the momentum transfer q">
      {DIRECTIONS.map(d => <button key={d.id} type="button" aria-pressed={direction === d.id} onClick={() => setDirection(d.id)}>q along {d.label}</button>)}
    </div>
    {result ? <>
      <Plot exportName={`quantum-eels-${id}-${direction}`} xLabel="Energy loss, E − E_I (eV)" yLabel="S(q, ω) per |q|², orientation average peak at 1" height={260}
        series={[
          { name: 'Averaged over orientations (XAS)', color: '#d4dae3', dash: 'dotted', x: result.energies_eV, y: result.average },
          { name: 'Exact, this direction', color: '#ffc46b', x: result.energies_eV, y: result.exact },
          { name: `Measured, ${shots.toLocaleString('en')} shots per function`, color: '#8ce3ff', x: result.energies_eV, y: result.measured },
        ]} />
      <dl className="qx-facts qx-readout">
        <div><dt>Strongest loss, exact</dt><dd>{result.peak_eV.exact.toFixed(2)} eV</dd></div>
        <div><dt>Strongest loss, measured</dt><dd>{result.peak_eV.measured.toFixed(2)} eV</dd></div>
        <div><dt>Largest difference</dt><dd>{(100 * result.difference).toFixed(1)} % of the peak</dd></div>
      </dl>
    </> : <p className="qx-note">Loading…</p>}
    <p className="qx-note">
      A fast electron that loses energy E passing the sample transfers momentum q, and in the dipole limit (small collection angles) the spectrum is S(q, ω) = Σ q_a q_b I_ab(ω): the oxygen K edge as X-rays see it, but along q. {FRAMES[id] ?? 'Axes are the Cartesian frame of the crystal cluster.'} A polycrystalline sample averages the directions and gives the XAS spectrum; an oriented one needs the cross terms I_ab, which the algorithm measures with off-diagonal Hadamard tests that prepare two dipole states at once: six correlation functions instead of three{data ? `, here emulated with the ${data.signals.factorization === 'exact' ? 'exact' : 'compressed'} factorization` : ''}.
      {cost && ` For this problem that is about ${sci(cost.eels.toffoli_whole_spectrum)} Toffoli gates for the whole spectrum, ${(cost.eels.toffoli_whole_spectrum / cost.toffoli_whole_spectrum).toFixed(1)} times XAS.`}
    </p>
  </section>;
}
