// Server components for /tools/ and the four calculator pages. The worked-example tables are computed at build time
// from the same tables and functions the live calculators use, so the static HTML already carries real numbers.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Num, Tex, Unit, formulaTex } from '../tex';
import { loadXrayData } from '@/lib/xraydata';
import { loadOptics } from '@/lib/twin/tables';
import { FILL_TARGETS } from '@/lib/twin/chambers';
import { TEACHING_CRITICAL_DOSE_Gy } from '@/lib/twin/damage';
import { TOOLS_PAGE, TOOL_PAGES, type ToolPage } from '@/lib/site';
import {
  DAMAGE_KIND_LABEL, DOSE_EXAMPLES, EXAFS_K, GAS_EXAMPLE_EDGES, MIRROR_COATINGS_SHOWN, MIRROR_EXAMPLE_ENERGIES_eV, SELF_ABSORPTION_EXAMPLES,
  dosePlan, edgeOf, gasPlan, mirrorChoice, mixLabel, selfAbsorption,
} from '@/lib/tools';
import { DoseCalculator, GasCalculator, MirrorCalculator, SelfAbsorptionCalculator } from './calculators';
import { Duration, Percent, Quantity, sig } from './format';

const tables = () => Promise.all([loadXrayData(), loadOptics()]);
const tool = (slug: string) => TOOL_PAGES.find(t => t.slug === `tools/${slug}`)!;

export function ToolsIndex() {
  return <div className="page-content tool-page">
    <div className="page-heading">
      <h1>Beamline calculators</h1>
      <p>{TOOLS_PAGE.description} Each one is a piece of the <Link href="/twin/">beamline twin</Link>, on its own page.</p>
    </div>
    <ul className="tool-list">{TOOL_PAGES.map(t => <li key={t.slug} className="panel">
      <h2><Link href={`/${t.slug}/`}>{t.name}</Link></h2>
      <p>{t.description}</p>
    </li>)}</ul>
    <p className="muted">Teaching with these? See <Link href="/instructors/">For instructors</Link>. The models, their sources and their tests are on the <Link href="/validation/">Methods</Link> page.</p>
  </div>;
}

/** Heading, the calculator, then the page's own sections and links to the other calculators. */
function ToolFrame({ page, intro, calculator, children }: { page: ToolPage; intro: ReactNode; calculator: ReactNode; children: ReactNode }) {
  return <div className="page-content tool-page">
    <div className="page-heading">
      <h1>{page.title}</h1>
      <p>{intro}</p>
    </div>
    {calculator}
    {children}
    <section aria-labelledby="more-tools">
      <h2 id="more-tools">More calculators</h2>
      <ul className="tool-links">{TOOL_PAGES.filter(t => t !== page).map(t => <li key={t.slug}><Link href={`/${t.slug}/`}>{t.name}</Link></li>)}<li><Link href="/twin/">The whole beamline twin</Link></li></ul>
    </section>
  </div>;
}

/** A block equation that scrolls sideways on its own on a narrow screen, reachable with the keyboard. */
const Equation = ({ label, children }: { label: string; children: string }) =>
  <div className="tool-equation" role="group" aria-label={label} tabIndex={0}><Tex block>{children}</Tex></div>;

const Table = ({ id, caption, head, children }: { id: string; caption: ReactNode; head: ReactNode; children: ReactNode }) =>
  <div className="table-wrap edge-table-wrap" role="region" aria-labelledby={id} tabIndex={0}><table className="edge-table">
    <caption>{caption}</caption><thead><tr>{head}</tr></thead><tbody>{children}</tbody>
  </table></div>;

/* ---------- Ion chamber gas ---------- */

export async function IonChamberGasPage() {
  await tables();
  const page = tool('ion-chamber-gas'), i0 = FILL_TARGETS.I0, it = FILL_TARGETS.It;
  const rows = GAS_EXAMPLE_EDGES.map(([label, el, edge]) => { const e = edgeOf(el, edge); return { label, e, i0: gasPlan(e, 15, 'I0').suggestion, it: gasPlan(e, 30, 'It').suggestion }; });
  return <ToolFrame page={page} calculator={<GasCalculator />} intro={<>An ion chamber measures the beam through the ion pairs photons make in its gas, so the fill decides how much of the beam it takes. The chamber before the sample, <Tex plain>{'I_0'}</Tex>, should take <Percent value={i0.min} digits={0} /> to <Percent value={i0.max} digits={0} />, leaving most of the beam for the sample; the one after it, <Tex plain>{'I_t'}</Tex>, <Percent value={it.min} digits={0} /> to <Percent value={it.max} digits={0} />. Give the energy and the plate length and the calculator finds the lightest helium, nitrogen, argon or krypton mix in that range.</>}>
    <section>
      <h2 id="gas-examples">Fills at common edges</h2>
      <Table id="gas-examples" caption={<>Suggested fills for a <Num>15</Num> <Unit>cm</Unit> <Tex plain>{'I_0'}</Tex> and a <Num>30</Num> <Unit>cm</Unit> <Tex plain>{'I_t'}</Tex> at <Num>1</Num> atm and <Num>295</Num> <Unit>K</Unit>, with the fraction each absorbs.</>}
        head={<><th scope="col">Edge</th><th scope="col" className="num">Energy (<Unit>eV</Unit>)</th><th scope="col"><Tex plain>{'I_0'}</Tex> fill</th><th scope="col" className="num">Absorbs</th><th scope="col"><Tex plain>{'I_t'}</Tex> fill</th><th scope="col" className="num">Absorbs</th></>}>
        {rows.map(r => <tr key={r.label}><th scope="row"><Tex plain>{formulaTex(r.label.split(' ')[0])}</Tex> {r.label.split(' ')[1]}</th><td className="num"><Num>{String(Math.round(r.e))}</Num></td><td>{mixLabel(r.i0.mix)}</td><td className="num"><Percent value={r.i0.absorbed} /></td><td>{mixLabel(r.it.mix)}</td><td className="num"><Percent value={r.it.absorbed} /></td></tr>)}
      </Table>
    </section>
    <section aria-labelledby="gas-how">
      <h2 id="gas-how">How it is worked out</h2>
      <p>The fraction absorbed in the gas, the part that makes ion pairs, is</p>
      <Equation label="Absorbed fraction">{String.raw`f = \left(1 - e^{-\mu L}\right)\frac{\mu_\mathrm{photo}}{\mu}, \qquad \mu = \sum_i x_i \left(\frac{\mu}{\rho}\right)_{\!i} \rho_i`}</Equation>
      <p>with <Tex plain>L</Tex> the active length, <Tex plain>{'x_i'}</Tex> the share of each gas and its density from the ideal gas law at <Num>1</Num> atm and <Num>295</Num> <Unit>K</Unit>. Cross sections are the tabulated values of XrayDB (Elam, Ravel and Sieber), the same ones <code>ionchamber_fluxes</code> in XrayDB uses. Scattered photons leave the chamber, so only the photoelectric share counts.</p>
      <p>The search steps through helium, helium and nitrogen, nitrogen, nitrogen and argon, argon, argon and krypton, then krypton, in <Num>1</Num> % steps, and keeps the mix closest to <Percent value={i0.aim} digits={0} /> for <Tex plain>{'I_0'}</Tex> or <Percent value={it.aim} digits={0} /> for <Tex plain>{'I_t'}</Tex> and <Tex plain>{'I_\\mathrm{ref}'}</Tex>, preferring the lighter mix on a tie. Every candidate is evaluated at the real energy, because the krypton K edge at <Num>14326</Num> <Unit>eV</Unit> makes krypton absorb far more just above it. The targets follow Bunker, <em>Introduction to XAFS</em> (Cambridge University Press, <Num>2010</Num>), chapter <Num>3</Num>.</p>
    </section>
  </ToolFrame>;
}

/* ---------- Harmonic rejection mirror ---------- */

export async function HarmonicMirrorPage() {
  await tables();
  const page = tool('harmonic-rejection-mirror');
  return <ToolFrame page={page} calculator={<MirrorCalculator />} intro={<>A Si(<Num>111</Num>) monochromator set to an energy <Tex plain>E</Tex> also passes <Tex plain>3E</Tex> through its (<Num>333</Num>) reflection. A mirror at grazing incidence reflects only below a cutoff energy that falls as the angle grows, so tilting it until the cutoff sits between <Tex plain>E</Tex> and <Tex plain>3E</Tex> keeps the beam you want and throws the harmonic away. The calculator picks the largest tabulated angle that keeps at least <Num>80</Num> % of <Tex plain>E</Tex> and passes at most <Num>1</Num> % of <Tex plain>3E</Tex> in one bounce.</>}>
    <section>
      <h2 id="mirror-examples">Angles by energy and coating</h2>
      <Table id="mirror-examples" caption={<>The largest angle (<Unit>mrad</Unit>) that meets both limits in one bounce. A dash means no tabulated angle from <Num>1</Num> to <Num>6</Num> <Unit>mrad</Unit> does, usually because the coating&apos;s own absorption edges sit near <Tex plain>E</Tex> or <Tex plain>3E</Tex>.</>}
        head={<><th scope="col" className="num">Energy (<Unit>keV</Unit>)</th>{MIRROR_COATINGS_SHOWN.map(c => <th key={c} scope="col" className="num">{c}</th>)}</>}>
        {MIRROR_EXAMPLE_ENERGIES_eV.map(e => <tr key={e}><th scope="row" className="num"><Num>{String(e / 1000)}</Num></th>{MIRROR_COATINGS_SHOWN.map(c => { const m = mirrorChoice(c, e); return <td key={c} className="num">{m.ok ? <Num>{String(m.angle_mrad)}</Num> : '–'}</td>; })}</tr>)}
      </Table>
    </section>
    <section aria-labelledby="mirror-how">
      <h2 id="mirror-how">How it is worked out</h2>
      <p>Reflectivities come from <code>mirror_reflectivity</code> in XrayDB for a perfectly smooth coating of bulk density, s polarization, single bounce, tabulated from <Num>1</Num> to <Num>6</Num> <Unit>mrad</Unit> and <Num>2</Num> to <Num>60</Num> <Unit>keV</Unit>; so <Tex plain>3E</Tex> must stay below <Num>60</Num> <Unit>keV</Unit>. The cutoff shown is where the reflectivity at the chosen angle falls through <Num>50</Num> %. Far from absorption edges it scales as <Tex plain>{String.raw`E_\mathrm{c} \propto 1/\theta`}</Tex>, which is why the angles in the table fall as the energy rises.</p>
      <p>The largest angle that still meets both limits is the most robust choice: a small drift in mirror pitch then costs a little fundamental rather than letting the harmonic back in. Real coatings are rough, which lowers the reflectivity near the cutoff, and a second mirror squares both numbers, so <Num>1</Num> % of the harmonic becomes <Num>0.01</Num> %. Si(<Num>111</Num>) has almost no (<Num>222</Num>) reflection, so its first harmonic is <Tex plain>3E</Tex>; Si(<Num>220</Num>) passes <Tex plain>2E</Tex> through (<Num>440</Num>), and Si(<Num>311</Num>) passes <Tex plain>3E</Tex> through (<Num>933</Num>).</p>
    </section>
  </ToolFrame>;
}

/* ---------- Self absorption ---------- */

export async function SelfAbsorptionPage() {
  await tables();
  const page = tool('self-absorption');
  const rows = SELF_ABSORPTION_EXAMPLES.map(e => ({ ...e, result: selfAbsorption(e.input) }));
  return <ToolFrame page={page} calculator={<SelfAbsorptionCalculator />} intro={<>A fluorescence signal follows the absorber&apos;s <Tex plain>{'\\mu(E)'}</Tex> only while the sample is thin or dilute. In a thick, concentrated sample the beam is used up close to the surface wherever <Tex plain>{'\\mu'}</Tex> is large, so peaks come out too small: the white line flattens and the EXAFS shrinks. The calculator gives the share of the true fine structure your measurement would show.</>}>
    <section>
      <h2 id="self-examples">Typical samples</h2>
      <Table id="self-examples" caption={<>Share of the true fine structure seen in fluorescence at <Num>45</Num>° in and out unless stated, just above the edge and at <Tex plain>{`k = ${EXAFS_K}\\ \\mathrm{\\AA^{-1}}`}</Tex>. Densities are of the sample as packed.</>}
        head={<><th scope="col">Sample</th><th scope="col" className="num">Depth exponent</th><th scope="col" className="num">White line shows</th><th scope="col" className="num">EXAFS shows</th></>}>
        {rows.map(r => <tr key={r.label}><th scope="row">{r.label}</th><td className="num"><Num>{sig(r.result.exponent)}</Num></td><td className="num"><Percent value={r.result.points[0].kept} digits={0} /></td><td className="num"><Percent value={r.result.points[1].kept} digits={0} /></td></tr>)}
      </Table>
    </section>
    <section aria-labelledby="self-how">
      <h2 id="self-how">How it is worked out</h2>
      <p>For a flat sample of thickness <Tex plain>d</Tex>, incidence angle <Tex plain>{'\\phi'}</Tex> and exit angle <Tex plain>{'\\psi'}</Tex> (Booth and Bridges, <em>Physica Scripta</em> <Num>2005</Num>):</p>
      <Equation label="Fluorescence of a flat sample">{String.raw`\frac{I_f}{I_0} \propto \frac{\mu_a(E)}{\mu_T(E) + g\,\mu_T(E_f)}\left[1 - e^{-\left(\frac{\mu_T(E)}{\sin\phi} + \frac{\mu_T(E_f)}{\sin\psi}\right)d}\right], \qquad g = \frac{\sin\phi}{\sin\psi}`}</Equation>
      <p>where <Tex plain>{'\\mu_a'}</Tex> is the absorber edge alone, <Tex plain>{'\\mu_T'}</Tex> the whole sample, and <Tex plain>{'E_f'}</Tex> the energy of the strongest emission line. The bracket&apos;s exponent is the depth exponent in the table: below about <Num>0.1</Num> the sample is thin and the signal follows <Tex plain>{'\\mu_a'}</Tex>. The share shown is <Tex plain>{String.raw`\mathrm{d}\ln I_f / \mathrm{d}\ln \mu_a`}</Tex>, worked out numerically; for a thick sample it equals <Tex plain>{String.raw`1 - \mu_a/(\mu_T(E) + g\,\mu_T(E_f))`}</Tex>. All <Tex plain>{'\\mu'}</Tex> are tabulated XrayDB values with a sharp edge, the same model the twin uses.</p>
      <p>To reduce it: measure in transmission if the sample allows, dilute it in a light matrix such as boron nitride or cellulose, make it much thinner than one absorption length, or collect at a grazing exit angle so the fluorescence comes from a thin skin. The twin&apos;s self absorption task (S4) lets students try each fix.</p>
    </section>
  </ToolFrame>;
}

/* ---------- Dose ---------- */

export async function DosePage() {
  await tables();
  const page = tool('x-ray-dose');
  const rows = DOSE_EXAMPLES.map(e => ({ ...e, plan: dosePlan(e.input) }));
  return <ToolFrame page={page} calculator={<DoseCalculator />} intro={<>Dose is the energy a sample absorbs per kilogram, in gray. It grows with the flux density, so focusing the same beam onto a spot <Num>100</Num> times smaller raises the dose rate <Num>100</Num> times; metal complexes in solution can then change oxidation state within seconds. The calculator gives the dose rate in the illuminated volume and the time until typical damage doses.</>}>
    <section>
      <h2 id="dose-examples">Typical beams</h2>
      <Table id="dose-examples" caption={<>Mean dose rate in the illuminated volume and the time to the teaching dose for a metal complex in water, <Quantity value={TEACHING_CRITICAL_DOSE_Gy.solution} unit="Gy" />.</>}
        head={<><th scope="col">Beam and sample</th><th scope="col" className="num">Flux density (<Unit>photons/s/mm²</Unit>)</th><th scope="col" className="num">Dose rate (<Unit>Gy/s</Unit>)</th><th scope="col" className="num">Time to <Quantity value={TEACHING_CRITICAL_DOSE_Gy.solution} unit="Gy" /></th></>}>
        {rows.map(r => <tr key={r.label}><th scope="row">{r.label}</th><td className="num"><Num>{sig(r.plan.fluxDensity_per_s_mm2)}</Num></td><td className="num"><Num>{sig(r.plan.meanRate_Gy_per_s)}</Num></td><td className="num"><Duration seconds={r.plan.timeTo.find(t => t.kind === 'solution')!.seconds} /></td></tr>)}
      </Table>
    </section>
    <section aria-labelledby="dose-how">
      <h2 id="dose-how">How it is worked out</h2>
      <p>With flux <Tex plain>{'\\Phi'}</Tex> at energy <Tex plain>E</Tex> on a beam area <Tex plain>A</Tex>, a sample of density <Tex plain>{'\\rho'}</Tex> and thickness <Tex plain>x</Tex>, the dose rate averaged over the illuminated volume and at the front face are</p>
      <Equation label="Dose rate">{String.raw`\dot D = \frac{\Phi E \left(1 - e^{-\mu_\mathrm{photo} x}\right)}{\rho\, x\, A}, \qquad \dot D_\mathrm{surface} = \frac{\Phi E}{A}\left(\frac{\mu_\mathrm{en}}{\rho}\right)`}</Equation>
      <p>with the photoelectric <Tex plain>{String.raw`\mu_\mathrm{photo}/\rho`}</Tex> from XrayDB standing in for <Tex plain>{String.raw`\mu_\mathrm{en}/\rho`}</Tex>. Both count all absorbed energy as staying in the sample, so they are upper bounds; fluorescence escaping a thin sample carries some away. The beam is treated as a flat rectangle of the size you give.</p>
      <Table id="dose-thresholds" caption="Teaching damage doses used here and in the twin. They mark the order of magnitude only; real thresholds depend on the chemistry, temperature and dose rate, so measure repeated scans on your own sample."
        head={<><th scope="col">Sample kind</th><th scope="col" className="num">Dose (<Unit>Gy</Unit>)</th></>}>
        {(Object.entries(TEACHING_CRITICAL_DOSE_Gy) as [keyof typeof TEACHING_CRITICAL_DOSE_Gy, number][]).map(([kind, dose]) => <tr key={kind}><th scope="row">{DAMAGE_KIND_LABEL[kind]}</th><td className="num"><Num>{sig(dose)}</Num></td></tr>)}
      </Table>
    </section>
  </ToolFrame>;
}
