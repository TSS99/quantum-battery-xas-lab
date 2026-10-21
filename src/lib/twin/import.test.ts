import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { seededRandom } from '../xas';
import { DEFAULT_TWIN } from '@/components/twin/twin-state';
import { loadOptics } from './tables';
import { dSpacing_A } from './mono';
import { defaultPlan } from './scan';
import { runScan } from './acquire';
import { writeXdi } from './xdi';
import { importAcquisition } from './import';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

describe('twin data import', () => {
  it('keeps the columns and metadata of a twin-written XDI and marks it measured', () => {
    const source = runScan(DEFAULT_TWIN, defaultPlan(8979), seededRandom(4));
    const imported = importAcquisition(writeXdi(source), 'cu-check.xdi', {
      sample: DEFAULT_TWIN.sample,
      monoDSpacing_A: dSpacing_A(DEFAULT_TWIN.profile.mono.crystal),
    });
    expect(imported.declaredSample).toBe(true);
    expect(imported.mode).toBe('transmission');
    expect(imported.acquisition.name).toBe('cu-check');
    expect(imported.acquisition.provenance).toEqual(['measured']);
    expect(imported.acquisition.metadata).toMatchObject(source.metadata);
    expect(Object.keys(imported.acquisition.columns)).toEqual(Object.keys(source.columns));
    imported.acquisition.columns.energy.forEach((value, index) => expect(value).toBeCloseTo(source.columns.energy[index], 5));
    imported.acquisition.columns.mutrans.forEach((value, index) => expect(value).toBeCloseTo(source.columns.mutrans[index], 8));
  });

  it('computes transmission mu from named plain columns and converts keV to eV', () => {
    const rows = Array.from({ length: 16 }, (_, i) => `${8.9 + i * 0.001} 100 ${50 - i}`).join('\n');
    const imported = importAcquisition(`# Energy_keV I0 It\n${rows}\n`, 'plain.dat', {
      sample: DEFAULT_TWIN.sample,
      monoDSpacing_A: 3.135601,
    });
    expect(imported.acquisition.columns.energy[0]).toBe(8900);
    expect(imported.acquisition.columns.mutrans[0]).toBeCloseTo(Math.log(2));
    expect(imported.declaredSample).toBe(false);
  });
});
