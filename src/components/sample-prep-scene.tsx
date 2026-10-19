'use client';
import { useMemo, type ReactNode } from 'react';
import { useLab } from './lab-context';
import { useXrayData } from './sample-controls';
import { Num, ScienceText, Tex, Unit, formulaTex } from './tex';
import { Panel } from './ui';
import { B, Beam, Box, CylY, CylZ, Disc, P, SceneDefs, Shadow, YB, circleXZ, circleYZ, line, pts } from './scene-kit';
import { samplePlan, type Sample } from '@/lib/sample';
import { PELLET_MASS_MG, samplePreparation, type SamplePreparation } from '@/lib/sample-prep';

/* How the chosen sample is prepared for transmission, one small scene per step on the same bench.
   Heap sizes, pellet shade and the transmitted beam follow the plan; every number is in the HTML captions. */
const Bench = () => <Box x0={-60} x1={220} y0={-14} y1={0} z0={-50} z1={80} front="url(#bl-dark)" top="#1b232c" />;
const Art = ({ children }: { children: ReactNode }) => <svg className="prep-art" viewBox="-10 106 168 126" aria-hidden="true" focusable="false"><Bench />{children}</svg>;

const SAMPLE = [79, 85, 93], FILLER = [238, 241, 244];
/** Powder shade for a BN mass fraction f: the grey sample lightens as white filler is added. */
const shade = (f: number) => 'rgb(' + SAMPLE.map((v, i) => Math.round(v + (FILLER[i] - v) * .85 * f)).join(' ') + ')';
/** Heap half-width grows with the cube root of the mass, within limits that fit the vessel. */
const heap = (mg: number, max: number) => Math.min(max, Math.max(4, 3 + 2 * Math.cbrt(mg)));
/** A powder heap of half-width w resting on height y. */
function Mound({ x, y, z, w, fill }: { x: number; y: number; z: number; w: number; fill: string }) {
  const [cx, cy] = P(x, y, z), f = (n: number) => n.toFixed(1);
  return <path d={`M${f(cx - w)} ${f(cy)}Q${f(cx)} ${f(cy - 1.3 * w)} ${f(cx + w)} ${f(cy)}A${f(w)} ${f(.3 * w)} 0 0 1 ${f(cx - w)} ${f(cy)}Z`} fill={fill} stroke="rgb(0 0 0/.25)" strokeWidth={.5} />;
}
const Tweezers = ({ x, z }: { x: number; z: number }) => <g stroke="#c3ccd7" strokeWidth={1.3} strokeLinecap="round" fill="none">
  <path d={line([x, 1, z], [x + 36, 2.5, z + 12])} /><path d={line([x, 1, z], [x + 35, 2.5, z + 17])} />
</g>;

function Balance({ mass }: { mass: number }) {
  const [dx, dy] = P(25, 16, -26), w = heap(mass, 12);
  return <Art>
    <Shadow x={75} z={4} w={62} h={12} />
    <Box x0={25} x1={125} y0={0} y1={16} z0={-26} z1={34} />
    <rect x={dx + 8} y={dy + 4} width={30} height={9} rx={1.5} fill="#06130f" stroke="#2c3a46" />
    <path d={`M${dx + 12} ${dy + 8.5}h22`} stroke="#74dcaa" strokeOpacity={.45} strokeWidth={2} strokeDasharray="3 2" />
    {[78, 90].map(o => <rect key={o} x={dx + o} y={dy + 6} width={8} height={5} rx={1.5} fill="#3a4552" />)}
    <Disc x={75} z={4} y0={16} y1={18} r={22} />
    {/* Weighing boat: opening, floor, the sample, then the outer front and right faces. */}
    <polygon points={pts([54, 22, -15], [96, 22, -15], [96, 22, 25], [54, 22, 25])} fill="#9aa3ae" />
    <polygon points={pts([60, 18.2, -10], [90, 18.2, -10], [90, 18.2, 20], [60, 18.2, 20])} fill="#c3cad3" />
    <Mound x={75} y={18.7} z={7} w={w} fill={shade(0)} />
    <polygon points={pts([60, 18.2, -10], [90, 18.2, -10], [96, 22, -15], [54, 22, -15])} fill="#dfe4ea" />
    <polygon points={pts([90, 18.2, -10], [90, 18.2, 20], [96, 22, 25], [96, 22, -15])} fill="#b9c1cb" />
    <polyline points={pts([54, 22, -15], [96, 22, -15], [96, 22, 25])} fill="none" stroke="#fff" strokeOpacity={.5} strokeWidth={.6} />
    <path d={line([86, 21, 0], [126, 34, -16])} stroke="#c3ccd7" strokeWidth={1.6} strokeLinecap="round" />
    {/* Glass draft shield */}
    <g fill="url(#bl-glass)" stroke="#fff" strokeOpacity={.14} strokeWidth={.8}>
      <polygon points={pts([33, 80, -18], [117, 80, -18], [117, 80, 30], [33, 80, 30])} />
      <polygon points={pts([117, 18, -18], [117, 80, -18], [117, 80, 30], [117, 18, 30])} />
      <polygon points={pts([33, 18, -18], [117, 18, -18], [117, 80, -18], [33, 80, -18])} />
    </g>
  </Art>;
}

function Mortar({ filler, fraction }: { filler: number; fraction: number }) {
  const [cx, cy] = P(66, 30, 0), w = 1.0846 * 30, t = .1046 * 30, rim = circleXZ(66, 30, 0, 26);
  return <Art>
    <Shadow x={66} w={42} h={10} />
    <Disc x={66} y0={0} y1={5} r={17} top="#6e6157" side="url(#sp-agate)" />
    <path d={`M${cx - w} ${cy + t}C${cx - w} ${cy + t + 33} ${cx + w} ${cy - t + 33} ${cx + w} ${cy - t}Z`} fill="url(#sp-agate)" />
    <path d={`M${cx - w + 6} ${cy + 12}C${cx - 6} ${cy + 22} ${cx + 12} ${cy + 18} ${cx + w - 4} ${cy + 6}`} fill="none" stroke="#c8b8a8" strokeOpacity={.22} />
    <path d={circleXZ(66, 30, 0, 30)} fill="#a8988a" />
    <clipPath id="sp-bowl"><path d={rim} /></clipPath>
    <path d={rim} fill="#2a2420" />
    <path d={circleXZ(67, 25, 3, 19)} fill={shade(fraction)} clipPath="url(#sp-bowl)" />
    <path d={line([70, 24, 4], [104, 74, -10])} stroke="#7d6d60" strokeWidth={8} strokeLinecap="round" />
    <path d={line([73, 30, 4], [102, 72, -10])} stroke="#c8b8a8" strokeOpacity={.45} strokeWidth={2} strokeLinecap="round" />
    {filler > 0 && <g>
      <polygon points={pts([104, .4, -40], [146, .4, -40], [146, .4, -12], [104, .4, -12])} fill="#c9d0d8" />
      <Mound x={125} y={.5} z={-26} w={heap(filler, 11)} fill={`rgb(${FILLER.join(' ')})`} />
    </g>}
  </Art>;
}

function Press({ pellet }: { pellet: string }) {
  const [gx, gy] = P(28, 9, -24);
  return <Art>
    <Shadow x={74} w={58} h={11} />
    <Box x0={28} x1={120} y0={0} y1={18} z0={-24} z1={20} />
    <circle cx={gx + 13} cy={gy} r={6.5} fill="url(#bl-steel-top)" />
    <circle cx={gx + 13} cy={gy} r={5.2} fill="#e8ecf0" />
    {Array.from({ length: 7 }, (_, i) => { const a = (-210 + 40 * i) * Math.PI / 180; return <path key={i} d={`M${gx + 13 + 4.2 * Math.cos(a)} ${gy + 4.2 * Math.sin(a)}l${Math.cos(a)} ${Math.sin(a)}`} stroke="#38434f" strokeWidth={.6} />; })}
    <path d={`M${gx + 13} ${gy}l3 -2.6`} stroke="#c0392b" strokeWidth={.9} strokeLinecap="round" />
    <CylY x={40} y0={18} y1={86} r={3.6} /><CylY x={108} y0={18} y1={86} r={3.6} />
    <Disc x={74} y0={18} y1={21} r={17} />
    <Disc x={74} y0={21} y1={44} r={13} />
    <Disc x={74} y0={44} y1={56} r={5.4} top="#e3e8ee" />
    <Disc x={74} y0={56} y1={86} r={3.2} />
    <Box x0={30} x1={118} y0={86} y1={96} z0={-12} z1={12} />
    <Disc x={74} y0={96} y1={100} r={3.2} />
    <path d={line([56, 100, 0], [92, 100, 0])} stroke="#8796a8" strokeWidth={2.4} strokeLinecap="round" />
    <path d={line([116, 14, -6], [150, 40, -18])} stroke="#8796a8" strokeWidth={3} strokeLinecap="round" />
    <circle cx={P(150, 40, -18)[0]} cy={P(150, 40, -18)[1]} r={3.6} fill="#15181c" />
    {/* The finished pellet, out of the die */}
    <Shadow x={136} z={-24} w={12} h={4} />
    <Disc x={136} z={-24} y0={0} y1={2.2} r={9} top={pellet} side="#2a3038" />
  </Art>;
}

/** Sample holder across the beam; the insert sits on its downstream face at x = 84. */
function Holder({ glow, chamber = false, children }: { glow: number; chamber?: boolean; children: ReactNode }) {
  const [sx, sy] = P(85, YB, 0);
  return <Art>
    <Shadow x={80} w={30} h={8} />
    <Beam d={`M-20 ${B - YB}H76`} />
    <Box x0={66} x1={94} y0={0} y1={8} z0={-20} z1={20} />
    <Box x0={77} x1={83} y0={8} y1={36} z0={-4} z1={4} />
    <Box x0={76} x1={84} y0={36} y1={96} z0={-30} z1={30} />
    {children}
    <Beam d={`M85 ${B - YB}H170`} glow={glow} />
    <ellipse cx={sx} cy={sy} rx={3} ry={4} fill="url(#bl-spot)" />
    {chamber && <g>
      <path d={circleYZ(124, YB, 0, 7)} fill="#3a4654" />
      <CylY x={96} y0={100} y1={104} r={5} />
      <g fill="url(#bl-glass)" stroke="#fff" strokeOpacity={.14} strokeWidth={.8}>
        <polygon points={pts([46, 100, -42], [124, 100, -42], [124, 100, 30], [46, 100, 30])} />
        <polygon points={pts([124, 2, -42], [124, 100, -42], [124, 100, 30], [124, 2, 30])} />
        <polygon points={pts([46, 2, -42], [124, 2, -42], [124, 100, -42], [46, 100, -42])} />
      </g>
    </g>}
  </Art>;
}
const PelletInsert = ({ fill }: { fill: string }) => <g>
  <path d={circleYZ(84.1, YB, 0, 15)} fill="#0b1015" />
  <path d={circleYZ(84.4, YB, 0, 13.5)} fill="#2a3038" />
  <path d={circleYZ(85.6, YB, 0, 13.5)} fill={fill} />
  <path d={circleYZ(85.7, YB, 0, 13.5)} fill="url(#sp-sheen)" />
</g>;
const FoilInsert = () => <g>
  <polygon points={pts([84.4, 49, -17], [84.4, 83, -17], [84.4, 83, 17], [84.4, 49, 17])} fill="url(#bl-foil)" />
  {[78, 48].map(y => <polygon key={y} points={pts([84.6, y, -21], [84.6, y + 6, -21], [84.6, y + 6, 21], [84.6, y, 21])} fill="#d48a2c" opacity={.55} />)}
</g>;
const ChipInsert = ({ fill }: { fill: string }) => <g>
  <polygon points={pts([84.4, 54, -12], [84.4, 78, -12], [84.4, 78, 12], [84.4, 54, 12])} fill="url(#bl-si)" />
  <polygon points={pts([84.6, 61, -5], [84.6, 71, -5], [84.6, 71, 5], [84.6, 61, 5])} fill={fill} opacity={.85} />
</g>;

function Foil() {
  return <Art>
    <Shadow x={72} z={4} w={70} h={14} />
    <polygon points={pts([16, .6, -26], [106, .6, -26], [106, .6, 34], [16, .6, 34])} fill="url(#bl-foil)" />
    <CylZ x={108} y={11} z0={-26} z1={34} r={11} body="url(#bl-foil)" cap="#dfe5ec" />
    <circle cx={P(108, 11, -26)[0]} cy={P(108, 11, -26)[1]} r={4} fill="#8a6d4a" />
    <Tweezers x={30} z={-48} />
  </Art>;
}

function Chip({ fill }: { fill: string }) {
  return <Art>
    <Shadow x={74} z={2} w={64} h={14} />
    <Box x0={28} x1={118} y0={0} y1={4} z0={-40} z1={44} top="url(#bl-si)" front="#5a6b80" side="#3a4654" />
    <polygon points={pts([48, 4.05, -20], [98, 4.05, -20], [98, 4.05, 24], [48, 4.05, 24])} fill="#8195ab" />
    <polygon points={pts([58, 4.1, -11], [88, 4.1, -11], [88, 4.1, 15], [58, 4.1, 15])} fill={fill} opacity={.85} />
    <Tweezers x={114} z={-54} />
  </Art>;
}

/** Windows, then the spacer and liquid (or the gas body), pulled apart along the beam. */
function CellParts({ gas, pane }: { gas: boolean; pane: string }) {
  const glass = (x: number, r: number) => <g key={x}><path d={circleYZ(x, YB, 0, r + 6)} fill="#3a4654" /><path d={circleYZ(x + .6, YB, 0, r)} fill={pane} /></g>;
  return <Art>
    <path d={line([6, YB, 0], [150, YB, 0])} stroke="#7fd8cf" strokeOpacity={.35} strokeDasharray="3 4" />
    {gas ? <>
      <Shadow x={24} w={10} h={4} /><Shadow x={76} w={42} h={8} /><Shadow x={130} w={10} h={4} />
      {glass(18, 9)}
      <Box x0={42} x1={110} y0={YB - 16} y1={YB + 16} z0={-16} z1={16} />
      <path d={circleYZ(110, YB, 0, 9)} fill="#0b1015" />
      <CylY x={54} y0={YB + 16} y1={YB + 26} r={3.4} /><CylY x={96} y0={YB + 16} y1={YB + 26} r={3.4} />
      {glass(128, 9)}
    </> : <>
      {[34, 70, 106].map(x => <Shadow key={x} x={x} w={12} h={4} />)}
      {glass(34, 13)}
      <path d={circleYZ(70, YB, 0, 20)} fill="#56657a" />
      <path d={circleYZ(70.6, YB, 0, 14)} fill="url(#sp-liquid)" />
      {glass(106, 13)}
    </>}
  </Art>;
}

function CellInBeam({ gas, pane, glow }: { gas: boolean; pane: string; glow: number }) {
  const exit = gas ? 118 : 88;
  return <Art>
    {gas ? <>
      <Shadow x={49} w={10} h={4} /><Shadow x={103} w={10} h={4} />
      <Beam d={`M-20 ${B - YB}H34`} />
      <Box x0={46} x1={52} y0={0} y1={YB - 16} z0={-4} z1={4} /><Box x0={100} x1={106} y0={0} y1={YB - 16} z0={-4} z1={4} />
      <Box x0={34} x1={118} y0={YB - 16} y1={YB + 16} z0={-16} z1={16} />
      <CylY x={50} y0={YB + 16} y1={YB + 28} r={3.4} /><CylY x={102} y0={YB + 16} y1={YB + 28} r={3.4} />
      <path d={circleYZ(118, YB, 0, 10)} fill={pane} />
    </> : <>
      <Shadow x={80} w={30} h={8} />
      <Beam d={`M-20 ${B - YB}H70`} />
      <Box x0={62} x1={98} y0={0} y1={8} z0={-22} z1={22} />
      <Box x0={77} x1={83} y0={8} y1={34} z0={-4} z1={4} />
      <Box x0={70} x1={78} y0={34} y1={94} z0={-30} z1={30} />
      <Box x0={78} x1={80} y0={40} y1={88} z0={-24} z1={24} front="url(#sp-liquid)" top="#6fa8d6" side="url(#sp-liquid)" />
      <Box x0={80} x1={88} y0={34} y1={94} z0={-30} z1={30} />
      <CylY x={84} z={-18} y0={94} y1={100} r={2.4} /><CylY x={84} z={18} y0={94} y1={100} r={2.4} />
      <path d={circleYZ(88, YB, 0, 12)} fill={pane} />
    </>}
    <Beam d={`M${exit} ${B - YB}H170`} glow={glow} />
  </Art>;
}

const sig = (v: number) => v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toPrecision(3);
/** A value and its unit, kept on one line. */
const Quantity = ({ v, u }: { v: string; u: string }) => <span className="nowrap"><Num>{v}</Num> <Unit>{u}</Unit></span>;
const Mass = ({ mg }: { mg: number }) => <Quantity v={sig(mg)} u="mg" />;
const Length = ({ um }: { um: number }) => um >= 1000 ? <Quantity v={sig(um / 1000)} u="mm" /> : <Quantity v={sig(um)} u="μm" />;
const PerArea = ({ mg }: { mg: number }) => <Quantity v={sig(mg)} u="mg/cm²" />;

export function PrepSteps({ sample, prep, dilute }: { sample: Sample; prep: SamplePreparation; dilute: boolean }) {
  const { plan, form, soft } = prep, gas = prep.phase === 'gas';
  const diameter = <Quantity v={prep.diameter_mm.toFixed(0)} u="mm" />;
  const total = plan.totalAbsorptionWithDiluent, glow = .08 + .92 * Math.sqrt(Math.exp(-total));
  const filler = plan.diluent, fraction = filler ? filler.mass_mg / prep.pelletMass_mg : 0, pellet = shade(fraction);
  const film = shade(0), pane = soft ? 'url(#sp-membrane)' : 'url(#bl-kapton)';
  const edgeStep = plan.limitedBy === 'edge-step' ? <Tex>{'\\Delta\\mu d = 1'}</Tex> : <Tex>{`\\Delta\\mu d = ${plan.achievedEdgeStep.toFixed(2)}`}</Tex>;
  const totalTex = <Tex>{`\\mu d = ${total.toFixed(2)}`}</Tex>;
  const practical = 'Fluorescence or electron yield is usually more practical.';
  const steps: [string, ReactNode, ReactNode][] =
    form === 'pellet' ? [
      ['Weigh', <Balance mass={plan.sampleMass_mg} />, <><Mass mg={plan.sampleMass_mg} /> of sample in a weighing boat. {plan.limitedBy === 'edge-step' ? <>This gives an edge step <span className="nowrap">{edgeStep}.</span></> : <>Total absorption limits the edge step to <span className="nowrap">{edgeStep}.</span></>}</>],
      [filler ? 'Mix' : 'Grind', <Mortar filler={filler?.mass_mg ?? 0} fraction={fraction} />, filler
        ? <>Grind it with <Mass mg={filler.mass_mg} /> of boron nitride, <Tex plain>{formulaTex('BN')}</Tex>, a light filler, until the mixture is even.</>
        : <>Make it a fine, even powder in a mortar. Coarse grains and gaps distort the edge step.</>],
      ['Press', <Press pellet={pellet} />, <>A {diameter} die and press turn it into a <Mass mg={prep.pelletMass_mg} /> pellet.{prep.light && <> More filler would push total <Tex>{'\\mu d'}</Tex> past 3, so it is lighter than the usual <Mass mg={PELLET_MASS_MG} />. If it crumbles, spread the powder thinly on Kapton tape instead.</>}</>],
      ['Mount', <Holder glow={glow}><PelletInsert fill={pellet} /></Holder>, <>Fix the {diameter} pellet across the beam. As a dense layer the sample would be <Length um={plan.thickness_um} /> thick, <PerArea mg={plan.massPerArea_mg_cm2} />. Total <span className="nowrap">{totalTex}.</span></>],
    ] : form === 'foil' ? [
      ['Foil', <Foil />, <>Use a foil <Length um={plan.thickness_um} /> thick, <PerArea mg={plan.massPerArea_mg_cm2} />. Pinholes distort the edge step.</>],
      ['Mount', <Holder glow={glow}><FoilInsert /></Holder>, <>Tape it flat across the holder opening. Edge step {edgeStep}, total <span className="nowrap">{totalTex}.</span></>],
    ] : form === 'film' ? [
      ['Film', <Chip fill={film} />, <>Make an even film <Length um={plan.thickness_um} /> thick, <PerArea mg={plan.massPerArea_mg_cm2} />, on a thin membrane.</>],
      ['Vacuum', <Holder glow={glow} chamber><ChipInsert fill={film} /></Holder>, <>Air absorbs soft X-rays, so the film is measured in vacuum. Transmission is hard here: the film must be even and free of pinholes, on a membrane that passes soft X-rays. {practical}</>],
    ] : [
      ['Cell', <CellParts gas={gas} pane={pane} />, gas
        ? <>Fill a cell <Length um={plan.thickness_um} /> long at <Quantity v={String(sample.density)} u="g/cm³" />.</>
        : <>Hold a layer <Length um={plan.thickness_um} /> thick between two windows.</>],
      ['Mount', <CellInBeam gas={gas} pane={pane} glow={glow} />, soft
        ? <>The windows must be thin enough to pass soft X-rays, and the rest of the beam path is in vacuum.{!gas && <> Transmission is hard here. {practical}</>}</>
        : <>The beam crosses both windows and the {gas ? 'gas' : 'liquid'}. Edge step {edgeStep}, total <span className="nowrap">{totalTex}.</span></>],
    ];
  const intro = form === 'pellet' ? 'A pressed pellet' : form === 'foil' ? 'A metal foil' : form === 'film' ? 'A thin film' : gas ? 'A gas cell' : 'A liquid cell';
  return <>
    <p className="muted">{intro} of <Tex plain>{formulaTex(sample.formula)}</Tex> for transmission at the {sample.absorber} <Tex plain>{formulaTex(sample.edge)}</Tex> edge.</p>
    <svg className="scene-defs" aria-hidden="true" focusable="false"><SceneDefs /><defs>
      <linearGradient id="sp-agate" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8f7f70" /><stop offset=".55" stopColor="#5f5249" /><stop offset="1" stopColor="#2f2925" /></linearGradient>
      <linearGradient id="sp-liquid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9cc5e8" stopOpacity=".75" /><stop offset="1" stopColor="#3f78b0" stopOpacity=".85" /></linearGradient>
      <linearGradient id="sp-membrane" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e6cf8f" stopOpacity=".8" /><stop offset="1" stopColor="#9c7d3c" stopOpacity=".8" /></linearGradient>
      <radialGradient id="sp-sheen" cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
    </defs></svg>
    <ol className="prep-steps">{steps.map(([title, art, text]) => <li key={title}>{art}<strong>{title}</strong> {text}</li>)}</ol>
    <p className="beam-note">Not to scale. The plan aims for an edge step <Tex>{'\\Delta\\mu d = 1'}</Tex> with total <Tex>{'\\mu d \\le 3'}</Tex> just above the edge, from tabulated atomic data.
      {form === 'pellet' && <> About <Mass mg={PELLET_MASS_MG} /> is a common total for a {diameter} pellet. A pressed pellet is thicker than the dense layer because it is porous and holds filler; its mass per area sets the edge step.</>}
      {gas && ' The path scales inversely with gas density: halving the pressure doubles it.'}
      {dilute && !soft && ' The absorber is too dilute for a good transmission edge step. Fluorescence is likely the better choice.'}</p>
  </>;
}

export function SamplePrepPanel() {
  const { state } = useLab(), { ready, error } = useXrayData();
  const result = useMemo(() => {
    if (!ready) return null;
    try { const info = samplePlan(state.sample); return { info, prep: samplePreparation(state.sample, info) }; }
    catch { return null; }
  }, [ready, state.sample]);
  if (error || (ready && !result)) return null;
  return <Panel className="prep-panel" title="Prepare the sample">
    {!result ? <p className="muted">Loading tabulated X-ray data.</p>
      : result.prep ? <PrepSteps sample={state.sample} prep={result.prep} dilute={result.info.mode?.mode === 'fluorescence'} />
      : <p className="muted"><ScienceText>{result.info.note}</ScienceText></p>}
  </Panel>;
}
