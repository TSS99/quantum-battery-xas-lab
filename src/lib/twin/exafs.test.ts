import { describe, expect, it } from 'vitest';
import cumulantFixture from '../../data/twin/exafs-engine-fixture.json';
import fixtures from '../../data/twin/feff-fixtures.json';
import type { ExafsParameters, FeffMaterial } from './types';
import { chiOfEnergy, chiPath, chiSum, loadPaths, sigma2Einstein } from './exafs';

type FixtureCase = (typeof fixtures.materials.cu.cases)[number];

function parametersFor(material: FeffMaterial, entry: FixtureCase): ExafsParameters {
  const input = entry.parameters;
  const params: ExafsParameters = { s02: input.s02, e0_eV: input.e0_eV, paths: {} };
  if ('sigma2_A2' in input) params.sigma2_A2 = input.sigma2_A2;
  for (const [siteIndex, site] of material.sites.entries()) {
    const record = entry.path_parameters[siteIndex];
    for (const [pathIndex, path] of site.paths.entries()) {
      params.paths![`${site.id}/${path.id}`] = {
        deltar_A: input.deltar_fraction * path.reff,
        // Case c has path-dependent Einstein disorder; for a and b this repeats the global value.
        sigma2_A2: record.rounded_sigma2_A2[pathIndex],
      };
    }
  }
  return params;
}

function relativeRms(actual: readonly number[], expected: readonly number[], start = 0): number {
  let difference = 0, signal = 0;
  for (let i = start; i < actual.length; i++) {
    difference += (actual[i] - expected[i]) ** 2;
    signal += expected[i] ** 2;
  }
  return Math.sqrt(difference / signal);
}

describe('Larch-compatible FEFF path sum', () => {
  it('loads each path set lazily and caches it', async () => {
    const first = await loadPaths('cu');
    expect(first.id).toBe('cu');
    expect(await loadPaths(' CU ')).toBe(first);
    await expect(loadPaths('missing')).rejects.toThrow(/Unknown FEFF path set/);
  });

  for (const [id, fixture] of Object.entries(fixtures.materials)) {
    for (const entry of fixture.cases) {
      it(`${id} case ${entry.parameters.id} matches Larch's rounded-path result`, async () => {
        const material = await loadPaths(id);
        const result = chiSum(material, parametersFor(material, entry), fixtures.k_A_inv);
        const start = fixtures.k_A_inv.findIndex(k => k >= 2);
        expect(result.k_A_inv).toEqual(fixtures.k_A_inv);
        expect(result.provenance).toBe('computed');
        expect(result.contributions).toHaveLength(material.sites.reduce((sum, site) => sum + site.paths.length, 0));
        expect(relativeRms(result.chi, entry.chi_rounded, start)).toBeLessThan(0.001);
        for (let i = start; i < result.chi.length; i++) {
          expect(Math.abs(result.chi[i] - entry.chi_rounded[i])).toBeLessThan(1e-6);
        }
        const reconstructed = result.chi.map((_, i) => result.contributions.reduce((sum, path) => sum + path.chi[i], 0));
        expect(relativeRms(reconstructed, result.chi, start)).toBeLessThan(1e-14);
      });
    }
  }

  it('applies global, path-id and site-qualified overrides in that order', async () => {
    const material = await loadPaths('fe3o4');
    const pathA = material.sites[0].paths[0], pathB = material.sites[1].paths[0];
    const grid = fixtures.k_A_inv.slice(0, 81);
    const sum = chiSum(material, {
      sigma2_A2: 0.003,
      paths: {
        [pathA.id]: { sigma2_A2: 0.004 },
        [`${material.sites[1].id}/${pathB.id}`]: { sigma2_A2: 0.005 },
      },
    }, grid);
    expect(sum.contributions.find(x => x.key === `${material.sites[0].id}/${pathA.id}`)!.parameters.sigma2_A2).toBe(0.004);
    expect(sum.contributions.find(x => x.key === `${material.sites[1].id}/${pathB.id}`)!.parameters.sigma2_A2).toBe(0.005);
  });

  it('uses crystallographic weights for a multi-site average and accepts custom populations', async () => {
    const material = await loadPaths('fe3o4');
    const grid = fixtures.k_A_inv;
    const params: ExafsParameters = { s02: 0.9, sigma2_A2: 0.004 };
    const combined = chiSum(material, params, grid);
    const siteA = chiSum(material, params, grid, { siteWeights: { FeA: 1, FeB: 0 } });
    const siteB = chiSum(material, params, grid, { siteWeights: { FeA: 0, FeB: 1 } });
    for (let i = 0; i < grid.length; i++) {
      expect(combined.chi[i]).toBeCloseTo(siteA.chi[i] / 3 + 2 * siteB.chi[i] / 3, 13);
    }
    const equal = chiSum(material, params, grid, { siteWeights: { FeA: 3, FeB: 3 } });
    for (let i = 0; i < grid.length; i++) expect(equal.chi[i]).toBeCloseTo((siteA.chi[i] + siteB.chi[i]) / 2, 13);
  });
});

describe('EXAFS disorder and energy conversion', () => {
  for (const [id, rows] of Object.entries(fixtures.einstein)) {
    it(`${id} Einstein sigma2 agrees with Larch`, async () => {
      const material = await loadPaths(id);
      for (const row of rows) {
        const path = material.sites[0].paths.find(candidate => candidate.id === row.path_id)!;
        row.temperatures_K.forEach((temperature, i) => {
          const actual = sigma2Einstein(path, row.theta_einstein_K, temperature);
          expect(Math.abs(actual / row.sigma2_A2[i] - 1)).toBeLessThan(0.005);
        });
      }
    });
  }

  it('returns zero below E0 and 1 + chi above it with computed provenance', async () => {
    const material = await loadPaths('cu');
    const energies = [8978, 8979, 8980, 9000];
    const result = chiOfEnergy(material, { s02: 0.9, sigma2_A2: 0.003 }, energies, 8979);
    expect(result.provenance).toBe('computed');
    expect(result.factor[0]).toBe(0);
    expect(result.k_A_inv[0]).toBe(0);
    for (let i = 1; i < energies.length; i++) expect(result.factor[i]).toBeCloseTo(1 + result.chi[i], 14);
    const scalar = chiOfEnergy(material, { s02: 0.9, sigma2_A2: 0.003 }, 9000, 8979);
    expect(scalar.factor).toBeCloseTo(1 + scalar.chi, 14);
    expect(scalar.provenance).toBe('computed');
  });

  it('chiPath applies the same first-point convention as a one-path sum', async () => {
    const material = await loadPaths('cu');
    const path = material.sites[0].paths[0];
    const params = { s02: 0.9, e0_eV: 2, deltar_A: 0.01, sigma2_A2: 0.0085, c3_A3: 0.0001 };
    const direct = chiPath(path, params, fixtures.k_A_inv);
    const summed = chiSum({ ...material, sites: [{ ...material.sites[0], weight: 1, paths: [path] }] }, params, fixtures.k_A_inv);
    expect(direct).toEqual(summed.chi);
  });

  it('matches Larch with nonzero imaginary shift, third cumulant and fourth cumulant', async () => {
    const material = await loadPaths(cumulantFixture.source.material);
    const site = material.sites.find(candidate => candidate.id === cumulantFixture.source.site)!;
    const path = site.paths.find(candidate => candidate.id === cumulantFixture.source.path_id)!;
    const actual = chiPath(path, cumulantFixture.parameters, cumulantFixture.k_A_inv);
    expect(cumulantFixture.source.data_sha256).toBe(fixtures.materials.cu.data_sha256);
    expect(cumulantFixture.versions.xraylarch).toBe(fixtures.versions.xraylarch);
    expect(cumulantFixture.call).toContain("interp='cubic'");
    for (let i = 0; i < actual.length; i++) {
      expect(Math.abs(actual[i] - cumulantFixture.chi[i])).toBeLessThan(1e-8);
    }
  });
});

describe('EXAFS performance', () => {
  it('evaluates 80 paths on a 600-point grid within a generous regression limit', async () => {
    const material = await loadPaths('lifepo4');
    expect(material.sites.reduce((sum, site) => sum + site.paths.length, 0)).toBe(80);
    const grid = Array.from({ length: 600 }, (_, i) => 16 * i / 599);
    const params = { s02: 0.9, sigma2_A2: 0.004 };
    // Prepare spline values and let V8 optimise the stable hot path before timing it.
    for (let warmup = 0; warmup < 5; warmup++) chiSum(material, params, grid);
    const timings: number[] = [];
    for (let repeat = 0; repeat < 11; repeat++) {
      const start = performance.now();
      chiSum(material, params, grid);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    // Typical local median is recorded in CODEX_PROGRESS.md. The larger bound prevents
    // a loaded CI host from turning this benchmark into a flaky correctness test.
    expect(timings[5]).toBeLessThan(25);
  });
});
