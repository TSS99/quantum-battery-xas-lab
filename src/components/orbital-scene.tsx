'use client';
import { useId } from 'react';
import { Box, SceneDefs } from './scene-kit';
import { Tex } from './tex';

/** Energy is vertical; the small cabinet-projection depth only separates the drawn bands. */
export function OrbitalScene({ transition, excited }: { transition: 'p' | 'd'; excited: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const paint = (name: string) => 'url(#orb-' + id + '-' + name + ')';
  const coreY = 361, targetY = transition === 'p' ? 165 : 224;
  const photon = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100;
    return (i ? 'L' : 'M') + (84 + 202 * t).toFixed(1) + ' ' + (314 + 39 * t + 7 * Math.sin(t * Math.PI * 12)).toFixed(1);
  }).join(' ');
  return <figure className="orbital-diagram">
    <svg viewBox="0 0 480 440" role="img" aria-labelledby={id + '-title'} aria-describedby={id + '-description'} focusable="false">
      <title id={id + '-title'}>Core electron and two possible excitation channels</title>
      <desc id={id + '-description'}>{excited
        ? 'An electron is shown in the ' + transition + '-like band, leaving a dashed core hole in the deep 1s level.'
        : 'Two electrons occupy the deep 1s level. An incoming X-ray can promote one into an empty state.'} The continuum lies above the ionization threshold. The p-like dipole channel is allowed; the d-like channel needs mixing or a non-dipole transition. Level spacing is schematic.</desc>
      <SceneDefs />
      <defs>
        <linearGradient id={'orb-' + id + '-continuum'} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#9cc5e8" stopOpacity=".24" /><stop offset="1" stopColor="#9cc5e8" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={'orb-' + id + '-electron'} cx=".3" cy=".25" r=".75">
          <stop offset="0" stopColor="#fff8e6" /><stop offset=".4" stopColor="#ffc46b" /><stop offset="1" stopColor="#a6651d" />
        </radialGradient>
        <radialGradient id={'orb-' + id + '-lobe'} cx=".3" cy=".25" r=".8">
          <stop offset="0" stopColor="#d6edf4" stopOpacity=".9" /><stop offset=".5" stopColor="#7fd8cf" stopOpacity=".6" /><stop offset="1" stopColor="#365a66" stopOpacity=".2" />
        </radialGradient>
      </defs>

      {/* An inset metal drawing panel, with the same light and finish as the beamline. */}
      <rect x="7" y="7" width="466" height="426" rx="12" fill="url(#bl-dark)" stroke="#56657a" />
      <path d="M20 8H460" stroke="#a9b4c1" strokeOpacity=".4" />
      <rect x="15" y="15" width="450" height="410" rx="7" fill="url(#bl-floor)" />
      {[[23, 23], [457, 23], [23, 417], [457, 417]].map(([x, y]) => <g key={x + '-' + y}>
        <circle cx={x} cy={y} r="3.5" fill="url(#bl-steel-top)" stroke="#1c242d" />
        <path d={'M' + (x - 1.6) + ' ' + (y + 1.6) + 'l3.2 -3.2'} stroke="#38434f" />
      </g>)}
      <path d="M47 393V57m-5 8 5-8 5 8" fill="none" stroke="#98a4b3" strokeWidth="1.4" />
      <text transform="translate(31 246) rotate(-90)" className="orbital-axis">Energy</text>

      {/* Closely spaced levels merge into the continuum above the ionization threshold. */}
      <path d="M88 121H396l12-8V51H100L88 59Z" fill={paint('continuum')} />
      {[61, 68, 76, 85, 95, 106].map(y => <path key={y} d={'M88 ' + y + 'H396l12-8'} fill="none" stroke="#9cc5e8" strokeOpacity=".12" />)}
      <text x="96" y="82" className="orbital-label">Continuum</text>
      <path d="M84 122H416" stroke="#9cc5e8" strokeWidth="1.2" strokeDasharray="5 5" />
      <text x="96" y="115" className="orbital-detail">Ionization threshold</text>

      {/* The arrow indicates the selected channel, not a calculated transition probability. */}
      <path d={'M300 346V' + (targetY + 14)} fill="none" stroke="#ffc46b" strokeWidth="1.6" strokeDasharray={transition === 'd' ? '5 5' : undefined} opacity={excited ? .85 : .35} />
      <path d={'M295 ' + (targetY + 21) + 'l5-7 5 7'} fill="none" stroke="#ffc46b" strokeWidth="1.6" opacity={excited ? .85 : .35} />

      {[{ kind: 'p', height: 244, labelY: 148 }, { kind: 'd', height: 185, labelY: 207 }].map(band => <g key={band.kind}>
        <g transform="translate(0 205)">
          <Box x0={88} x1={396} y0={band.height - 7} y1={band.height} z0={0} z1={28}
            front={excited && transition === band.kind ? '#735637' : 'url(#bl-front)'}
            top={excited && transition === band.kind ? '#b4915d' : 'url(#bl-top)'} />
        </g>
        <path d={'M90 ' + (419 - band.height + 3) + 'H394'} stroke="#c4ccd6" strokeOpacity=".2" />
        <text x="96" y={band.labelY} className="orbital-label">{band.kind}-like band</text>
        <text x="337" y={band.labelY + 17} className="orbital-detail">{excited && transition === band.kind ? 'excited' : 'empty'}</text>
      </g>)}
      {/* Orbital lobes show character only, not a real-space calculation. */}
      <g transform="translate(238 165) rotate(-24)" fill={paint('lobe')} stroke="#9cc5e8" strokeOpacity=".35">
        <path d="M0 0C-9-21-35-19-32-5C-29 9-10 10 0 0Z" />
        <path d="M0 0C9 21 35 19 32 5C29-9 10-10 0 0Z" />
      </g>
      <g transform="translate(238 224) rotate(-20)" fill={paint('lobe')} stroke="#9cc5e8" strokeOpacity=".35">
        {[0, 90, 180, 270].map(angle => <path key={angle} transform={'rotate(' + angle + ')'} d="M0 0C3-14 18-22 21-12C24-2 11 3 0 0Z" />)}
      </g>

      <g transform="translate(0 205)"><Box x0={88} x1={396} y0={41} y1={48} z0={0} z1={28} /></g>
      <text x="96" y="405" className="orbital-label">1s core level</text>
      <g opacity={excited ? .2 : 1} className="orbital-photon">
        <path d={photon} fill="none" stroke="#ffc46b" strokeWidth="5" opacity=".12" />
        <path d={photon} fill="none" stroke="#ffc46b" strokeWidth="1.8" />
        <path d="M281 347l10 7-12 2" fill="none" stroke="#ffc46b" strokeWidth="1.8" />
      </g>
      <text x="96" y="297" className="orbital-label orbital-photon-label">X-ray photon <tspan fontStyle="italic">hν</tspan></text>
      {excited && <><circle cx="300" cy={coreY} r="9" fill="none" stroke="#ffc46b" strokeWidth="1.8" strokeDasharray="3 3" /><text x="280" y="405" className="orbital-detail">core hole</text></>}
      <circle cx="326" cy={coreY} r="7" fill={paint('electron')} />
      <g className="orbital-moving-electron" style={{ transform: 'translate(300px, ' + (excited ? targetY : coreY) + 'px)' }}>
        <circle r="7" fill={paint('electron')} />
      </g>
    </svg>
    <figcaption>Level spacing and orbital shapes are schematic, not to scale. The core hole and electron interactions reshape real spectra. The <Tex plain>{'d'}</Tex>-like channel needs mixing or a non-dipole transition; no transition intensity is calculated.</figcaption>
  </figure>;
}
