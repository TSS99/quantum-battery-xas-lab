'use client';
/**
 * Measure and compare (/quantum/): the oxide clusters' computed oxygen K edges as samples on a soft X-ray beamline,
 * and the fit that reads a measurement back as a mixture of oxygen environments (src/lib/quantum/measure.ts). A
 * measured spectrum of your own can be loaded instead; it stays in the browser.
 */
import { Download, FileUp, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Plot } from '../plot';
import { download } from '../ui';
import { seededRandom } from '@/lib/xas';
import { HARTREE_EV, loadPack, type Pack } from '@/lib/quantum/packs';
import {
  AIR_LENGTH_MM, BEAMLINE, LIFETIME_HWHM_EV, fit, measure, mixture, rank, readSpectrum, scanEnergies, toCsv,
  type Detection, type FitOptions, type Measured, type Sticks,
} from '@/lib/quantum/measure';

const CLUSTERS = [
  { id: 'li2mno3-o2-k', name: 'Li₂MnO₃, O2 site' },
  { id: 'li2mno3-o1-k', name: 'Li₂MnO₃, O1 site' },
  { id: 'li3mn2o-o2-k', name: 'O2 site, one lithium removed' },
  { id: 'li2mn2o-o2-k', name: 'O2 site, two lithium removed' },
];
const MIXTURES = {
  crystal: { name: 'Li₂MnO₃ crystal, O2 and O1 sites 2 : 1', fractions: [2 / 3, 1 / 3, 0, 0] },
  charged: { name: 'Partly charged, three environments', fractions: [1 / 3, 1 / 6, 0.3, 0.2] },
};
type SampleKey = keyof typeof MIXTURES | 'alone' | 'file';
const POWERS = [1000, 2000, 5000, 10000, 20000];
const DWELLS = [0.1, 0.3, 1, 3, 10];
const WIDTHS = [0, 0.5, 1, 2];
const FIT_WIDTHS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5];
const PLACES = ['best', 'second', 'third', 'fourth'];
/** The cost of a finer resolution for the 11 orbital clusters (scripts/quantum/estimates.py). */
interface Resolution { eta_Ha: number; toffoli_longest_circuit: number; seconds_active_volume_1MHz: number; fits: Record<string, boolean> }
const sci = (x: number) => { const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(1)}×10${String(e).replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d])}`; };
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
const spread = (x: number) => x < 5e-4 ? '± <0.1 %' : `± ${pct(x)}`;
const duration = (s: number) => s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} hours`;

export default function MeasureCard({ id }: { id: string }) {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [sample, setSample] = useState<SampleKey>('crystal');
  const [detection, setDetection] = useState<Detection>('tey');
  const [power, setPower] = useState(2), [dwell, setDwell] = useState(2), [width, setWidth] = useState(2);
  // 0 is the exact spectra; then the quantum run's resolutions, finest first.
  const [resolution, setResolution] = useState(0);
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [seed, setSeed] = useState(1);
  const [uploaded, setUploaded] = useState<(Measured & { name: string; column: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void Promise.all(CLUSTERS.map(c => loadPack(c.id))).then(setPacks); }, []);
  useEffect(() => { void import('@/data/quantum/estimates.json').then(m => setResolutions([...m.default.resolution as Resolution[]].sort((a, b) => a.eta_Ha - b.eta_Ha))); }, []);

  const sticks = useMemo<Sticks[] | null>(() => packs && packs.map(p => ({ centres_eV: p.reference.centres_Ha.map(c => c * HARTREE_EV), weights: p.reference.weights })), [packs]);
  const energies = useMemo(() => packs && scanEnergies(packs.map(p => p.reference.edge_eV)), [packs]);
  const alone = CLUSTERS.findIndex(c => c.id === id);
  const key: SampleKey = (sample === 'alone' && alone < 0) || (sample === 'file' && !uploaded) ? 'crystal' : sample;
  const truth = key === 'alone' ? CLUSTERS.map((_, k) => +(k === alone)) : key === 'file' ? null : MIXTURES[key].fractions;
  const beam = { ...BEAMLINE, resolvingPower: POWERS[power], dwell_s: DWELLS[dwell], detection };
  const quantum = resolution > 0 ? resolutions[resolution - 1] : undefined;
  const halfWidth = quantum ? quantum.eta_Ha * HARTREE_EV : LIFETIME_HWHM_EV;
  const built = packs ? packs[0].settings.eta_Ha * HARTREE_EV : 1.36;

  const scan = useMemo(() => sticks && energies && truth
    ? measure(mixture(sticks.map((s, k) => ({ sticks: s, fraction: truth[k] }))), energies, beam, seededRandom(seed), WIDTHS[width]) : null,
  [sticks, energies, key, alone, power, dwell, detection, width, seed]);
  const data: Measured | null = key === 'file' ? uploaded : scan;
  const result = useMemo(() => {
    if (!data || !sticks) return null;
    const options: FitOptions = { shifts: key === 'file' ? [-45, 5] : [-2, 2], broadenings: FIT_WIDTHS, resolvingPower: POWERS[power],
      halfWidth_eV: halfWidth, background: key === 'file' };
    return { mix: fit(data, sticks, options), ranking: rank(data, sticks, options) };
  }, [data, sticks, key, power, halfWidth]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const read = readSpectrum(await file.text(), file.name);
      setUploaded({ ...read, name: file.name });
      setSample('file');
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const x = data ? Array.from(data.energies) : [];
  const top = scan ? scan.truth.indexOf(1) : -1;
  return <section className="twin-card qx-card qx-wide" aria-labelledby="qx-measure">
    <h2 id="qx-measure" className="twin-kicker">Measure on a soft X-ray beamline, and compare</h2>
    <div className="qx-measure">
      <div className="qx-measure-controls">
        <label className="twin-field">Sample
          <select value={key} onChange={e => setSample(e.target.value as SampleKey)}>
            {alone >= 0 && <option value="alone">This cluster alone: {CLUSTERS[alone].name}</option>}
            {Object.entries(MIXTURES).map(([k, m]) => <option key={k} value={k}>{m.name}</option>)}
            {uploaded && <option value="file">Your spectrum: {uploaded.name}</option>}
          </select>
        </label>
        <div className="qx-actions">
          <label className="twin-chip qx-file"><FileUp size={14} aria-hidden="true" />Load your measured spectrum
            <input className="sr-only" type="file" accept=".csv,.txt,.dat,.xdi,.xmu,.nor" onChange={e => void onFile(e.target.files?.[0])} /></label>
        </div>
        {error && <p className="qx-note" role="alert">{error}</p>}
        {key !== 'file' && <>
          <div className="twin-switch" role="group" aria-label="Detection">
            <button type="button" aria-pressed={detection === 'tey'} onClick={() => setDetection('tey')}>Electron yield</button>
            <button type="button" aria-pressed={detection === 'fy'} onClick={() => setDetection('fy')}>Fluorescence yield</button>
          </div>
          <div className="twin-field">
            <div className="qx-field-head"><label htmlFor="qx-power">Resolving power, E/ΔE</label><output htmlFor="qx-power">{POWERS[power].toLocaleString('en')}</output></div>
            <input id="qx-power" type="range" min={0} max={POWERS.length - 1} step={1} value={power} aria-valuetext={POWERS[power].toLocaleString('en')} onChange={e => setPower(+e.target.value)} />
          </div>
          <div className="twin-field">
            <div className="qx-field-head"><label htmlFor="qx-dwell">Dwell per point</label><output htmlFor="qx-dwell">{DWELLS[dwell]} s</output></div>
            <input id="qx-dwell" type="range" min={0} max={DWELLS.length - 1} step={1} value={dwell} aria-valuetext={`${DWELLS[dwell]} s`} onChange={e => setDwell(+e.target.value)} />
          </div>
          <div className="twin-field">
            <div className="qx-field-head"><label htmlFor="qx-width">Broadening in the sample</label><output htmlFor="qx-width">{WIDTHS[width]} eV</output></div>
            <input id="qx-width" type="range" min={0} max={WIDTHS.length - 1} step={1} value={width} aria-valuetext={`${WIDTHS[width]} eV`} onChange={e => setWidth(+e.target.value)} />
          </div>
        </>}
        {resolutions.length > 0 && <><div className="twin-field">
          <div className="qx-field-head"><label htmlFor="qx-eta">Candidates, as a quantum run resolves them</label><output htmlFor="qx-eta">{quantum ? `η = ${halfWidth.toFixed(2)} eV` : 'exact'}</output></div>
          <input id="qx-eta" type="range" min={0} max={resolutions.length} step={1} value={resolution} aria-valuetext={quantum ? `η = ${halfWidth.toFixed(2)} eV` : 'exact spectra'} onChange={e => setResolution(+e.target.value)} />
        </div>
        <p className="qx-note" role="status">{quantum
            ? `Longest circuit ${sci(quantum.toffoli_longest_circuit)} Toffoli gates for these 11 orbital clusters: ${quantum.fits.starling ? 'fits the Starling class' : quantum.fits['blue-jay'] ? 'needs the Blue Jay class' : 'beyond both announced generations'}, ${duration(quantum.seconds_active_volume_1MHz)} on the active volume layout.`
            : 'The exact spectra, at the 0.15 eV lifetime width: what a perfect computation would give.'}</p></>}
        {scan && <div className="qx-actions">
          <button type="button" className="twin-chip" onClick={() => setSeed(s => s + 1)}><Shuffle size={14} aria-hidden="true" />New scan</button>
          <button type="button" className="twin-chip" onClick={() => download(`quantum-scan-${key}.csv`, toCsv(scan, key === 'alone' ? CLUSTERS[alone].name : MIXTURES[key as keyof typeof MIXTURES].name), 'text/csv')}>
            <Download size={14} aria-hidden="true" />Download the scan</button>
        </div>}
      </div>
      <div className="qx-measure-plot">
        {data && result ? <Plot exportName={`quantum-measure-${key}`} xLabel={key === 'file' ? 'Photon energy (eV), as measured' : 'Photon energy (eV), computed scale'}
          yLabel={key === 'file' ? 'Signal, as loaded' : 'Absorption, top at 1'} height={280}
          series={[
            ...(scan && key !== 'file' ? [{ name: 'Sample absorption', color: '#d4dae3', x, y: Array.from(scan.truth) }] : []),
            { name: key === 'file' ? 'Your spectrum' : 'Measured', color: '#8ce3ff', x, y: Array.from(data.measured) },
            { name: 'Fit', color: '#ffc46b', dash: 'dashed' as const, x, y: Array.from(result.mix.model) },
          ]} /> : <p className="qx-note">Loading the clusters…</p>}
      </div>
    </div>
    {result && <>
      <dl className="qx-facts qx-readout">
        {scan && key !== 'file' && <>
          <div><dt>Scan</dt><dd>{scan.energies.length} points, {duration(scan.seconds)}</dd></div>
          <div><dt>Surface dose</dt><dd>{Math.round(scan.dose_MGy).toLocaleString('en')} MGy</dd></div>
          <div><dt>Noise at the top</dt><dd>{(100 * scan.sigma[top]).toFixed(2)} %</dd></div>
        </>}
        <div><dt>Shift applied to the candidates</dt><dd>{result.mix.shift_eV.toFixed(2)} eV</dd></div>
        <div><dt>Extra broadening</dt><dd>{result.mix.extraFwhm_eV} eV</dd></div>
        <div><dt>Misfit</dt><dd>R {result.mix.rFactor.toExponential(1)}{key !== 'file' && `, χ²ᵥ ${result.mix.chi2.toFixed(2)}`}</dd></div>
      </dl>
      <div className="table-wrap"><table className="twin-fit-table">
        <caption className="sr-only">The oxygen environments the fit finds</caption>
        <thead><tr><th scope="col">Oxygen environment</th><th scope="col">Fitted fraction</th>{truth && <th scope="col">In the sample</th>}<th scope="col">Fitted alone</th></tr></thead>
        <tbody>{CLUSTERS.map((c, k) => {
          const place = result.ranking.findIndex(r => r.index === k), solo = result.ranking[place].fit;
          return <tr key={c.id}><th scope="row">{c.name}</th>
            <td>{pct(result.mix.fractions[k])}{result.mix.fractions[k] >= 5e-4 && ` ${spread(result.mix.errors[k])}`}</td>
            {truth && <td>{pct(truth[k])}</td>}
            <td>{PLACES[place]}, {key === 'file' ? `R ${solo.rFactor.toExponential(1)}` : `χ²ᵥ ${solo.chi2 < 100 ? solo.chi2.toFixed(1) : solo.chi2.toExponential(1)}`}</td></tr>;
        })}</tbody>
      </table></div>
    </>}
    <p className="qx-note">
      The sample is a mixture of the clusters&apos; exact spectra, per oxygen atom, with the 0.15 eV lifetime width of the O 1s hole. The beamline is a model, not a facility: a grating monochromator, an I0 gold mesh, the sample&apos;s drain current for electron yield or a silicon drift detector for fluorescence, Poisson counts and 0.2 % normalization noise at 1 s, 10¹¹ photons per second on 100 × 50 µm, and a background under the edge (the other atoms in electron yield, scatter in fluorescence) subtracted as a pre-edge line would be. Soft X-rays of 530 eV travel {AIR_LENGTH_MM} mm in air, so beam and sample are in vacuum. Electron yield sees the top few nanometres; fluorescence sees about 280 nm but saturates in a concentrated oxide, flattening the strong peaks, which the fit then misreads.
    </p>
    <p className="qx-note">
      Noise is rarely what limits the comparison: a real material differs from these small clusters by more than any scan&apos;s noise, so the fit says which computed environment is closest, not that it is right. The quantum run sets how sharp the candidates are: at the {built.toFixed(2)} eV used above, the fit cannot tell these environments apart; telling how much lithium has gone needs η near 0.27 eV, and the two oxygen sites near 0.14 eV, each a longer evolution in finer steps. A spectrum you load is fitted with a free shift (the computed energies sit 6 to 30 eV high), a free constant and slope, from 5 eV below its edge to 20 eV above; it never leaves your browser.
    </p>
  </section>;
}
