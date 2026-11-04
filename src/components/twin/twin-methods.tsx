'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { TexProse } from './tex-prose';
import { TWIN_ATTRIBUTIONS, TWIN_METHODS, type TwinMethod } from '@/lib/twin/methods';
import { QUANTUM_METHODS } from '@/lib/quantum/methods';
import type { Provenance } from '@/lib/twin/types';

// The figure carries its own data and plots, so it loads after the page rather than with it.
const MeasuredFigure = dynamic(() => import('./measured-figure').then(m => m.MeasuredFigure), { ssr: false, loading: () => <p className="muted">Loading the comparison with a measured spectrum…</p> });

const SOURCE: Record<Provenance, string> = { tabulated: 'Tabulated', computed: 'Computed', measured: 'Measured', 'teaching-model': 'Teaching model' };

function MethodsTable({ rows, caption }: { rows: readonly TwinMethod[]; caption: string }) {
  return <div className="table-wrap"><table className="twin-methods">
    <caption className="sr-only">{caption}</caption>
    <thead><tr><th scope="col">Quantity</th><th scope="col">Model and data</th><th scope="col">Checked against</th><th scope="col">Tolerance</th><th scope="col">Tests</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.quantity}>
      <th scope="row">{row.quantity}<br /><small>{SOURCE[row.provenance]}</small></th>
      <td data-label="Model"><TexProse>{row.model}</TexProse><br /><small>Data: <TexProse>{row.data}</TexProse></small></td>
      <td data-label="Checked against"><TexProse>{row.checked}</TexProse></td>
      <td data-label="Tolerance"><TexProse>{row.tolerance}</TexProse></td>
      <td data-label="Tests"><details><summary>{row.tests.length} {row.tests.length === 1 ? 'test' : 'tests'}</summary><ul>
        {row.tests.map(t => <li key={t.file + t.name}><code>{t.file.replace(/^src\/lib\//, '')}</code>: {t.name}</li>)}
      </ul></details></td>
    </tr>)}</tbody>
  </table></div>;
}

/** The Methods page: every model of the twin and of the quantum XAS engine, what checks it, and the tests that hold it. */
export function TwinMethods() {
  return <>
    <p>The <Link href="/">Beamline Twin</Link> computes everything below in your browser. Each row names the unit tests that hold it. GitHub Actions runs every test before each deploy, and the site is published only when all of them pass.</p>
    <ul className="source-list">
      <li><strong>Tabulated</strong>: interpolated from published tables (XrayDB, the X-ray Data Booklet).</li>
      <li><strong>Computed</strong>: calculated from those tables or from FEFF paths, and checked against Larch or xraydb.</li>
      <li><strong>Teaching model</strong>: a stated simplification with a plausible value, such as the electron escape depth or the Einstein temperatures.</li>
      <li><strong>Measured</strong>: data you import. Its origin and calibration are not checked.</li>
    </ul>
    <MethodsTable rows={TWIN_METHODS} caption="Beamline twin models, checks and tests" />
    <h2>Checked against a measurement</h2>
    <p>Every other row checks the twin against another code. This one checks it against a real scan.</p>
    <MeasuredFigure />
    <h2>Quantum XAS</h2>
    <p>The <Link href="/quantum/">Quantum XAS</Link> page computes oxygen K edges with the time domain algorithm of Fomichev et al. (2025), emulated on a classical computer. Its problems and signals come from the Python engine in <code>scripts/quantum</code>, whose tests run with the others before each deploy.</p>
    <MethodsTable rows={QUANTUM_METHODS} caption="Quantum XAS models, checks and tests" />
    <h2>Sources and licences</h2>
    <ul className="source-list">{TWIN_ATTRIBUTIONS.map(a => <li key={a.name}><a href={a.url} target="_blank" rel="noreferrer">{a.name}</a>: {a.use} ({a.licence}).</li>)}</ul>
  </>;
}
