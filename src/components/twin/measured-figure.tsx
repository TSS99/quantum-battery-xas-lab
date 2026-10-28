'use client';
/* The Methods page figure for the twin against a measured Cu foil: normalized mu(E) near the edge and k^2 chi(k), from
   the comparison src/lib/twin/measured-check.ts computes and measured-check.test.ts keeps in step with the code. */
import check from '@/data/twin/measured/cu-check.json';
import { Plot } from '../plot';
import { Tex } from '../tex';

const MEASURED = '#ffc46b', TWIN = '#7fd8cf';

export function MeasuredFigure() {
  const { curves, chi, firstShell_A, normRms } = check;
  return <figure className="measured-figure">
    <div className="two-col">
      <Plot series={[
        { name: 'Measured Cu foil', color: MEASURED, x: curves.e, y: curves.normMeasured },
        { name: 'Twin', color: TWIN, x: curves.e, y: curves.normTwin, dash: 'dashed' },
      ]} xLabel="E − E0 (eV)" yLabel="Normalized μ(E)" yTex={String.raw`\mathrm{normalized}\ \mu(E)`} yUnit="" height={220} exportName="twin-vs-measured-mu" />
      <Plot series={[
        { name: 'Measured Cu foil', label: <>Measured <Tex plain>{'k^2\\chi(k)'}</Tex></>, color: MEASURED, x: curves.k, y: curves.k2chiMeasured },
        { name: 'Twin', label: <>Twin <Tex plain>{'k^2\\chi(k)'}</Tex></>, color: TWIN, x: curves.k, y: curves.k2chiTwin, dash: 'dashed' },
      ]} xLabel="k (Å⁻¹)" yLabel="k²χ(k)" yTex={String.raw`k^2\chi(k)\ (\mathring{\mathrm{A}}^{-2})`} height={220} exportName="twin-vs-measured-chik" />
    </div>
    <figcaption>A Cu foil measured at APS 13-ID in 2001 against the twin&apos;s 7 μm Cu foil at the same energies, both through
      the same normalization and background removal. Above the near edge the oscillations agree: correlation {chi.correlation.toFixed(2)},
      or {chi.bestCorrelation.toFixed(2)} with the twin&apos;s E0 moved by {chi.bestShift_eV} eV (the shift a fit would find); amplitude
      ×{chi.amplitudeRatio.toFixed(2)}; first shell at {firstShell_A.twin.toFixed(2)} Å against {firstShell_A.measured.toFixed(2)} Å.
      The near edge does not match (normalized RMS {normRms.nearEdge.toFixed(2)}): the twin draws it with a teaching model, not a
      calculation, so read edge shapes from measured references.</figcaption>
  </figure>;
}
