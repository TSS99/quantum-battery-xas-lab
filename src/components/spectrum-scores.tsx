'use client';
import { useState } from 'react';
import { compareSpectra } from '@/lib/comparison';
import type { Spectrum } from '@/lib/spectra';
import { Plot } from './plot';
import { Panel, Range, TryThis } from './ui';
import { Num, Tex, Unit } from './tex';
export function SpectrumScores({ reference, target, edge }: { reference: Spectrum; target: Spectrum; edge: number }) {
  const [shift, setShift] = useState(0), [scored, setScored] = useState(false);
  let score: ReturnType<typeof compareSpectra> | null = null, problem = '';
  try { score = compareSpectra(reference, target, shift, [edge - 10, edge + 30]); } catch (e) { problem = e instanceof Error ? e.message : 'Check the comparison.'; }
  const fmt = (v: number | null) => v === null ? 'Undefined' : v.toFixed(4);
  return <Panel title="Align and score"><p>Compare the selected curve with the live reference over {(edge - 10).toFixed(1)}–{(edge + 30).toFixed(1)} eV. One constant shift is applied to the selected curve.</p>
    <Range label="Comparison energy shift" value={shift} min={-10} max={10} step={.1} digits={1} unit="eV" onChange={v => { setShift(v); setScored(false); }} />
    <button className="button secondary" disabled={!score || target.id === 'live'} onClick={() => setScored(true)}>Score selected curve</button>
    {target.id === 'live' && <p className="muted">Select a saved or imported curve to compare with the live curve.</p>}
    {problem && <p role="status">{problem}</p>}
    {scored && score && <><dl className="score-list"><div><dt>Cosine</dt><dd><Num>{fmt(score.cosine)}</Num></dd></div><div><dt>Pearson</dt><dd><Num>{fmt(score.pearson)}</Num></dd></div><div><dt>Spearman</dt><dd><Num>{fmt(score.spearman)}</Num></dd></div><div><dt>Relative <Tex plain>{'L^1'}</Tex></dt><dd><Num>{fmt(score.relativeL1)}</Num></dd></div></dl><p>Overlap: {score.window[0].toFixed(1)}–{score.window[1].toFixed(1)} eV; {score.energies.length} points. RMSE <Num>{score.rmse.toPrecision(4)}</Num> <Unit>cm⁻¹</Unit>.</p><Plot exportName="comparison-residual" yLabel="Residual (cm⁻¹)" yTex={'\\text{Residual }(\\mathrm{cm}^{-1})'} series={[{ name: 'Selected − live reference', color: '#c4ccd6', x: score.energies, y: score.residuals }]} /><TryThis steps={['validate']} done research={<>Scores use raw <Tex plain>{'\\mu'}</Tex> on the shifted target grid, with linear interpolation of the reference. <Tex plain>{'L^1'}</Tex> is divided by the reference absolute area. No uncertainty is propagated.</>}>Compare the residual as well as the score. A high cosine score alone cannot validate a material model.</TryThis></>}
  </Panel>;
}
