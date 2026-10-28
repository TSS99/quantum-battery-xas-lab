import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadXrayData } from '../xraydata';
import { loadOptics } from './tables';
import { loadLibraryFineStructure } from './sample';
import { DEFAULT_STATE } from './twin';
import { measuredCuCheck, type MeasuredCheck } from './measured-check';

const FIXTURE = 'src/data/twin/measured/cu-check.json';
let check: MeasuredCheck;

beforeAll(async () => {
  await Promise.all([loadXrayData(), loadOptics()]);
  expect(await loadLibraryFineStructure(DEFAULT_STATE.sample)).toBe(true);
  check = measuredCuCheck();
});

describe('the twin against a measured Cu foil (APS 13-ID, 2001)', () => {
  it('puts the edge within 3 eV of the measured one and matches the normalized pre-edge and EXAFS region', () => {
    expect(Math.abs(check.e0.twin - check.e0.measured)).toBeLessThan(3);
    expect(check.normRms.preEdge).toBeLessThan(0.02);
    expect(check.normRms.exafs).toBeLessThan(0.08);
    // The near edge is the teaching model (no FEFF XANES), so it is the worst region; this bound only stops it getting worse.
    expect(check.normRms.nearEdge).toBeGreaterThan(check.normRms.exafs);
    expect(check.normRms.nearEdge).toBeLessThan(0.45);
  });

  it('gives chi(k) the measured phase and amplitude: correlation above 0.7, above 0.85 after an E0 shift, first shell within 0.05 angstrom', () => {
    expect(check.chi.correlation).toBeGreaterThan(0.7);
    expect(check.chi.bestCorrelation).toBeGreaterThan(0.85);
    expect(Math.abs(check.chi.bestShift_eV)).toBeLessThanOrEqual(10);
    expect(check.chi.amplitudeRatio).toBeGreaterThan(0.85);
    expect(check.chi.amplitudeRatio).toBeLessThan(1.3);
    expect(Math.abs(check.firstShell_A.twin - check.firstShell_A.measured)).toBeLessThan(0.05);
  });

  it('keeps the comparison on the Methods page in step with the code', () => {
    const round = (x: unknown): unknown => typeof x === 'number' ? +x.toPrecision(6) : Array.isArray(x) ? x.map(round) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, round(v)])) : x;
    const fresh = round(check) as MeasuredCheck;
    if (process.env.UPDATE_MEASURED_CHECK) writeFileSync(FIXTURE, JSON.stringify(fresh) + '\n');
    const stored = JSON.parse(readFileSync(FIXTURE, 'utf8')) as MeasuredCheck;
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(b));
    expect(close(stored.chi.correlation, fresh.chi.correlation)).toBe(true);
    expect(close(stored.normRms.nearEdge, fresh.normRms.nearEdge)).toBe(true);
    expect(stored.curves.k2chiTwin.every((v, i) => close(v, fresh.curves.k2chiTwin[i]))).toBe(true);
    expect(stored.curves.normTwin.every((v, i) => close(v, fresh.curves.normTwin[i]))).toBe(true);
  });
});
