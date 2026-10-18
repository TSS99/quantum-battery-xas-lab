'use client';
import { useEffect, useRef, useState } from 'react';
import { Num, Tex, Unit, formulaTex } from './tex';
import { B, Beam, Box, CylY, CylZ, IonChamber, K, P, Q, SceneDefs, YB, circleYZ, line, pts, type V3 } from './scene-kit';

/* A transmission XAS beamline drawn in cabinet projection: X runs along the beam, Y is up, Z is depth.
   Geometry is schematic (not to scale); the monochromator angle, counts and absorption are live values. */

const HC = 12398.42, SI111_2D = 2 * 3.1356; // eV·Å; Si(111) lattice spacing doubled, Å
const YB0 = 46; // beam height before the fixed-exit monochromator; YB is after it
const XS = 552; // sample position along the beam

function Badge({ n, x, y, tx, ty }: { n: number; x: number; y: number; tx: number; ty: number }) {
  return <g className="bl-badge"><path d={`M${x} ${y + 10}L${tx} ${ty}`} /><circle cx={x} cy={y} r={10} /><text x={x} y={y + 4.2}>{n}</text></g>;
}

export interface BeamSceneProps { energy: number; edgeEnergy: number; transmittance: number; incident: number; transmitted: number; thickness: number; scanning: boolean; formula: string; absorber: string; edge: string }

export function BeamScene({ energy, edgeEnergy, transmittance, incident, transmitted, thickness, scanning, formula, absorber, edge }: BeamSceneProps) {
  const scroller = useRef<HTMLDivElement>(null), [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    let centred = false;
    const check = () => { const s = el.scrollWidth > el.clientWidth + 1; setScrolls(s); if (s && !centred) { el.scrollLeft = (XS / 940) * el.scrollWidth - el.clientWidth / 2; centred = true; } };
    const observer = new ResizeObserver(check); observer.observe(el); return () => observer.disconnect();
  }, []);

  const crystal = energy >= 2100;
  const theta = crystal ? Math.asin(Math.min(1, HC / energy / SI111_2D)) * 180 / Math.PI : 0;
  const tv = (crystal ? Math.max(7, Math.min(40, theta)) : 9) * Math.PI / 180;
  const c1: [number, number] = [258, YB0], c2: [number, number] = [258 + (YB - YB0) / Math.tan(2 * tv), YB];
  const u = [Math.cos(tv), Math.sin(tv)], n = [-Math.sin(tv), Math.cos(tv)], L = 15;
  const slab = (c: [number, number], side: number, z: number): V3[] => [[c[0] - u[0] * L, c[1] - u[1] * L, z], [c[0] + u[0] * L, c[1] + u[1] * L, z], [c[0] + u[0] * L + side * n[0] * 8, c[1] + u[1] * L + side * n[1] * 8, z], [c[0] - u[0] * L + side * n[0] * 8, c[1] - u[1] * L + side * n[1] * 8, z]];
  const surface = (c: [number, number], off: number): V3[] => [[c[0] - u[0] * L + off * n[0], c[1] - u[1] * L + off * n[1], -12], [c[0] + u[0] * L + off * n[0], c[1] + u[1] * L + off * n[1], -12], [c[0] + u[0] * L + off * n[0], c[1] + u[1] * L + off * n[1], 12], [c[0] - u[0] * L + off * n[0], c[1] - u[1] * L + off * n[1], 12]];

  const above = energy >= edgeEnergy;
  const glow = transmittance < 1e-6 ? 0 : .08 + .92 * Math.sqrt(Math.max(0, Math.min(1, transmittance)));
  const pellet = Math.max(.6, Math.min(9, 2.2 * Math.log10(1 + thickness))), layers = Math.max(2, Math.ceil(pellet / .7));
  const [sx, sy] = P(556 + pellet, YB, 0), [nx, ny] = P(XS, YB, 38);
  const wiggle = 'M' + Array.from({ length: 125 }, (_, i) => { const x = i * 1.25, z = x < 26 ? 0 : 6 * Math.sin(2 * Math.PI * (x - 26) / 20.67); return P(x, YB0, z).map(v => v.toFixed(1)).join(','); }).join('L');
  const bend = line([155, YB0, 0], [162, YB0, 3], [168, YB0, 12], [173, YB0, 26], [177, YB0, 42], [180, YB0, 58]);
  const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
  const absorbed = (1 - transmittance) * 100, edgeName = <>{absorber} <Tex plain>{formulaTex(edge)}</Tex> edge (<Num>{edgeEnergy.toFixed(1)}</Num> <Unit>eV</Unit>)</>;
  const label = `Beamline drawing. The monochromator passes ${energy.toFixed(1)} eV and ${(transmittance * 100).toFixed(1)}% of the photons reach detector 2.`;

  return <div className={'beam-graphic' + (scanning ? ' scanning' : '')}>
    <div className="beam-scroll" ref={scroller} tabIndex={scrolls ? 0 : undefined} role={scrolls ? 'region' : undefined} aria-label={scrolls ? 'Beamline drawing, scrolls sideways' : undefined}>
      <svg viewBox="0 16 940 312" role="img" aria-label={label}>
        <SceneDefs />

        {/* Hutch floor and back wall */}
        <polygon points={pts([-200, -90, 200], [1200, -90, 200], [1200, -90, -220], [-200, -90, -220])} fill="url(#bl-floor)" />
        <path d={Array.from({ length: 12 }, (_, i) => line([-120 + i * 110, -90, 200], [-120 + i * 110 - 160, -90, -220])).join('') + [100, 0, -100].map(z => line([-200, -90, z], [1200, -90, z])).join('')} stroke="#fff" strokeOpacity=".035" />
        <path d={Array.from({ length: 9 }, (_, i) => line([i * 120, -90, 200], [i * 120, 300, 200])).join('')} stroke="#fff" strokeOpacity=".025" />
        {[[88, -86, 60], [298, -86, 80], [400, -90, 30], [648, -90, 30], [888, -90, 30]].map(([x, y, w]) => { const [cx, cy] = P(x, y, x > 380 ? -46 : 0); return <ellipse key={x} cx={cx + 6} cy={cy + 2} rx={w} ry={9} fill="url(#bl-shadow)" />; })}

        {/* Stands that sit on the floor behind the optical table */}
        <Box x0={44} x1={132} y0={-86} y1={YB0 - 34} z0={-14} z1={14} front="url(#bl-granite)" />
        <Box x0={246} x1={350} y0={-86} y1={0} z0={-30} z1={30} front="url(#bl-granite)" />

        {/* Optical breadboard */}
        {[[392, -54], [640, -54], [880, -54]].map(([x, z]) => <Box key={x} x0={x} x1={x + 18} y0={-90} y1={-20} z0={z} z1={z + 16} front="url(#bl-dark)" />)}
        <Box x0={384} x1={905} y0={-20} y1={0} z0={-64} z1={64} front="url(#bl-dark)" top="#1b232c" />
        <rect transform={`matrix(1 0 ${K} ${-Q} 0 ${B})`} x={384} y={-64} width={521} height={128} fill="url(#bl-holes)" />
        <path d={line([384, 0, -64], [905, 0, -64])} stroke="#7a8a9e" strokeOpacity=".5" />
        {[[460, 60], [XS, 46], [688, 66], [820, 50]].map(([x, w]) => <ellipse key={x} cx={x + 4} cy={B + 4} rx={w} ry={12} fill="url(#bl-shadow)" />)}

        {/* Source: electrons wiggle through an insertion device; a dipole bends them back into the ring */}
        <Box x0={22} x1={154} y0={2} y1={90} z0={16} z1={24} front="url(#bl-dark)" />
        <Box x0={26} x1={150} y0={YB0 - 33} y1={YB0 - 11} z0={-16} z1={16} />
        <Box x0={158} x1={184} y0={YB0 - 19} y1={YB0 + 19} z0={50} z1={56} front="#2b4563" top="#3d5f86" side="#22384f" />
        <Box x0={158} x1={184} y0={YB0 - 19} y1={YB0 - 5} z0={22} z1={50} front="#35577d" top="#4a74a3" side="#29445f" />
        <path d={wiggle} className="bl-path" /><path d={bend} className="bl-path" />
        <path d={wiggle + bend.replace('M', 'L')} className="bl-electrons" />
        <Beam d={`M30 ${B - YB0}H150`} color="url(#bl-white)" core="url(#bl-white)" flow={false} />
        <Beam d={`M150 ${B - YB0}H258`} color="#f4f1ea" core="#ffffff" />
        <Box x0={26} x1={150} y0={YB0 + 11} y1={YB0 + 33} z0={-16} z1={16} />
        {Array.from({ length: 12 }, (_, i) => <g key={i}>
          <rect x={26 + i * 124 / 12 + K * -16} y={B - (YB0 + 33) + 4.32} width={124 / 12 - 1} height={22} fill={i % 2 ? '#4a77a8' : '#b8545a'} opacity=".85" />
          <rect x={26 + i * 124 / 12 + K * -16} y={B - (YB0 - 11) + 4.32} width={124 / 12 - 1} height={22} fill={i % 2 ? '#b8545a' : '#4a77a8'} opacity=".85" />
        </g>)}
        <Box x0={158} x1={184} y0={YB0 + 5} y1={YB0 + 19} z0={22} z1={50} front="#35577d" top="#4a74a3" side="#29445f" />
        {/* Front-end vacuum pipe with flanges */}
        <rect x={172} y={B - YB0 - 8.3} width={60} height={16.6} fill="url(#bl-pipe)" />
        {[172, 200].map(x => <g key={x}><rect x={x} y={B - YB0 - 13.5} width={5} height={27} fill="url(#bl-pipe)" /><path d={circleYZ(x + 5, YB0, 0, 13)} fill="#4a5869" /><path d={circleYZ(x + 5, YB0, 0, 8.3)} fill="#2c3541" />{[0, 1, 2, 3, 4, 5].map(i => <path key={i} d={circleYZ(x + 5, YB0 + 10.6 * Math.sin(i * Math.PI / 3), 10.6 * Math.cos(i * Math.PI / 3), 1)} fill="#9aa8b8" />)}</g>)}

        {/* Double-crystal monochromator, front wall cut away */}
        <Box x0={232} x1={362} y0={0} y1={108} z0={-40} z1={40} />
        <clipPath id="bl-dcm"><rect x={240 + K * -40} y={B - 100 - Q * -40} width={114} height={74} rx={4} /></clipPath>
        <g clipPath="url(#bl-dcm)">
          <rect x={230} y={B - 120} width={150} height={120} fill="#0c1116" />
          <polygon points={pts([236, 4, -40], [358, 4, -40], [358, 4, 40], [236, 4, 40])} fill="#18202a" />
          <polygon points={pts([236, 4, -40], [236, 104, -40], [236, 104, 40], [236, 4, 40])} fill="#141b23" />
          <rect x={236 + K * 40} y={B - 104 - Q * 40} width={122} height={100} fill="#10161d" />
          <path d={line([c1[0] - 4, c1[1] - 10, 0], [c1[0] - 4, 104, 0]) + line([c1[0] + 4, c1[1] - 10, 0], [c1[0] + 4, 104, 0])} stroke="#c27c4e" strokeWidth={2.2} fill="none" />
          <Box x0={c1[0] - 10} x1={c1[0] + 10} y0={4} y1={c1[1] - 12} z0={-12} z1={12} front="url(#bl-dark)" />
          <polygon points={pts(...surface(c1, 0))} fill="url(#bl-si)" />
          {!crystal && <polygon points={pts(...surface(c1, 0))} fill="url(#bl-ruling)" />}
          <polygon points={pts(...slab(c1, -1, -12))} fill="#6c7f94" />
          <Beam d={`M232 ${B - YB0}H${c1[0]}`} color="#f4f1ea" core="#ffffff" />
          <Beam d={`M${c1[0]} ${B - c1[1]}L${c2[0]} ${B - c2[1]}L380 ${B - YB}`} color="#ffc46b" core="#fff1d6" />
          <polygon points={pts(...surface(c2, 8))} fill="#56657a" />
          <polygon points={pts(...slab(c2, 1, -12))} fill="#7d90a6" />
          <path d={line([c2[0], c2[1] + 10, 0], [c2[0], 104, 0])} stroke="#6b7a8c" strokeWidth={4} />
        </g>
        <path fillRule="evenodd" fill="url(#bl-front)" d={`M${232 + K * -40} ${B - 108 - Q * -40}h130v108h-130z M${240 + K * -40 + 4} ${B - 100 - Q * -40}h106a4 4 0 0 1 4 4v66a4 4 0 0 1 -4 4h-106a4 4 0 0 1 -4 -4v-66a4 4 0 0 1 4 -4z`} />
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <circle key={i} cx={232 + K * -40 + 6 + i * 16.9} cy={B - 104 - Q * -40} r={1.4} fill="#8796a8" />)}
        <rect x={296 + K * -40} y={B - 22 - Q * -40} width={58} height={14} rx={2} fill="#06130f" stroke="#2c3a46" />
        <text x={325 + K * -40} y={B - 12 - Q * -40} className="bl-lcd">{energy.toFixed(1)} eV</text>
        <text x={244 + K * -40} y={B - 12 - Q * -40} className="bl-plate">{crystal ? 'Si(111)' : 'PGM'}</text>
        <path d={circleYZ(362, YB, 0, 12)} fill="#3e4a58" /><path d={circleYZ(362, YB, 0, 6)} fill="#0c1116" />
        <CylY x={258} y0={108} y1={120} r={9} />

        {/* Slits */}
        <Box x0={384} x1={404} y0={0} y1={6} z0={-16} z1={16} front="url(#bl-dark)" />
        <Box x0={390} x1={398} y0={6} y1={YB - 24} z0={-5} z1={5} />
        <Box x0={388} x1={400} y0={YB - 24} y1={YB - 6} z0={-14} z1={14} front="url(#bl-tungsten)" />

        {/* Beam from the monochromator to the end of the table; it fades after the sample */}
        <Beam d={`M362 ${B - YB}H556`} color="#ffc46b" core="#fff1d6" />
        <Beam d={`M${556 + pellet} ${B - YB}H880`} color="#ffc46b" core="#fff1d6" glow={glow} />

        <Box x0={388} x1={400} y0={YB + 6} y1={YB + 24} z0={-14} z1={14} front="url(#bl-tungsten)" />
        <Box x0={389} x1={399} y0={YB + 24} y1={YB + 32} z0={-8} z1={8} front="url(#bl-dark)" />

        <IonChamber id="bl-i0" x0={420} x1={500} y0={30} y1={102} z={30} beam={1} readout={fmt(incident)} />

        {/* Fluorescence detector behind the sample, at 90 degrees to the beam */}
        <Box x0={XS - 6} x1={XS + 6} y0={0} y1={YB - 14} z0={86} z1={96} front="url(#bl-dark)" />
        <CylZ x={XS} y={YB} z0={64} z1={124} r={14} />
        <CylZ x={XS} y={YB} z0={38} z1={64} r={6.5} />
        <circle cx={nx} cy={ny} r={4} fill="#151b22" stroke={above ? '#74dcaa' : '#6b7a8c'} strokeWidth={1.2} strokeOpacity={above ? .95 : .5} />

        {/* Sample on a motorised stage */}
        <Box x0={XS - 24} x1={XS + 24} y0={0} y1={8} z0={-26} z1={26} front="url(#bl-dark)" />
        <Box x0={XS - 18} x1={XS + 18} y0={8} y1={16} z0={-20} z1={20} />
        <Box x0={XS - 3} x1={XS + 3} y0={16} y1={40} z0={-4} z1={4} />
        <Box x0={XS - 4} x1={XS + 4} y0={40} y1={92} z0={-16} z1={16} />
        {Array.from({ length: layers }, (_, i) => <path key={i} d={circleYZ(556 + pellet * i / (layers - 1), YB, 0, 11)} fill={i === layers - 1 ? 'url(#bl-pellet)' : '#2a2e33'} />)}
        {above && <circle cx={sx} cy={sy} r={16} fill="url(#bl-fluor)" />}
        <ellipse cx={sx} cy={sy} rx={5} ry={6} fill="url(#bl-spot)" />

        <IonChamber id="bl-it" x0={630} x1={745} y0={30} y1={102} z={30} beam={glow} readout={fmt(transmitted)} />

        {/* Reference foil and third chamber */}
        <Box x0={760} x1={770} y0={0} y1={34} z0={-4} z1={4} />
        <Box x0={762} x1={767} y0={34} y1={92} z0={-18} z1={18} />
        <polygon points={pts([767, 56, -10], [767, 76, -10], [767, 76, 10], [767, 56, 10])} fill="url(#bl-foil)" />
        <IonChamber id="bl-ir" x0={790} x1={848} y0={38} y1={94} z={24} beam={glow} />
        <Box x0={877} x1={885} y0={0} y1={50} z0={-4} z1={4} />
        <Box x0={872} x1={892} y0={50} y1={82} z0={-12} z1={12} front="url(#bl-tungsten)" />

        {/* Beam stubs leaving each exit window, drawn over the side faces they pass in front of */}
        {[[362, 380], [500, 514], [556 + pellet, 568], [745, 758], [767, 776], [848, 860]].map(([a, b], i) => <Beam key={a} d={`M${a} ${B - YB}H${b}`} color="#ffc46b" core="#fff1d6" glow={i < 2 ? 1 : glow} flow={false} />)}
        {above && <g className="bl-fluor-rays" stroke="#74dcaa" strokeLinecap="round">
          {[-150, -115, -70, 65, 105, 140, 170, -25].map(a => <path key={a} d={`M${sx} ${sy}l${(26 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(-26 * Math.sin(a * Math.PI / 180)).toFixed(1)}`} strokeWidth={1.4} opacity={.7} />)}
          <path d={`M${sx} ${sy}L${nx} ${ny}`} strokeWidth={2.2} />
        </g>}

        <Badge n={1} x={88} y={40} tx={88} ty={B - YB0 - 40} />
        <Badge n={2} x={297} y={40} tx={297} ty={B - 108 - 8} />
        <Badge n={3} x={448} y={40} tx={460} ty={B - 102 - 8} />
        <Badge n={4} x={520} y={52} tx={XS - 2} ty={B - 92 - 6} />
        <Badge n={5} x={606} y={52} tx={P(XS, YB + 14, 100)[0]} ty={P(XS, YB + 14, 100)[1]} />
        <Badge n={6} x={688} y={40} tx={688} ty={B - 102 - 8} />
        <Badge n={7} x={810} y={40} tx={810} ty={B - 94 - 6} />
      </svg>
    </div>
    <ol className="beam-legend">
      <li><strong>Source</strong>Electrons weave through alternating magnets and give off a white X-ray beam.</li>
      <li><strong>Monochromator</strong>{crystal ? <><Tex plain>{'\\mathrm{Si}(111)'}</Tex> crystals at a Bragg angle of <Tex plain>{`\\theta = ${theta.toFixed(2)}^\\circ`}</Tex> pass <Num>{energy.toFixed(1)}</Num> <Unit>eV</Unit>.</> : <>A ruled grating picks out <Num>{energy.toFixed(1)}</Num> <Unit>eV</Unit>, all in vacuum.</>}</li>
      <li><strong><Tex plain>{'I_0'}</Tex> · detector 1</strong>{crystal ? 'Ion chamber' : 'Gold mesh'} counting photons in: <Num>{fmt(incident)}</Num>.</li>
      <li><strong>Sample</strong><Tex plain>{formulaTex(formula)}</Tex>, <Num>{thickness.toFixed(thickness < 1 ? 4 : 2)}</Num> <Unit>μm</Unit>, absorbs {absorbed > 99.95 && 'over '}<Num>{(absorbed > 99.95 ? '99.9' : absorbed.toFixed(1)) + '%'}</Num>.</li>
      <li><strong>Fluorescence detector</strong>{above ? <>Above the {edgeName} the sample emits its own X-rays.</> : <>Below the {edgeName}: no {absorber} <Tex plain>{formulaTex(edge)}</Tex> fluorescence yet.</>}</li>
      <li><strong><Tex plain>{'I_t'}</Tex> · detector 2</strong>{crystal ? 'Ion chamber' : 'Photodiode'} counting photons out: <Num>{fmt(transmitted)}</Num>.</li>
      <li><strong>Reference · detector 3</strong>A known foil in the same beam checks the energy scale.</li>
    </ol>
    <p className="beam-note">Not to scale. The crystal angle, counts and fluorescence follow your settings.</p>
  </div>;
}
