import Link from 'next/link';
import { Panel } from './ui';
import { TexProse } from './twin/tex-prose';
import { TWIN_ATTRIBUTIONS, TWIN_METHODS } from '@/lib/twin/methods';
import type { Provenance } from '@/lib/twin/types';

const SOURCE: Record<Provenance, string> = { tabulated: 'Tabulated', computed: 'Computed', measured: 'Measured', 'teaching-model': 'Teaching model' };

/** The beamline twin's section of the Methods page: every model, what checks it, and the tests that hold it. */
export function TwinMethods() {
  return <Panel title="Beamline twin: models and checks">
    <p>The <Link href="/twin/">beamline twin</Link> computes everything below in your browser. Each row names the unit tests that hold it. GitHub Actions runs every test, and the SciPy reference tests, before each deploy, and the site is published only when all of them pass.</p>
    <ul className="source-list">
      <li><strong>Tabulated</strong>: interpolated from published tables (XrayDB, the X-ray Data Booklet).</li>
      <li><strong>Computed</strong>: calculated from those tables or from FEFF paths, and checked against Larch or xraydb.</li>
      <li><strong>Teaching model</strong>: a stated simplification with a plausible value, such as the electron escape depth or the Einstein temperatures.</li>
      <li><strong>Measured</strong>: data you import. Its origin and calibration are not checked.</li>
    </ul>
    <div className="table-wrap"><table className="twin-methods">
      <caption className="sr-only">Beamline twin models, checks and tests</caption>
      <thead><tr><th scope="col">Quantity</th><th scope="col">Model and data</th><th scope="col">Checked against</th><th scope="col">Tolerance</th><th scope="col">Tests</th></tr></thead>
      <tbody>{TWIN_METHODS.map(row => <tr key={row.quantity}>
        <th scope="row">{row.quantity}<br /><small>{SOURCE[row.provenance]}</small></th>
        <td data-label="Model"><TexProse>{row.model}</TexProse><br /><small>Data: <TexProse>{row.data}</TexProse></small></td>
        <td data-label="Checked against"><TexProse>{row.checked}</TexProse></td>
        <td data-label="Tolerance"><TexProse>{row.tolerance}</TexProse></td>
        <td data-label="Tests"><details><summary>{row.tests.length} {row.tests.length === 1 ? 'test' : 'tests'}</summary><ul>
          {row.tests.map(t => <li key={t.file + t.name}><code>{t.file.replace(/^src\/lib\//, '')}</code>: {t.name}</li>)}
        </ul></details></td>
      </tr>)}</tbody>
    </table></div>
    <h3>Sources and licences</h3>
    <ul className="source-list">{TWIN_ATTRIBUTIONS.map(a => <li key={a.name}><a href={a.url} target="_blank" rel="noreferrer">{a.name}</a>: {a.use} ({a.licence}).</li>)}</ul>
  </Panel>;
}
