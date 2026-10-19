/**
 * The "Measured data" workflow: detector columns to mu(E), reference-foil energy calibration,
 * merging repeated scans and Larch pre_edge normalization. The numerical steps are the Larch ports
 * in ./xas-reduction; this file wires them together, records what was removed or assumed, and
 * writes an equivalent xraylarch script so a result can be reproduced outside the browser.
 */
import { metadataField, type BeamlineTable, type ColumnMapping } from './beamline-files';
import { LARCH_PORT_VERSION, findE0, mergeScans, preEdge, type MergeResult, type PreEdgeParams, type PreEdgeResult } from './xas-reduction';

/** One scan reduced to mu(E) on a strictly increasing energy grid (eV). */
export interface MuScan {
  name: string;
  energy: number[];
  mu: number[];
  /** ln(It / Iref) of the reference foil, when It and Iref are mapped. */
  muRef?: number[];
  /** Rows removed before processing. */
  removed: { nonFinite: number; repeated: number; reordered: boolean };
}

const MIN_POINTS = 16;

function column(table: BeamlineTable, index: number | null, role: string): number[] {
  if (index === null || index < 0 || index >= table.columns.length) throw new Error(`${table.name}: choose the ${role} column.`);
  return table.columns[index];
}

/** The mu(E) formula a mapping uses, as LaTeX, for display. */
export function muFormulaTex(mapping: ColumnMapping): string {
  return mapping.mode === 'transmission' ? '\\mu(E) = \\ln(I_0/I_t)' : '\\mu(E) = I_f/I_0';
}

/**
 * mu(E) from mapped columns: transmission ln(I0/It), fluorescence (sum of channels)/I0, and the
 * reference foil ln(It/Iref). A row is removed when any value it needs is not a finite number
 * (zero or negative counts give an undefined logarithm). Rows are then put in increasing energy
 * order and a row whose energy repeats the previous one is removed. All removals are counted.
 */
export function muFromTable(table: BeamlineTable, mapping: ColumnMapping): MuScan {
  const energy = column(table, mapping.energy, 'energy'), i0 = column(table, mapping.i0, 'I0');
  const used = [mapping.energy, mapping.i0, ...(mapping.mode === 'transmission' ? [mapping.it] : mapping.fluorescence)];
  if (new Set(used).size !== used.length) throw new Error(`${table.name}: energy, I0 and the detector channels must be different columns.`);
  let signal: (row: number) => number;
  if (mapping.mode === 'transmission') {
    const it = column(table, mapping.it, 'It');
    signal = row => Math.log(i0[row] / it[row]);
  } else {
    if (!mapping.fluorescence.length) throw new Error(`${table.name}: choose at least one fluorescence channel.`);
    const channels = mapping.fluorescence.map(index => column(table, index, 'fluorescence'));
    signal = row => channels.reduce((sum, values) => sum + values[row], 0) / i0[row];
  }
  let reference: ((row: number) => number) | null = null;
  if (mapping.iref !== null) {
    const it = column(table, mapping.it, 'It (needed for the reference foil)'), iref = column(table, mapping.iref, 'Iref');
    if (mapping.iref === mapping.it) throw new Error(`${table.name}: It and Iref must be different columns.`);
    reference = row => Math.log(it[row] / iref[row]);
  }
  const scale = mapping.energyUnit === 'keV' ? 1000 : 1;
  let rows: { e: number; mu: number; ref: number }[] = [];
  let nonFinite = 0;
  for (let row = 0; row < energy.length; row++) {
    const e = energy[row] * scale, mu = signal(row), ref = reference ? reference(row) : 0;
    if (Number.isFinite(e) && Number.isFinite(mu) && Number.isFinite(ref)) rows.push({ e, mu, ref }); else nonFinite++;
  }
  const reordered = rows.some((row, i) => i > 0 && row.e < rows[i - 1].e);
  if (reordered) rows = rows.map((row, i) => ({ row, i })).sort((a, b) => a.row.e - b.row.e || a.i - b.i).map(item => item.row);
  const kept = rows.filter((row, i) => i === 0 || row.e !== rows[i - 1].e);
  if (kept.length < MIN_POINTS) throw new Error(`${table.name}: only ${kept.length} usable rows; at least ${MIN_POINTS} are needed.`);
  return {
    name: table.name, energy: kept.map(row => row.e), mu: kept.map(row => row.mu),
    muRef: reference ? kept.map(row => row.ref) : undefined,
    removed: { nonFinite, repeated: rows.length - kept.length, reordered },
  };
}

export interface CalibrationTarget {
  /** For example "Fe K". */
  label: string;
  /** Tabulated edge energy, eV (XrayDB). */
  energy: number;
}

export interface ReductionRequest {
  scans: MuScan[];
  /** null: no calibration; energies are used as recorded. */
  calibration: CalibrationTarget | null;
  merge: 'cubic' | 'linear';
  preEdge: PreEdgeParams;
}

export interface ReducedScan {
  name: string;
  /** E0 of the reference foil on the recorded axis (derivative maximum, Larch find_e0); null without a reference. */
  e0Ref: number | null;
  /** Added to every energy of this scan: tabulated edge minus e0Ref; 0 without calibration. */
  shift: number;
  /** Larch find_e0 of the sample on the shifted axis. */
  e0Sample: number;
  energy: number[];
  mu: number[];
}

export interface ReductionResult {
  scans: ReducedScan[];
  /** null for a single scan. */
  merged: MergeResult | null;
  /** The curve that was normalized: the merged mu(E) or the single scan. */
  energy: number[];
  mu: number[];
  norm: PreEdgeResult;
  /** Median scan-to-scan standard deviation over the post-edge fit range, in units of the edge step. */
  spread: number | null;
  warnings: string[];
}

const median = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Calibrate each scan with its own reference foil (shift = tabulated edge - foil E0, applied to the
 * sample energies of the same scan), merge the shifted scans like larch.io.merge_groups, and
 * normalize the result like larch.xafs.pre_edge.
 */
export function reduceScans(request: ReductionRequest): ReductionResult {
  if (!request.scans.length) throw new Error('Choose at least one scan.');
  const warnings: string[] = [];
  const scans = request.scans.map(scan => {
    let e0Ref: number | null = null, shift = 0;
    if (request.calibration) {
      if (!scan.muRef) throw new Error(`${scan.name}: calibration needs a reference channel (It and Iref).`);
      e0Ref = findE0(scan.energy, scan.muRef);
      shift = request.calibration.energy - e0Ref;
      if (Math.abs(shift) > 20) warnings.push(`${scan.name}: the reference E0 is ${Math.abs(shift).toFixed(1)} eV from the tabulated ${request.calibration.label} edge. Check the element, the edge and the Iref column.`);
    }
    const energy = scan.energy.map(value => value + shift);
    return { name: scan.name, e0Ref, shift, e0Sample: findE0(energy, scan.mu), energy, mu: scan.mu };
  });
  let merged: MergeResult | null = null, energy = scans[0].energy, mu = scans[0].mu;
  if (scans.length > 1) {
    merged = mergeScans(scans.map(scan => ({ energy: scan.energy, mu: scan.mu })), request.merge);
    if (merged.kind !== request.merge) warnings.push('Cubic interpolation gave a jump 50 times larger than any in the first scan, so the scans were merged with linear interpolation instead (as Larch does).');
    const step = merged.energy.length > 1 ? merged.energy[1] - merged.energy[0] : 0;
    for (const scan of scans.slice(1)) if (scan.energy[0] > merged.energy[0] + step) warnings.push(`${scan.name} starts at ${scan.energy[0].toFixed(1)} eV, above the start of the merged grid (${merged.energy[0].toFixed(1)} eV); as in Larch, it is extrapolated there.`);
    energy = merged.energy; mu = merged.mu;
  }
  const norm = preEdge(energy, mu, request.preEdge);
  let spread: number | null = null;
  if (merged) {
    const low = norm.e0 + norm.norm1, high = norm.e0 + norm.norm2;
    const values = merged.std.flatMap((value, i) => merged!.energy[i] >= low && merged!.energy[i] <= high ? [value / norm.edgeStep] : []);
    spread = values.length ? median(values) : null;
  }
  return { scans, merged, energy: norm.energy, mu, norm, spread, warnings };
}

// ---------------------------------------------------------------- saving and records

export interface SourceFile { table: BeamlineTable; mapping: ColumnMapping; sha256?: string; example?: boolean }

const signed = (value: number, digits = 3) => (value >= 0 ? '+' : '') + value.toFixed(digits);
const columnName = (table: BeamlineTable, index: number | null) => index === null ? 'none' : table.labels[index] ?? `column ${index + 1}`;

/** How mu(E) was formed from one file, in words. */
export function mappingText(source: SourceFile): string {
  const { table, mapping } = source, name = (i: number | null) => columnName(table, i);
  const signal = mapping.mode === 'transmission' ? `ln(${name(mapping.i0)}/${name(mapping.it)})` : `(${mapping.fluorescence.map(name).join(' + ')})/${name(mapping.i0)}`;
  return `mu = ${signal}${mapping.iref !== null ? `, reference ln(${name(mapping.it)}/${name(mapping.iref)})` : ''}, energy ${name(mapping.energy)} in ${mapping.energyUnit}`;
}

/** Plain-text processing record, short enough for a saved curve's notes (8000 characters). */
export function processingNotes(sources: SourceFile[], request: Omit<ReductionRequest, 'scans'>, result: ReductionResult, scans: MuScan[]): string {
  const n = result.norm;
  const removed = scans.map(scan => {
    const parts = [scan.removed.nonFinite && `${scan.removed.nonFinite} undefined`, scan.removed.repeated && `${scan.removed.repeated} repeated-energy`, scan.removed.reordered && 'reordered'].filter(Boolean);
    return parts.length ? `${scan.name}: ${parts.join(', ')}` : '';
  }).filter(Boolean);
  const lines = [
    `Measured data workflow, XAS Lab ports of xraylarch ${LARCH_PORT_VERSION}.`,
    `Files: ${sources.map(s => `${s.table.name}${s.sha256 ? ` (SHA-256 ${s.sha256})` : ''}`).join('; ')}.`,
    `Columns: ${[...new Set(sources.map(mappingText))].join('; ')}.`,
    `Rows removed: ${removed.length ? removed.join('; ') : 'none'}.`,
    request.calibration
      ? `Calibration: reference foil E0 (find_e0, derivative maximum) set to the tabulated ${request.calibration.label} edge, ${request.calibration.energy} eV (XrayDB). Shifts: ${result.scans.map(s => `${s.name} ${signed(s.shift)} eV`).join(', ')}.`
      : 'Calibration: none; energies as recorded.',
    result.merged ? `Merge: ${result.scans.length} scans, merge_groups kind=${result.merged.kind}, grid of the first scan.` : 'Merge: single scan.',
    `pre_edge: e0=${n.e0.toFixed(3)}, pre1=${n.pre1}, pre2=${n.pre2}, norm1=${n.norm1}, norm2=${n.norm2.toFixed(3)}, nnorm=${n.nnorm}, nvict=${n.nvict}${n.npre === 0 ? ' (constant pre-edge: fewer than 3 points in range)' : ''}, edge_step=${n.edgeStep.toPrecision(6)}${request.preEdge.step !== undefined ? ' (given)' : ''}.`,
    ...result.warnings.map(warning => `Warning: ${warning}`),
  ];
  return lines.join('\n').slice(0, 8000);
}

/** Fields of a saved curve (see Spectrum in ./spectra), before validation. */
export function savedCurve(result: ReductionResult, quantity: 'normalized' | 'flattened', options: { id: string; name: string; sources: SourceFile[]; notes: string; calibration: CalibrationTarget | null }) {
  const sources = options.sources, sampleName = sources[0] && sources[0].table.format === 'xdi' ? metadataField(sources[0].table, 'Sample.name') : undefined;
  return {
    id: options.id, name: options.name.slice(0, 200), provenance: 'imported' as const,
    declaredProvenance: sources.length && sources.every(source => source.example) ? 'synthetic' as const : undefined,
    energy_eV: result.norm.energy, mu_cm_inv: quantity === 'normalized' ? result.norm.norm : result.norm.flat, quantity,
    source: sources.map(source => source.table.name).join(', ').slice(0, 512),
    sourceSha256: sources.length === 1 ? sources[0].sha256 : undefined,
    sampleId: sampleName?.slice(0, 200),
    notes: options.notes,
    calibration: options.calibration
      ? { status: 'user-declared' as const, offset_eV: 0, reference: `${options.calibration.label} reference foil, E0 set to ${options.calibration.energy} eV; shifts already applied to the energies (${result.scans.map(s => signed(s.shift)).join(', ')} eV)`.slice(0, 512) }
      : { status: 'uncalibrated' as const, offset_eV: 0, reference: 'Energies as recorded; no reference-foil calibration' },
  };
}

/** Everything needed to audit or redo a result, with the arrays, as one JSON-ready object. */
export function processingRecord(sources: SourceFile[], request: Omit<ReductionRequest, 'scans'>, result: ReductionResult, scans: MuScan[]) {
  const n = result.norm;
  return {
    schema: 'xas-lab-measured-data', version: 1, larchPort: LARCH_PORT_VERSION,
    note: 'Processed in the browser; the files were not uploaded. Uncertainty: the scan spread is the standard deviation across scans (divided by N, as Larch); it is not propagated and excludes calibration, thickness and self-absorption effects.',
    files: sources.map((source, i) => ({ name: source.table.name, format: source.table.format, sha256: source.sha256 ?? null, labels: source.table.labels, mapping: source.mapping, formula: mappingText(source), removedRows: scans[i]?.removed })),
    calibration: request.calibration ? { target: request.calibration, method: 'larch.xafs.find_e0 of ln(It/Iref); shift = tabulated edge - E0, added to the same scan', scans: result.scans.map(s => ({ name: s.name, e0Reference_eV: s.e0Ref, shift_eV: s.shift, e0Sample_eV: s.e0Sample })) } : null,
    merge: result.merged ? { method: `larch.io.merge_groups(kind='${result.merged.kind}')`, scans: result.scans.length, medianSpreadOverPostEdge_edgeSteps: result.spread } : null,
    preEdge: { requested: request.preEdge, used: { e0: n.e0, pre1: n.pre1, pre2: n.pre2, norm1: n.norm1, norm2: n.norm2, nnorm: n.nnorm, nvict: n.nvict, npre: n.npre }, edgeStep: n.edgeStep },
    warnings: result.warnings,
    units: { energy: 'eV', mu: sources[0]?.mapping.mode === 'fluorescence' ? 'If/I0, arbitrary' : 'ln(I0/It), dimensionless', norm: 'dimensionless', flat: 'dimensionless', spread: 'same as mu' },
    arrays: { energy: n.energy, mu: result.mu, preEdge: n.preEdge, postEdge: n.postEdge, norm: n.norm, flat: n.flat, spread: result.merged?.std ?? null },
  };
}

// ---------------------------------------------------------------- reproduction script

export interface ScriptFile { name: string; format: BeamlineTable['format']; mapping: ColumnMapping }

const py = (value: number) => Number.isInteger(value) ? value.toFixed(1) : String(value);

/**
 * An xraylarch script that repeats the processing with the parameters the browser used. Columns
 * are addressed by position (g.data[i]) so label spelling cannot change the result. The fit ranges,
 * nnorm and nvict are passed explicitly; E0 is passed only if the user set it.
 */
export function larchScript(files: ScriptFile[], request: Omit<ReductionRequest, 'scans'>, result: ReductionResult): string {
  const n = result.norm, given = request.preEdge;
  const args = [
    given.e0 !== undefined && Number.isFinite(given.e0) ? `e0=${py(n.e0)}` : null,
    given.step !== undefined && Number.isFinite(given.step) ? `step=${py(given.step)}` : null,
    `pre1=${py(n.pre1)}`, `pre2=${py(n.pre2)}`, `norm1=${py(n.norm1)}`, `norm2=${py(n.norm2)}`, `nnorm=${n.nnorm}`, `nvict=${n.nvict}`,
  ].filter(Boolean).join(', ');
  const fileRows = files.map(file => {
    const m = file.mapping;
    const signal = m.mode === 'transmission' ? `'it': ${m.it}` : `'fluo': [${m.fluorescence.join(', ')}]`;
    return `    (${JSON.stringify(file.name)}, ${JSON.stringify(file.format)}, {'energy': ${m.energy}, 'scale': ${m.energyUnit === 'keV' ? 1000 : 1}, 'mode': '${m.mode}', 'i0': ${m.i0}, ${signal}, 'it_ref': ${m.iref === null ? 'None' : m.it}, 'iref': ${m.iref === null ? 'None' : m.iref}}),`;
  });
  return [
    '"""Repeat the XAS Lab "Measured data" processing with xraylarch.',
    '',
    `XAS Lab ports xraylarch ${LARCH_PORT_VERSION}. Put the data files next to this script and run it with a`,
    'Python that has xraylarch installed. Columns are counted from 0 in the order they appear in each file.',
    '"""',
    'import numpy as np',
    'from larch import Group',
    'from larch.io import read_xdi, read_ascii, merge_groups',
    'from larch.xafs import find_e0, pre_edge',
    '',
    'FILES = [',
    ...fileRows,
    ']',
    request.calibration ? `E_EDGE = ${py(request.calibration.energy)}  # tabulated ${request.calibration.label} edge, eV (XrayDB, Elam, Ravel and Sieber 2002)` : 'E_EDGE = None  # no energy calibration',
    '',
    '',
    'def scan(path, fmt, c):',
    '    g = read_xdi(path) if fmt == "xdi" else read_ascii(path)',
    '    d = g.data',
    '    energy = d[c["energy"]] * c["scale"]',
    '    mu = np.log(d[c["i0"]] / d[c["it"]]) if c["mode"] == "transmission" else sum(d[i] for i in c["fluo"]) / d[c["i0"]]',
    '    ref = np.log(d[c["it_ref"]] / d[c["iref"]]) if c["iref"] is not None else np.zeros_like(mu)',
    '    # XAS Lab removes rows with undefined values, sorts by energy and removes repeated energies.',
    '    ok = np.isfinite(energy) & np.isfinite(mu) & np.isfinite(ref)',
    '    energy, mu, ref = energy[ok], mu[ok], ref[ok]',
    '    order = np.argsort(energy, kind="stable")',
    '    energy, mu, ref = energy[order], mu[order], ref[order]',
    '    keep = np.concatenate([[True], np.diff(energy) != 0])',
    '    return energy[keep], mu[keep], ref[keep]',
    '',
    '',
    'groups = []',
    'for path, fmt, columns in FILES:',
    '    energy, mu, ref = scan(path, fmt, columns)',
    '    shift = 0.0 if E_EDGE is None else E_EDGE - find_e0(energy, ref)',
    '    print(f"{path}: shift {shift:+.3f} eV")',
    '    groups.append(Group(energy=energy + shift, mu=mu))',
    '',
    `merged = merge_groups(groups, kind=${JSON.stringify(request.merge)}) if len(groups) > 1 else groups[0]`,
    'out = Group()',
    `pre_edge(merged.energy, merged.mu, group=out, ${args})`,
    'print(f"e0 = {out.e0:.3f} eV, edge_step = {out.edge_step:.6g}")',
    `# XAS Lab gave e0 = ${n.e0.toFixed(3)} eV, edge_step = ${n.edgeStep.toPrecision(6)}`,
    '',
  ].join('\n');
}
