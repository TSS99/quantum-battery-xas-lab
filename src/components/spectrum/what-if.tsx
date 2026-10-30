'use client';
import { RotateCcw } from 'lucide-react';
import type { Shell, ShellSpectra, ShellTweak } from '@/lib/twin/shells';
import { Num, Tex } from '../tex';
import { Range } from '../ui';
import { atomName } from './atoms';

const rms = (values: number[], k: number[], from: number, to: number) => {
  let sum = 0, n = 0;
  values.forEach((v, i) => { if (k[i] >= from && k[i] <= to) { sum += v * v; n++; } });
  return Math.sqrt(sum / Math.max(1, n));
};
const peakHeight = (y: number[]) => y.reduce((m, v) => Math.max(m, v), 0);
const hundredths = (x: number) => Math.round(x * 100) / 100;

/**
 * Change one shell and the temperature and watch the curves answer: the distance moves the wiggle's frequency and the
 * peak, the number of neighbours scales the height, the disorder sigma^2 damps the high k end. The readouts compare
 * with the shell as the library has it.
 */
export function WhatIf({ shell, tweak, setTweak, sigma2_A2, temperature_K, setTemperature, spectra, base, onReset, changed }: {
  shell: Shell; tweak: ShellTweak; setTweak: (t: ShellTweak) => void; sigma2_A2: number;
  temperature_K: number; setTemperature: (t: number) => void; spectra: ShellSpectra; base: ShellSpectra; onReset: () => void; changed: boolean;
}) {
  const count = Math.round(shell.count * (tweak.scale ?? 1));
  const name = atomName(shell.element!);
  const peakNow = spectra.peak_A[shell.id], peakWas = base.peak_A[shell.id];
  const height = peakHeight(spectra.magnitude[shell.id]) / peakHeight(base.magnitude[shell.id]);
  const highK = rms(spectra.chi[shell.id], spectra.k, 9, 11) / rms(base.chi[shell.id], base.k, 9, 11);
  return <div className="what-if">
    {/* On a grid of whole hundredths of an angstrom, so every value the slider offers is one it can hold. */}
    <Range label={`Distance of the ${name} neighbours`} value={hundredths(shell.r_A + (tweak.deltar_A ?? 0))} min={hundredths(Math.max(0.8, shell.r_A - 0.3))} max={hundredths(shell.r_A + 0.3)} step={0.01} digits={2} unit="Å"
      onChange={r => setTweak({ ...tweak, deltar_A: r - shell.r_A })} hint={`${shell.r_A.toFixed(2)} Å in the crystal; farther wiggles faster and echoes weaker (1/R² and the electron's limited range)`} />
    <Range label={`Number of ${name} neighbours`} value={count} min={1} max={Math.max(2, shell.count * 2)} step={1}
      onChange={n => setTweak({ ...tweak, scale: n / shell.count })} hint={`${shell.count} in the crystal`} />
    <Range label="Disorder of this shell" display={<>Disorder of this shell, <Tex plain>{'\\sigma^2'}</Tex></>} value={sigma2_A2} min={0} max={0.03} step={0.0005} digits={4} unit="Å^2"
      onChange={s => setTweak({ ...tweak, sigma2_A2: s })} hint="thermal and static spread of the distance" />
    <Range label="Temperature of the sample" value={temperature_K} min={10} max={800} step={5} unit="K"
      onChange={setTemperature} hint={<>sets <Tex plain>{'\\sigma^2'}</Tex> of every shell (Einstein model) unless you set this one</>} />
    <dl className="what-if-readout" aria-live="polite">
      <div><dt>Peak in <Tex plain>{'|\\chi(R)|'}</Tex></dt><dd><Num>{peakWas.toFixed(2)}</Num> → <Num>{peakNow.toFixed(2)}</Num> Å</dd></div>
      <div><dt>Peak height</dt><dd>× <Num>{height.toFixed(2)}</Num></dd></div>
      <div><dt>Wiggle at <Tex plain>{'k \\approx 10'}</Tex></dt><dd>× <Num>{highK.toFixed(2)}</Num></dd></div>
    </dl>
    <button type="button" className="twin-chip" onClick={onReset} disabled={!changed}><RotateCcw size={14} aria-hidden="true" />Back to the crystal</button>
  </div>;
}
