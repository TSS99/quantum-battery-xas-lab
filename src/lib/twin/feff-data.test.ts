import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FeffCitation, FeffIndexEntry, FeffMaterial } from './types';
import manifest from '../../data/twin/feff/manifest.json';
import fixtures from '../../data/twin/feff-fixtures.json';

const directory = join(process.cwd(), 'src/data/twin/feff');
const index: FeffIndexEntry[] = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'));
const materials: FeffMaterial[] = index.map(row => JSON.parse(readFileSync(join(directory, `${row.id}.json`), 'utf8')));
const columns = ['k', 'real_phc', 'mag_feff', 'pha_feff', 'red_fact', 'lam', 'rep'] as const;
const targetIds = [
  'cu', 'fe-bcc', 'ni', 'co-hcp', 'zn-hcp', 'ti-hcp', 'v-bcc', 'cr-bcc', 'pd', 'ag', 'pt', 'au',
  'limn2o4', 'licoo2', 'linio2', 'lifepo4', 'li2mno3',
  'mno', 'mn3o4', 'beta-mno2', 'nio', 'coo', 'co3o4', 'cuo', 'cu2o', 'zno',
  'alpha-fe2o3', 'fe3o4', 'tio2-rutile', 'tio2-anatase', 'v2o5', 'ceo2', 'srtio3', 'fes2', 'li2s',
];
const fixtureIds = ['cu', 'fe-bcc', 'pt', 'limn2o4', 'licoo2', 'lifepo4', 'nio', 'fe3o4', 'zno', 'ceo2'];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const finite = (values: number[]) => values.every(value => typeof value === 'number' && Number.isFinite(value));

function citation(source: FeffCitation) {
  expect(source.reference.length).toBeGreaterThan(10);
  expect(source.doi).toMatch(/^10\.\d{4,9}\/\S+$/);
  expect(source.locator.length).toBeGreaterThan(10);
  expect(typeof source.url).toBe('string');
}

describe('FEFF library coverage and provenance', () => {
  it('accounts for every requested structure exactly once', () => {
    const ids = [...index.map(x => x.id), ...manifest.dropped.map(x => x.id)];
    expect(ids.sort()).toEqual([...targetIds].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of manifest.dropped) expect(row.reason.length).toBeGreaterThan(20);
    expect(readdirSync(directory).filter(x => x.endsWith('.json')).sort()).toEqual(
      [...index.map(x => `${x.id}.json`), 'index.json', 'manifest.json'].sort(),
    );
  });

  it('records the reference environment and FEFF calculation settings', () => {
    expect(manifest.schema_version).toBe(1);
    expect(manifest.versions.xraylarch).toBe('2026.3.1');
    expect(manifest.versions).toEqual(fixtures.versions);
    expect(manifest.feff_executable_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.settings).toMatchObject({
      cluster_radius_A: 7, rmax_A: 6, max_paths_per_site: 80,
      max_gzip_bytes: 40_000, significant_digits: 5,
    });
  });

  it.each(materials)('$id agrees with its index, manifest and gzip budget', material => {
    const bytes = readFileSync(join(directory, `${material.id}.json`));
    const row = index.find(x => x.id === material.id)!;
    const record = manifest.files.find(x => x.id === material.id)!;
    expect(material.schema_version).toBe(1);
    expect(material).toMatchObject({
      id: row.id, formula: row.formula, absorber: row.absorber,
      edge: row.edge, edge_energy_eV: row.edge_energy_eV,
    });
    expect(['K', 'L3']).toContain(material.edge);
    expect(material.edge_energy_eV).toBeGreaterThan(0);
    expect(record.sha256).toBe(hash(bytes));
    expect(record.bytes).toBe(bytes.length);
    // zlib versions may choose different deflate blocks. The actual budget is
    // enforced independently, while the manifest records Python's byte count.
    expect(gzipSync(bytes, { level: 9 }).length).toBeLessThanOrEqual(40_000);
    expect(record.gzip_bytes).toBeLessThanOrEqual(40_000);
    const count = material.sites.reduce((sum, site) => sum + site.paths.length, 0);
    expect(row.number_of_paths).toBe(count);
    expect(record.number_of_paths).toBe(count);
    expect(record.available_paths).toBe(material.sites.reduce((sum, site) => sum + site.available_paths, 0));
    citation(material.citation);
  });
});

describe('crystal admission checks', () => {
  it.each(materials)('$id has passing, sourced checks for every absorber orbit', material => {
    const { structure, checks, sites } = material;
    expect(checks.passed).toBe(true);
    expect(checks.composition.passed).toBe(true);
    expect(checks.composition.expected).toBe(material.formula);
    expect(finite(structure.lattice_A_deg)).toBe(true);
    expect(structure.lattice_A_deg).toHaveLength(6);
    expect(structure.lattice_A_deg.every(x => x > 0)).toBe(true);
    expect(structure.space_group).toBeGreaterThanOrEqual(1);
    expect(structure.space_group).toBeLessThanOrEqual(230);
    expect(structure.positions.length).toBeGreaterThan(0);
    const counts: Record<string, number> = {};
    for (const position of structure.positions) {
      expect(position.wyckoff).toMatch(/^\d+[a-z]$/);
      expect(position.fractional).toHaveLength(3);
      expect(position.fractional.every(x => Number.isFinite(x) && x >= 0 && x < 1)).toBe(true);
      counts[position.element] = (counts[position.element] ?? 0) + parseInt(position.wyckoff);
    }
    expect(counts).toEqual(checks.composition.cell);
    // Independently check element ratios from the simple formula syntax used
    // by this library, without trusting the generator's passed flag.
    const formula = [...material.formula.matchAll(/([A-Z][a-z]?)(\d*)/g)];
    expect(formula.map(match => match[0]).join('')).toBe(material.formula);
    expect(Object.keys(counts).sort()).toEqual(formula.map(match => match[1]).sort());
    const ratios = formula.map(([, element, count]) => counts[element] / Number(count || 1));
    expect(ratios.every(x => x === ratios[0])).toBe(true);
    const density = checks.density;
    citation(density.source);
    expect(density.passed).toBe(true);
    expect(density.literature_g_cm3).toBeGreaterThan(0);
    expect(Math.abs(density.computed_g_cm3 / density.literature_g_cm3 - 1)).toBeLessThanOrEqual(.02);
    expect(density.relative_error).toBeCloseTo(Math.abs(density.computed_g_cm3 / density.literature_g_cm3 - 1), 8);
    expect(density.tolerance).toBe(.02);
    expect(checks.symmetry.map(x => x.symprec_A)).toEqual([.0001, .001, .01]);
    expect(checks.symmetry.every(x => x.space_group === structure.space_group)).toBe(true);
    expect(checks.nearest.map(x => x.site).sort()).toEqual(sites.map(x => x.id).sort());
    for (const check of checks.nearest) {
      citation(check.source);
      expect(check.passed).toBe(true);
      expect(check.tolerance_A).toBe(.02);
      expect(Math.abs(check.computed_A - check.distance_A)).toBeLessThanOrEqual(.02);
      expect(check.absolute_error_A).toBeCloseTo(Math.abs(check.computed_A - check.distance_A), 8);
      const shortest = sites.find(x => x.id === check.site)!.paths.filter(x => x.nleg === 2)[0];
      expect(shortest.reff).toBeCloseTo(check.computed_A, 3);
      expect(shortest.geometry[1].label).toBe(check.element);
    }
    expect(sites.reduce((sum, site) => sum + site.multiplicity, 0)).toBe(counts[material.absorber]);
    expect(sites.reduce((sum, site) => sum + site.weight, 0)).toBeCloseTo(1, 14);
    for (const site of sites) {
      expect(site.weight).toBeCloseTo(site.multiplicity / counts[material.absorber], 14);
      expect(site.cluster_atoms).toBeGreaterThan(1);
      expect(site.input_sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it.each([['cu', 2.556, 12], ['fe-bcc', 2.48, 8], ['ni', 2.49, 12]] as const)(
    '%s retains its known first-shell length and degeneracy', (id, distance, degeneracy) => {
      const first = materials.find(x => x.id === id)!.sites[0].paths[0];
      expect(first.nleg).toBe(2);
      expect(Math.abs(first.reff - distance)).toBeLessThan(.02);
      expect(first.degen).toBe(degeneracy);
    },
  );

  it('preserves both magnetite sites and their multiplicity weights', () => {
    const sites = materials.find(x => x.id === 'fe3o4')!.sites;
    expect(sites.map(x => [x.id, x.multiplicity, x.weight])).toEqual([['FeA', 8, 1 / 3], ['FeB', 16, 2 / 3]]);
    expect(materials.find(x => x.id === 'pt')!.edge).toBe('L3');
    expect(materials.find(x => x.id === 'ceo2')!.edge).toBe('L3');
  });
});

describe('native FEFF paths', () => {
  it.each(materials)('$id has finite, complete arrays and consistent closed-path geometry', material => {
    for (const site of material.sites) {
      expect(site.paths.length).toBeGreaterThan(0);
      expect(site.paths.length).toBeLessThanOrEqual(80);
      expect(site.available_paths).toBeGreaterThanOrEqual(site.paths.length);
      expect(new Set(site.paths.map(x => x.id)).size).toBe(site.paths.length);
      for (const path of site.paths) {
        expect(path.id).toMatch(/^feff\d{4}$/);
        expect(path.reff).toBeGreaterThan(0);
        expect(path.reff).toBeLessThanOrEqual(6);
        expect(Number.isInteger(path.nleg) && path.nleg >= 2).toBe(true);
        expect(path.geometry).toHaveLength(path.nleg);
        expect(path.degen).toBeGreaterThan(0);
        expect(path.k[0]).toBe(0);
        expect(path.k.at(-1)).toBeGreaterThanOrEqual(20);
        expect(path.k.every((k, i) => i === 0 || k > path.k[i - 1])).toBe(true);
        for (const column of columns) {
          expect(path[column]).toHaveLength(path.k.length);
          expect(finite(path[column])).toBe(true);
          expect(path[column].every(x => x === Number(x.toPrecision(5)))).toBe(true);
        }
        expect(path.lam.every(x => x > 0)).toBe(true);
        expect(path.geometry[0].label).toBe(material.absorber);
        expect(path.geometry[0].xyz_A).toEqual([0, 0, 0]);
        expect(path.geometry[0].ipot).toBe(0);
        let length = 0;
        path.geometry.forEach((atom, i) => {
          expect(atom.label).toMatch(/^[A-Z][a-z]?$/);
          expect(Number.isInteger(atom.atomic_number) && atom.atomic_number > 0).toBe(true);
          expect(atom.mass_amu).toBeGreaterThan(0);
          expect(atom.xyz_A).toHaveLength(3);
          expect(finite(atom.xyz_A)).toBe(true);
          const next = path.geometry[(i + 1) % path.nleg].xyz_A;
          length += Math.hypot(...atom.xyz_A.map((x, j) => x - next[j]));
        });
        // FEFF writes geometry/reff to four decimals before our five-digit rounding.
        expect(Math.abs(length / 2 - path.reff)).toBeLessThan(.0006);
      }
    }
  });
});

describe('test-only Larch golden fixtures', () => {
  it('covers all ten requested materials, three parameter sets and the complete grid', () => {
    expect(fixtures.schema_version).toBe(1);
    expect(Object.keys(fixtures.materials).sort()).toEqual([...fixtureIds].sort());
    expect(fixtures.omitted_materials).toEqual([]);
    expect(fixtures.k_A_inv).toEqual(Array.from({ length: 321 }, (_, i) => i / 20));
    expect(fixtures.calls.join('\n')).toContain('larch.xafs.ff2chi');
    expect(fixtures.calls.join('\n')).toContain('larch.xafs.sigma2_eins');
    for (const [id, fixture] of Object.entries(fixtures.materials)) {
      const material = materials.find(x => x.id === id)!;
      expect(fixture.data_sha256).toBe(hash(readFileSync(join(directory, `${id}.json`))));
      expect(fixture.cases.map(x => x.parameters.id)).toEqual(['a', 'b', 'c']);
      for (const entry of fixture.cases) {
        expect(entry.chi).toHaveLength(321);
        expect(entry.chi_rounded).toHaveLength(321);
        expect(finite(entry.chi) && finite(entry.chi_rounded)).toBe(true);
        expect(entry.chi.some(x => Math.abs(x) > .001)).toBe(true);
        const values = entry.chi.slice(40);
        const rms = Math.hypot(...entry.chi_rounded.slice(40).map((x, i) => x - values[i])) / Math.hypot(...values);
        expect(rms).toBeLessThan(.001);
        expect(entry.path_parameters.map(x => x.site)).toEqual(material.sites.map(x => x.id));
        entry.path_parameters.forEach((record, i) => {
          expect(record.path_ids).toEqual(material.sites[i].paths.map(x => x.id));
          expect(record.sigma2_A2).toHaveLength(record.path_ids.length);
          expect(record.rounded_sigma2_A2).toHaveLength(record.path_ids.length);
          expect(record.sigma2_A2.every(x => Number.isFinite(x) && x > 0)).toBe(true);
        });
      }
      expect(fixture.cases[0].parameters).toEqual({ id: 'a', s02: .9, e0_eV: 0, deltar_fraction: 0, sigma2_A2: .003 });
      expect(fixture.cases[1].parameters).toEqual({ id: 'b', s02: .8, e0_eV: 3, deltar_fraction: .01, sigma2_A2: .006 });
      expect(fixture.cases[2].parameters).toEqual({
        id: 'c', s02: 1, e0_eV: -2, deltar_fraction: 0, temperature_K: 300, theta_einstein_K: 250,
      });
      expect(material.accuracy.map(x => x.case)).toEqual(['a', 'b', 'c']);
      for (const record of material.accuracy) {
        expect(record.rounding_relative_rms).toBeLessThan(.001);
        expect(Number.isFinite(record.omission_relative_rms) && record.omission_relative_rms >= 0).toBe(true);
      }
    }
  });

  it('records Einstein disorder for the first three Cu and Fe paths at four temperatures', () => {
    expect(Object.keys(fixtures.einstein).sort()).toEqual(['cu', 'fe-bcc']);
    for (const [id, rows] of Object.entries(fixtures.einstein)) {
      expect(rows).toHaveLength(3);
      expect(rows.map(x => x.path_id)).toEqual(materials.find(x => x.id === id)!.sites[0].paths.slice(0, 3).map(x => x.id));
      for (const row of rows) {
        expect(row.temperatures_K).toEqual([10, 77, 300, 600]);
        expect(row.theta_einstein_K).toBe(250);
        expect(row.sigma2_A2).toHaveLength(4);
        expect(row.sigma2_A2.every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1]))).toBe(true);
      }
    }
  });
});
