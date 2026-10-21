import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { loadOptics } from './tables';
import { loadPaths } from './exafs';
import { firstShellFit } from './first-shell-fit';
import { loadLibraryFineStructure } from './sample';
import { handleScanRequest, type ScanMessage } from './worker';
import { DEFAULT_STATE } from './twin';
import type { Acquisition, TwinState } from './types';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics(), loadLibraryFineStructure(DEFAULT_STATE.sample)]); });

async function scan(state: TwinState, seed: number): Promise<Acquisition> {
  const messages: ScanMessage[] = [];
  await handleScanRequest({ type: 'scan', id: 1, state, plan: state.scan, seed }, m => messages.push(m));
  const done = messages.find(m => m.type === 'done');
  if (done?.type !== 'done') throw new Error('The scan did not finish.');
  return done.acquisition;
}

const transmissionMu = (a: Acquisition) => {
  const keep = a.columns.mutrans.map(Number.isFinite);
  return { energy: a.columns.energy.filter((_, i) => keep[i]), mu: a.columns.mutrans.filter((_, i) => keep[i]) };
};

describe('first shell fit of a twin scan', () => {
  it('recovers the S0^2, distance and Einstein sigma^2 the twin used for the Cu foil', async () => {
    const cu = await loadPaths('cu');
    const { energy, mu } = transmissionMu(await scan(DEFAULT_STATE, 3));
    const fit = firstShellFit(cu, energy, mu, DEFAULT_STATE.environment.temperature_K);
    const p = fit.result.parameters;
    expect(fit.result.success, fit.result.message).toBe(true);
    expect(fit.reff_A).toBeCloseTo(3.615 / Math.SQRT2, 3);
    expect(fit.window_A[0]).toBeLessThan(fit.window_A[1]);
    expect(Math.abs(p.s02.value - fit.truth.s02)).toBeLessThan(0.1);
    expect(Math.abs(p.dr.value - fit.truth.deltar_A)).toBeLessThan(0.02);
    expect(Math.abs(p.ss.value - fit.truth.sigma2_A2) / fit.truth.sigma2_A2).toBeLessThan(0.15);
    expect(fit.result.rFactor!).toBeLessThan(0.02);
  });

  it('follows the sample temperature: a colder foil fits a smaller sigma^2', async () => {
    const cu = await loadPaths('cu');
    const cold: TwinState = { ...DEFAULT_STATE, environment: { ...DEFAULT_STATE.environment, kind: 'cryostat', temperature_K: 20 } };
    const warm = firstShellFit(cu, ...Object.values(transmissionMu(await scan(DEFAULT_STATE, 3))) as [number[], number[]], DEFAULT_STATE.environment.temperature_K);
    const chilled = firstShellFit(cu, ...Object.values(transmissionMu(await scan(cold, 3))) as [number[], number[]], 20);
    expect(chilled.truth.sigma2_A2).toBeLessThan(warm.truth.sigma2_A2);
    expect(chilled.result.parameters.ss.value).toBeLessThan(warm.result.parameters.ss.value);
  });

  it('refuses a scan that stops too close to the edge', async () => {
    const cu = await loadPaths('cu');
    const energy = Array.from({ length: 120 }, (_, i) => 8950 + i), mu = energy.map(e => e > 8979 ? 1 : 0);
    expect(() => firstShellFit(cu, energy, mu, 295)).toThrow(/too close to the edge/);
  });
});
