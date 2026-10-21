import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import fixture from '@/data/twin/larch-export-fixture.json';
import type { Acquisition } from './types';
import { readXdi } from './xdi';
import { reduceAcquisition } from './reduction';

describe('Larch acquisition export', () => {
  it('matches xraylarch for E0, edge step and the uncorrected peak R', () => {
    const file = readXdi(readFileSync(join(process.cwd(), fixture.xdi), 'utf8'));
    const acquisition: Acquisition = { id: 'fixture', kind: 'transmission', columns: file.columns, metadata: file.fields, provenance: ['computed'] };
    const result = reduceAcquisition(acquisition);
    const peak = result.exafs.xftf.magnitude.reduce((best, value, index, all) => value > all[best] ? index : best, 0);
    expect(result.pre.e0).toBeCloseTo(fixture.result.e0_eV, 0);
    expect(Math.abs(result.pre.e0 - fixture.result.e0_eV)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(result.pre.edgeStep / fixture.result.edgeStep - 1)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(result.exafs.xftf.r[peak] - fixture.result.peakR_A)).toBeLessThanOrEqual(0.05);
  });

  it('exports the explicit reduction calls', () => {
    const script = readFileSync(join(process.cwd(), fixture.script), 'utf8');
    expect(script).toContain('pre_edge(');
    expect(script).toContain('autobk(');
    expect(script).toContain('xftf(');
  });
});
