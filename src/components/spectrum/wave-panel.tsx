'use client';
import { useState } from 'react';
import { ETOK } from '@/lib/twin/exafs';
import { pathCurves, type Shell } from '@/lib/twin/shells';
import { echoAtAbsorber, shellSlice } from '@/lib/twin/wave-field';
import { Num, Tex } from '../tex';
import { Range } from '../ui';
import { atomName } from './atoms';
import { WaveMap } from './wave-map';

/**
 * The photoelectron wave of one shell in a slice through the real cluster (wave-map.tsx): it leaves the absorber with
 * wavelength 2 pi / k, fades as 1/r and with its mean free path, each neighbour sends back an echo with FEFF's
 * amplitude and phase, and the echo meets the absorber 2kR + phase(k) later. sin(2kR + phase) is the sign of the
 * shell's chi(k); a test checks it against the path sum for Cu, CuO and Pt.
 */
export function WavePanel({ shell, absorber, atoms, deltar_A, k, setK, chi, color }: {
  shell: Shell; absorber: string; atoms: [number, number, number][]; deltar_A: number; k: number; setK: (k: number) => void; chi: number; color: string;
}) {
  const [echoesOnly, setEchoesOnly] = useState(false);
  const path = shell.paths[0], R = shell.r_A + deltar_A;
  const curves = pathCurves(path, k);
  const echo = echoAtAbsorber(k, R, curves);
  // The shell's atoms moved by the "what if" distance change, along their own directions.
  const moved = atoms.map(a => { const r = Math.hypot(...a); return a.map(v => v * (r + deltar_A) / r) as [number, number, number]; });
  const { points, total } = shellSlice(moved);
  const neighbour = atomName(shell.element!), lambda = 2 * Math.PI / k;
  const verdict = echo > 0.3 ? 'in step: the returning wave adds, so absorption goes up' : echo < -0.3 ? 'out of step: the returning wave cancels, so absorption goes down' : 'about a quarter period apart: little change';
  return <div className="wave-panel">
    <div className="spectrum-seg wave-map-view" role="group" aria-label="What the wave map shows">
      <button type="button" className="twin-chip" aria-pressed={!echoesOnly} onClick={() => setEchoesOnly(false)}>Whole wave</button>
      <button type="button" className="twin-chip" aria-pressed={echoesOnly} onClick={() => setEchoesOnly(true)}>Echoes alone</button>
    </div>
    <WaveMap k={k} atoms={moved} curves={curves} color={color} absorber={absorber} element={shell.element!} echo={echo} echoesOnly={echoesOnly}
      label={`The electron wave around the ${atomName(absorber)} atom and ${points.length} of its ${total} ${neighbour} neighbours at ${R.toFixed(2)} angstrom, at k ${k.toFixed(2)}${echoesOnly ? ', echoes alone' : ''}: ${verdict}`} />
    <p className="wave-map-key">{echoesOnly
      ? <>The {neighbour} echoes alone, brightened, meeting at the {atomName(absorber)} atom; the ring: in step or not.</>
      : <>To scale: wavelength <Num>{lambda.toFixed(2)}</Num> Å, gone within about <Num>{curves.lambda.toFixed(0)}</Num> Å. The echoes really are this weak.</>}
      {' '}<Num>{String(points.length)}</Num> of <Num>{String(total)}</Num> {neighbour} atoms lie in this slice.</p>
    <Range label="Electron wavenumber k" display={<>Electron wavenumber <Tex plain>k</Tex></>} value={k} min={2} max={14} step={0.05} digits={2} unit="Å^-1" onChange={setK}
      hint={<>photon energy <Num>{(k * k / ETOK).toFixed(0)}</Num> eV above the edge</>} />
    <p className={'wave-verdict ' + (echo > 0.3 ? 'is-up' : echo < -0.3 ? 'is-down' : '')} aria-live="polite">
      At <Tex plain>{`k = ${k.toFixed(2)}`}</Tex> the waves are {verdict}. This shell&apos;s <Tex plain>{'\\chi(k)'}</Tex> here: <Num>{(chi >= 0 ? '+' : '') + chi.toFixed(4)}</Num>.
    </p>
  </div>;
}
