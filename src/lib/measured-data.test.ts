import { beforeAll, describe, expect, it } from 'vitest';
import examples from '../data/xas-reduction/examples.json';
import larch from '../data/xas-reduction/larch-reference.json';
import { guessColumns, parseBeamlineFile, type ColumnMapping } from './beamline-files';
import { larchScript, muFromTable, processingNotes, processingRecord, reduceScans, savedCurve } from './measured-data';
import { validateSpectrum } from './spectra';
import { elementInfo, loadXrayData } from './xraydata';

const tables = examples.files.map(item => parseBeamlineFile(item.text, item.name));
const feTables = tables.slice(0, 3), cuTable = tables[3];
const maxAbs = (a: number[], b: number[]) => { expect(a.length).toBe(b.length); return Math.max(...a.map((value, i) => Math.abs(value - b[i]))); };
let feK = 0;
beforeAll(async () => { await loadXrayData(); feK = elementInfo('Fe').edges.find(edge => edge.edge === 'K')!.energy_eV; });

describe('mu(E) from detector columns', () => {
  // Observed max |difference| from Larch: 5e-12 (the fixture stores 12 significant digits).
  it('computes ln(I0/It) and ln(It/Iref) like the Larch reference', () => {
    feTables.forEach((table, i) => {
      const scan = muFromTable(table, guessColumns(table));
      expect(maxAbs(scan.mu, larch.feScans[i].mu)).toBeLessThan(1e-10);
      expect(maxAbs(scan.muRef!, larch.feScans[i].mu_ref)).toBeLessThan(1e-10);
      expect(scan.removed).toEqual({ nonFinite: 0, repeated: 0, reordered: false });
    });
  });

  it('sums the chosen fluorescence channels over I0', () => {
    const scan = muFromTable(cuTable, guessColumns(cuTable));
    expect(maxAbs(scan.mu, larch.cu.mu)).toBeLessThan(1e-12);
    expect(maxAbs(scan.muRef!, larch.cu.mu_ref)).toBeLessThan(1e-10);
  });

  it('removes undefined, out-of-order and repeated rows and counts them', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [7000 + i, 100, 50]);
    rows[3][2] = 0; rows[4][2] = -5;                 // ln(100/0) and ln(100/-5) are undefined
    rows.push([7005, 100, 40], [6999, 100, 50]);     // a repeated energy and an earlier one
    const table = parseBeamlineFile(rows.map(row => row.join(' ')).join('\n'), 'test.dat');
    const mapping: ColumnMapping = { energy: 0, energyUnit: 'eV', mode: 'transmission', i0: 1, it: 2, fluorescence: [], iref: null };
    const scan = muFromTable(table, mapping);
    expect(scan.removed).toEqual({ nonFinite: 2, repeated: 1, reordered: true });
    expect(scan.energy[0]).toBe(6999);
    expect(scan.energy.every((value, i) => i === 0 || value > scan.energy[i - 1])).toBe(true);
    expect(scan.mu[scan.energy.indexOf(7005)]).toBeCloseTo(Math.log(2), 12);   // the first 7005 row is kept
    expect(muFromTable(table, { ...mapping, energyUnit: 'keV' }).energy[0]).toBe(6999000);
  });

  it('explains a mapping that cannot work', () => {
    const table = feTables[0], mapping = guessColumns(table);
    expect(() => muFromTable(table, { ...mapping, it: null })).toThrow(/choose the It column/);
    expect(() => muFromTable(table, { ...mapping, it: 1 })).toThrow(/must be different columns/);
    expect(() => muFromTable(table, { ...mapping, mode: 'fluorescence', fluorescence: [] })).toThrow(/at least one fluorescence channel/);
  });
});

describe('calibration, merge and normalization', () => {
  const scans = () => feTables.map(table => muFromTable(table, guessColumns(table)));

  it('uses the XrayDB Fe K edge that the fixtures used', () => {
    expect(feK).toBe(larch.tabulatedEdges_eV['Fe K']);
  });

  it('shifts each scan by its own reference foil and merges and normalizes like Larch', () => {
    const result = reduceScans({ scans: scans(), calibration: { label: 'Fe K', energy: feK }, merge: 'cubic', preEdge: {} });
    result.scans.forEach((scan, i) => {
      expect(scan.e0Ref).toBeCloseTo(larch.feScans[i].e0_ref, 6);
      expect(scan.shift).toBeCloseTo(larch.feScans[i].shift_eV, 6);
    });
    expect(maxAbs(result.merged!.mu, larch.merge.mu)).toBeLessThan(1e-10);
    const expected = larch.preEdge['merged-defaults'];
    expect(result.norm.e0).toBeCloseTo(expected.e0, 6);
    expect(Math.abs(result.norm.edgeStep / expected.edge_step - 1)).toBeLessThan(1e-9);
    expect(maxAbs(result.norm.flat, expected.flat)).toBeLessThan(1e-9);
    expect(result.spread).toBeGreaterThan(0);
    expect(result.spread).toBeLessThan(0.05);
    expect(result.warnings).toEqual([]);
  });

  it('recovers the synthetic monochromator offsets to within one energy step', () => {
    // The generator offsets each scan's energy axis; calibration should undo most of it.
    const offsets = examples.generator.monoOffsets_eV as Record<string, number>;
    const result = reduceScans({ scans: scans(), calibration: { label: 'Fe K', energy: feK }, merge: 'cubic', preEdge: {} });
    for (const scan of result.scans) expect(Math.abs(scan.shift - offsets[scan.name])).toBeLessThan(0.4);
  });

  it('leaves energies alone without calibration and normalizes a single scan', () => {
    const [first] = scans();
    const result = reduceScans({ scans: [first], calibration: null, merge: 'cubic', preEdge: { nnorm: 1 } });
    expect(result.merged).toBeNull();
    expect(result.scans[0].shift).toBe(0);
    expect(result.energy).toEqual(first.energy);
    expect(result.norm.nnorm).toBe(1);
    expect(result.spread).toBeNull();
  });

  it('warns when the reference edge is far from the tabulated edge', () => {
    const result = reduceScans({ scans: scans().slice(0, 1), calibration: { label: 'Mn K', energy: 6539 }, merge: 'cubic', preEdge: {} });
    expect(result.warnings[0]).toMatch(/572\.6 eV from the tabulated Mn K edge/);
  });

  it('needs a reference channel to calibrate', () => {
    const table = feTables[0], scan = muFromTable(table, { ...guessColumns(table), iref: null });
    expect(() => reduceScans({ scans: [scan], calibration: { label: 'Fe K', energy: feK }, merge: 'cubic', preEdge: {} })).toThrow(/needs a reference channel/);
  });
});

describe('saving to the curve list', () => {
  const sources = feTables.map(table => ({ table, mapping: guessColumns(table), sha256: 'a'.repeat(64), example: true }));
  const request = { calibration: { label: 'Fe K', energy: 7112 }, merge: 'cubic' as const, preEdge: {} };
  const scans = sources.map(source => muFromTable(source.table, source.mapping));
  const result = reduceScans({ ...request, scans });

  it('stores norm or flat as a dimensionless, calibrated, imported curve that passes validation', () => {
    const notes = processingNotes(sources, request, result, scans);
    for (const quantity of ['normalized', 'flattened'] as const) {
      const curve = validateSpectrum(savedCurve(result, quantity, { id: 'x', name: 'Fe2O3 merged', sources, notes, calibration: request.calibration }));
      expect(curve.quantity).toBe(quantity);
      expect(curve.mu_cm_inv).toEqual(quantity === 'normalized' ? result.norm.norm : result.norm.flat);
      expect(curve.provenance).toBe('imported');
      expect(curve.declaredProvenance).toBe('synthetic');
      expect(curve.sampleId).toBe('Fe2O3 in BN pellet, synthetic');
      expect(curve.calibration).toMatchObject({ status: 'user-declared', offset_eV: 0 });
      expect(curve.calibration!.reference).toContain('+0.403, -0.398, +0.000 eV');
      expect(curve.sourceSha256).toBeUndefined();
    }
    expect(notes).toContain('mu = ln(i0/itrans), reference ln(itrans/irefer), energy energy in eV');
    expect(notes).toContain('nnorm=2, nvict=0');
    expect(notes.length).toBeLessThan(8000);
  });

  it('marks user files as user supplied and keeps the hash of a single file', () => {
    const one = [{ ...sources[0], example: false }];
    const single = reduceScans({ ...request, scans: scans.slice(0, 1) });
    const curve = validateSpectrum(savedCurve(single, 'normalized', { id: 'y', name: 'one scan', sources: one, notes: '', calibration: null }));
    expect(curve.declaredProvenance).toBeUndefined();
    expect(curve.sourceSha256).toBe('a'.repeat(64));
    expect(curve.calibration).toMatchObject({ status: 'uncalibrated' });
  });

  it('writes a record with the files, mapping, shifts, parameters and arrays', () => {
    const record = processingRecord(sources, request, result, scans);
    expect(record.larchPort).toBe(larch.versions.xraylarch);
    expect(record.calibration!.scans.map(scan => scan.shift_eV)).toEqual(result.scans.map(scan => scan.shift));
    expect(record.preEdge.used).toMatchObject({ pre1: -200, pre2: -100, norm1: 25, nnorm: 2 });
    expect(record.arrays.norm).toHaveLength(result.norm.energy.length);
    expect(JSON.parse(JSON.stringify(record)).files[0].mapping.i0).toBe(1);
  });
});

describe('reproduction script', () => {
  it('passes the ranges, polynomial degree and files to xraylarch', () => {
    const result = reduceScans({ scans: feTables.map(table => muFromTable(table, guessColumns(table))), calibration: { label: 'Fe K', energy: feK }, merge: 'cubic', preEdge: { nnorm: 2 } });
    const script = larchScript(feTables.map(table => ({ name: table.name, format: table.format, mapping: guessColumns(table) })), { calibration: { label: 'Fe K', energy: feK }, merge: 'cubic', preEdge: { nnorm: 2 } }, result);
    expect(script).toContain('("fe2o3_bn_scan2.xdi", "xdi", {\'energy\': 0, \'scale\': 1, \'mode\': \'transmission\', \'i0\': 1, \'it\': 2, \'it_ref\': 2, \'iref\': 3}),');
    expect(script).toContain('E_EDGE = 7112.0');
    expect(script).toContain(`pre_edge(merged.energy, merged.mu, group=out, pre1=-200.0, pre2=-100.0, norm1=25.0, norm2=${result.norm.norm2}, nnorm=2, nvict=0)`);
    expect(script).toContain('merge_groups(groups, kind="cubic")');
    expect(script).not.toMatch(/\be0=/);
  });
});
