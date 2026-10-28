'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLab } from './lab-context';
import { Plot } from './plot';
import { Panel, Range, Metric, TryThis, Disclosure } from './ui';
import { DataLoading, SampleSummary, useSampleSpectrum } from './sample-controls';
import { ChemistryControls } from './laboratory';
import { isBattery } from '@/lib/sample';
import { mu } from '@/lib/xraydata';
import { transmission, sampleCounts } from '@/lib/xas';
import { BeamScene } from './beamline-scene';
import { Num, ScienceText, Tex, Unit, formulaTex, texNum } from './tex';

export function Beamline() {
  const { state, set, addRun, notify } = useLab();
  const { spectrum, info, error } = useSampleSpectrum(), model = useSampleSpectrum(true);
  const [scanning, setScanning] = useState(false), [noise, setNoise] = useState(false), [overlay, setOverlay] = useState(false), [view, setView] = useState<'mu' | 'transmission'>('mu'), [planned, setPlanned] = useState(false);
  useEffect(() => {
    if (!scanning || !info) return;
    let energy = info.start;
    set({ energy });
    const timer = setInterval(() => { energy = Math.min(info.end, energy + (info.end - info.start) / 100); set({ energy }); if (energy >= info.end) { setScanning(false); clearInterval(timer); } }, 65);
    return () => clearInterval(timer);
  }, [scanning, info?.start, info?.end]);
  useEffect(() => { setScanning(false); setPlanned(false); }, [state.sample.absorber, state.sample.edge, state.sample.preset]);
  if (!spectrum || !info) return <DataLoading error={error}>Next you can scan the photon energy across the {state.sample.absorber} <Tex plain>{formulaTex(state.sample.edge)}</Tex> edge, set the sample thickness and count the photons that reach the detector.</DataLoading>;
  const energy = Math.max(info.start, Math.min(info.end, state.energy));
  const coefficient = mu(state.sample.formula, state.sample.density, energy).total;
  const result = transmission(coefficient, state.thickness, state.photons), counts = sampleCounts(coefficient, state.thickness, state.photons, state.seed);
  const curve = (values: number[]) => view === 'mu' ? values : values.map(v => transmission(v, state.thickness, state.photons).transmittance);
  return <>
    <p className="callout"><span>This page shows one idea: what a sample does to the beam at each energy. To run the whole instrument, with the mirrors, the monochromator, the detectors and real scans, <Link href="/twin/">operate the beamline twin</Link>.</span></p>
    <SampleSummary />
    <TryThis done={planned} research={<><Tex>{`\\mu d = ${result.opticalDepth.toFixed(3)}`}</Tex>; {info.plan ? <Tex>{`\\Delta\\mu d = ${(info.plan.edgeStep.deltaMu_cm_inv * state.thickness * 1e-4).toFixed(3)}`}</Tex> : <><Tex>{'\\Delta\\mu d'}</Tex> unavailable</>}. Counts use total tabulated attenuation, including scattering.</>}>{planned ? 'This thickness balances the edge step against total absorption. Start a scan to see where the signal changes.' : 'Use the suggested thickness, then start an energy scan. Watch how many photons reach the detector.'}</TryThis>
    <div className="main-with-controls">
      <Panel className="beam-panel" title="Follow the X-ray beam">
        <div className="toolbar"><button className="button" onClick={() => setScanning(!scanning)}>{scanning ? 'Stop scan' : 'Start energy scan'}</button><span className="energy-window" data-testid="beamline-window"><Tex plain>{`${info.start.toFixed(1)}\\text{–}${info.end.toFixed(1)}\\ \\mathrm{eV}`}</Tex></span></div>
        <BeamScene energy={energy} edgeEnergy={info.edge.energy_eV} transmittance={result.transmittance} incident={state.photons} transmitted={result.expectedTransmitted} thickness={state.thickness} scanning={scanning} formula={state.sample.formula} absorber={state.sample.absorber} edge={state.sample.edge} />
        <div role="group" aria-label="Beamline plot" className="toolbar"><button className="button secondary small" aria-pressed={view === 'mu'} onClick={() => setView('mu')}>Absorption</button><button className="button secondary small" aria-pressed={view === 'transmission'} onClick={() => setView('transmission')}>Transmission</button></div>
        <Plot reveal={scanning?(energy-info.start)/(info.end-info.start):1} ghostKey={String(state.x)+':'+state.shift+':'+overlay} edge={isBattery(state.sample)?state.edge-state.shift*state.x:info.edge.energy_eV+state.shift-3} series={[{ name: 'Tabulated atomic data', color: '#ffc46b', x: spectrum.energy_eV, y: curve(spectrum.mu_cm_inv) }, ...(overlay && model.spectrum && info.inRange ? [{ name: 'Near-edge model', color: isBattery(state.sample) && state.sample.absorber === 'Mn' ? '#b49cff' : '#c4ccd6', x: model.spectrum.energy_eV, y: curve(model.spectrum.mu_cm_inv), dashed: true }] : [])]} cursor={energy} onCursor={energy => { setScanning(false); set({ energy }); }} yLabel={view === 'mu' ? 'μ (cm⁻¹)' : 'Transmission Iₜ / I₀'} yTex={view === 'mu' ? '\\mu\\ (\\mathrm{cm}^{-1})' : '\\text{Transmission }I_t/I_0'} exportName="beamline" />
        <div className="metric-grid"><Metric label={<>Absorption <Tex plain>{'\\mu(E)'}</Tex></>} value={coefficient.toFixed(2)} unit="cm⁻¹" /><Metric label={<>Transmitted <Tex plain>{'I_t'}</Tex>, expected</>} value={result.expectedTransmitted.toFixed(0)} unit="photons" /></div>
        <p className="muted">The displayed coefficient is total attenuation, including absorption and scattering out of the direct beam. Tabulated atomic cross sections give the background and edge jumps. They do not include chemical shifts or fine structure. <Link href="/validation/">Data source and limits</Link></p>
      </Panel>
      <Panel title="Set the measurement" className="control-panel primary-controls">
        <Range label="Photon energy" min={info.start} max={info.end} step={.1} value={energy} digits={1} unit="eV" onChange={energy => { setScanning(false); set({ energy }); }} />
        <Range label="Sample thickness" min={.00001} max={Math.max(200, Math.ceil(state.thickness), Math.ceil((info.plan?.thickness_um ?? 20) * 3))} step={.00001} value={state.thickness} digits={state.thickness < 1 ? 5 : 2} unit="μm" onChange={thickness => set({ thickness })} />
        {info.plan && <button className="button secondary" onClick={() => { set({ thickness: info.plan!.thickness_um }); setPlanned(true); }}><span>Use suggested thickness · <Num>{info.plan.thickness_um.toPrecision(3)}</Num> <Unit>μm</Unit></span></button>}
        {info.mode && <p className="muted">{info.edge.energy_eV < 2000 ? 'For soft X-ray transmission, check density, path length and window transmission. Fluorescence or electron yield may also be suitable.' : info.mode.mode === 'fluorescence' ? 'The absorber is too dilute for a good transmission edge step. Fluorescence is likely the better choice.' : 'Transmission is suitable for this edge and composition.'}</p>}
        {info.note && <p role="status"><ScienceText>{info.note}</ScienceText></p>}
        {isBattery(state.sample) && <ChemistryControls compact guide={false} />}
      </Panel>
    </div>
    <details className="research-drawer" open={state.expert}><summary>Research controls</summary><div className="drawer-body">
      <div className="two-col">
        <div><Range label="Incident photons (log₁₀)" display={<>Incident photons (<Tex plain>{'\\log_{10}'}</Tex>)</>} min={0} max={7} step={.1} value={Math.log10(state.photons)} digits={1} onChange={v => set({ photons: Math.round(10 ** v) })} />
          <div className="equation"><Tex block>{'I_t = I_0\\,e^{-\\mu d}'}</Tex><Tex>{`d = ${texNum((state.thickness * 1e-4).toPrecision(4))}\\ \\text{cm},\\quad I_0 = ${texNum(state.photons.toLocaleString('en-US'))}`}</Tex></div>
          <label className="check-control"><input type="checkbox" checked={noise} onChange={e => setNoise(e.target.checked)} />Simulate Poisson detector counts</label>
          {noise && <div className="noise-result"><p><Tex plain>{'I_0'}</Tex> draw <Num>{counts.incident.toLocaleString('en-US')}</Num>; <Tex plain>{'I_t'}</Tex> draw <Num>{counts.transmitted.toLocaleString('en-US')}</Num>; inferred <Tex plain>{'\\mu'}</Tex> {counts.apparentMu == null ? 'undefined' : <Num>{counts.apparentMu.toFixed(2)}</Num>} <Unit>cm⁻¹</Unit>.</p><p>With zero counts, <Tex plain>{'\\mu'}</Tex> can&apos;t be computed. <Tex plain>{'I_0'}</Tex> and <Tex plain>{'I_t'}</Tex> are independent Poisson draws.</p><label className="field-label">Random seed<input type="number" min={0} max={4294967295} value={state.seed} onChange={e => { const n = +e.target.value; if (Number.isInteger(n) && n >= 0 && n <= 4294967295) set({ seed: n }); }} /></label><button className="button secondary" onClick={() => set({ seed: (state.seed + 1) >>> 0 })}>New seeded draw</button></div>}
        </div>
        <div><label className="check-control"><input type="checkbox" disabled={!info.inRange} checked={overlay} onChange={e => setOverlay(e.target.checked)} />Show optional near-edge model</label><p className="muted">The overlay adds adjustable shapes. Detector counts still use tabulated data.</p>
          {overlay && <>{isBattery(state.sample) && state.sample.absorber === 'Mn' && state.sample.edge === 'K' ? <div>
            <Range label="Reference model edge" value={state.edge} min={6535} max={6570} step={.1} digits={1} unit="eV" onChange={edge => set({ edge })} />
            <Range label="Edge shift per lithium" value={state.shift} min={-10} max={10} step={.1} digits={1} unit="eV" onChange={shift => set({ shift })} />
            <Range label="Edge sharpness" value={state.width} min={.2} max={8} step={.1} digits={1} unit="eV" onChange={width => set({ width })} />
            <Range label="White-line height" value={state.whiteLine} min={0} max={300} unit="cm⁻¹" onChange={whiteLine => set({ whiteLine })} />
            <Range label="Pre-edge height" value={state.preEdge} min={0} max={100} unit="cm⁻¹" onChange={preEdge => set({ preEdge })} />
            <Range label="Ripples after the edge" value={state.oscillation} min={0} max={.3} step={.01} digits={2} onChange={oscillation => set({ oscillation })} />
          </div> : <Range label="Model edge shift" value={state.shift - 3} min={-13} max={7} step={.1} digits={1} unit="eV" onChange={v => set({ shift: v + 3 })} />}</>}
          <button className="button secondary" onClick={() => { addRun({ ...spectrum, id: crypto.randomUUID() }); notify('Curve saved in Spectra studio.'); }}>Save tabulated curve</button>
        </div>
      </div>
      {info.plan && <Disclosure title="Thickness calculation"><p>Target <Tex>{'\\Delta\\mu d = 1'}</Tex>; total <Tex>{'\\mu d \\le 3'}</Tex>. At the suggested thickness: edge step {info.plan.achievedEdgeStep.toFixed(3)}, total absorption {info.plan.totalAbsorptionAbove.toFixed(3)}.</p><p>Sample mass <Num>{info.plan.sampleMass_mg.toPrecision(4)}</Num> <Unit>mg</Unit> over {info.plan.pelletArea_cm2.toFixed(3)} <Unit>cm²</Unit>. <ScienceText>{info.plan.notes.join(' ')}</ScienceText></p></Disclosure>}
    </div></details>
  </>;
}
