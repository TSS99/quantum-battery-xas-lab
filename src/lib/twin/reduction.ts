import { processExafs } from '../exafs';
import { preEdge } from '../xas-reduction';
import type { Acquisition, TwinMode } from './types';

export const TWIN_REDUCTION = {
  rbkg: 1,
  kmin: 2,
  kmax: 12,
  kweight: 2,
  dk: 1,
  window: 'hanning' as const,
  nfft: 2048,
  kstep: 0.05,
  autobkKmin: 0,
  autobkKweight: 1,
  autobkDk: 0.1,
  nclamp: 3,
  clampLow: 0,
  clampHigh: 1,
} as const;

const FLUOR_MODES: readonly TwinMode[] = ['fluorescence', 'xrf'];

/** mu(E) for the acquisition mode, omitting non-finite rows. */
export function muOf(columns: Record<string, number[]>, mode: TwinMode) {
  const y = FLUOR_MODES.includes(mode) ? columns.mufluor : columns.mutrans;
  if (!columns.energy || !y) throw new Error(`This ${mode} acquisition has no ${FLUOR_MODES.includes(mode) ? 'mufluor' : 'mutrans'} column.`);
  const keep = columns.energy.map((energy, i) => Number.isFinite(energy) && Number.isFinite(y[i]));
  return { energy: columns.energy.filter((_, i) => keep[i]), mu: y.filter((_, i) => keep[i]) };
}

/** The exact normalization, AUTOBK and xftf path used by the result dock and Larch export. */
export function reduceAcquisition(acquisition: Acquisition, mode: TwinMode = acquisition.kind) {
  const { energy, mu } = muOf(acquisition.columns, mode);
  const pre = preEdge(energy, mu);
  // preEdge clamps a step that does not rise to 1e-12; a saturated detector or a missing absorber gives no edge to read.
  const range = Math.max(...mu) - Math.min(...mu);
  if (!(pre.edgeStep > 1e-12) || pre.edgeStep < 1e-3 * range) throw new Error('the signal does not rise at the edge (a saturated detector, or no absorber in the beam).');
  const kmaxData = Math.sqrt(0.26246842 * (energy[energy.length - 1] - pre.e0));
  const kmax = Math.min(TWIN_REDUCTION.kmax, kmaxData - 0.3);
  const exafs = processExafs(energy, mu, {
    rbkg: TWIN_REDUCTION.rbkg,
    kmin: TWIN_REDUCTION.kmin,
    kmax,
    kweight: TWIN_REDUCTION.kweight,
    dk: TWIN_REDUCTION.dk,
    window: TWIN_REDUCTION.window,
  });
  return { energy, mu, pre, exafs, kmax };
}
