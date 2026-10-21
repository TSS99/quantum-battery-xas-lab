import { describe, expect, it } from 'vitest';
import { RESULT_FORMAT, classCsv, classLink, parseClassHash, parseResult, resultToJson, summarize, type TrainingResult } from './classroom';

const result = (patch: Partial<TrainingResult> = {}): TrainingResult => ({
  format: RESULT_FORMAT, student: 'Asha', scenario: { id: 's6-gases', title: 'Ion chamber gases' }, seed: 42, score: 80, success: false,
  confidence: 4, cues: ['The chamber currents'], answer: null, details: [{ label: 'Hidden fault', value: '$I_t$ filled with He' }],
  started: '2026-10-22T09:00:00.000Z', seconds: 312.5, ...patch,
});

describe('classroom results', () => {
  it('round-trips a result file and keeps only the known fields', () => {
    const r = result();
    expect(parseResult(resultToJson(r))).toEqual(r);
    expect(parseResult(JSON.stringify({ ...r, extra: 'ignored' }))).toEqual(r);
  });

  it('rejects malformed files with a plain message', () => {
    expect(() => parseResult('not json')).toThrow(/not valid JSON/);
    expect(() => parseResult(JSON.stringify({ ...result(), format: 'other' }))).toThrow(RESULT_FORMAT);
    expect(() => parseResult(JSON.stringify(result({ score: 120 })))).toThrow(/0 to 100/);
    expect(() => parseResult(JSON.stringify(result({ confidence: 0 })))).toThrow(/1 to 5/);
    expect(() => parseResult(JSON.stringify(result({ seed: -1 })))).toThrow(/seed/);
    expect(() => parseResult(JSON.stringify(result({ started: 'yesterday' })))).toThrow(/date/);
    expect(() => parseResult(JSON.stringify(result({ scenario: { id: 'S6 <b>', title: 'x' } })))).toThrow(/task/);
  });

  it('builds and reads class links, leaving the seed to the page hash', () => {
    const link = classLink('https://tss99.github.io/quantum-battery-xas-lab/twin/#mode=xrf&seed=1', 's6-gases', 42);
    expect(link).toBe('https://tss99.github.io/quantum-battery-xas-lab/twin/#train=s6-gases&seed=42');
    expect(parseClassHash(new URL(link).hash)).toBe('s6-gases');
    expect(new URLSearchParams(new URL(link).hash.slice(1)).get('seed')).toBe('42');
    expect(parseClassHash('#mode=xrf&seed=7')).toBeNull();
    expect(parseClassHash('#train=../evil')).toBeNull();
  });

  it('summarizes per task and writes a CSV with quoted text', () => {
    const rows = [result(), result({ student: 'Ben', score: 100, success: true, confidence: 2 }), result({ student: 'Cy', scenario: { id: 's1-calibrate', title: 'Calibrate' }, score: 50, cues: ['a, b'] })];
    const { rows: sorted, tasks } = summarize(rows);
    expect(sorted.map(r => r.student)).toEqual(['Cy', 'Asha', 'Ben']);
    expect(tasks.find(t => t.id === 's6-gases')).toMatchObject({ count: 2, meanScore: 90, successes: 1, meanConfidence: 3 });
    const csv = classCsv(rows).trim().split('\n');
    expect(csv[0]).toBe('student,task,seed,score,success,confidence,seconds,started,answer,cues');
    expect(csv[1]).toContain('"a, b"');
    expect(csv).toHaveLength(4);
  });
});
