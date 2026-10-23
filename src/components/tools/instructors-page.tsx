// Server component for /instructors/: how to run a class on the beamline twin. The task list is read from the
// scenario definitions at build time, so it always matches what the Training dialog offers.
import Link from 'next/link';
import { Num } from '../tex';
import { TexProse } from '../twin/tex-prose';
import { SCENARIOS } from '@/lib/twin/scenarios';
import { RESULT_FORMAT } from '@/lib/twin/classroom';
import { INSTRUCTORS_PAGE } from '@/lib/site';

// A class link loads the twin page and opens the task, so it is a plain link rather than client navigation.
const twinHref = (hash: string) => (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/twin/' + hash;

export function InstructorsPage() {
  return <div className="page-content tool-page">
    <div className="page-heading">
      <h1>{INSTRUCTORS_PAGE.title}</h1>
      <p>The <Link href="/twin/">beamline twin</Link> has training tasks that each hide one thing about the instrument: a wrong energy offset, harmonics in the beam, the wrong gas in an ion chamber. A class link gives every student the same task with the same hidden fault, and each student hands back a small result file you can load into one table. There are no accounts and nothing is uploaded.</p>
    </div>

    <section className="panel" aria-labelledby="class-steps">
      <h2 id="class-steps">Running a class</h2>
      <ol className="tool-steps">
        <li>Open the <Link href="/twin/">beamline twin</Link> and press <strong>Training</strong> (or the <kbd>T</kbd> key).</li>
        <li>Pick a task below and press <strong>Class link</strong> next to it. The link is copied, with the task and the current seed in it, for example <code>{'…/twin/#train=s1-calibrate&seed=7'}</code>. Everyone who opens it meets the same hidden fault.</li>
        <li>Students work with the normal controls, some of which a task locks, then judge their own result and name the clues they used. The reveal shows what was hidden, a score out of <Num>100</Num> and why the data looked the way it did.</li>
        <li>Each student types a name and downloads a result file (<code>{RESULT_FORMAT}</code>, a few kilobytes of JSON) and sends it to you by your usual route.</li>
        <li>In Training, open <strong>For instructors: class links and results</strong> and press <strong>Load result files</strong>. You get a row per task (how many tried it, mean score, how many succeeded, mean confidence) and a row per student, and you can download the table as CSV. The files stay in your browser.</li>
      </ol>
    </section>

    <section>
      <h2 id="class-tasks">The tasks</h2>
      <div className="table-wrap edge-table-wrap" role="region" aria-labelledby="class-tasks" tabIndex={0}><table className="edge-table tool-tasks">
        <caption>The tasks offered in Training, in order. Each link opens the task with seed <Num>1</Num>; copy a class link from Training to choose another seed.</caption>
        <thead><tr><th scope="col">Task</th><th scope="col">What the student is asked</th></tr></thead>
        <tbody>{SCENARIOS.map(s => <tr key={s.id}>
          <th scope="row"><a href={twinHref(`#train=${s.id}&seed=1`)} rel="nofollow">{s.title}</a></th>
          <td><TexProse>{s.brief}</TexProse></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section aria-labelledby="class-notes">
      <h2 id="class-notes">Good to know</h2>
      <ul>
        <li><strong>Same seed, same fault.</strong> The seed fixes the hidden values, so two students on one link can compare notes; give groups different seeds if you would rather they could not.</li>
        <li><strong>Replays.</strong> If a student turns recording on before starting, the reveal comes with a replay they can scrub through to see what they changed and when, and the recording downloads as a file. It is never uploaded.</li>
        <li><strong>Offline.</strong> Installed as an app, the twin works without a network, which helps in rooms with poor Wi-Fi.</li>
        <li><strong>Before the beamline.</strong> The <Link href="/tools/">calculators</Link> cover the same choices students meet at a real beamline: ion chamber gases, the harmonic rejection mirror, self absorption and dose. The <Link href="/validation/">Methods</Link> page lists every model and the tests behind it.</li>
      </ul>
    </section>
  </div>;
}
