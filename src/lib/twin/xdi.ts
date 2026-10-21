/**
 * XDI 1.0 files (XAS Data Interchange, https://github.com/XraySpectroscopy/XAS-Data-Interchange):
 * a version line, "Namespace.tag: value" header fields, Column.N names, free comments after
 * "# ///", a "#----" line, the column label line and whitespace separated data.
 *
 * The reader also accepts plain columns: optional '#' header lines, the last of which may name
 * the columns.
 */
import type { Acquisition } from './types';

export const XDI_VERSION = 'XDI/1.0';
const APPLICATION = 'XAS-Lab-twin/1';

/** Required header fields of XDI 1.0. */
export const XDI_REQUIRED = ['Element.symbol', 'Element.edge', 'Mono.d_spacing'] as const;

/** Units of the dictionary columns this app writes. */
const UNITS: Record<string, string> = { energy: 'eV' };

export interface XdiFile {
  version: string;
  /** Header fields other than Column.N, in file order. */
  fields: Record<string, string>;
  /** Column names in order, without units. */
  labels: string[];
  columns: Record<string, number[]>;
  comments: string[];
}

const format = (value: number) => Number.isFinite(value) ? (Number.isInteger(value) && Math.abs(value) < 1e15 ? value.toString() : value.toPrecision(10)) : 'nan';

/** XDI text of an acquisition. The energy column comes first, as the specification asks. */
export function writeXdi(acquisition: Pick<Acquisition, 'columns' | 'metadata'>, comments: string[] = []): string {
  const { columns, metadata } = acquisition;
  for (const field of XDI_REQUIRED) if (!metadata[field]) throw new Error(`XDI needs the ${field} header field.`);
  const labels = Object.keys(columns);
  if (labels[0] !== 'energy') throw new Error('The first XDI column must be the energy.');
  const rows = columns.energy.length;
  for (const label of labels) {
    if (!/^[A-Za-z][\w]*$/.test(label)) throw new Error(`"${label}" is not a valid XDI column name.`);
    if (columns[label].length !== rows) throw new Error(`Column ${label} has ${columns[label].length} rows, the energy has ${rows}.`);
  }
  const lines = [`# ${XDI_VERSION} ${APPLICATION}`];
  labels.forEach((label, i) => lines.push(`# Column.${i + 1}: ${label}${UNITS[label] ? ' ' + UNITS[label] : ''}`));
  for (const [key, value] of Object.entries(metadata)) {
    if (/^Column\.\d+$/i.test(key)) continue; // regenerated above from the actual column order
    if (!/^[A-Za-z][\w]*\.[\w]+$/.test(key)) throw new Error(`"${key}" is not a valid XDI field name (Namespace.tag).`);
    lines.push(`# ${key}: ${value.replace(/[\r\n]+/g, ' ')}`);
  }
  lines.push('# ///');
  for (const comment of comments) for (const part of comment.split(/\r?\n/)) lines.push(`# ${part}`);
  lines.push('#----');
  lines.push('# ' + labels.join(' '));
  for (let r = 0; r < rows; r++) lines.push(labels.map(label => format(columns[label][r])).join(' '));
  return lines.join('\n') + '\n';
}

const parseNumber = (text: string) => /^nan$/i.test(text) ? NaN : Number(text);

/** Reads XDI, or plain whitespace columns with optional '#' header lines. */
export function readXdi(text: string): XdiFile {
  const lines = text.split(/\r?\n/);
  const isXdi = /^#\s*XDI\/\d/.test(lines[0] ?? '');
  const fields: Record<string, string> = {}, comments: string[] = [], tagged: string[] = [];
  let version = '', headerLabels: string[] = [], lastHeader = '', inComments = false;
  const data: number[][] = [];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('#')) {
      const body = line.replace(/^#\s?/, '');
      if (index === 0 && isXdi) { version = body.split(/\s+/)[0]; return; }
      if (isXdi && /^\/{3,}/.test(body)) { inComments = true; return; }
      if (isXdi && /^-{4,}/.test(body)) { inComments = false; return; }
      if (inComments) { comments.push(body); return; }
      const field = isXdi ? body.match(/^([A-Za-z][\w]*\.[\w]+)\s*:\s*(.*)$/) : null;
      if (field) {
        const column = field[1].match(/^Column\.(\d+)$/i);
        if (column) tagged[Number(column[1]) - 1] = field[2].trim().split(/\s+/)[0];
        else fields[field[1]] = field[2].trim();
        return;
      }
      lastHeader = body;
      return;
    }
    const values = line.split(/[\s,]+/).map(parseNumber);
    if (values.some(v => Number.isNaN(v) && !/nan/i.test(line))) {
      if (!data.length) { lastHeader = line; return; }  // a plain-text header line without '#'
      throw new Error(`Line ${index + 1} is not numeric data: "${line.slice(0, 60)}"`);
    }
    data.push(values);
  });
  if (!data.length) throw new Error('No data rows found.');
  const width = data[0].length;
  if (data.some(row => row.length !== width)) throw new Error('Data rows have different numbers of columns.');
  if (tagged.length) headerLabels = Array.from({ length: width }, (_, i) => tagged[i] ?? `col${i + 1}`);
  else {
    const named = lastHeader.split(/[\s,]+/).filter(Boolean);
    headerLabels = named.length === width ? named : Array.from({ length: width }, (_, i) => `col${i + 1}`);
  }
  const columns: Record<string, number[]> = {};
  headerLabels.forEach((label, i) => { columns[label] = data.map(row => row[i]); });
  return { version: version || 'plain', fields, labels: headerLabels, columns, comments };
}
