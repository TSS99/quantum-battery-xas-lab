'use client';
/* Drawing kit for instrument scenes in cabinet projection: X runs along the beam, Y is up, Z is depth.
   Every scene uses the same light, metal and glass so the pages read as one laboratory. */
export const K = 0.42, Q = 0.27, B = 214, YB = 66; // YB: height of the monochromatic beam above the table
export type V3 = [number, number, number];
export const P = (x: number, y: number, z: number): [number, number] => [x + K * z, B - y - Q * z];
export const pts = (...v: V3[]) => v.map(p => P(...p).map(n => n.toFixed(1)).join(',')).join(' ');
export const loop = (f: (t: number) => V3, n = 32) => 'M' + Array.from({ length: n }, (_, i) => P(...f(2 * Math.PI * i / n)).map(v => v.toFixed(1)).join(',')).join('L') + 'Z';
export const circleYZ = (x: number, y: number, z: number, r: number) => loop(t => [x, y + r * Math.sin(t), z + r * Math.cos(t)]);
export const circleXZ = (x: number, y: number, z: number, r: number) => loop(t => [x + r * Math.cos(t), y, z + r * Math.sin(t)]);
export const line = (...v: V3[]) => 'M' + v.map(p => P(...p).map(n => n.toFixed(1)).join(',')).join('L');

export function Box({ x0, x1, y0, y1, z0, z1, front = 'url(#bl-front)', top = 'url(#bl-top)', side = 'url(#bl-side)' }: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; front?: string; top?: string; side?: string }) {
  return <g>
    <polygon points={pts([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1])} fill={top} />
    <polygon points={pts([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])} fill={side} />
    <rect x={x0 + K * z0} y={B - y1 - Q * z0} width={x1 - x0} height={y1 - y0} fill={front} />
    <polyline points={pts([x0, y1, z0], [x1, y1, z0], [x1, y1, z1])} className="bl-edge" />
  </g>;
}
/** Cylinder whose axis runs along Z (into the page), seen from its near end. */
export function CylZ({ x, y, z0, z1, r, body = 'url(#bl-cyl)', cap = '#56657a' }: { x: number; y: number; z0: number; z1: number; r: number; body?: string; cap?: string }) {
  const [ax, ay] = P(x, y, z0), [bx, by] = P(x, y, z1), nx = .5408 * r, ny = .8412 * r;
  return <g>
    <circle cx={bx} cy={by} r={r} fill="#1c242d" />
    <polygon points={`${ax + nx},${ay + ny} ${bx + nx},${by + ny} ${bx - nx},${by - ny} ${ax - nx},${ay - ny}`} fill={body} />
    <circle cx={ax} cy={ay} r={r} fill={cap} />
  </g>;
}
/** Short vertical post, such as an SHV connector on top of an ion chamber. */
export function CylY({ x, y0, y1, z = 0, r }: { x: number; y0: number; y1: number; z?: number; r: number }) {
  const [cx, top] = P(x, y1, z), [, bottom] = P(x, y0, z), w = 1.085 * r;
  return <g>
    <rect x={cx - w} y={top} width={2 * w} height={bottom - top} fill="url(#bl-post)" />
    <path d={circleXZ(x, y1, z, r)} fill="#8796a8" />
  </g>;
}
export function Beam({ d, color = '#ffc46b', core = '#fff1d6', glow = 1, flow = true, flowClass = 'bl-flow' }: { d: string; color?: string; core?: string; glow?: number; flow?: boolean; flowClass?: string }) {
  return <g opacity={glow} fill="none" strokeLinecap="round">
    <path d={d} stroke={color} strokeWidth={13} opacity={.06} />
    <path d={d} stroke={color} strokeWidth={7} opacity={.14} />
    <path d={d} stroke={color} strokeWidth={3.4} opacity={.4} />
    <path d={d} stroke={core} strokeWidth={1.5} />
    {flow && <path d={d} stroke={core} strokeWidth={2.6} className={flowClass} />}
  </g>;
}
/** Ion chamber with a glass viewport, collector plates and a Kapton exit window. */
export function IonChamber({ x0, x1, y0, y1, z, beam, readout, id }: { x0: number; x1: number; y0: number; y1: number; z: number; beam: number; readout?: string; id: string }) {
  const fz = -z, gx0 = x0 + 10 + K * fz, gx1 = x1 - 10 + K * fz, gy0 = B - (YB + 16) - Q * fz, gy1 = B - (YB - 16) - Q * fz;
  return <g>
    <Box x0={x0 + 12} x1={x1 - 12} y0={0} y1={y0} z0={-z + 10} z1={z - 10} front="url(#bl-dark)" />
    <Box x0={x0} x1={x1} y0={y0} y1={y1} z0={-z} z1={z} />
    <path d={circleYZ(x1, YB, 0, 15)} fill="#3a4654" />
    <path d={circleYZ(x1, YB, 0, 11)} fill="url(#bl-kapton)" />
    <clipPath id={id}><rect x={gx0} y={gy0} width={gx1 - gx0} height={gy1 - gy0} rx={3} /></clipPath>
    <rect x={gx0} y={gy0} width={gx1 - gx0} height={gy1 - gy0} rx={3} fill="#070b0f" />
    <g clipPath={`url(#${id})`}>
      <path d={`M${gx0} ${gy0 + 5}H${gx1}M${gx0} ${gy1 - 5}H${gx1}`} stroke="#c27c4e" strokeWidth={2.2} />
      <path d={Array.from({ length: Math.floor((gx1 - gx0) / 9) }, (_, i) => `M${gx0 + 6 + i * 9} ${gy0 + 8}V${gy1 - 8}`).join('')} stroke="#9cc5e8" strokeWidth={1} className="bl-ions" opacity={.15 + .55 * beam} />
      <Beam d={`M${gx0 - 20} ${B - YB}H${gx1 + 20}`} color="#ffc46b" core="#fff1d6" glow={Math.max(.06, beam)} />
      <rect x={gx0} y={gy0} width={gx1 - gx0} height={gy1 - gy0} fill="url(#bl-glass)" />
    </g>
    <rect x={gx0} y={gy0} width={gx1 - gx0} height={gy1 - gy0} rx={3} fill="none" stroke="#6b7a8c" strokeOpacity={.6} />
    {readout && <g><rect x={(gx0 + gx1) / 2 - 27} y={B - y1 - Q * fz + 4} width={54} height={13} rx={2} fill="#06130f" stroke="#2c3a46" /><text x={(gx0 + gx1) / 2} y={B - y1 - Q * fz + 13.6} className="bl-lcd">{readout}</text></g>}
    {/* Countersunk face screws and ribbed cable strain reliefs. */}
    {[[x0 + 5 + K * fz, B - y1 - Q * fz + 5], [x1 - 5 + K * fz, B - y1 - Q * fz + 5], [x0 + 5 + K * fz, B - y0 - Q * fz - 5], [x1 - 5 + K * fz, B - y0 - Q * fz - 5]].map(([sx, sy], i) => <g key={i}>
      <circle cx={sx} cy={sy} r={2.1} fill="url(#bl-steel-top)" stroke="#26303a" strokeWidth={.7} />
      <path d={`M${sx - .9} ${sy + .9}l1.8 -1.8`} stroke="#38434f" strokeWidth={.8} />
    </g>)}
    <CylY x={x0 + 14} y0={y1} y1={y1 + 9} r={4} /><CylY x={x1 - 14} y0={y1} y1={y1 + 9} r={4} />
    {[x0 + 14, x1 - 14].map(x => { const [sx, sy] = P(x, y1 + 9, 0); return <g key={x}>
      <rect x={sx - 3} y={sy - 5} width={6} height={8} rx={2} fill="#18212b" />
      <path d={`M${sx - 2.5} ${sy - 3}h5m-5 2h5m-5 2h5`} fill="none" stroke="#647182" strokeWidth={.7} />
    </g>; })}
    <path d={`M${P(x0 + 14, y1 + 9, 0).join(' ')}c-2 -18 14 -30 34 -38`} className="bl-cable" />
    <path d={`M${P(x1 - 14, y1 + 9, 0).join(' ')}c-2 -16 12 -26 30 -32`} className="bl-cable" />
  </g>;
}
/** Vertical cylinder (a disc when short), such as coin-cell parts or a sample stage. */
export function Disc({ x, z = 0, y0, y1, r, top = 'url(#bl-steel-top)', side = 'url(#bl-steel-side)', opacity }: { x: number; z?: number; y0: number; y1: number; r: number; top?: string; side?: string; opacity?: number }) {
  const w = 1.0846 * r, t = .1046 * r, [cx, ty] = P(x, y1, z), [, by] = P(x, y0, z);
  return <g opacity={opacity}>
    <path d={circleXZ(x, y0, z, r)} fill={side} />
    <polygon points={`${cx - w},${ty + t} ${cx + w},${ty - t} ${cx + w},${by - t} ${cx - w},${by + t}`} fill={side} />
    <path d={circleXZ(x, y1, z, r)} fill={top} />
  </g>;
}
/** Optical breadboard: a slab whose top carries the tapped-hole grid. */
export function Breadboard({ x0, x1, z0, z1, depth = 14 }: { x0: number; x1: number; z0: number; z1: number; depth?: number }) {
  return <g>
    <Box x0={x0} x1={x1} y0={-depth} y1={0} z0={z0} z1={z1} front="url(#bl-dark)" top="#1b232c" />
    <rect transform={`matrix(1 0 ${K} ${-Q} 0 ${B})`} x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="url(#bl-holes)" />
    <path d={line([x0, 0, z0], [x1, 0, z0])} stroke="#7a8a9e" strokeOpacity=".5" />
  </g>;
}
/** Soft contact shadow on a surface at height y. */
export const Shadow = ({ x, y = 0, z = 0, w, h = 9 }: { x: number; y?: number; z?: number; w: number; h?: number }) => { const [cx, cy] = P(x, y, z); return <ellipse cx={cx} cy={cy} rx={w} ry={h} fill="url(#bl-shadow)" />; };
/** Shared gradients and patterns. Render once per page (or per standalone SVG) before any scene that uses them. */
export function SceneDefs() {
  return <defs>
    <linearGradient id="bl-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a5869" /><stop offset="1" stopColor="#2c3541" /></linearGradient>
    <linearGradient id="bl-top" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#6f8096" /><stop offset="1" stopColor="#56657a" /></linearGradient>
    <linearGradient id="bl-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#2a333e" /><stop offset="1" stopColor="#1e252e" /></linearGradient>
    <linearGradient id="bl-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a323c" /><stop offset="1" stopColor="#1a2028" /></linearGradient>
    <linearGradient id="bl-granite" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3a3f46" /><stop offset="1" stopColor="#24282e" /></linearGradient>
    <linearGradient id="bl-cyl" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stopColor="#7a8a9e" /><stop offset=".45" stopColor="#4a5869" /><stop offset="1" stopColor="#222a33" /></linearGradient>
    <linearGradient id="bl-pipe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8a99ab" /><stop offset=".35" stopColor="#5d6c7e" /><stop offset="1" stopColor="#252d36" /></linearGradient>
    <linearGradient id="bl-post" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8796a8" /><stop offset="1" stopColor="#38434f" /></linearGradient>
    <linearGradient id="bl-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".12" /><stop offset=".35" stopColor="#fff" stopOpacity=".02" /><stop offset=".36" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#9cc5e8" stopOpacity=".05" /></linearGradient>
    <linearGradient id="bl-si" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#dce6f2" /><stop offset="1" stopColor="#8195ab" /></linearGradient>
    <linearGradient id="bl-tungsten" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5b6168" /><stop offset="1" stopColor="#33383e" /></linearGradient>
    <linearGradient id="bl-foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f2f4f7" /><stop offset=".5" stopColor="#9aa6b4" /><stop offset="1" stopColor="#dfe5ec" /></linearGradient>
    <linearGradient id="bl-white" x1="20" x2="150" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f4f1ea" stopOpacity="0" /><stop offset="1" stopColor="#f4f1ea" /></linearGradient>
    <radialGradient id="bl-kapton" cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#ffd08a" /><stop offset=".6" stopColor="#d48a2c" /><stop offset="1" stopColor="#8a5212" /></radialGradient>
    <radialGradient id="bl-pellet" cx=".4" cy=".35" r=".75"><stop offset="0" stopColor="#5a5f66" /><stop offset="1" stopColor="#202428" /></radialGradient>
    <linearGradient id="bl-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141b22" /><stop offset="1" stopColor="#0b0f13" /></linearGradient>
    <radialGradient id="bl-shadow"><stop offset="0" stopColor="#000" stopOpacity=".55" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
    <radialGradient id="bl-spot"><stop offset="0" stopColor="#fff6e0" /><stop offset=".4" stopColor="#ffc46b" stopOpacity=".8" /><stop offset="1" stopColor="#ffc46b" stopOpacity="0" /></radialGradient>
    <radialGradient id="bl-fluor"><stop offset="0" stopColor="#74dcaa" stopOpacity=".55" /><stop offset="1" stopColor="#74dcaa" stopOpacity="0" /></radialGradient>
    <pattern id="bl-holes" width="12.5" height="12.5" patternUnits="userSpaceOnUse"><circle cx="6.25" cy="6.25" r="1.6" fill="#0b1015" /></pattern>
    <linearGradient id="bl-steel-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d6dde6" /><stop offset=".5" stopColor="#9aa6b4" /><stop offset="1" stopColor="#c3ccd7" /></linearGradient>
    <linearGradient id="bl-steel-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a9b4c1" /><stop offset=".45" stopColor="#6b7684" /><stop offset="1" stopColor="#3a424c" /></linearGradient>
    <linearGradient id="bl-black-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3a3f46" /><stop offset="1" stopColor="#15181c" /></linearGradient>
    <linearGradient id="bl-lithium-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e9edf2" /><stop offset=".6" stopColor="#b9c1cb" /><stop offset="1" stopColor="#d9dfe6" /></linearGradient>
    <linearGradient id="bl-screen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0d141b" /><stop offset="1" stopColor="#081016" /></linearGradient>
    <linearGradient id="bl-bezel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2e3742" /><stop offset="1" stopColor="#1b222a" /></linearGradient>
    <pattern id="bl-ruling" width="2.4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0V4" stroke="#7fd8cf" strokeOpacity=".55" strokeWidth=".8" /></pattern>
  </defs>;
}
