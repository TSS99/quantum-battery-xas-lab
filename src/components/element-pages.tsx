// Server components for /elements/ and /elements/<symbol>/. They read the X-ray table at build
// time through src/lib/elements.ts and ship no JavaScript of their own.
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { ELEMENTS, LOW_FLUORESCENCE_YIELD, compoundsWith, defaultEdge, elementLabPath, elementTitle, formatEnergy, scannableEdges, tablePosition, type ElementData, type ElementEdge } from '@/lib/elements';
import { Num, Tex, Unit, formulaTex } from './tex';

// The lab reads ?element= and ?scenario= only when it loads, so lab links are plain <a> elements
// that load the page; next/link would keep the previous sample.
const labHref = (path: string) => (process.env.NEXT_PUBLIC_BASE_PATH || '') + path;

const EdgeName = ({ edge }: { edge: string }) => <Tex plain>{formulaTex(edge)}</Tex>;
const Energy = ({ eV }: { eV: number }) => <><Num>{formatEnergy(eV)}</Num> <Unit>eV</Unit></>;
const LAB_RANGE = <><Num>100</Num> <Unit>eV</Unit> and <Num>100</Num> <Unit>keV</Unit></>;

/** "K, L1 and L3" with typeset labels. */
const edgeList = (edges: ElementEdge[]): ReactNode =>
  edges.map((e, i) => <span key={e.edge}>{i === 0 ? '' : i === edges.length - 1 ? ' and ' : ', '}<EdgeName edge={e.edge} /></span>);

export function ElementsIndex() {
  return <div className="page-content element-page">
    <div className="page-heading">
      <h1>X-ray absorption edges by element</h1>
      <p>Pick an element for its edge energies, jump ratios and fluorescence yields, and to open it in the lab. The tables cover hydrogen to californium (<Tex>{'Z = 1\\text{ to }98'}</Tex>).</p>
    </div>
    <section>
      <h2 id="periodic-table">Periodic table</h2>
      <p id="periodic-help" className="muted">Elements are ordered by atomic number. The two lower rows contain the lanthanides and actinides. Scroll within the table on a small screen, or use the list below.</p>
      <div className="periodic-table-wrap" role="region" aria-labelledby="periodic-table" aria-describedby="periodic-help" tabIndex={0}>
      <ol className="periodic-table">{ELEMENTS.map(el => {
        const { row, col } = tablePosition(el.Z);
        return <li key={el.slug} style={{ '--row': row, '--col': col } as CSSProperties}>
          <Link href={`/elements/${el.slug}/`} prefetch={false} aria-label={`${el.name} (${el.symbol}), atomic number ${el.Z}`} title={el.name}><small><Num>{String(el.Z)}</Num></small><strong><Tex plain>{formulaTex(el.symbol)}</Tex></strong></Link>
        </li>;
      })}</ol></div>
    </section>
    <section>
      <h2 id="k-and-l3">K and <EdgeName edge="L3" /> edge energies</h2>
      <div className="table-wrap edge-table-wrap" role="region" aria-labelledby="k-and-l3" tabIndex={0}><table className="edge-table">
        <caption>All tabulated elements, in atomic-number order. Scroll within the table to see every column.</caption>
        <thead><tr><th scope="col" className="num"><Tex plain>Z</Tex></th><th scope="col">Element</th><th scope="col" className="num">K edge (<Unit>eV</Unit>)</th><th scope="col" className="num"><EdgeName edge="L3" /> edge (<Unit>eV</Unit>)</th></tr></thead>
        <tbody>{ELEMENTS.map(el => {
          const k = el.edges.find(e => e.edge === 'K'), l3 = el.edges.find(e => e.edge === 'L3');
          return <tr key={el.slug}>
            <td className="num"><Num>{String(el.Z)}</Num></td>
            <th scope="row"><Link href={`/elements/${el.slug}/`} prefetch={false}>{el.name} ({el.symbol})</Link></th>
            <td className="num">{k ? <Num>{formatEnergy(k.energy_eV)}</Num> : 'Not listed'}</td>
            <td className="num">{l3 ? <Num>{formatEnergy(l3.energy_eV)}</Num> : 'Not listed'}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="muted">Edge energies from XrayDB <Num>9.2</Num> (Elam, Ravel and Sieber, <Num>2002</Num>) for isolated atoms, without chemical shifts. The lab has cross sections between {LAB_RANGE}; edges outside that range are listed for reference. <Link href="/validation/">Methods and data sources</Link></p>
    </section>
  </div>;
}

export function ElementPage({ element: el }: { element: ElementData }) {
  const at = ELEMENTS.indexOf(el), previous = ELEMENTS[at - 1], next = ELEMENTS[at + 1];
  const lower = el.name.toLowerCase(), main = defaultEdge(el), scannable = scannableEdges(el);
  const hard = scannable.filter(e => e.band === 'hard'), soft = scannable.filter(e => e.band === 'soft');
  const lowYield = soft.filter(e => e.fluorescenceYield < LOW_FLUORESCENCE_YIELD);
  const compounds = compoundsWith(el);
  const inRange = scannable.length === 0 ? <>none lies</> : scannable.length === 1 ? <>only <EdgeName edge={scannable[0].edge} /> lies</> : <>{edgeList(scannable)} lie</>;

  return <div className="page-content element-page">
    <div className="page-heading">
      <h1>{elementTitle(el)}</h1>
      <p>The {el.symbol} <EdgeName edge={main.edge} /> edge is at <Energy eV={main.energy_eV} />. The tables list <Num>{String(el.edges.length)}</Num> absorption {el.edges.length === 1 ? 'edge' : 'edges'} for {lower}; {inRange} between {LAB_RANGE}, the range the lab can scan.</p>
    </div>
    <dl className="element-facts">
      <div><dt>Atomic number</dt><dd><Tex plain>{`Z = ${el.Z}`}</Tex></dd></div>
      <div><dt>Molar mass</dt><dd><Num>{String(el.molarMass)}</Num> <Unit>g/mol</Unit></dd></div>
      <div><dt>Edges in the lab range</dt><dd><Num>{String(scannable.length)}</Num> of <Num>{String(el.edges.length)}</Num></dd></div>
    </dl>

    <section className="panel" aria-labelledby="open-in-lab">
      <h2 id="open-in-lab">Open {lower} in the lab</h2>
      <div className="toolbar">
        <a className="button" rel="nofollow" href={labHref(elementLabPath('crystal', el.symbol, main.edge))}><span>Open {el.symbol} <EdgeName edge={main.edge} /> on the Sample page</span></a>
        <a className="button secondary" rel="nofollow" href={labHref(elementLabPath('beamline', el.symbol, main.edge))}>{scannable.length ? 'Scan it on the beamline' : 'Inspect the absorption background'}</a>
      </div>
      <p className="muted">Both load {lower} as a pure sample with the formula <Tex plain>{formulaTex(el.symbol)}</Tex>. Density is retained from your current settings because these X-ray tables have no density. Enter your sample&apos;s density on the Sample page before planning a thickness.{scannable.length > 1 && ' To scan another edge, use the links in the table below.'}{!scannable.length && ' This edge is outside the lab range; the beamline shows only the available absorption background.'}</p>
    </section>

    <section>
      <h2 id="edges">Absorption edges of {lower}</h2>
      <div className="table-wrap edge-table-wrap" role="region" aria-labelledby="edges" tabIndex={0}><table className="edge-table">
        <caption>Energies, jump ratios and fluorescence yields as tabulated by Elam, Ravel and Sieber (<Num>2002</Num>). Scroll within the table to see every column.</caption>
        <thead><tr><th scope="col">Edge</th><th scope="col" className="num">Energy (<Unit>eV</Unit>)</th><th scope="col" className="num">Jump ratio</th><th scope="col" className="num">Fluorescence yield</th><th scope="col">In the lab</th></tr></thead>
        <tbody>{el.edges.map(e => <tr key={e.edge}>
          <th scope="row"><EdgeName edge={e.edge} /></th>
          <td className="num"><Num>{formatEnergy(e.energy_eV)}</Num></td>
          <td className="num"><Num>{String(e.jumpRatio)}</Num></td>
          <td className="num"><Num>{String(e.fluorescenceYield)}</Num></td>
          <td>{e.band === 'outside' ? 'Outside range' : <><a rel="nofollow" href={labHref(elementLabPath('beamline', el.symbol, e.edge))} aria-label={`Scan the ${el.symbol} ${e.edge} edge on the beamline`}>Scan</a><small>{e.band === 'soft' ? 'Soft X-ray' : 'Hard X-ray'}</small></>}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="muted">Jump ratio is the photoabsorption just above the edge divided by the photoabsorption just below it. Fluorescence yield is the probability that a core hole in that shell decays by emitting an X-ray. Both are dimensionless. The lab can scan across edges strictly between {LAB_RANGE}; other edges are listed for reference. A listed edge with jump ratio <Num>1</Num> has no step for thickness planning.</p>
    </section>

    <section aria-labelledby="detection">
      <h2 id="detection">Transmission, fluorescence or electron yield</h2>
      {hard.length > 0 && <p>{edgeList(hard)} {hard.length === 1 ? 'is a hard X-ray edge' : 'are hard X-ray edges'} in the lab&apos;s classification (<Num>2</Num> <Unit>keV</Unit> and above). The sample planner suggests transmission when the edge step is large enough relative to total attenuation. For a small step, as in a dilute absorber, it suggests fluorescence. Concentration alone does not decide the measurement mode.</p>}
      {soft.length > 0 && <p>{edgeList(soft)} {soft.length === 1 ? 'is a soft X-ray edge' : 'are soft X-ray edges'} in the lab&apos;s classification (below <Num>2</Num> <Unit>keV</Unit>). Transmission generally needs thin films or membranes, so the planner suggests fluorescence or electron yield.{lowYield.length > 0 && <> The fluorescence yield at {edgeList(lowYield)} is below <Num>{String(LOW_FLUORESCENCE_YIELD)}</Num>, where the lab suggests considering total electron yield.</>}</p>}
      {scannable.length > 0 && <p className="muted">These are planning rules of thumb. Sample thickness, self-absorption and the beamline&apos;s energy range and detectors still matter. The lab simulates transmission; it does not simulate fluorescence or electron-yield detector counts.</p>}
      {scannable.length === 0 && <p>No edge of {lower} lies between {LAB_RANGE}, so the lab cannot model a measurement across one. {el.name} still adds to the absorption background of any sample that contains it.</p>}
    </section>

    {compounds.length > 0 && <section aria-labelledby="compounds">
      <h2 id="compounds">Sample presets containing {lower}</h2>
      <ul className="compound-links">{compounds.map(({ preset, edge, path }) => <li key={preset.id}>
        <a rel="nofollow" href={labHref(path)}>{preset.name.replace(/ \([^)]*\)$/, '')}</a> <span><Tex plain>{formulaTex(preset.formula)}</Tex>, <Num>{String(preset.density)}</Num> <Unit>g/cm³</Unit>, opens at the {el.symbol} <EdgeName edge={edge} /> edge{el.edges.find(e => e.edge === edge)?.band === 'outside' && ' (outside the lab range)'}</span>
      </li>)}</ul>
      <p className="muted">These links load the preset&apos;s density and select {lower} as the absorber. Check the density source on the Sample page and adjust it for your sample.</p>
    </section>}

    <p className="muted">Values from <a href="https://xraypy.github.io/XrayDB/">XrayDB</a> <Num>9.2</Num> (Elam, Ravel and Sieber, <Num>2002</Num>), released into the public domain. These isolated-atom tables do not include chemical shifts, XANES or EXAFS fine structure. <Link href="/validation/">Methods and data sources</Link></p>
    <nav className="element-pager" aria-label="More elements">
      {previous && <Link href={`/elements/${previous.slug}/`}>Previous: {previous.name} ({previous.symbol})</Link>}
      <Link href="/elements/">All elements</Link>
      {next && <Link href={`/elements/${next.slug}/`}>Next: {next.name} ({next.symbol})</Link>}
    </nav>
  </div>;
}
