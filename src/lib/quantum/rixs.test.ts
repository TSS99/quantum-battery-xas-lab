import { describe, expect, it } from 'vitest';
import index from '@/data/quantum/rixs/index.json';
import water from '@/data/quantum/rixs/h2o-o-k-sto3g.json';
import co from '@/data/quantum/rixs/co-o-k-sto3g.json';
import estimates from '@/data/quantum/estimates.json';
import { seededRandom } from '../xas';
import { amplificationRounds, loadRixs, ORIENTED, rixsRow, rixsSpectrum, successProbability, toffoliPerSample, type Geometry, type RixsCost, type RixsData } from './rixs';

const molecules = [water, co] as unknown as RixsData[];

describe('RIXS', () => {
  it('gives the Python check value for every problem', async () => {
    for (const id of index.problems) {
      const d = await loadRixs(id);
      expect(rixsRow(d, d.check.geometry, d.check.row)[d.check.bin] / d.check.value, id).toBeCloseTo(1, 3);
    }
  });

  it('keeps parallel plus twice crossed equal to the isotropic average of the oriented pairs', () => {
    for (const d of molecules) for (let i = 0; i < d.incident_eV.length; i += 3) {
      const parallel = rixsRow(d, 'parallel', i), crossed = rixsRow(d, 'crossed', i);
      const isotropic = new Float64Array(parallel.length);
      for (const g of ORIENTED) rixsRow(d, g, i).forEach((v, k) => { isotropic[k] += v / 3; });
      // Each map is rounded to one part in 9,999 of its own largest bin, so allow half a level of each.
      const rounding = (d.maps.parallel.scale + 2 * d.maps.crossed.scale + ORIENTED.reduce((s, g) => s + d.maps[g].scale / 3, 0)) / d.settings.levels / 2;
      parallel.forEach((v, k) => expect(Math.abs(v + 2 * crossed[k] - isotropic[k])).toBeLessThanOrEqual(rounding));
      const sum = (key: 'elastic' | 'totals', g: Geometry) => d[key][g][i];
      for (const key of ['elastic', 'totals'] as const) {
        const iso = ORIENTED.reduce((s, g) => s + sum(key, g) / 3, 0);
        expect(Math.abs(sum(key, 'parallel') + 2 * sum(key, 'crossed') - iso) / iso).toBeLessThan(1e-6);
      }
    }
  });

  it('leaves the molecules no elastic line with crossed polarizations along different symmetry axes', () => {
    // Water lies in yz with z its axis; CO lies along z. A final state reached through y then z has the symmetry of yz,
    // never that of the ground state.
    for (const [d, crossed, parallel] of [[molecules[0], ['yz', 'zy'], 'zz'], [molecules[1], ['xz', 'zx', 'yz', 'xy'], 'xx']] as [RixsData, Geometry[], Geometry][]) {
      const top = Math.max(...d.elastic[parallel]);
      expect(top).toBeGreaterThan(0);
      for (const g of crossed) for (const e of d.elastic[g]) expect(e / top).toBeLessThan(1e-8);
    }
  });

  it('draws samples that converge on the exact row', () => {
    const d = molecules[1], i = d.polynomial.row;
    const few = rixsSpectrum(d, 'parallel', i, 1_000, seededRandom(1)), many = rixsSpectrum(d, 'parallel', i, 10_000_000, seededRandom(1));
    expect(many.difference).toBeLessThan(few.difference);
    expect(many.difference).toBeLessThan(0.02);
    expect(many.peak_eV.measured).toBe(many.peak_eV.exact);
    expect(few.elastic + few.outside).toBeLessThan(1);
  });

  it('follows the paper for amplification and the cost of a sample', () => {
    expect(amplificationRounds(0.06 ** 2)).toBe(13);  // sqrt(P_R) about 0.06 gives the paper's K_A = 13
    for (const d of molecules) {
      for (const g of [...ORIENTED, 'parallel', 'crossed'] as Geometry[]) for (let i = 0; i < d.incident_eV.length; i++) {
        const p = successProbability(d, g, i);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      const cost = (estimates.problems as unknown as { id: string; rixs: RixsCost }[]).find(r => r.id === d.id)!.rixs;
      expect(toffoliPerSample(cost, cost.amplification_rounds) / cost.toffoli_per_sample).toBeCloseTo(1, 9);
    }
  });
});
