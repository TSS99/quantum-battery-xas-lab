/**
 * Local, opt-in recording of a training run, format `xaslab-twin-telemetry/1`. It lives in the
 * page and downloads as JSON; nothing is ever uploaded. Times are seconds since the run started.
 */
export const TELEMETRY_FORMAT = 'xaslab-twin-telemetry/1';

export type TelemetryEvent =
  | { t: number; type: 'change'; key: string; from: string; to: string; source: 'ui' | 'keyboard' | 'agent' }
  | { t: number; type: 'snap'; energy_eV: number; mode: string; score: number }
  | { t: number; type: 'mode'; mode: string }
  | { t: number; type: 'acquire' }
  | { t: number; type: 'judge'; rating: number; cues: string[]; note: string }
  | { t: number; type: 'end'; score: number; success: boolean };

export interface TelemetryLog {
  format: typeof TELEMETRY_FORMAT;
  /** Random id made by the page for this run; not linked to a person. */
  session: string;
  /** Self-reported, optional. */
  experience: 'new' | 'some' | 'expert' | 'unstated';
  scenario: { id: string; seed: number };
  started: string;
  events: TelemetryEvent[];
}

/** Snapshots are taken every half second (plan 3.10). */
export const SNAP_INTERVAL_S = 0.5;

export class Recorder {
  readonly log: TelemetryLog;
  constructor(session: string, scenario: { id: string; seed: number }, experience: TelemetryLog['experience'], started: Date) {
    this.log = { format: TELEMETRY_FORMAT, session, experience, scenario, started: started.toISOString(), events: [] };
  }
  add(event: TelemetryEvent) {
    const last = this.log.events.at(-1);
    if (last && event.t < last.t) throw new RangeError('Telemetry events must be added in time order.');
    this.log.events.push(event);
  }
  /** Score-over-time points from the snapshots, for the replay. */
  snapshots() { return this.log.events.filter((e): e is Extract<TelemetryEvent, { type: 'snap' }> => e.type === 'snap'); }
  toJSON() { return JSON.stringify(this.log); }
}

/** Checks a recording's shape; returns the problems, empty when it is valid. */
export function validateTelemetry(value: unknown): string[] {
  const problems: string[] = [];
  const log = value as Partial<TelemetryLog>;
  if (!log || typeof log !== 'object') return ['Not an object.'];
  if (log.format !== TELEMETRY_FORMAT) problems.push(`format is not ${TELEMETRY_FORMAT}`);
  if (typeof log.session !== 'string' || !log.session) problems.push('session id missing');
  if (!log.scenario || typeof log.scenario.id !== 'string' || !Number.isInteger(log.scenario.seed)) problems.push('scenario id or seed missing');
  if (!Array.isArray(log.events)) problems.push('events missing');
  else {
    const kinds = new Set(['change', 'snap', 'mode', 'acquire', 'judge', 'end']);
    log.events.forEach((e, i) => {
      if (!kinds.has(e.type)) problems.push(`event ${i} has unknown type ${String(e.type)}`);
      if (!(e.t >= 0)) problems.push(`event ${i} has no time`);
      if (i > 0 && e.t < log.events![i - 1].t) problems.push(`event ${i} is out of order`);
    });
  }
  return problems;
}
