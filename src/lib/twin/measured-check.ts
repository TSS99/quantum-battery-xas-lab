/**
 * The twin against a measured spectrum: a Cu foil scanned in transmission at APS 13-ID in 2001, from the Larch
 * examples (MIT License). The twin scans the same energies in educational mode with its default Cu foil, and both go
 * through the same Larch-compatible normalization and AUTOBK background removal, so the numbers say where the twin
 * matches a real measurement and by how much. The tables, the optics and the Cu FEFF paths must be loaded first.
 */
import measured from '@/data/twin/measured/cu-metal-rt.json';
import { interpolate, preEdge } from '../xas-reduction';
import { processExafs } from '../exafs';
import { simulatePoint } from './acquire';
import { DEFAULT_STATE } from './twin';
import { KAPPA } from './scan';
import type { TwinState } from './types';

export const MEASURED_CU = measured;

/** k range and processing of the chi(k) comparison: the usual choices for a Cu foil. */
export const MEASURED_EXAFS = { rbkg: 1, kmin: 3, kmax: 15, kweight: 2, dk: 1, window: 'hanning' } as const;
const K_STEP = 0.05;

export interface MeasuredCheck {
  /** Edge positions (maximum of the derivative), eV. The measured one carries that beamline's 2001 calibration. */
  e0: { measured: number; twin: number };
  /** RMS of measured minus twin normalized mu(E), edges aligned, below the edge, near it and over the EXAFS. */
  normRms: { preEdge: number; nearEdge: number; exafs: number };
  chi: {
    /** Correlation of k^2 chi(k) over the k range, 1 for the same shape. */
    correlation: number;
    /** The E0 shift of the twin's chi that gives the best correlation, eV, and that correlation. */
    bestShift_eV: number;
    bestCorrelation: number;
    /** RMS amplitude of the twin's k^2 chi over the measured one. */
    amplitudeRatio: number;
  };
  /** Largest peak of |chi(R)| below 3 angstrom (the first shell, not phase corrected), angstrom. */
  firstShell_A: { measured: number; twin: number };
  curves: { e: number[]; normMeasured: number[]; normTwin: number[]; k: number[]; k2chiMeasured: number[]; k2chiTwin: number[] };
}

const rms = (values: number[]) => Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length);
const correlation = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);

export function measuredCuCheck(state: TwinState = DEFAULT_STATE): MeasuredCheck {
  const energy = MEASURED_CU.energy_eV;
  const muMeasured = energy.map((_, i) => Math.log(MEASURED_CU.i0[i] / MEASURED_CU.itrans[i]));
  // Educational mode has no noise, so the random source is never drawn from.
  const muTwin = energy.map(e => { const p = simulatePoint({ ...state, realistic: false }, e, () => 0.5); return Math.log(p.i0 / p.it); });

  const a = preEdge(energy, muMeasured), b = preEdge(energy, muTwin), shift = b.e0 - a.e0;
  const twinAligned = interpolate(energy.map(e => e - shift), b.norm, energy);
  const residual = (lo: number, hi: number) => rms(energy.flatMap((e, i) => e - a.e0 >= lo && e - a.e0 < hi ? [a.norm[i] - twinAligned[i]] : []));

  const xa = processExafs(energy, muMeasured, { ...MEASURED_EXAFS }), xb = processExafs(energy, muTwin, { ...MEASURED_EXAFS });
  const n = Math.round((MEASURED_EXAFS.kmax - MEASURED_EXAFS.kmin) / K_STEP) + 1;
  const k = Array.from({ length: n }, (_, i) => +(MEASURED_EXAFS.kmin + i * K_STEP).toFixed(4));
  const weight = (chi: number[]) => chi.map((c, i) => c * k[i] ** 2);
  const chiA = weight(interpolate(xa.autobk.k, xa.autobk.chi, k));
  // The twin's chi as it would be with its E0 moved by dE: k' = sqrt(k^2 + KAPPA dE).
  const chiB = (dE: number) => weight(interpolate(xb.autobk.k, xb.autobk.chi, k.map(v => Math.sqrt(Math.max(0, v * v + KAPPA * dE)))));
  let best = { dE: 0, r: -Infinity };
  for (let dE = -15; dE <= 15; dE += 0.5) { const r = correlation(chiA, chiB(dE)); if (r > best.r) best = { dE, r }; }
  const twinChi = chiB(0);
  const firstShell = (x: typeof xa) => { let j = 0; for (let i = 1; i < x.xftf.r.length; i++) if (x.xftf.r[i] < 3 && x.xftf.magnitude[i] > x.xftf.magnitude[j]) j = i; return x.xftf.r[j]; };

  const near = energy.flatMap((e, i) => e - a.e0 >= -30 && e - a.e0 <= 120 ? [i] : []);
  return {
    e0: { measured: a.e0, twin: b.e0 },
    normRms: { preEdge: residual(-200, -20), nearEdge: residual(-20, 50), exafs: residual(50, Infinity) },
    chi: { correlation: correlation(chiA, twinChi), bestShift_eV: best.dE, bestCorrelation: best.r, amplitudeRatio: rms(twinChi) / rms(chiA) },
    firstShell_A: { measured: firstShell(xa), twin: firstShell(xb) },
    curves: { e: near.map(i => energy[i] - a.e0), normMeasured: near.map(i => a.norm[i]), normTwin: near.map(i => twinAligned[i]), k, k2chiMeasured: chiA, k2chiTwin: twinChi },
  };
}
