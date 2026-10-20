'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { type ExafsProcessingOptions, type ExafsProcessingResult, type ExafsWindow } from '@/lib/exafs';
import type { Spectrum } from '@/lib/spectra';
import { Plot, type Series } from './plot';
import { Num, Tex, Unit } from './tex';
import { Badge, Metric, Panel, Range, download } from './ui';

const DEFAULT_OPTIONS: ExafsProcessingOptions = {
  rbkg: 1,
  kmin: 2,
  kmax: 14,
  kweight: 2,
  dk: 1,
  window: 'hanning',
};

const superscript = (value: number) => String(value).replace(/0/g, '⁰').replace(/1/g, '¹').replace(/2/g, '²').replace(/3/g, '³');

export function ExafsPanel({ spectrum }: { spectrum: Spectrum }) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [result, setResult] = useState<ExafsProcessingResult | null>(null);
  const [status, setStatus] = useState('Waiting to process the selected curve.');
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    workerRef.current?.terminate();
    setResult(null);
    setStatus('Processing the selected curve in this browser.');
    const timer = setTimeout(() => {
      try {
        const worker = new Worker(new URL('../workers/exafs.worker.ts', import.meta.url));
        workerRef.current = worker;
        worker.onmessage = (event: MessageEvent<{ id: number; result?: ExafsProcessingResult; error?: string }>) => {
          if (event.data.id !== requestId.current) return;
          if (event.data.result) {
            setResult(event.data.result);
            setStatus('Processing complete. Data stayed in this browser.');
          } else setStatus(event.data.error ?? 'EXAFS processing could not be completed.');
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        };
        worker.onerror = () => {
          if (id === requestId.current) setStatus('The EXAFS worker could not run. The selected raw curve is unchanged.');
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        };
        worker.postMessage({ id, energy_eV: spectrum.energy_eV, mu: spectrum.mu_cm_inv, options });
      } catch {
        setStatus('The EXAFS worker could not start. The selected raw curve is unchanged.');
      }
    }, 120);
    return () => { clearTimeout(timer); workerRef.current?.terminate(); workerRef.current = null; };
  }, [spectrum, options]);

  const plots = useMemo(() => {
    if (!result) return null;
    const weighted = result.xftf.weightedChi;
    const k = result.autobk.k.slice(0, weighted.length);
    const maximum = Math.max(...weighted.map(Math.abs), 1e-12), windowScale = 0.85 * maximum;
    const kUnit = options.kweight === 0 ? '' : `Å⁻${superscript(options.kweight)}`;
    const rUnit = `Å⁻${superscript(options.kweight + 1)}`;
    const kSeries: Series[] = [
      { name: `k^${options.kweight} chi(k)`, label: <Tex>{options.kweight ? `k^{${options.kweight}}\\chi(k)` : '\\chi(k)'}</Tex>, color: '#7fd8cf', x: k, y: weighted },
      { name: 'Fourier window (scaled)', label: <>Window × <Num>{windowScale.toPrecision(3)}</Num></>, color: '#f4c777', x: k, y: result.xftf.kwin.map(value => value * windowScale), dash: 'dotted' },
    ];
    const rSeries: Series[] = [
      { name: 'Magnitude of chi(R)', label: <Tex>{'|\\chi(R)|'}</Tex>, color: '#7fd8cf', x: result.xftf.r, y: result.xftf.magnitude },
      { name: 'Real chi(R)', label: <Tex>{'\\operatorname{Re}\\chi(R)'}</Tex>, color: '#f4c777', x: result.xftf.r, y: result.xftf.real, dash: 'dashed' },
      { name: 'Imaginary chi(R)', label: <Tex>{'\\operatorname{Im}\\chi(R)'}</Tex>, color: '#ff8a8f', x: result.xftf.r, y: result.xftf.imaginary, dash: 'dotted' },
    ];
    return { kSeries, rSeries, kUnit, rUnit, windowScale };
  }, [result, options.kweight]);

  const exportResult = () => {
    if (!result) return;
    download(`${spectrum.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64) || 'spectrum'}-exafs.json`, JSON.stringify({
      format: 'xas-lab-exafs/1',
      source: { id: spectrum.id, name: spectrum.name, provenance: spectrum.provenance },
      method: 'xraylarch 2026.3.1-compatible AUTOBK and xftf',
      result,
    }, null, 2));
  };

  return <Panel title="EXAFS reduction" eyebrow="Selected raw curve" aside={<Badge tone="amber">AUTOBK + xftf</Badge>}>
    <p>Remove the smooth atomic background, inspect <Tex>{'k^w\\chi(k)'}</Tex>, then transform the selected range to <Tex>{'\\chi(R)'}</Tex>. The raw spectrum is kept unchanged.</p>
    <div className="exafs-controls control-panel" aria-label="EXAFS processing controls">
      <Range label="Background cutoff rbkg" display={<><Tex plain>{'R_{\\mathrm{bkg}}'}</Tex> cutoff</>} value={options.rbkg} min={0.5} max={2} step={0.05} digits={2} unit="Å" onChange={rbkg => setOptions(current => ({ ...current, rbkg }))} hint="Low-R interval minimized by AUTOBK." />
      <Range label="Minimum k" display={<><Tex plain>{'k_{\\min}'}</Tex></>} value={options.kmin} min={0} max={18} step={0.25} digits={2} unit="Å⁻¹" onChange={kmin => setOptions(current => ({ ...current, kmin: Math.min(kmin, current.kmax - 0.5) }))} />
      <Range label="Maximum k" display={<><Tex plain>{'k_{\\max}'}</Tex></>} value={options.kmax} min={4} max={20} step={0.25} digits={2} unit="Å⁻¹" onChange={kmax => setOptions(current => ({ ...current, kmax: Math.max(kmax, current.kmin + 0.5) }))} />
      <label>k-weight <select aria-label="k-weight" value={options.kweight} onChange={event => setOptions(current => ({ ...current, kweight: Number(event.target.value) }))}>{[0, 1, 2, 3].map(weight => <option key={weight} value={weight}>k^{weight}</option>)}</select></label>
      <Range label="Window taper dk" display={<><Tex plain>{'dk'}</Tex> taper</>} value={options.dk} min={0.1} max={4} step={0.1} digits={1} unit="Å⁻¹" onChange={dk => setOptions(current => ({ ...current, dk }))} />
      <label>Window <select value={options.window} onChange={event => setOptions(current => ({ ...current, window: event.target.value as ExafsWindow }))}>
        <option value="hanning">Hanning</option><option value="kaiser">Kaiser</option><option value="parzen">Parzen</option><option value="welch">Welch</option><option value="sine">Sine</option><option value="gaussian">Gaussian</option>
      </select></label>
    </div>
    <p className="muted exafs-status" role="status" aria-live="polite">{status}</p>
    {result && plots && <>
      <div className="metric-grid">
        <Metric label={<>Estimated <Tex plain>{'E_0'}</Tex></>} value={result.preEdge.e0.toFixed(2)} unit="eV" />
        <Metric label="Estimated edge step" value={result.preEdge.edgeStep.toPrecision(4)} unit="cm⁻¹" />
        <Metric label="Spline knots" value={String(result.autobk.nknots)} />
        <Metric label={<><Tex plain>{'\\delta R'}</Tex> grid spacing</>} value={result.xftf.deltaR.toFixed(4)} unit="Å" />
      </div>
      <div className="two-col exafs-plots">
        <Plot series={plots.kSeries} xLabel="Photoelectron wavenumber k (Å⁻¹)" yLabel={options.kweight ? `k^${options.kweight} chi(k) (${plots.kUnit})` : 'chi(k) (dimensionless)'} yTex={options.kweight ? `k^{${options.kweight}}\\chi(k)\\ (\\mathring{\\mathrm A}^{-${options.kweight}})` : '\\chi(k)\\ (\\text{dimensionless})'} yUnit={plots.kUnit} exportName="exafs-chi-k" height={270} />
        <Plot series={plots.rSeries} xLabel="Uncorrected radial coordinate R (Å)" yLabel={`chi(R) components (${plots.rUnit})`} yTex={`\\chi(R)\\ (\\mathring{\\mathrm A}^{-${options.kweight + 1}})`} yUnit={plots.rUnit} exportName="exafs-chi-r" height={270} />
      </div>
      <p className="callout"><strong><Tex plain>{'R'}</Tex> is not a bond length.</strong> Photoelectron phase shifts usually place an uncorrected Fourier-transform peak below the corresponding interatomic distance.</p>
      <p className="muted">The window is multiplied by <Num>{plots.windowScale.toPrecision(3)}</Num> only for the shared <Tex>{'k^w\\chi(k)'}</Tex> display. AUTOBK uses evenly spaced spline anchors in <Tex plain>{'k'}</Tex>, minimizes signal below <Tex plain>{'R_{\\mathrm{bkg}}'}</Tex>, and clamps the last <Num>3</Num> points with the xraylarch <Num>2026.3.1</Num> defaults. <Tex>{'\\delta R=\\pi/(N_{\\mathrm{fft}}\\,\\delta k)'}</Tex> with <Tex>{'N_{\\mathrm{fft}}=2048'}</Tex> and <Tex>{'\\delta k=0.05\\ \\mathring{\\mathrm A}^{-1}'}</Tex>.</p>
      <p className="muted">The displayed <Tex plain>{'E_0'}</Tex> is a maximum-slope estimate and the edge step comes from pre- and post-edge fits. Neither is a reference-foil calibration. Change in <Tex plain>{'E_0'}</Tex> changes the phase of <Tex plain>{'\\chi(k)'}</Tex>.</p>
      <button className="button secondary small" onClick={exportResult}><Download size={14} />EXAFS JSON</button>
    </>}
  </Panel>;
}
