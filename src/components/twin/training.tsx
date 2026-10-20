'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Num } from '../tex';
import { Plot } from '../plot';
import { download } from '../ui';
import { seededRandom } from '@/lib/xas';
import { SCENARIOS, type Scenario, type ScenarioMetrics } from '@/lib/twin/scenarios';
import { Recorder, SNAP_INTERVAL_S, type TelemetryLog } from '@/lib/twin/telemetry';
import type { TwinState } from '@/lib/twin/types';
import { useTwin } from './twin-store';
import { TexProse } from './tex-prose';

interface Run {
  scenario: Scenario;
  truth: Record<string, number>;
  seed: number;
  started: number;
  recorder: Recorder | null;
  phase: 'working' | 'judging' | 'revealed';
  metrics?: ScenarioMetrics;
}

const RATINGS = ['Not at all', 'Unsure', 'Fairly', 'Quite', 'Certain'];
const sessionId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

/** The parts of the state whose changes are recorded, as text for the log. */
const WATCHED: [string, (t: TwinState) => string][] = [
  ['energy', t => t.energy_eV.toFixed(1)], ['mode', t => t.mode], ['realistic', t => String(t.realistic)],
  ['sample', t => t.sample.formula + ' ' + t.sample.absorber + ' ' + t.sample.edge], ['detune', t => String(t.profile.mono.detune)],
  ['gains', t => t.profile.chambers.map(c => c.gain_V_per_A).join('/')], ['scan', t => JSON.stringify(t.scan.regions.length) + t.scan.kind + t.scan.repeats],
];

/** Training button, scenario list, task card, judgement, reveal and replay (plan 3.10). */
export function Training() {
  const { store: { twin, view }, dispatch } = useTwin();
  const dialog = useRef<HTMLDialogElement>(null);
  const [record, setRecord] = useState(false), [experience, setExperience] = useState<TelemetryLog['experience']>('unstated');
  const [run, setRun] = useState<Run | null>(null);
  const [answer, setAnswer] = useState(''), [rating, setRating] = useState(-1), [cues, setCues] = useState<string[]>([]), [note, setNote] = useState('');
  const [frame, setFrame] = useState(0);
  const previous = useRef<TwinState | null>(null), acquires = useRef(view.acquireRequest);
  const now = () => run ? (performance.now() - run.started) / 1000 : 0;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (view.training && !d.open) d.showModal();
    if (!view.training && d.open) d.close();
  }, [view.training]);

  // Record changes and acquisitions while the task runs.
  useEffect(() => {
    const before = previous.current;
    previous.current = twin;
    if (!run?.recorder || run.phase !== 'working' || !before || before === twin) return;
    for (const [key, read] of WATCHED) {
      const from = read(before), to = read(twin);
      if (from === to) continue;
      run.recorder.add(key === 'mode' ? { t: now(), type: 'mode', mode: to } : { t: now(), type: 'change', key, from, to, source: 'ui' });
    }
  });
  useEffect(() => {
    if (view.acquireRequest === acquires.current) return;
    acquires.current = view.acquireRequest;
    if (run?.recorder && run.phase === 'working') run.recorder.add({ t: now(), type: 'acquire' });
  });
  // Snapshots every half second, with the hidden score the user cannot see yet.
  const latest = useRef({ twin, answer });
  latest.current = { twin, answer };
  useEffect(() => {
    if (!run?.recorder || run.phase !== 'working') return;
    const timer = setInterval(() => {
      const { twin: t, answer: a } = latest.current;
      const score = run.scenario.metrics({ state: t, truth: run.truth, acquisitions: [], answer: a === '' ? undefined : Number(a) }).score;
      run.recorder!.add({ t: (performance.now() - run.started) / 1000, type: 'snap', energy_eV: t.energy_eV, mode: t.mode, score });
    }, SNAP_INTERVAL_S * 1000);
    return () => clearInterval(timer);
  }, [run]);

  function start(scenario: Scenario) {
    const seed = twin.seed;
    const { state, truth } = scenario.setup(twin, seededRandom(seed >>> 0));
    const recorder = record ? new Recorder(sessionId(), { id: scenario.id, seed }, experience, new Date()) : null;
    setRun({ scenario, truth, seed, started: performance.now(), recorder, phase: 'working' });
    setAnswer(''); setRating(-1); setCues([]); setNote(''); setFrame(0);
    previous.current = state;
    dispatch({ type: 'load', twin: state, locked: scenario.locked, note: `Training: ${scenario.title}. Seed ${seed}.` });
    dispatch({ type: 'training', open: false });
  }

  function judge() {
    if (!run) return;
    const metrics = run.scenario.metrics({ state: twin, truth: run.truth, acquisitions: [], answer: answer === '' ? undefined : Number(answer) });
    run.recorder?.add({ t: now(), type: 'judge', rating: rating + 1, cues, note });
    run.recorder?.add({ t: now(), type: 'end', score: metrics.score, success: metrics.success });
    setRun({ ...run, phase: 'revealed', metrics });
    dispatch({ type: 'note', text: `Training result: ${metrics.score} out of 100.` });
  }

  function close() {
    setRun(null);
    dispatch({ type: 'load', twin, locked: [], note: 'Training ended; every control is free again.' });
  }

  const snaps = run?.recorder?.snapshots() ?? [];
  const shown = snaps[Math.min(frame, snaps.length - 1)];
  return <>
    <dialog ref={dialog} className="twin-dialog" aria-labelledby="twin-training-title" onClose={() => dispatch({ type: 'training', open: false })} onClick={e => { if (e.target === dialog.current) dispatch({ type: 'training', open: false }); }}>
      <div className="twin-dialog-body">
        <div className="twin-section-head">
          <h2 id="twin-training-title">Training scenarios</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => dispatch({ type: 'training', open: false })}><X size={18} aria-hidden="true" /></button>
        </div>
        <p className="twin-note">Each task hides one thing about the instrument, seeded from the link (seed <Num>{String(twin.seed)}</Num>). Work with the normal controls, judge your result, then see the truth.</p>
        <fieldset className="twin-chamber">
          <legend>Recording</legend>
          <label className="twin-check"><input type="radio" name="twin-record" checked={!record} onChange={() => setRecord(false)} />Do not record</label>
          <label className="twin-check"><input type="radio" name="twin-record" checked={record} onChange={() => setRecord(true)} />Record this run on this device for the replay (never uploaded)</label>
          {record && <label className="twin-field">Your XAS experience (optional)
            <select value={experience} onChange={e => setExperience(e.target.value as TelemetryLog['experience'])}>
              <option value="unstated">Rather not say</option><option value="new">New to XAS</option><option value="some">Some beamtimes</option><option value="expert">Expert</option>
            </select>
          </label>}
        </fieldset>
        <ul className="twin-scenarios">{SCENARIOS.map(s => <li key={s.id}>
          <h3>{s.title}</h3>
          <p><TexProse>{s.brief}</TexProse></p>
          <button type="button" className="button cta small" onClick={() => start(s)}>Start {s.title.toLowerCase()}</button>
        </li>)}</ul>
      </div>
    </dialog>

    {run && <section className="twin-task" aria-labelledby="twin-task-title">
      <div className="twin-section-head">
        <h2 id="twin-task-title">Task: {run.scenario.title}</h2>
        <button type="button" className="button secondary small" onClick={close}>{run.phase === 'revealed' ? 'Close' : 'Give up'}</button>
      </div>
      {run.phase !== 'revealed' && <p><TexProse>{run.scenario.brief}</TexProse></p>}
      {run.phase === 'working' && <div className="twin-task-actions">
        {run.scenario.answer && <label className="twin-field">{run.scenario.answer.label}<input type="number" step={0.1} inputMode="decimal" value={answer} onChange={e => setAnswer(e.target.value)} /></label>}
        <button type="button" className="button cta small" onClick={() => setRun({ ...run, phase: 'judging' })}>Done</button>
      </div>}
      {run.phase === 'judging' && <form className="twin-judge" onSubmit={e => { e.preventDefault(); judge(); }}>
        <fieldset><legend>How sure are you that you got it right?</legend>
          {RATINGS.map((r, i) => <label key={r} className="twin-check"><input type="radio" name="twin-rating" checked={rating === i} onChange={() => setRating(i)} required />{r}</label>)}
        </fieldset>
        <fieldset><legend>Which cues did you use?</legend>
          {run.scenario.cues.map(c => <label key={c} className="twin-check"><input type="checkbox" checked={cues.includes(c)} onChange={e => setCues(e.target.checked ? [...cues, c] : cues.filter(x => x !== c))} /><TexProse>{c}</TexProse></label>)}
        </fieldset>
        <label className="twin-field">A note for yourself (optional)<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
        <button type="submit" className="button cta small">Show the truth</button>
      </form>}
      {run.phase === 'revealed' && run.metrics && <div className="twin-reveal">
        <p className="twin-score"><strong><Num>{String(run.metrics.score)}</Num></strong> out of <Num>100</Num>, {run.metrics.success ? 'well done' : 'not there yet'}.</p>
        <dl className="twin-rows">{run.metrics.details.map(d => <div key={d.label}><dt>{d.label}</dt><dd><TexProse>{d.value}</TexProse></dd></div>)}</dl>
        <p><TexProse>{run.scenario.reveal(run.truth)}</TexProse></p>
        {snaps.length > 1 && <div className="twin-replay">
          <h3>Replay</h3>
          <Plot series={[{ name: 'Score', color: '#7fd8cf', x: snaps.map(s => s.t), y: snaps.map(s => s.score) }]} xLabel="Time (s)" yLabel="Score" minY={0} height={160} exportName="twin-training-score" />
          <label className="twin-field">Moment in the run
            <input type="range" min={0} max={snaps.length - 1} value={Math.min(frame, snaps.length - 1)} onChange={e => setFrame(Number(e.target.value))} aria-valuetext={shown ? `${shown.t.toFixed(1)} s` : undefined} />
          </label>
          {shown && <p className="twin-readout">At <Num>{shown.t.toFixed(1)}</Num> s: {shown.mode} mode, energy <Num>{shown.energy_eV.toFixed(1)}</Num> eV, score <Num>{String(shown.score)}</Num>.</p>}
        </div>}
        <div className="twin-task-actions">
          {run.recorder && <button type="button" className="button secondary small" onClick={() => download(`twin-training-${run.scenario.id}-seed${run.seed}.json`, run.recorder!.toJSON())}><Download size={14} aria-hidden="true" />Download the recording</button>}
          <button type="button" className="button secondary small" onClick={() => start(run.scenario)}>Try again</button>
        </div>
      </div>}
    </section>}
  </>;
}
