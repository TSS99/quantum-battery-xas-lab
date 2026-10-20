import { describe, expect, it } from 'vitest';
import examples from '../data/xas-reduction/examples.json';
import larch from '../data/xas-reduction/larch-reference.json';
import { MAX_BEAMLINE_ROWS, declaredEdge, guessColumns, layoutKey, parseBeamlineFile } from './beamline-files';

const file = (name: string) => examples.files.find(item => item.name === name)!;

describe('XDI 1.0', () => {
  it('reads the columns, units and fields that larch.io.read_xdi reads', () => {
    for (const scan of larch.feScans) {
      const table = parseBeamlineFile(file(scan.file).text, scan.file);
      expect(table.format).toBe('xdi');
      expect(table.version).toBe('XDI/1.0 XASLab-synthetic/1.0');
      expect(table.labels).toEqual(scan.xdi.array_labels);
      expect(table.units).toEqual(scan.xdi.array_units);
      expect(table.columns[0]).toHaveLength(scan.xdi.npts);
      expect(table.metadata['Element.symbol']).toBe(scan.xdi.element.symbol);
      expect(Number(table.metadata['Mono.d_spacing'])).toBe(scan.xdi.mono_d_spacing);
      expect(table.comments[0]).toMatch(/^Synthetic transmission scan/);
      expect(declaredEdge(table)).toEqual({ element: 'Fe', edge: 'K' });
    }
  });

  it('falls back to the label line after #---- when there are no Column fields', () => {
    const table = parseBeamlineFile('# XDI/1.0\n# Element.Symbol: Cu\n# Element.EDGE: L3\n# ///\n#----\n# energy i0 it\n8900 10 5\n8901 10 5\n', 'x.xdi');
    expect(table.labels).toEqual(['energy', 'i0', 'it']);
    // XDI field names are case-insensitive.
    expect(declaredEdge(table)).toEqual({ element: 'Cu', edge: 'L3' });
    expect(declaredEdge(parseBeamlineFile('# Element.symbol: Cu\n1 2\n2 3\n'))).toBeNull();
  });

  it('reads a file saved with a byte-order mark', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseBeamlineFile(bom + '# XDI/1.0\n# Column.1: energy eV\n# Column.2: i0\n#----\n1 2\n2 3\n').format).toBe('xdi');
  });

  it('proposes energy, I0, It and Iref for transmission', () => {
    const guess = guessColumns(parseBeamlineFile(file('fe2o3_bn_scan1.xdi').text));
    expect(guess).toMatchObject({ energy: 0, energyUnit: 'eV', mode: 'transmission', i0: 1, it: 2, iref: 3, fluorescence: [] });
  });
});

describe('generic beamline ASCII', () => {
  const cu = parseBeamlineFile(file(larch.cu.file).text, larch.cu.file);

  it('finds the same columns as larch.io.read_ascii', () => {
    expect(cu.format).toBe('ascii');
    expect(cu.columns).toHaveLength(larch.cu.read_ascii_labels.length);
    expect(cu.columns[0]).toHaveLength(larch.cu.npts);
    // Larch reads the label line ";Energy ..." as "_energy"; this reader drops the comment character.
    expect(cu.labels.map(label => label.toLowerCase())).toEqual(larch.cu.read_ascii_labels.map(label => label.replace(/^_/, '')));
    expect(cu.metadata.Sample).toMatch(/^dilute Cu\(II\) in water/);
  });

  it('sums the live fluorescence channels and leaves out the dead one', () => {
    const guess = guessColumns(cu);
    expect(guess).toMatchObject({ mode: 'fluorescence', energy: 0, i0: 1, it: 2, iref: 3, fluorescence: [4, 5, 7] });
    expect(guess.excluded).toEqual([{ column: 6, reason: expect.stringMatching(/dead channel/) }]);
  });

  it('reads commas, tabs and semicolons, pads short rows and numbers unlabeled columns', () => {
    const table = parseBeamlineFile('scan 12\n1.0, 2.0, 3\n2.0;4.0;6\n3.0\t6.0\n4 8 12\n', 'plain.txt');
    expect(table.labels).toEqual(['col1', 'col2', 'col3']);
    expect(table.columns[2].slice(0, 2)).toEqual([3, 6]);
    expect(table.columns[2][2]).toBeNaN();
    expect(table.paddedRows).toBe(1);
  });

  it('uses an uncommented label line and keeps the last numeric block as data', () => {
    const table = parseBeamlineFile('E(keV) I0 It\n7.0 1 2\n7.1 1 2\n# end of scan\n', 'k.dat');
    expect(table.labels).toEqual(['E(keV)', 'I0', 'It']);
    expect(table.columns[0]).toEqual([7.0, 7.1]);
    expect(guessColumns(table).energyUnit).toBe('keV');
  });

  it('makes repeated labels distinct and groups files by layout', () => {
    const a = parseBeamlineFile('# e i0 i0\n1 2 3\n2 3 4\n'), b = parseBeamlineFile('# e i0 i0\n5 6 7\n6 7 8\n');
    expect(a.labels).toEqual(['e', 'i0', 'i0_3']);
    expect(layoutKey(a)).toBe(layoutKey(b));
  });

  it('explains files it cannot use', () => {
    expect(() => parseBeamlineFile('# only text\n# more text\n')).toThrow(/No rows of numbers/);
    expect(() => parseBeamlineFile('1\n2\n3\n')).toThrow(/only one column/);
    expect(() => parseBeamlineFile(Array.from({ length: MAX_BEAMLINE_ROWS + 1 }, (_, i) => `${i} 1`).join('\n'))).toThrow(/limit is 20000/);
  });
});
