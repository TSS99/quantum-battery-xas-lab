// Classroom (plan 3.10), with no server: an instructor shares a task link (scenario and seed), each student
// downloads a result file after the reveal, and the instructor loads the files in the browser to tabulate them.

export const RESULT_FORMAT = 'xaslab-twin-result/1';

export interface TrainingResult {
  format: typeof RESULT_FORMAT;
  /** The name the student typed, or an empty string. */
  student: string;
  scenario: { id: string; title: string };
  seed: number;
  /** 0 to 100. */
  score: number;
  success: boolean;
  /** How sure the student was before the reveal, 1 (not at all) to 5 (certain). */
  confidence: number;
  cues: string[];
  answer: number | null;
  /** The reveal's rows: plain text with $...$ around LaTeX. */
  details: { label: string; value: string }[];
  /** When the task started, ISO 8601. */
  started: string;
  /** Seconds from the start to the judgement. */
  seconds: number;
}

export const resultToJson = (result: TrainingResult) => JSON.stringify(result, null, 2) + '\n';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;

/** Reads one result file. Throws with a plain message on anything malformed, so one bad file cannot spoil the table. */
export function parseResult(json: string): TrainingResult {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('This file is not valid JSON.'); }
  if (!isRecord(raw) || raw.format !== RESULT_FORMAT) throw new Error(`This is not a ${RESULT_FORMAT} file.`);
  const r = raw, scenario = r.scenario;
  if (!text(r.student, 80)) throw new Error('The student name must be text of at most 80 characters.');
  if (!isRecord(scenario) || !text(scenario.id, 60) || !/^[a-z0-9-]+$/.test(scenario.id as string) || !text(scenario.title, 120)) throw new Error('The result names no valid task.');
  if (typeof r.seed !== 'number' || !Number.isInteger(r.seed) || r.seed < 0 || r.seed > 4294967295) throw new Error('The seed must be a whole number.');
  if (typeof r.score !== 'number' || !Number.isFinite(r.score) || r.score < 0 || r.score > 100) throw new Error('The score must be from 0 to 100.');
  if (typeof r.success !== 'boolean') throw new Error('The result must say whether the task succeeded.');
  if (typeof r.confidence !== 'number' || !Number.isInteger(r.confidence) || r.confidence < 1 || r.confidence > 5) throw new Error('The confidence must be a whole number from 1 to 5.');
  if (!Array.isArray(r.cues) || r.cues.length > 10 || !r.cues.every(c => text(c, 200))) throw new Error('The cues must be a short list of text.');
  if (r.answer !== null && (typeof r.answer !== 'number' || !Number.isFinite(r.answer))) throw new Error('The answer must be a number or null.');
  if (!Array.isArray(r.details) || r.details.length > 10 || !r.details.every(d => isRecord(d) && text(d.label, 300) && text(d.value, 300))) throw new Error('The details must be a short list of labels and values.');
  if (!text(r.started, 40) || Number.isNaN(Date.parse(r.started as string))) throw new Error('The start time must be a date.');
  if (typeof r.seconds !== 'number' || !Number.isFinite(r.seconds) || r.seconds < 0) throw new Error('The duration must be zero or more seconds.');
  return {
    format: RESULT_FORMAT, student: r.student as string, scenario: { id: scenario.id as string, title: scenario.title as string },
    seed: r.seed, score: r.score, success: r.success, confidence: r.confidence, cues: r.cues as string[], answer: r.answer as number | null,
    details: (r.details as { label: string; value: string }[]).map(d => ({ label: d.label, value: d.value })), started: r.started as string, seconds: r.seconds,
  };
}

/** The link an instructor shares: the twin page with the task and the seed in the hash. */
export function classLink(page: string, scenarioId: string, seed: number): string {
  return `${page.replace(/#.*$/, '')}#train=${encodeURIComponent(scenarioId)}&seed=${seed >>> 0}`;
}

/** The task named in a class link, or null. The seed is read by the page's own hash handling. */
export function parseClassHash(hash: string): string | null {
  const id = new URLSearchParams(hash.replace(/^#/, '')).get('train');
  return id && /^[a-z0-9-]{1,60}$/.test(id) ? id : null;
}

export interface TaskSummary { id: string; title: string; count: number; meanScore: number; successes: number; meanConfidence: number }

/** One row per task, in the order the tasks first appear, plus the results sorted by task and student. */
export function summarize(results: readonly TrainingResult[]): { rows: TrainingResult[]; tasks: TaskSummary[] } {
  const rows = [...results].sort((a, b) => a.scenario.id.localeCompare(b.scenario.id) || a.student.localeCompare(b.student) || a.started.localeCompare(b.started));
  const tasks = new Map<string, TaskSummary>();
  for (const r of results) {
    const t = tasks.get(r.scenario.id) ?? { id: r.scenario.id, title: r.scenario.title, count: 0, meanScore: 0, successes: 0, meanConfidence: 0 };
    t.meanScore = (t.meanScore * t.count + r.score) / (t.count + 1);
    t.meanConfidence = (t.meanConfidence * t.count + r.confidence) / (t.count + 1);
    t.successes += Number(r.success);
    t.count += 1;
    tasks.set(r.scenario.id, t);
  }
  return { rows, tasks: [...tasks.values()] };
}

const cell = (value: string | number | boolean | null) => {
  const s = value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The class table as CSV, one line per result. */
export function classCsv(results: readonly TrainingResult[]): string {
  const head = ['student', 'task', 'seed', 'score', 'success', 'confidence', 'seconds', 'started', 'answer', 'cues'];
  const lines = summarize(results).rows.map(r => [r.student, r.scenario.id, r.seed, r.score, r.success, r.confidence, Math.round(r.seconds), r.started, r.answer, r.cues.join('; ')].map(cell).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}
