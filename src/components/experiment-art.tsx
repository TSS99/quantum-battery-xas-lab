'use client';
import type { ReactNode } from 'react';
import { B, Beam, Box, Breadboard, Disc, IonChamber, K, P, Q, Shadow, YB, circleXZ, circleYZ, line, loop, pts } from './scene-kit';

/* Hardware illustrations for the experiment presets. They reuse the beamline's projection and materials;
   the curves on the screens are computed from the same formulas the lab uses. */
const VIEW = '-24 52 350 198';
const TEX_FONT = "KaTeX_Main, 'Latin Modern Roman', 'Times New Roman', serif";
const Art = ({ view = VIEW, children }: { view?: string; children: ReactNode }) => <svg className="exp-art" viewBox={view} aria-hidden="true" focusable="false">{children}</svg>;
const stub = (a: number, b: number, glow = 1) => <Beam d={`M${a} ${B - YB}H${b}`} glow={glow} flow={false} />;
const spot = (x: number) => { const [sx, sy] = P(x, YB, 0); return <ellipse cx={sx} cy={sy} rx={4} ry={5} fill="url(#bl-spot)" />; };
const Desk = () => <Box x0={-40} x1={360} y0={-10} y1={0} z0={-96} z1={80} front="url(#bl-dark)" top="#18202a" />;
/** Maps local screen coordinates (0..w, 0..h) onto a panel whose top edge sits at (yTop, zTop) and bottom at (yBot, zBot). */
const panel = (x0: number, x1: number, yTop: number, zTop: number, yBot: number, zBot: number, w: number, h: number) => {
  const [ax, ay] = P(x0, yTop, zTop), [bx, by] = P(x1, yTop, zTop), [cx, cy] = P(x0, yBot, zBot);
  return `matrix(${(bx - ax) / w} ${(by - ay) / w} ${(cx - ax) / h} ${(cy - ay) / h} ${ax} ${ay})`;
};
const path = (xs: number[], ys: number[]) => xs.map((x, i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join('');

function CoinCell() {
  const ions = [[-20, -10], [0, 12], [18, -4], [-6, -24], [26, 16], [-28, 14]];
  const label = (y: number, r: number, text: string) => { const [x0, y0] = P(140 + 1.08 * r, y, 0); return <g key={text}><path d={`M${x0 + 3} ${y0}H246`} stroke="#6b7a8c" strokeOpacity=".6" strokeDasharray="2 2" /><text x={250} y={y0 + 3} fill="#98a4b3" fontSize="9" fontFamily={TEX_FONT}>{text}</text></g>; };
  return <Art view="-10 84 350 198">
    <Breadboard x0={-10} x1={330} z0={-60} z1={60} depth={12} />
    <Shadow x={146} w={70} h={14} />
    <path d={line([140, 0, 0], [140, 112, 0])} stroke="#7fd8cf" strokeOpacity=".35" strokeDasharray="3 4" />
    <Disc x={140} y0={0} y1={9} r={48} />
    <path d={circleXZ(140, 9, 0, 42)} fill="#5f6a77" />
    <Disc x={140} y0={19} y1={20} r={38} top="#c9d1db" side="#8f99a5" />
    <Disc x={140} y0={20} y1={25} r={38} top="url(#bl-black-top)" side="#1d2126" />
    <Disc x={140} y0={35} y1={36} r={44} top="#e9eef3" side="#cfd6de" opacity={.72} />
    {ions.map(([dx, dz]) => <path key={dx} d={line([140 + dx, 47, dz], [140 + dx, 26, dz])} className="bl-li" />)}
    <Disc x={140} y0={47} y1={51} r={36} top="url(#bl-lithium-top)" side="#8f99a5" />
    <Disc x={140} y0={61} y1={63} r={40} />
    <path d={loop(t => [140 + 34 * Math.cos(t), 74 + 2.6 * Math.sin(3 * t), 34 * Math.sin(t)], 72)} fill="none" stroke="#a9b4c1" strokeWidth={3.2} />
    <Disc x={140} y0={85} y1={87} r={46} top="#22262b" side="#15181c" />
    <Disc x={140} y0={87} y1={96} r={46} />
    <path d={circleXZ(140, 96, 0, 40)} fill="none" stroke="#7a8796" strokeOpacity=".7" />
    {label(91, 46, 'cap and gasket')}{label(74, 36, 'spring')}{label(62, 40, 'spacer')}{label(49, 36, 'lithium metal')}{label(36, 44, 'separator')}{label(23, 38, 'cathode on Al foil')}{label(5, 48, 'case')}
    <text x={P(78, 38, 0)[0]} y={P(78, 38, 0)[1]} fill="#74dcaa" fontSize="10" fontFamily={TEX_FONT} fontStyle="italic">Li<tspan dy="-4" fontSize="7">+</tspan></text>
  </Art>;
}

function EdgeScan() {
  const transmitted = .45;
  return <Art>
    <Breadboard x0={-10} x1={310} z0={-46} z1={46} depth={12} />
    <Shadow x={58} w={44} /><Shadow x={150} w={22} /><Shadow x={246} w={52} />
    <Beam d={`M-30 ${B - YB}H146`} />
    <Beam d={`M154 ${B - YB}H330`} glow={transmitted} />
    <IonChamber id="art-edge-i0" x0={20} x1={95} y0={30} y1={102} z={26} beam={1} readout="100,000" />
    <Box x0={132} x1={168} y0={0} y1={8} z0={-20} z1={20} front="url(#bl-dark)" />
    <Box x0={147} x1={153} y0={8} y1={40} z0={-3} z1={3} />
    <Box x0={146} x1={154} y0={40} y1={92} z0={-14} z1={14} />
    <path d={circleYZ(154, YB, 0, 10)} fill="url(#bl-pellet)" />
    <IonChamber id="art-edge-it" x0={200} x1={292} y0={30} y1={102} z={26} beam={transmitted} readout="41,372" />
    {stub(95, 106)}{stub(154, 162, transmitted)}{stub(292, 303, transmitted)}{spot(154)}
  </Art>;
}

function PhotonCounting() {
  const lambda = 6, pmf = Array.from({ length: 14 }, (_, k) => { let p = Math.exp(-lambda); for (let i = 1; i <= k; i++) p *= lambda / i; return p; });
  const max = Math.max(...pmf), fx = 170 + K * -34, fy = B - 78 - Q * -34;
  const [ax, ay] = P(106, 111, 0), [bx, by] = P(186, 78, -14);
  return <Art>
    <Breadboard x0={-10} x1={320} z0={-46} z1={46} depth={12} />
    <Shadow x={70} w={52} /><Shadow x={240} w={76} />
    <Beam d={`M-30 ${B - YB}H330`} glow={.45} flowClass="bl-sparse" />
    <IonChamber id="art-count" x0={20} x1={120} y0={30} y1={102} z={26} beam={.3} readout="1,000" />
    {stub(120, 132, .45)}
    <Box x0={170} x1={305} y0={0} y1={78} z0={-34} z1={30} />
    <rect x={fx + 8} y={fy + 8} width={80} height={48} rx={2} fill="url(#bl-screen)" stroke="#2c3a46" />
    {pmf.map((p, k) => <rect key={k} x={fx + 12 + k * 5.4} y={fy + 52 - 38 * p / max} width={4.2} height={38 * p / max} fill="#74dcaa" opacity={.85} />)}
    <path d={`M${fx + 12 + lambda * 5.4 + 2.1} ${fy + 12}V${fy + 53}`} stroke="#ffc46b" strokeDasharray="2 2" />
    <rect x={fx + 94} y={fy + 9} width={34} height={13} rx={2} fill="#06130f" stroke="#2c3a46" />
    <text x={fx + 111} y={fy + 18.6} className="bl-lcd">1,012</text>
    {[100, 120].map(dx => <g key={dx}><circle cx={fx + dx} cy={fy + 38} r={6.5} fill="url(#bl-steel-top)" /><path d={`M${fx + dx} ${fy + 38}l3 -4.5`} stroke="#1c242d" strokeWidth={1.4} /></g>)}
    {[96, 107, 118, 129].map(dx => <circle key={dx} cx={fx + dx} cy={fy + 63} r={2.6} fill="#c8a24a" stroke="#6b5a2a" />)}
    <path d={`M${ax} ${ay}C${ax + 10} ${ay - 34} ${bx - 26} ${by - 30} ${bx} ${by}`} className="bl-cable" />
  </Art>;
}

/** Screen content: the dipole correlation C(t) and its spectrum for two transitions, as on the Quantum page. */
function CorrelationScreen() {
  const w = [.62, .38], om = [1.3, 2.9], eta = .06, t = Array.from({ length: 120 }, (_, i) => i * 40 / 119);
  const re = t.map(s => w.reduce((a, wn, n) => a + wn * Math.cos(om[n] * s), 0) * Math.exp(-eta * s));
  const im = t.map(s => -w.reduce((a, wn, n) => a + wn * Math.sin(om[n] * s), 0) * Math.exp(-eta * s));
  const e = Array.from({ length: 160 }, (_, i) => i * 4 / 159), hw = .14;
  const sp = e.map(x => w.reduce((a, wn, n) => a + wn * hw * hw / ((x - om[n]) ** 2 + hw * hw), 0));
  const X = (s: number) => 10 + s / 40 * 154, Xe = (x: number) => 10 + x / 4 * 154;
  return <g>
    <rect width={174} height={110} fill="url(#bl-screen)" />
    <rect width={174} height={7} fill="#151c24" /><circle cx={5} cy={3.5} r={1.4} fill="#ff8a8f" /><circle cx={9.5} cy={3.5} r={1.4} fill="#ffc46b" /><circle cx={14} cy={3.5} r={1.4} fill="#74dcaa" />
    <path d="M10 31H164M10 101H164" stroke="#35404d" strokeWidth={.6} />
    <path d={path(t.map(X), re.map(v => 31 - 18 * v))} fill="none" stroke="#c4ccd6" strokeWidth={1} />
    <path d={path(t.map(X), im.map(v => 31 - 18 * v))} fill="none" stroke="#74dcaa" strokeWidth={1} />
    <path d={path(e.map(Xe), sp.map(v => 101 - 40 * v))} fill="none" stroke="#ffc46b" strokeWidth={1.3} />
    {om.map((o, n) => <path key={o} d={`M${Xe(o)} 101V${101 - 40 * w[n]}`} stroke="#74dcaa" strokeDasharray="1.5 1.5" strokeWidth={.8} />)}
    <text x={12} y={16} fill="#98a4b3" fontSize="7" fontFamily={TEX_FONT} fontStyle="italic">C(t)</text>
    <text x={12} y={60} fill="#98a4b3" fontSize="7" fontFamily={TEX_FONT} fontStyle="italic">S(ω)</text>
  </g>;
}

function Laptop() {
  const keys: ReactNode[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 13; c++) keys.push(<rect key={r + '-' + c} x={74 + c * 12.6} y={-4 + r * 7.2} width={10.6} height={5.6} rx={1} fill="#1b222a" />);
  return <Art>
    <Desk />
    <Shadow x={160} y={0} z={-20} w={110} h={16} />
    <polygon points={pts([60, 6, 28], [250, 6, 28], [250, 128, 44], [60, 128, 44])} fill="#151b22" />
    <polygon points={pts([60, 6, 24], [250, 6, 24], [250, 128, 40], [60, 128, 40])} fill="url(#bl-bezel)" />
    <g transform={panel(68, 242, 122, 39.2, 12, 24.8, 174, 110)}><CorrelationScreen /></g>
    <polygon points={pts([68, 122, 39.2], [242, 122, 39.2], [242, 12, 24.8], [68, 12, 24.8])} fill="url(#bl-glass)" />
    <Box x0={60} x1={250} y0={0} y1={6} z0={-70} z1={24} front="url(#bl-dark)" top="#3a4552" side="#1e252e" />
    <g transform={`matrix(1 0 ${K} ${-Q} 0 ${B - 6})`}>{keys}<rect x={128} y={-62} width={54} height={34} rx={3} fill="#33404d" /></g>
  </Art>;
}

/** Screen content: one first-order product-formula step exactly as the Quantum page compiles it
    (Rz per Z term, CX-Rx-CX per XX term, Rx per X term), and the spectral error falling as 1/n. */
function CircuitScreen() {
  const wires = [24, 50, 76];
  const n = [1, 2, 4, 8, 16, 32], err = n.map(k => .5 / k);
  const lx = (k: number) => 168 + Math.log2(k) / 5 * 42, ly = (e: number) => 30 - Math.log10(e / .5) / 1.6 * 44;
  const gate = (x: number, y: number, name: string) => <g key={name + x + y}><rect x={x} y={y - 5.5} width={13} height={11} rx={1.5} fill="#1c2530" stroke="#c4ccd6" strokeWidth={.7} /><text x={x + 6.5} y={y + 2.2} fill="#c4ccd6" fontSize="6" textAnchor="middle" fontFamily={TEX_FONT}><tspan fontStyle="italic">R</tspan><tspan dy="1.5" fontSize="4.5" fontStyle="italic">{name}</tspan></text></g>;
  const cx = (x: number, c: number, t: number) => <g key={'cx' + x}><path d={`M${x} ${wires[c]}V${wires[t] + 4}`} stroke="#ffc46b" strokeWidth={.9} /><circle cx={x} cy={wires[c]} r={2} fill="#ffc46b" /><circle cx={x} cy={wires[t]} r={4} fill="none" stroke="#ffc46b" strokeWidth={.9} /><path d={`M${x - 4} ${wires[t]}h8`} stroke="#ffc46b" strokeWidth={.9} /></g>;
  return <g>
    <rect width={218} height={110} fill="url(#bl-screen)" />
    {wires.map((y, q) => <g key={y}><text x={4} y={y + 2.5} fill="#98a4b3" fontSize="7" fontFamily={TEX_FONT} fontStyle="italic">q<tspan dy="2" fontSize="5">{q}</tspan></text><path d={`M14 ${y}H150`} stroke="#6b7a8c" strokeWidth={.8} /></g>)}
    {wires.map(y => gate(19, y, 'z'))}
    {cx(42, 0, 1)}{gate(49, wires[0], 'x')}{cx(70, 0, 1)}
    {cx(80, 1, 2)}{gate(87, wires[1], 'x')}{cx(108, 1, 2)}
    {wires.map(y => gate(117, y, 'x'))}
    <rect x={14} y={12} width={124} height={76} rx={3} fill="none" stroke="#7fd8cf" strokeOpacity=".4" strokeDasharray="2 2" />
    <text x={141} y={17} fill="#7fd8cf" fontSize="7" fontFamily={TEX_FONT}>×<tspan fontStyle="italic">n</tspan></text>
    <text x={76} y={102} fill="#98a4b3" fontSize="7" fontFamily={TEX_FONT} textAnchor="middle">one step, repeated <tspan fontStyle="italic">n</tspan> times</text>
    <path d="M166 8V78H214" fill="none" stroke="#35404d" strokeWidth={.7} />
    <path d={path(n.map(lx), err.map(ly))} fill="none" stroke="#74dcaa" strokeWidth={1} />
    {n.map((k, i) => <circle key={k} cx={lx(k)} cy={ly(err[i])} r={1.6} fill="#74dcaa" />)}
    <text x={190} y={90} fill="#98a4b3" fontSize="7" fontFamily={TEX_FONT} fontStyle="italic" textAnchor="middle">n</text>
  </g>;
}

function Workstation() {
  const keys: ReactNode[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) keys.push(<rect key={r + '-' + c} x={94 + c * 8.6} y={-73 + r * 6.6} width={7} height={5} rx={1} fill="#1b222a" />);
  return <Art view="-24 36 350 198">
    <Desk />
    <Shadow x={155} y={0} z={0} w={60} h={10} /><Shadow x={155} y={0} z={-60} w={70} h={10} />
    <Box x0={125} x1={185} y0={0} y1={3} z0={-14} z1={26} top="url(#bl-steel-top)" />
    <Box x0={148} x1={162} y0={3} y1={52} z0={20} z1={26} />
    <Box x0={40} x1={270} y0={36} y1={160} z0={14} z1={20} front="url(#bl-bezel)" />
    <g transform={`translate(${40 + K * 14 + 6} ${B - 160 - Q * 14 + 7})`}><CircuitScreen /></g>
    <rect x={40 + K * 14 + 6} y={B - 160 - Q * 14 + 7} width={218} height={110} fill="url(#bl-glass)" />
    <Box x0={90} x1={220} y0={0} y1={4} z0={-78} z1={-46} front="url(#bl-dark)" top="#3a4552" side="#1e252e" />
    <g transform={`matrix(1 0 ${K} ${-Q} 0 ${B - 4})`}>{keys}</g>
    <Disc x={246} z={-60} y0={0} y1={5} r={7} top="#3a4552" side="#1e252e" />
  </Art>;
}

function SampleLadder() {
  const zs = [-48, -24, 0, 24, 48], shades = ['#5b6067', '#4a4f56', '#3a3e44', '#2b2e33', '#1d2024'], labels = ['0', '0.25', '0.5', '0.75', '1'];
  return <Art>
    <Breadboard x0={-10} x1={320} z0={-76} z1={76} depth={12} />
    <Shadow x={150} w={56} h={14} /><Shadow x={258} w={48} />
    <Beam d={`M-30 ${B - YB}H146`} />
    <Beam d={`M154 ${B - YB}H330`} glow={.5} />
    <Box x0={18} x1={30} y0={0} y1={YB - 10} z0={-5} z1={5} />
    <Box x0={10} x1={44} y0={YB - 12} y1={YB + 12} z0={-12} z1={12} front="url(#bl-tungsten)" />
    <Box x0={135} x1={165} y0={0} y1={8} z0={-70} z1={70} top="url(#bl-steel-top)" />
    <Box x0={138} x1={162} y0={8} y1={18} z0={-18} z1={18} />
    <Box x0={147} x1={153} y0={18} y1={32} z0={-3} z1={3} />
    <Box x0={146} x1={154} y0={32} y1={96} z0={-62} z1={62} />
    {zs.map((z, i) => <g key={z}><path d={circleYZ(154, YB, z, 11)} fill="#1c242d" /><path d={circleYZ(154, YB, z, 9)} fill={shades[i]} /></g>)}
    <g fill="#c4ccd6" fontFamily={TEX_FONT} textAnchor="middle">
      {zs.map((z, i) => { const [lx, ly] = P(154, 46, z); return <text key={z} x={lx} y={ly} fontSize="8">{labels[i]}</text>; })}
      <text x={P(154, 84, 0)[0]} y={P(154, 84, 0)[1]} fontSize="8" fontStyle="italic">x</text>
    </g>
    <IonChamber id="art-ladder-it" x0={214} x1={302} y0={30} y1={102} z={26} beam={.5} readout="38,905" />
    {stub(44, 52)}{stub(154, 162, .5)}{stub(302, 312, .5)}{spot(154)}
  </Art>;
}

export const EXPERIMENT_ART: Record<string, () => ReactNode> = {
  crystal: CoinCell, edge: EdgeScan, counts: PhotonCounting, quantum: Laptop, trotter: Workstation, series: SampleLadder,
};
