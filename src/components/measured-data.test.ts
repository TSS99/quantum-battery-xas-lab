import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import examples from '../data/xas-reduction/examples.json';
import { guessColumns, parseBeamlineFile } from '@/lib/beamline-files';
import { muFromTable, reduceScans, type ReductionRequest } from '@/lib/measured-data';
import { loadXrayData } from '@/lib/xraydata';
import { LabProvider } from './lab-context';
import { MappingEditor, MeasuredData, MeasuredResults, type Done } from './measured-data';

// Server rendering of the processed views with real example output: no render errors, no KaTeX errors.
const tables = examples.files.map(file => parseBeamlineFile(file.text, file.name));
function processed(indices: number[], calibration: ReductionRequest['calibration']): Done {
  const sources = indices.map(i => ({ table: tables[i], mapping: guessColumns(tables[i]), example: true }));
  const scans = sources.map(source => muFromTable(source.table, source.mapping));
  const request = { calibration, merge: 'cubic' as const, preEdge: {} };
  return { result: reduceScans({ ...request, scans }), request, scans, sources };
}
const params = { e0: '', pre1: '', pre2: '', norm1: '', norm2: '', step: '', nnorm: '', nvict: '0' };
const render = (done: Done, view: 'mu' | 'norm' | 'flat') => renderToStaticMarkup(createElement(MeasuredResults, {
  done, view, params, mergeKind: 'cubic', name: 'Fe2O3', sampleEdge: 'Mn K', onView() {}, onParams() {}, onMergeKind() {}, onName() {}, onSave() {},
}));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[\s\u200b]+/g, ' ');

beforeAll(() => loadXrayData());

describe('Measured data panel', () => {
  it('starts with the file picker, the two examples and the privacy note', () => {
    const html = renderToStaticMarkup(createElement(LabProvider, null, createElement(MeasuredData, { onSaved() {} })));
    expect(html).toContain('aria-label="Open beamline files (XDI or column text)"');
    expect(text(html)).toContain('Fe K example: 3 transmission scans');
    expect(text(html)).toContain('never uploaded');
    expect(html).not.toContain('katex-error');
  });

  it('shows the shifts, merge spread, fit ranges and save buttons for the Fe scans', () => {
    const done = processed([0, 1, 2], { label: 'Fe K', energy: 7112 });
    for (const view of ['mu', 'norm', 'flat'] as const) {
      const html = render(done, view);
      expect(html).not.toContain('katex-error');
      expect(text(html)).toContain('Save normalized curve');
      expect(html).toContain(`aria-label="measured-${view}:`);
    }
    const html = text(render(done, 'mu'));
    expect(html).toContain('+0.40');
    expect(html).toContain('−0.40');
    expect(html).toContain('Spread / edge step');
    expect(html).toContain('Shaded: the pre-edge and post-edge fit ranges');
    expect(html).toContain('The lab sample is set to the Mn K edge');
    const svg = render(done, 'mu');
    expect(svg).toMatch(/>pre-edge<\/text>/);
    expect(svg).toMatch(/>post-edge<\/text>/);
  });

  it('labels a single fluorescence scan in arbitrary units and skips the merge', () => {
    const html = text(render(processed([3], { label: 'Cu K', energy: 8979 }), 'mu'));
    expect(html).toContain('One scan is selected');
    expect(html).toContain('μ(E) = If/I0');
  });

  it('lists the fluorescence channels with their medians and flags the dead one', () => {
    const guess = guessColumns(tables[3]);
    const html = renderToStaticMarkup(createElement(MappingEditor, { files: [{ id: 'cu', table: tables[3], include: true, example: true }], mapping: guess, guess, onChange() {} }));
    expect(text(html)).toContain('Fluorescence channels to sum');
    expect(text(html)).toMatch(/SDD3 median 3(\.\d+)?, looks dead/);
    expect(html).not.toContain('katex-error');
  });
});
