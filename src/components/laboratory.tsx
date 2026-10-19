'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useLab } from './lab-context';
import { Num, Tex, Unit, formulaTex } from './tex';
import { Disclosure, Metric, Panel, Range, TryThis } from './ui';
import { ActiveSpacePlan } from './active-space';
import { WorkflowRail } from './workflow';
import { CtaBand, RevealText, StatementBand } from './landing';
import { Plot } from './plot';
import { OrbitalScene } from './orbital-scene';
import { nominalMnOxidation, scan, edgeEnergy } from '@/lib/xas';
import { isBattery } from '@/lib/sample';
import { SamplePicker, SampleSummary } from './sample-controls';
// Each module page loads only its own panel code; panels still render into the static HTML.
const Beamline = dynamic(() => import('./beamline-panel').then(m => m.Beamline));
const SpectraPanel = dynamic(() => import('./spectra-panel').then(m => m.SpectraPanel));
const QuantumPanel = dynamic(() => import('./quantum-panel').then(m => m.QuantumPanel));
const ExperimentPanel = dynamic(() => import('./research-panels').then(m => m.ExperimentPanel));
const ValidationPanel = dynamic(() => import('./research-panels').then(m => m.ValidationPanel));
const SamplePrepPanel = dynamic(() => import('./sample-prep-scene').then(m => m.SamplePrepPanel));
const AtomicScene = dynamic(() => import('./atomic-scene'), { ssr: false, loading: () => <div className="atom-stage loading-stage">Loading the coordination model…</div> });

const moduleInfo: Record<string, [string, string, ReactNode]> = {
  crystal: ['Sample', 'Choose a material and the atom you want to probe.', 'Formula and density set atomic attenuation. Select an absorber and shell.'],
  beamline: ['XAS beamline', 'Scan the photon energy and watch the transmitted signal.', <><Tex>{'I_t = I_0\\,e^{-\\mu d}'}</Tex>, where <Tex>{'\\mu'}</Tex> is the tabulated total attenuation and <Tex>{'d'}</Tex> is converted from <Unit>μm</Unit> to <Unit>cm</Unit>.</>],
  spectra: ['Spectra studio', 'Save a curve, change the sample and compare. You can also import your own data.', <>Compare <Tex>{'\\mu(E)'}</Tex>, edge estimates and residuals. Raw arrays stay unchanged.</>],
  electronic: ['Electronic structure', 'See which empty states a core electron can reach.', <>K-edge sketch: electric-dipole <Tex>{'\\Delta l = \\pm 1'}</Tex>. Energies and mixing are schematic.</>],
  quantum: ['Quantum dynamics', 'Kick the starting state, follow its motion and turn the signal into a spectrum.', <><Tex>{'D = X_0'}</Tex>, <Tex>{'\\hbar = 1'}</Tex>. Compare exact and first-order Trotter time evolution.</>],
  experiments: ['Experiments', 'Open an example or save your current work.', 'Save sample settings and curves. Quantum runs have a separate export.'],
  validation: ['Methods & validation', 'Check the calculations and see where each model applies.', 'Residuals test whether the code is self-consistent. Agreement with a real material needs measured data.'],
};
export function Laboratory({ module }: { module: string }) {
  const { state } = useLab();
  return <div className="page-content">{module !== 'home' && <div className="page-heading"><h1>{moduleInfo[module]?.[0]}</h1><p>{moduleInfo[module]?.[state.expert ? 2 : 1]}</p></div>}
    {module === 'home' ? <Overview /> : module === 'crystal' ? <Crystal /> : module === 'beamline' ? <Beamline /> : module === 'spectra' ? <SpectraPanel /> : module === 'electronic' ? <Electronic /> : module === 'quantum' ? <QuantumPanel /> : module === 'experiments' ? <ExperimentPanel /> : <ValidationPanel />}
  </div>;
}
export function ChemistryControls({ compact = false, guide = true }: { compact?: boolean; guide?: boolean }) {
  const { state, set } = useLab();
  if (!isBattery(state.sample)) return null;
  return <div className="chemistry-controls">
    <Range label="Lithium content" value={state.x} min={0} max={1} step={.01} digits={2} unit="x" onChange={x => set({ x })} />
    <div className="chemistry-metrics"><Metric label="Mn oxidation" value={'+' + nominalMnOxidation(state.x).toFixed(2)} tone="violet-text" />{!compact && <Metric label={<>Share of <Tex plain>{'\\mathrm{Mn^{3+}}'}</Tex></>} value={(state.x * 100).toFixed(0)} unit="%" />}</div>
    <div className="fraction-bar" role="img" aria-label={Math.round(state.x * 100) + ' percent manganese three plus in the charge-balance model'}><span style={{ width: state.x * 100 + '%' }} /></div>
    {guide && <TryThis steps={['sample']} done={state.x === 1} research={<><Tex>{'v_{\\mathrm{Mn}} = 4 - x'}</Tex> assumes <Tex plain>{'\\mathrm{Li^{+}}'}</Tex>, <Tex plain>{'\\mathrm{O^{2-}}'}</Tex> and <Tex plain>{'\\mathrm{Mn^{3+}}/\\mathrm{Mn^{4+}}'}</Tex> compensation. It is a formal oxidation state.</>}>{state.x === 1 ? <>At <Tex plain>{'x'}</Tex> = 1.00, Mn is +3.00 in this model. Each lithium brings one electron.</> : <>Move lithium content to 1.00. Each lithium brings one electron, so Mn moves from +4 toward +3.</>}</TryThis>}
  </div>;
}
function Overview() {
  const { state, set } = useLab();
  const curve = useMemo(() => scan(state), [state.x, state.edge, state.shift, state.width, state.whiteLine, state.preEdge, state.oscillation]);
  return <>
    <section className="landing-intro"><RevealText text="One lab for the whole XAS workflow" /><p>From choosing a sample to reading the spectrum, with tabulated data, live calculations and plain explanations for students, researchers and industry teams.</p></section>
    <section className="module-row">
      <div className="module-row-copy"><Link className="module-row-title" href="/crystal/">Live example<span className="row-chev" aria-hidden="true">›</span></Link><p>{state.expert ? 'Plan a sample, compare spectra or test time-domain quantum calculations.' : 'Choose a material and see how it absorbs X-rays. Formulas can use any element from H to Cf.'}</p></div>
      <div className="hero-demo">
        {isBattery(state.sample) ? <><h2>Add lithium and watch the edge shift</h2><ChemistryControls compact guide={false} /><Plot ghostKey={String(state.x)+':'+state.shift} edge={edgeEnergy(state)} height={220} series={[{ name: 'Mn teaching model', x: curve.energy_eV, y: curve.mu_cm_inv, color: '#b49cff' }]} cursor={edgeEnergy(state)} /><TryThis done={state.x === 1} research={<><Tex>{`E_0 = \\text{edge} - \\text{shift}\\cdot x = ${edgeEnergy(state).toFixed(2)}\\ \\text{eV}`}</Tex>. This is the battery worked example.</>}>{state.x === 1 ? 'The model edge moved to lower energy as Mn gained electrons.' : 'Move the lithium slider and follow the edge marker.'}</TryThis><p className="muted">These spectra are a teaching model, not measured data.</p></> : <><h2>Your current sample</h2><SampleSummary /><TryThis done={false} research={<>The selected {state.sample.absorber} <Tex plain>{formulaTex(state.sample.edge)}</Tex> edge sets the beamline window.</>}>Open the beamline to scan this sample.</TryThis><Link className="button secondary" href="/beamline/">Open beamline</Link></>}
      </div>
    </section>
    <section className="landing-section"><RevealText text="Start where you are" /><div className="module-cards">{[
      { href: 'crystal', audience: 'Student', text: 'Learn how an absorption edge works.', expert: false },
      { href: 'quantum', audience: 'Researcher', text: 'Test time evolution against an exact result.', expert: true },
      { href: 'spectra', audience: 'Industry R&D', text: 'Import a spectrum and compare curves.', expert: true },
    ].map(c => <Link key={c.href} href={'/' + c.href + '/'} onClick={() => set({ expert: c.expert })} className="module-card"><h2>{c.audience}</h2><p>{c.text}</p><span className="card-more">Open<span aria-hidden="true"> ›</span></span></Link>)}</div></section>
    <WorkflowRail/>
    <StatementBand text="Open source, private by design, and checked against the reference tools" />
    <CtaBand />
  </>;
}
function Crystal() {
  const { state } = useLab();
  const battery = isBattery(state.sample);
  return <><div className={battery ? 'sample-layout' : 'sample-layout general-sample'}>
    <Panel title="Choose your sample"><SamplePicker guide={!battery} /></Panel>
    {battery && <Panel className="scene-panel" title="Battery worked example"><ChemistryControls /><AtomicScene /><p className="muted"><Tex plain>{'\\mathrm{MnO_6}'}</Tex> is one Mn and its six oxygen neighbors, cut from a solid. Real crystals distort; this shape stays fixed.</p></Panel>}
    <SamplePrepPanel />
  </div><div className="toolbar"><Link className="button" href="/beamline/">Continue to the beamline</Link><Link className="text-link" href="/electronic/">How core excitation works</Link><Link className="text-link" href="/elements/">Edge energies of every element</Link></div>
    <details className="research-drawer" open={state.expert}><summary>Sample assumptions</summary><div className="drawer-body"><p>Formula and density set the tabulated atomic background. Structure, bonding and oxidation can change the real near-edge spectrum.</p>{battery && <p>The <Tex plain>{'\\mathrm{Li}_x\\mathrm{MnO_2}'}</Tex> example assumes Mn carries all the charge. Oxygen redox, defects and phase changes are outside this model.</p>}<p>The anchor papers simulate the oxygen K-edge of an O-centred <Tex plain>{'\\mathrm{Li_4Mn_2O}'}</Tex> cluster from <Tex plain>{'\\mathrm{Li_2MnO_3}'}</Tex>. The <Tex plain>{'\\mathrm{MnO_6}'}</Tex> sketch and Mn teaching curve here are separate examples. <Link href="/validation/">Read the research references</Link>.</p></div></details>
  </>;
}
function Electronic() {
  const { state } = useLab();
  const [transition, setTransition] = useState<'p' | 'd'>('p'), [mixing, setMixing] = useState(.35), [excited, setExcited] = useState(false);
  return <>
    <TryThis done={transition === 'd' && excited} research={<><Tex>{'\\mathrm{1s} \\to \\mathrm{p}'}</Tex>: <Tex>{'\\Delta l = +1'}</Tex>. Pure atomic <Tex>{'\\mathrm{1s} \\to \\mathrm{3d}'}</Tex> is dipole forbidden. This sketch does not calculate transition intensity.</>}>{transition === 'd' && excited ? 'The dashed circle marks the core hole. A d-like state needs mixing or another excitation channel.' : 'Select 1s → d-like character, then excite the electron.'}</TryThis>
    <Panel title="A K-edge excitation" className="orbital-panel">
      <OrbitalScene transition={transition} excited={excited} />
      <div className="orbital-channels" role="group" aria-label="Excitation channel">
        <button className="button secondary" aria-pressed={transition === 'p'} onClick={() => { setTransition('p'); setExcited(false); }}>↑ 1s → p character</button>
        <button className="button secondary" aria-pressed={transition === 'd'} onClick={() => { setTransition('d'); setExcited(false); }}>↑ 1s → d-like character</button>
      </div>
      <div className="toolbar primary-controls"><button className="button" onClick={() => setExcited(!excited)}>{excited ? 'Return electron to core' : 'Excite the electron'}</button><span aria-live="polite">{excited ? 'A core hole is left behind.' : transition === 'p' ? 'The dipole channel can reach p character.' : 'This channel is dipole forbidden on its own.'}</span></div>
    </Panel>
    <details className="research-drawer" open={state.expert}><summary>Orbital mixing and the quantum model</summary><div className="drawer-body">
      <ActiveSpacePlan/><Range label="Conceptual oxygen mixing" value={mixing} min={0} max={1} step={.05} digits={2} onChange={setMixing} /><div className="character-dots">{Array.from({ length: 20 }, (_, i) => <i key={i} style={{ background: i < Math.round(mixing * 20) ? '#ff8a8f' : '#b49cff' }} />)}</div><p><Tex plain>{'\\mathrm{O}\\ 2p'}</Tex> share: <Num>{(mixing * 100).toFixed(0) + '%'}</Num>. This only redraws the sketch.</p><p>In a solid, <Tex plain>{'p'}</Tex>–<Tex plain>{'d'}</Tex> mixing can give a <Tex plain>{'d'}</Tex>-like state some dipole intensity. Quadrupole transitions can also contribute.</p><p><Tex>{'D = X_0'}</Tex> in the quantum page is a simple substitute for the X-ray kick. It acts on a small spin system.</p><Link className="button secondary" href="/quantum/">Try time-domain spectroscopy</Link>
    </div></details>
  </>;
}
