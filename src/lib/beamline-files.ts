/**
 * Readers for measured XAS files: XDI 1.0 and generic beamline ASCII (comment lines, then columns).
 *
 * The rules follow the xraylarch readers (larch.io.read_xdi and larch.io.read_ascii) closely
 * enough that both give the same columns for the same file: the data block is the last run of
 * all-numeric lines, tabs, commas and semicolons separate numbers, short rows are padded with
 * NaN, and labels come from the XDI Column.N fields or from the last header line with one word
 * per column. Unlike Larch, labels keep their case and a leading comment character is not turned
 * into "_" (Larch reads ";Energy" as "_energy").
 *
 * Nothing here interprets the numbers; guessColumns() only proposes which column is which.
 */

/** Same limits as the spectrum import: 5 MB of text and 20,000 data rows per file. */
export const MAX_BEAMLINE_BYTES = 5_000_000;
export const MAX_BEAMLINE_ROWS = 20_000;
const COMMENT_CHARS = '#;%*!$';
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$|^[+-]?(?:nan|inf|infinity)$/i;

export interface BeamlineTable {
  name: string;
  format: 'xdi' | 'ascii';
  /** XDI version line, for example "XDI/1.0 GSE/1.0". */
  version?: string;
  labels: string[];
  /** Units from XDI Column.N fields; empty when the file does not say. */
  units: string[];
  /** columns[c][row]. Missing cells in short rows are NaN, as in Larch. */
  columns: number[][];
  /** XDI fields ("Element.symbol" -> "Fe") or "key: value" header lines of an ASCII file. */
  metadata: Record<string, string>;
  /** XDI user comments, or the header lines of an ASCII file without their comment character. */
  comments: string[];
  /** Rows that were shorter than the widest row and padded with NaN. */
  paddedRows: number;
}

const splitNumbers = (line: string) => line.replace(/[\t,;]/g, ' ').trim().split(/\s+/);
const toNumber = (word: string) => {
  const lower = word.toLowerCase().replace(/^\+/, '');
  if (lower === 'nan' || lower === '-nan') return NaN;
  if (/^-?inf(inity)?$/.test(lower)) return lower.startsWith('-') ? -Infinity : Infinity;
  return Number(word);
};
const isNumericLine = (line: string) => !COMMENT_CHARS.includes(line[0]) && splitNumbers(line).every(word => NUMBER.test(word));
const stripComment = (line: string) => line.replace(/^[#;%*!$]+/, '').trim();

/** Distinct labels: repeated or empty names get a column number. */
function uniqueLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label, i) => {
    const base = label.trim() || `col${i + 1}`;
    const count = seen.get(base.toLowerCase()) ?? 0;
    seen.set(base.toLowerCase(), count + 1);
    return count ? `${base}_${i + 1}` : base;
  });
}

/** The last all-numeric block of lines becomes columns; everything above it is the header. */
function splitBlocks(lines: string[]) {
  let end = lines.length;
  while (end > 0 && !(lines[end - 1].trim() && isNumericLine(lines[end - 1].trim()))) end--;
  let start = end;
  while (start > 0 && (!lines[start - 1].trim() || isNumericLine(lines[start - 1].trim()))) start--;
  const rows = lines.slice(start, end).map(line => line.trim()).filter(Boolean).map(line => splitNumbers(line).map(toNumber));
  if (!rows.length) throw new Error('No rows of numbers were found. The file needs columns of numbers after its header lines.');
  if (rows.length > MAX_BEAMLINE_ROWS) throw new Error(`The file has ${rows.length} data rows; the limit is ${MAX_BEAMLINE_ROWS}.`);
  const width = Math.max(...rows.map(row => row.length));
  let paddedRows = 0;
  const columns = Array.from({ length: width }, () => new Array<number>(rows.length));
  rows.forEach((row, r) => {
    if (row.length < width) paddedRows++;
    for (let c = 0; c < width; c++) columns[c][r] = c < row.length ? row[c] : NaN;
  });
  return { header: lines.slice(0, start).map(line => line.trim()).filter(Boolean), columns, paddedRows };
}

function parseXdi(lines: string[], name: string): BeamlineTable {
  const { header, columns, paddedRows } = splitBlocks(lines);
  const version = stripComment(header[0] ?? '');
  const metadata: Record<string, string> = {}, comments: string[] = [], named: { label: string; unit: string }[] = [];
  let section: 'fields' | 'comments' | 'done' = 'fields', labelLine: string[] | null = null;
  for (const raw of header.slice(1)) {
    if (!raw.startsWith('#')) continue;
    const text = stripComment(raw);
    if (section === 'done') { if (text) labelLine = text.split(/\s+/); continue; }
    if (/^\/{2,}/.test(text)) { section = 'comments'; continue; }
    if (/^-{2,}/.test(text)) { section = 'done'; continue; }
    const field = section === 'fields' ? text.match(/^([A-Za-z][\w]*\.[\w.]+)\s*:\s*(.*)$/) : null;
    if (field) {
      metadata[field[1]] = field[2].trim();
      const column = field[1].match(/^column\.(\d+)$/i);
      if (column) {
        const [label = '', ...unit] = field[2].trim().split(/\s+/);
        named[Number(column[1]) - 1] = { label, unit: unit.join(' ') };
      }
    } else if (text) comments.push(text);
  }
  const width = columns.length;
  const fromFields = named.filter(Boolean).length > 0;
  const labels = Array.from({ length: width }, (_, c) => fromFields ? named[c]?.label ?? '' : labelLine?.length === width ? labelLine[c] : '');
  return { name, format: 'xdi', version, labels: uniqueLabels(labels), units: Array.from({ length: width }, (_, c) => named[c]?.unit ?? ''), columns, metadata, comments, paddedRows };
}

function parseAscii(lines: string[], name: string): BeamlineTable {
  const { header, columns, paddedRows } = splitBlocks(lines);
  const width = columns.length, metadata: Record<string, string> = {}, comments = header.map(stripComment);
  for (const text of comments) {
    const match = text.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
    if (match) metadata[match[1]] = match[2].trim();
  }
  let labels: string[] = [];
  for (let i = comments.length - 1; i >= 0 && !labels.length; i--) {
    const words = comments[i].replace(/[\t,]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length === width && !words.every(word => NUMBER.test(word))) labels = words;
  }
  return { name, format: 'ascii', labels: uniqueLabels(labels.length ? labels : Array.from({ length: width }, () => '')), units: new Array<string>(width).fill(''), columns, metadata, comments, paddedRows };
}

/** Read an XDI 1.0 file (first line "# XDI/1.x") or a generic ASCII column file. */
export function parseBeamlineFile(text: string, name = 'data file'): BeamlineTable {
  if (text.length > MAX_BEAMLINE_BYTES) throw new Error(`${name} is larger than the 5 MB limit.`);
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const first = lines.find(line => line.trim())?.trim() ?? '';
  const table = /^#\s*XDI\/1\./i.test(first) ? parseXdi(lines, name) : parseAscii(lines, name);
  if (table.columns.length < 2) throw new Error(`${name} has only one column. Energy and at least one detector channel are needed.`);
  return table;
}

// ---------------------------------------------------------------- column guesses

export type MeasurementMode = 'transmission' | 'fluorescence';

export interface ColumnMapping {
  energy: number;
  energyUnit: 'eV' | 'keV';
  mode: MeasurementMode;
  i0: number | null;
  /** Transmitted intensity after the sample (before the reference foil). */
  it: number | null;
  /** Fluorescence channels, summed. */
  fluorescence: number[];
  /** Intensity after the reference foil. */
  iref: number | null;
}

export interface ColumnGuess extends ColumnMapping {
  /** Fluorescence-like channels that were left out, with the reason. */
  excluded: { column: number; reason: string }[];
  /** Median of each column, so the user can spot a dead channel. */
  medians: number[];
}

const key = (label: string) => label.toLowerCase().replace(/[^a-z0-9]/g, '');
const ROLE_PATTERNS = {
  energy: /^(energy|energ|ener|en|e|enc|eenc|energyev|energykev|monoenergy|mono|eev|ekev|energyreadback|energyrbv)$/,
  i0: /^(i0|io|izero|i0ch|i0c|mon|monitor|i00|i0b|iob|i0a|ioa)$/,
  it: /^(it|i1|itrans|itransmitted|trans|transmission|itr|i1ch|i1c|ia)$/,
  iref: /^(iref|irefer|ireference|ir|i2|ref|reference|i2ch|i2c)$/,
  fluorescence: /^(if|ifl|ifluor|ifluo|fluo|fluor|fluorescence|fl|fy|pfy|tfy|lytle|pips|sca\d*|roi\d*|sdd\d*|vortex\d*|ge\d*|ketek\d*|mca\d*|det\d*|ff\d*|fluo\d+|fluor\d+|if\d+|sdd\d+roi\d*|roi\d+sdd\d*)$/,
} as const;

function median(values: number[]): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return NaN;
  const mid = finite.length >> 1;
  return finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
}

/**
 * Propose a column mapping from the labels. Energy defaults to the first column. A fluorescence
 * channel whose median is below 1 % of the strongest channel's median is treated as dead and left
 * out of the sum. Mode is fluorescence when fluorescence channels are found, otherwise transmission.
 */
export function guessColumns(table: BeamlineTable): ColumnGuess {
  const keys = table.labels.map(key);
  const find = (pattern: RegExp, skip: (number | null)[] = []) => {
    const index = keys.findIndex((k, i) => pattern.test(k) && !skip.includes(i));
    return index >= 0 ? index : null;
  };
  const energy = find(ROLE_PATTERNS.energy) ?? 0;
  const i0 = find(ROLE_PATTERNS.i0, [energy]);
  const it = find(ROLE_PATTERNS.it, [energy, i0]);
  const iref = find(ROLE_PATTERNS.iref, [energy, i0, it]);
  const medians = table.columns.map(median);
  const candidates = keys.flatMap((k, i) => ROLE_PATTERNS.fluorescence.test(k) && ![energy, i0, it, iref].includes(i) ? [i] : []);
  const strongest = Math.max(0, ...candidates.map(i => Math.abs(medians[i])).filter(Number.isFinite));
  const excluded: ColumnGuess['excluded'] = [];
  const fluorescence = candidates.filter(i => {
    const ok = Number.isFinite(medians[i]) && Math.abs(medians[i]) >= 0.01 * strongest && strongest > 0;
    if (!ok) excluded.push({ column: i, reason: 'median below 1 % of the strongest channel (dead channel?)' });
    return ok;
  });
  const unit = table.units[energy]?.toLowerCase() === 'kev' || /kev/i.test(table.labels[energy]) ? 'keV' : 'eV';
  return { energy, energyUnit: unit, mode: fluorescence.length ? 'fluorescence' : 'transmission', i0, it, fluorescence, iref, excluded, medians };
}

/** A header field by name, ignoring case (XDI field names are case-insensitive). */
export function metadataField(table: BeamlineTable, name: string): string | undefined {
  const key = Object.keys(table.metadata).find(item => item.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : table.metadata[key];
}

/** Element symbol and edge from XDI Element.symbol and Element.edge, when present. */
export function declaredEdge(table: BeamlineTable): { element: string; edge: string } | null {
  if (table.format !== 'xdi') return null;
  const symbol = metadataField(table, 'Element.symbol')?.trim(), edge = metadataField(table, 'Element.edge')?.trim();
  if (!symbol || !/^[A-Z][a-z]?$/.test(symbol)) return null;
  return { element: symbol, edge: edge && /^(K|L[1-3]|M[1-5]|N[1-7])$/.test(edge) ? edge : 'K' };
}

/** Column labels joined, so files with the same layout share one mapping. */
export const layoutKey = (table: BeamlineTable) => `${table.format}:${table.labels.join('|')}`;
