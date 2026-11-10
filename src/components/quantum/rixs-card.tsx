'use client';
/**
 * RIXS (/quantum/): the map of resonant inelastic X-ray scattering over incident energy and energy loss, and one row of
 * it as the algorithm of Loaiza et al. (arXiv 2602.20270) samples it, for a powder or an oriented sample
 * (src/lib/quantum/rixs.ts). Each sample costs a block encoding of the Kramers–Heisenberg state, amplified, and a phase
 * estimation; the readouts give its success probability and Toffoli gates.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Plot } from '../plot';
import { seededRandom } from '@/lib/xas';
import { amplificationRounds, loadRixs, rixsMap, rixsSpectrum, successProbability, toffoliPerSample, type Geometry, type RixsCost, type RixsData } from '@/lib/quantum/rixs';

const AXES = ['x', 'y', 'z'] as const;
/** What the axes mean for each problem, as in the EELS section. */
const FRAMES: Record<string, string> = {
  'h2o-o-k-sto3g': 'The molecule lies in the yz plane with z along the bisector of the H–O–H angle.',
  'co-o-k-sto3g': 'The bond lies along z.',
};
const sci = (x: number) => { const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(1)}×10${String(e).replace(/-/, '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d])}`; };
const percent = (x: number) => `${(100 * x).toFixed(x < 0.01 ? 2 : 1)} %`;

/** Dark to the warm photon colour to near white, one hue; brightness follows the square root of the intensity. */
function ramp(v: number): [number, number, number] {
  const t = Math.sqrt(Math.max(0, Math.min(1, v)));
  const mix = (a: number[], b: number[], s: number) => a.map((x, i) => Math.round(x + (b[i] - x) * s)) as [number, number, number];
  return t < 0.7 ? mix([13, 20, 36], [255, 196, 107], t / 0.7) : mix([255, 196, 107], [255, 246, 230], (t - 0.7) / 0.3);
}

function RixsMap({ d, geometry, row, onRow }: { d: RixsData; geometry: Geometry; row: number; onRow: (i: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640), [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    if (!wrap.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(wrap.current); return () => observer.disconnect();
  }, []);
  const rows = d.incident_eV.length, cols = d.loss_eV.length;
  const z = useMemo(() => rixsMap(d, geometry), [d, geometry]);
  const image = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = cols; canvas.height = rows;
    const context = canvas.getContext('2d');
    if (!context) return '';
    const pixels = context.createImageData(cols, rows);
    for (let i = 0; i < rows; i++) for (let k = 0; k < cols; k++) {
      const p = ((rows - 1 - i) * cols + k) * 4, [r, g, b] = ramp(z[i * cols + k]);
      pixels.data[p] = r; pixels.data[p + 1] = g; pixels.data[p + 2] = b; pixels.data[p + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL();
  }, [z, rows, cols]);
  const L = 58, R = 12, T = 8, B = 40, H = 230;
  const step = d.loss_eV[1] - d.loss_eV[0], x0 = d.loss_eV[0] - step / 2, x1 = d.loss_eV[cols - 1] + step / 2;
  const de = rows > 1 ? d.incident_eV[1] - d.incident_eV[0] : 1, y0 = d.incident_eV[0] - de / 2, y1 = d.incident_eV[rows - 1] + de / 2;
  const px = (x: number) => L + (x - x0) / (x1 - x0) * (width - L - R);
  const py = (y: number) => H - B - (y - y0) / (y1 - y0) * (H - T - B);
  const xTicks = [0, 5, 10, 15, 20, 25].filter(x => x >= x0 && x <= x1);
  const yTicks = Array.from({ length: 4 }, (_, i) => y0 + (i + 0.5) * (y1 - y0) / 4);
  const at = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = x0 + (e.clientX - box.left - L) / (width - L - R) * (x1 - x0), y = y0 + (H - B - (e.clientY - box.top)) / (H - T - B) * (y1 - y0);
    const i = Math.round((y - d.incident_eV[0]) / de), k = Math.round((x - d.loss_eV[0]) / step);
    return i >= 0 && i < rows && k >= 0 && k < cols ? { i, k } : null;
  };
  const top = d.incident_eV[z.indexOf(Math.max(...z)) / cols | 0], loss = d.loss_eV[z.indexOf(Math.max(...z)) % cols];
  return <div ref={wrap} className="qx-map">
    <svg width={width} height={H} role="img" aria-label={`RIXS map, inelastic part: incident photon energy ${d.incident_eV[0].toFixed(1)} to ${d.incident_eV[rows - 1].toFixed(1)} eV up, energy loss ${d.loss_eV[0]} to ${d.loss_eV[cols - 1]} eV across. Strongest at ${top.toFixed(2)} eV in, ${loss.toFixed(1)} eV lost.`}
      onPointerMove={e => { const c = at(e); setHover(c ? `In ${d.incident_eV[c.i].toFixed(2)} eV, lost ${d.loss_eV[c.k].toFixed(1)} eV: ${(100 * z[c.i * cols + c.k]).toFixed(1)} % of the strongest` : null); }}
      onPointerLeave={() => setHover(null)} onClick={e => { const c = at(e); if (c) onRow(c.i); }}>
      {image && <image href={image} x={L} y={T} width={width - L - R} height={H - T - B} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />}
      <line x1={L} x2={width - R} y1={py(d.incident_eV[row])} y2={py(d.incident_eV[row])} stroke="#8ce3ff" strokeWidth={1.5} strokeDasharray="5 3" />
      {xTicks.map(x => <text key={x} x={px(x)} y={H - B + 16} textAnchor="middle" className="qx-map-tick">{x}</text>)}
      {yTicks.map(y => <text key={y} x={L - 6} y={py(y) + 4} textAnchor="end" className="qx-map-tick">{y.toFixed(1)}</text>)}
      <text x={(L + width - R) / 2} y={H - 6} textAnchor="middle" className="qx-map-label">Energy loss (eV)</text>
      <text transform={`translate(13 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" className="qx-map-label">Incident (eV)</text>
    </svg>
    <p className="qx-map-hover">{hover ?? 'Brightness follows the square root of the intensity. Point at the map to read it; click a row to take it.'}</p>
  </div>;
}

interface CostRow { id: string; rixs: RixsCost }

export default function RixsCard({ id, shots, seed }: { id: string; shots: number; seed: number }) {
  const [data, setData] = useState<RixsData | null>(null);
  const [cost, setCost] = useState<RixsCost | null>(null);
  const [powder, setPowder] = useState(true);
  const [crossed, setCrossed] = useState(false);
  const [inAxis, setInAxis] = useState<typeof AXES[number]>('z'), [outAxis, setOutAxis] = useState<typeof AXES[number]>('z');
  const [row, setRow] = useState(0);
  useEffect(() => {
    let stale = false;
    setData(null);
    void loadRixs(id).then(d => { if (!stale) { setData(d); setRow(d.polynomial.row); } });
    void import('@/data/quantum/estimates.json').then(m => { if (!stale) setCost((m.default.problems as unknown as CostRow[]).find(p => p.id === id)?.rixs ?? null); });
    return () => { stale = true; };
  }, [id]);

  const geometry: Geometry = powder ? (crossed ? 'crossed' : 'parallel') : `${inAxis}${outAxis}`;
  const usable = data && data.id === id && row < data.incident_eV.length ? data : null;
  const result = useMemo(() => usable ? rixsSpectrum(usable, geometry, row, shots, seededRandom(seed)) : null, [usable, geometry, row, shots, seed]);
  const p = usable ? successProbability(usable, geometry, row) : 0;
  const rounds = p > 0 ? amplificationRounds(p) : 0;
  const absorbs = !data || data.dipole_norms[AXES.indexOf(inAxis)] > 0;

  return <section className="twin-card qx-card qx-wide" aria-labelledby="qx-rixs">
    <h2 id="qx-rixs" className="twin-kicker">Resonant inelastic X-ray scattering</h2>
    <div className="qx-rixs-controls">
      <div className="twin-switch" role="group" aria-label="Sample">
        <button type="button" aria-pressed={powder} onClick={() => setPowder(true)}>Powder</button>
        <button type="button" aria-pressed={!powder} onClick={() => setPowder(false)}>Oriented</button>
      </div>
      {powder ? <div className="twin-switch" role="group" aria-label="Polarizations, in and out">
        <button type="button" aria-pressed={!crossed} onClick={() => setCrossed(false)}>Parallel</button>
        <button type="button" aria-pressed={crossed} onClick={() => setCrossed(true)}>Crossed</button>
      </div> : <>
        <div className="twin-switch qx-three" role="group" aria-label="Incoming polarization">
          {AXES.map(a => <button key={a} type="button" aria-pressed={inAxis === a} onClick={() => setInAxis(a)}>In along {a}</button>)}
        </div>
        <div className="twin-switch qx-three" role="group" aria-label="Outgoing polarization">
          {AXES.map(a => <button key={a} type="button" aria-pressed={outAxis === a} onClick={() => setOutAxis(a)}>Out along {a}</button>)}
        </div>
      </>}
    </div>
    {usable ? <>
      <div className="twin-field">
        <div className="qx-field-head"><label htmlFor="qx-rixs-in">Incident photon energy</label><output htmlFor="qx-rixs-in">{usable.incident_eV[row].toFixed(2)} eV</output></div>
        <input id="qx-rixs-in" type="range" min={0} max={usable.incident_eV.length - 1} step={1} value={row}
          aria-valuetext={`${usable.incident_eV[row].toFixed(2)} eV`} onChange={e => setRow(+e.target.value)} />
      </div>
      <RixsMap d={usable} geometry={geometry} row={row} onRow={setRow} />
      {result && absorbs && result.exact.some(v => v > 0) ? <>
        <Plot exportName={`quantum-rixs-${id}-${geometry}-${usable.incident_eV[row].toFixed(2)}eV`} xLabel="Energy loss (eV)" yLabel="Samples per 0.2 eV bin, exact peak at 1" height={240}
          series={[
            { name: 'Exact, as phase estimation reads it', color: '#ffc46b', x: result.loss_eV, y: result.exact },
            { name: `Measured, ${shots.toLocaleString('en')} samples`, color: '#8ce3ff', x: result.loss_eV, y: result.measured },
          ]} />
        <dl className="qx-facts qx-readout">
          <div><dt>Strongest loss, exact</dt><dd>{result.peak_eV.exact.toFixed(1)} eV</dd></div>
          <div><dt>Strongest loss, measured</dt><dd>{result.peak_eV.measured.toFixed(1)} eV</dd></div>
          <div><dt>Largest difference</dt><dd>{(100 * result.difference).toFixed(1)} % of the peak</dd></div>
          <div><dt>Elastic line</dt><dd>{percent(result.elastic)} of samples</dd></div>
          <div><dt>Block encoding succeeds</dt><dd>{percent(p)}, {rounds} rounds</dd></div>
          <div><dt>Toffolis per sample</dt><dd>{cost ? sci(toffoliPerSample(cost, rounds)) : '…'}</dd></div>
        </dl>
      </> : <p className="qx-note">With the incoming polarization along {inAxis} this problem absorbs nothing here; pick another direction.</p>}
    </> : <p className="qx-note">Loading…</p>}
    <p className="qx-note">
      A photon tuned to a core resonance is absorbed and another leaves with less energy, leaving the sample in a valence excited state: the Kramers–Heisenberg amplitude ⟨F|m_out G(ω_in) m_in|I⟩, with the core hole&apos;s half width of {data ? data.settings.gamma_eV.toFixed(1) : '0.3'} eV. At the oxygen K edge of lithium rich cathodes this is how oxygen redox is read. {powder ? 'A powder averages every orientation; crossed polarizations need the parts of the scattering tensor that are not symmetric.' : FRAMES[id] ?? 'Axes are the Cartesian frame of the crystal cluster.'} The quantum algorithm prepares m_out G m_in|I⟩ with a block encoding, G as a Chebyshev polynomial of degree {data ? data.green_degree.toLocaleString('en') : 'K_G'} in the Hamiltonian, amplifies it, and samples the loss by phase estimation with a resolution of {data ? data.settings.resolution_eV : 0.2} eV; the curves count those samples in 0.2 eV bins, without the elastic line.
      {data && ` Here the polynomial moves the spectrum by ${sci(data.polynomial.largest_change)} of its peak.`}
      {cost && ` A spectrum of ${shots.toLocaleString('en')} samples is about ${sci(shots * toffoliPerSample(cost, rounds))} Toffoli gates on ${cost.logical_qubits} logical qubits.`}
    </p>
  </section>;
}
