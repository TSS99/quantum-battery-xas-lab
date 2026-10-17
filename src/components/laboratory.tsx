'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLab } from './lab-context';
import { Disclosure, Metric, Panel, Range, TryThis } from './ui';
import { ActiveSpacePlan } from './active-space';
import { WorkflowRail } from './workflow';
import { Plot } from './plot';
import { nominalMnOxidation, scan, edgeEnergy } from '@/lib/xas';
import { isBattery } from '@/lib/sample';
import { SamplePicker, SampleSummary } from './sample-controls';
// Each module page loads only its own panel code; panels still render into the static HTML.
const Beamline = dynamic(() => import('./beamline-panel').then(m => m.Beamline));
const SpectraPanel = dynamic(() => import('./spectra-panel').then(m => m.SpectraPanel));
const QuantumPanel = dynamic(() => import('./quantum-panel').then(m => m.QuantumPanel));
const ExperimentPanel = dynamic(() => import('./research-panels').then(m => m.ExperimentPanel));
const ValidationPanel = dynamic(() => import('./research-panels').then(m => m.ValidationPanel));
const AtomicScene = dynamic(() => import('./atomic-scene'), { ssr: false, loading: () => <div className="atom-stage loading-stage">Loading the coordination model…</div> });

const moduleInfo: Record<string, [string, string, string]> = {
  crystal: ['Sample', 'Choose a material and the atom you want to probe.', 'Formula and density set atomic attenuation. Select an absorber and shell.'],
  beamline: ['XAS beamline', 'Scan the photon energy and watch the transmitted signal.', 'Iₜ = I₀ exp(−μd), where μ is the tabulated total attenuation and d is converted from μm to cm.'],
  spectra: ['Spectra studio', 'Save a curve, change the sample and compare. You can also import your own data.', 'Compare μ(E), edge estimates and residuals. Raw arrays stay unchanged.'],
  electronic: ['Electronic structure', 'See which empty states a core electron can reach.', 'K-edge sketch: electric-dipole Δl = ±1. Energies and mixing are schematic.'],
  quantum: ['Quantum dynamics', 'Kick the starting state, follow its motion and turn the signal into a spectrum.', 'D = X₀, ℏ = 1. Compare exact and first-order Trotter time evolution.'],
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
    <div className="chemistry-metrics"><Metric label="Mn oxidation" value={'+' + nominalMnOxidation(state.x).toFixed(2)} tone="violet-text" />{!compact && <Metric label="Share of Mn³⁺" value={(state.x * 100).toFixed(0)} unit="%" />}</div>
    <div className="fraction-bar" role="img" aria-label={Math.round(state.x * 100) + ' percent manganese three plus in the charge-balance model'}><span style={{ width: state.x * 100 + '%' }} /></div>
    {guide && <TryThis steps={['sample']} done={state.x === 1} research={<>vMn = 4 − x assumes Li⁺, O²⁻ and Mn³⁺/Mn⁴⁺ compensation. It is a formal oxidation state.</>}>{state.x === 1 ? 'At x = 1.00, Mn is +3.00 in this model. Each lithium brings one electron.' : 'Move lithium content to 1.00. Each lithium brings one electron, so Mn moves from +4 toward +3.'}</TryThis>}
  </div>;
}
function Overview() {
  const { state, set } = useLab();
  const curve = useMemo(() => scan(state), [state.x, state.edge, state.shift, state.width, state.whiteLine, state.preEdge, state.oscillation]);
  return <>
    <section className="hero">
      <div className="hero-copy"><h1>Explore X-ray absorption</h1><p>{state.expert ? 'Plan a sample, compare spectra or test time-domain quantum calculations.' : 'Choose a material and see how it absorbs X-rays.'}</p><Link className="button" href="/crystal/">Start with a sample</Link><p className="muted">Formulas can use any element from H to Cf. Calculations stay in your browser.</p></div>
      <div className="hero-demo">
        {isBattery(state.sample) ? <><h2>Add lithium and watch the edge shift</h2><ChemistryControls compact guide={false} /><Plot ghostKey={String(state.x)+':'+state.shift} edge={edgeEnergy(state)} height={220} series={[{ name: 'Mn teaching model', x: curve.energy_eV, y: curve.mu_cm_inv, color: '#b49cff' }]} cursor={edgeEnergy(state)} /><TryThis done={state.x === 1} research={<>E₀ = edge − shift·x = {edgeEnergy(state).toFixed(2)} eV. This is the battery worked example.</>}>{state.x === 1 ? 'The model edge moved to lower energy as Mn gained electrons.' : 'Move the lithium slider and follow the edge marker.'}</TryThis><p className="muted">These spectra are a teaching model, not measured data.</p></> : <><h2>Your current sample</h2><SampleSummary /><TryThis done={false} research={<>The selected {state.sample.absorber} {state.sample.edge} edge sets the beamline window.</>}>Open the beamline to scan this sample.</TryThis><Link className="button secondary" href="/beamline/">Open beamline</Link></>}
      </div>
    </section>
    <WorkflowRail/><div className="module-cards">{[
      { href: 'crystal', audience: 'Student', text: 'Learn how an absorption edge works.', expert: false },
      { href: 'quantum', audience: 'Researcher', text: 'Test time evolution against an exact result.', expert: true },
      { href: 'spectra', audience: 'Industry R&D', text: 'Import a spectrum and compare curves.', expert: true },
    ].map(c => <Link key={c.href} href={'/' + c.href + '/'} onClick={() => set({ expert: c.expert })} className="module-card"><h2>{c.audience}</h2><p>{c.text}</p></Link>)}</div>
  </>;
}
function Crystal() {
  const { state } = useLab();
  const battery = isBattery(state.sample);
  return <><div className={battery ? 'sample-layout' : 'sample-layout general-sample'}>
    <Panel title="Choose your sample"><SamplePicker guide={!battery} /></Panel>
    {battery && <Panel className="scene-panel" title="Battery worked example"><ChemistryControls /><AtomicScene /><p className="muted">MnO₆ is one Mn and its six oxygen neighbors, cut from a solid. Real crystals distort; this shape stays fixed.</p></Panel>}
  </div><div className="toolbar"><Link className="button" href="/beamline/">Continue to the beamline</Link><Link className="text-link" href="/electronic/">How core excitation works</Link></div>
    <details className="research-drawer" open={state.expert}><summary>Sample assumptions</summary><div className="drawer-body"><p>Formula and density set the tabulated atomic background. Structure, bonding and oxidation can change the real near-edge spectrum.</p>{battery && <p>The LiₓMnO₂ example assumes Mn carries all the charge. Oxygen redox, defects and phase changes are outside this model.</p>}<p>The anchor papers simulate the oxygen K-edge of an O-centred Li₄Mn₂O cluster from Li₂MnO₃. The MnO₆ sketch and Mn teaching curve here are separate examples. <Link href="/validation/">Read the research references</Link>.</p></div></details>
  </>;
}
function Electronic() {
  const { state } = useLab();
  const [transition, setTransition] = useState<'p' | 'd'>('p'), [mixing, setMixing] = useState(.35), [excited, setExcited] = useState(false);
  return <>
    <TryThis done={transition === 'd' && excited} research={<>1s → p: Δl = +1. Pure atomic 1s → 3d is dipole forbidden. This sketch does not calculate transition intensity.</>}>{transition === 'd' && excited ? 'The dashed circle marks the core hole. A d-like state needs mixing or another excitation channel.' : 'Select 1s → d-like character, then excite the electron.'}</TryThis>
    <Panel title="A K-edge excitation" className="orbital-panel">
      <div className="orbital-diagram" aria-label="Core electron and two possible excitation channels">
        <div className={'orbital-level ' + (excited && transition === 'p' ? 'occupied' : '')}><span>Empty p-like states</span><span className="level-line" /><button className="button secondary" aria-pressed={transition === 'p'} onClick={() => { setTransition('p'); setExcited(false); }}>↑ 1s → p character</button></div>
        <div className={'orbital-level ' + (excited && transition === 'd' ? 'occupied' : '')}><span>d-like states</span><span className="level-line dashed" /><button className="button secondary" aria-pressed={transition === 'd'} onClick={() => { setTransition('d'); setExcited(false); }}>↑ 1s → d-like character</button></div>
        <div className="orbital-core"><span className={excited ? 'electron-hole' : 'electron'} /><span className="electron" /><strong>1s core</strong></div>
      </div>
      <div className="toolbar primary-controls"><button className="button" onClick={() => setExcited(!excited)}>{excited ? 'Return electron to core' : 'Excite the electron'}</button><span aria-live="polite">{excited ? 'A core hole is left behind.' : transition === 'p' ? 'The dipole channel can reach p character.' : 'This channel is dipole forbidden on its own.'}</span></div>
      <p className="muted">Level spacing is a sketch. The core hole and electron interactions reshape real spectra.</p>
    </Panel>
    <details className="research-drawer" open={state.expert}><summary>Orbital mixing and the quantum model</summary><div className="drawer-body">
      <ActiveSpacePlan/><Range label="Conceptual oxygen mixing" value={mixing} min={0} max={1} step={.05} digits={2} onChange={setMixing} /><div className="character-dots">{Array.from({ length: 20 }, (_, i) => <i key={i} style={{ background: i < Math.round(mixing * 20) ? '#ff8a8f' : '#b49cff' }} />)}</div><p>O 2p share: {(mixing * 100).toFixed(0)}%. This only redraws the sketch.</p><p>In a solid, p–d mixing can give a d-like state some dipole intensity. Quadrupole transitions can also contribute.</p><p>D = X₀ in the quantum page is a simple substitute for the X-ray kick. It acts on a small spin system.</p><Link className="button secondary" href="/quantum/">Try time-domain spectroscopy</Link>
    </div></details>
  </>;
}
