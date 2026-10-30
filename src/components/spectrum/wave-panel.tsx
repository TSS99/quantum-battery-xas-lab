'use client';
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ETOK } from '@/lib/twin/exafs';
import { pathCurves, type Shell } from '@/lib/twin/shells';
import { Num, Tex } from '../tex';
import { Range } from '../ui';
import { atomName } from './atoms';

const W = 640, H = 230, X0 = 70, X1 = 570, OUT_Y = 92, BACK_Y = 150, AMP = 22;
const OUTGOING = '#8ce3ff';
/** One drawn wave period every two seconds: the electron's real frequency is far beyond any drawing. */
const DRAWN_HZ = 0.5;

/**
 * The photoelectron wave of one shell: it leaves the absorber with wavelength 2 pi / k, the neighbour reflects part of
 * it, and it comes home 2kR + phase(k) behind (phase from FEFF: the absorber's and the neighbour's phase shifts). chi
 * is the imaginary part of the returning wave against the outgoing one, sin(2kR + phase), so the returning wave is
 * drawn a quarter period on: crests that meet at the absorber mean the most absorption. A test checks that this sign
 * agrees with the path sum's chi(k) for Cu, CuO and Pt.
 */
export function WavePanel({ shell, absorber, deltar_A, k, setK, chi, color }: {
  shell: Shell; absorber: string; deltar_A: number; k: number; setK: (k: number) => void; chi: number; color: string;
}) {
  const reduced = useReducedMotion();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (reduced) { setT(0); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => { setT((now - start) / 1000); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);
  const path = shell.paths[0], R = path.reff + deltar_A;
  const { phase } = pathCurves(path, k);
  const lag = 2 * k * R + phase, inStep = Math.sin(lag);
  const scale = (X1 - X0) / R, wt = 2 * Math.PI * DRAWN_HZ * t;
  const wave = (y0: number, f: (s: number) => number) => {
    const n = 220;
    return Array.from({ length: n + 1 }, (_, i) => {
      const s = R * i / n;
      return (i ? 'L' : 'M') + (X0 + s * scale).toFixed(1) + ',' + (y0 - AMP * f(s)).toFixed(1);
    }).join('');
  };
  // Outgoing from the absorber, and the reflected wave travelling home, a quarter period on (see above).
  const out = wave(OUT_Y, s => Math.sin(k * s - wt));
  const back = wave(BACK_Y, s => 0.7 * Math.sin(k * (2 * R - s) + lag - 2 * k * R - Math.PI / 2 - wt));
  const neighbour = atomName(shell.element!), lambda = 2 * Math.PI / k;
  const verdict = inStep > 0.3 ? 'in step: the returning wave adds, so absorption goes up' : inStep < -0.3 ? 'out of step: the returning wave cancels, so absorption goes down' : 'about a quarter period apart: little change';
  return <div className="wave-panel">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The electron wave between the ${atomName(absorber)} atom and a ${neighbour} neighbour ${R.toFixed(2)} angstrom away, at k ${k.toFixed(2)}: ${verdict}`}>
      <rect width={W} height={H} rx="10" fill="#121a2b" />
      <line x1={X0} x2={X1} y1={OUT_Y} y2={OUT_Y} stroke="#35404d" strokeDasharray="3 5" />
      <line x1={X0} x2={X1} y1={BACK_Y} y2={BACK_Y} stroke="#35404d" strokeDasharray="3 5" />
      <path d={out} fill="none" stroke={OUTGOING} strokeWidth="2.4" />
      <path d={back} fill="none" stroke={color} strokeWidth="2.4" />
      <circle cx={X0} cy={(OUT_Y + BACK_Y) / 2} r="20" fill="#f3f6fa" />
      <text x={X0} y={(OUT_Y + BACK_Y) / 2 + 5} textAnchor="middle" fontSize="14" fill="#121a2b" fontWeight="600">{absorber}</text>
      <circle cx={X1} cy={(OUT_Y + BACK_Y) / 2} r="16" fill={color} />
      <text x={X1} y={(OUT_Y + BACK_Y) / 2 + 5} textAnchor="middle" fontSize="13" fill="#121a2b" fontWeight="600">{shell.element}</text>
      <text x={X0 + 30} y={OUT_Y - 32} fill={OUTGOING} fontSize="12.5">outgoing, λ = {lambda.toFixed(2)} Å</text>
      <text x={X0 + 30} y={BACK_Y + 40} fill="#d4dae3" fontSize="12.5">reflected by the {neighbour} atom, coming home</text>
      <text x={(X0 + X1) / 2} y={H - 8} textAnchor="middle" fill="#a7b1c1" fontSize="12">R = {R.toFixed(2)} Å, drawn to scale with the wavelength</text>
    </svg>
    <Range label="Electron wavenumber k" display={<>Electron wavenumber <Tex plain>k</Tex></>} value={k} min={2} max={14} step={0.05} digits={2} unit="Å^-1" onChange={setK}
      hint={<>photon energy <Num>{(k * k / ETOK).toFixed(0)}</Num> eV above the edge</>} />
    <p className={'wave-verdict ' + (inStep > 0.3 ? 'is-up' : inStep < -0.3 ? 'is-down' : '')} aria-live="polite">
      At <Tex plain>{`k = ${k.toFixed(2)}`}</Tex> the waves are {verdict}. This shell&apos;s <Tex plain>{'\\chi(k)'}</Tex> here: <Num>{(chi >= 0 ? '+' : '') + chi.toFixed(4)}</Num>.
    </p>
  </div>;
}
