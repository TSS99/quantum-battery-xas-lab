import { declaredEdge, guessColumns, metadataField, parseBeamlineFile } from '../beamline-files';
import type { Acquisition, SampleConfig, TwinMode } from './types';

export interface ImportFallback {
  sample: Pick<SampleConfig, 'formula' | 'absorber' | 'edge'>;
  monoDSpacing_A: number;
}

export interface ImportedAcquisition {
  acquisition: Acquisition;
  mode: Extract<TwinMode, 'transmission' | 'fluorescence'>;
  /** True only when the file itself declares both the element and edge. */
  declaredSample: boolean;
}

const labelKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]/g, '');
const directColumn = (labels: string[], names: string[]) => {
  const wanted = new Set(names.map(labelKey));
  const index = labels.findIndex(label => wanted.has(labelKey(label)));
  return index < 0 ? null : index;
};
const safeName = (name: string) => name.replace(/\.[^.]+$/, '').trim() || 'Imported data';

/**
 * Turn XDI or named beamline columns into the acquisition shape used by the twin dock.
 * Rows are sorted by energy, duplicate energies are dropped, and invalid signal rows are omitted.
 */
export function importAcquisition(text: string, name: string, fallback: ImportFallback): ImportedAcquisition {
  const table = parseBeamlineFile(text, name);
  const guess = guessColumns(table), declared = declaredEdge(table);
  const raw: Record<string, number[]> = {};
  table.labels.forEach((label, index) => { raw[label] = table.columns[index].slice(); });

  const energy = table.columns[guess.energy].map(value => guess.energyUnit === 'keV' ? value * 1000 : value);
  const mutransIndex = directColumn(table.labels, ['mutrans', 'mu_trans', 'mu', 'absorption']);
  const mufluorIndex = directColumn(table.labels, ['mufluor', 'mu_fluor', 'fluorescence_mu']);
  const declaredMode = metadataField(table, 'XASLab.measurement_mode');
  const mode: ImportedAcquisition['mode'] = declaredMode === 'fluorescence' || declaredMode === 'xrf' ? 'fluorescence'
    : declaredMode === 'transmission' || mutransIndex !== null ? 'transmission'
      : mufluorIndex !== null || guess.fluorescence.length ? 'fluorescence' : 'transmission';
  const i0 = guess.i0 === null ? null : table.columns[guess.i0];
  const it = guess.it === null ? null : table.columns[guess.it];
  const summedFluorescence = guess.fluorescence.length
    ? energy.map((_, row) => guess.fluorescence.reduce((sum, column) => sum + table.columns[column][row], 0))
    : null;
  let mu: number[];
  if (mode === 'fluorescence') {
    if (mufluorIndex !== null) mu = table.columns[mufluorIndex].slice();
    else if (i0 && summedFluorescence) mu = i0.map((value, row) => value > 0 ? summedFluorescence[row] / value : NaN);
    else throw new Error('Fluorescence data needs a named mufluor column, or I0 and at least one named fluorescence channel.');
  } else {
    if (mutransIndex !== null) mu = table.columns[mutransIndex].slice();
    else if (i0 && it) mu = i0.map((value, row) => value > 0 && it[row] > 0 ? Math.log(value / it[row]) : NaN);
    else throw new Error('Transmission data needs a named mutrans or mu column, or named I0 and It columns.');
  }

  const order = energy.map((value, row) => ({ value, row })).filter(item => Number.isFinite(item.value) && Number.isFinite(mu[item.row])).sort((a, b) => a.value - b.value);
  const keep: number[] = [];
  for (const item of order) if (!keep.length || item.value > energy[keep.at(-1)!]) keep.push(item.row);
  if (keep.length < 16) throw new Error('The imported spectrum needs at least 16 finite rows with distinct energies.');

  const columns: Record<string, number[]> = { energy: keep.map(row => energy[row]) };
  // Preserve every source column under its source name, then add the canonical columns the dock needs.
  for (const [label, values] of Object.entries(raw)) if (label !== 'energy') columns[label] = keep.map(row => values[row]);
  if (i0) columns.i0 = keep.map(row => i0[row]);
  if (it) columns.itrans = keep.map(row => it[row]);
  if (guess.iref !== null) columns.irefer = keep.map(row => table.columns[guess.iref!][row]);
  if (summedFluorescence) columns.ifluor = keep.map(row => summedFluorescence[row]);
  columns[mode === 'fluorescence' ? 'mufluor' : 'mutrans'] = keep.map(row => mu[row]);

  const symbol = declared?.element ?? fallback.sample.absorber, edge = declared?.edge ?? fallback.sample.edge;
  const metadata = {
    ...table.metadata,
    'Element.symbol': symbol,
    'Element.edge': edge,
    'Mono.d_spacing': metadataField(table, 'Mono.d_spacing') ?? String(fallback.monoDSpacing_A),
    'Sample.name': metadataField(table, 'Sample.name') ?? fallback.sample.formula,
    'XASLab.source_file': name,
    'XASLab.declared_edge': String(declared !== null),
  };
  return {
    mode,
    declaredSample: declared !== null,
    acquisition: {
      id: `import-${safeName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: safeName(name),
      kind: mode,
      columns,
      metadata,
      provenance: ['measured'],
    },
  };
}
