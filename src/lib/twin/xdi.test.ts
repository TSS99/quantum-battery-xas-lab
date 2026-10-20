import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { seededRandom } from '../xas';
import { loadOptics } from './tables';
import { runScan } from './acquire';
import { defaultPlan } from './scan';
import { XDI_REQUIRED, readXdi, writeXdi } from './xdi';
import { DEFAULT_TWIN } from '../../components/twin/twin-state';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

describe('XDI files', () => {
  it('round-trips a simulated scan: header fields, column names and every value', () => {
    const scan = runScan({ ...DEFAULT_TWIN, realistic: true }, defaultPlan(8979), seededRandom(2));
    const text = writeXdi(scan, ['Simulated by the XAS Lab beamline twin.']);
    const file = readXdi(text);
    expect(file.version).toBe('XDI/1.0');
    expect(file.labels).toEqual(Object.keys(scan.columns));
    expect(file.fields).toEqual(scan.metadata);
    expect(file.comments).toEqual(['Simulated by the XAS Lab beamline twin.']);
    for (const [name, values] of Object.entries(scan.columns)) {
      file.columns[name].forEach((v, i) => expect(v).toBeCloseTo(values[i], Math.max(0, 9 - Math.ceil(Math.log10(Math.abs(values[i]) + 1)))));
    }
  });

  it('follows the XDI rules: required fields, energy first, integer column tags in order', () => {
    const scan = runScan(DEFAULT_TWIN, defaultPlan(8979), () => 0);
    const lines = writeXdi(scan).split('\n');
    expect(lines[0]).toMatch(/^# XDI\/1\.0 /);
    for (const field of XDI_REQUIRED) expect(lines.some(l => l.startsWith(`# ${field}: `))).toBe(true);
    const tags = lines.filter(l => /^# Column\./.test(l));
    expect(tags[0]).toBe('# Column.1: energy eV');
    tags.forEach((tag, i) => expect(tag).toMatch(new RegExp(`^# Column\\.${i + 1}: [a-z]\\w*`)));
    expect(() => writeXdi({ columns: { i0: [1] }, metadata: scan.metadata })).toThrow(/energy/);
    expect(() => writeXdi({ columns: scan.columns, metadata: { 'Element.symbol': 'Cu' } })).toThrow(/Element\.edge/);
  });

  it('reads plain whitespace columns with a header line', () => {
    const file = readXdi('# my scan\n# energy  i0  it\n8900 100 50\n8910 101 49.5\n');
    expect(file.version).toBe('plain');
    expect(file.labels).toEqual(['energy', 'i0', 'it']);
    expect(file.columns.it).toEqual([50, 49.5]);
    expect(readXdi('1 2\n3 4\n').labels).toEqual(['col1', 'col2']);
    expect(() => readXdi('# nothing\n')).toThrow(/No data/);
  });
});
