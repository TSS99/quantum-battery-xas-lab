import katex from 'katex';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '@/lib/xraydata';
import { loadOptics } from '@/lib/twin/tables';
import { REJECTION_KEEP_FUNDAMENTAL, REJECTION_PASS_HARMONIC } from '@/lib/twin/mirrors';
import { backscatterEnergy_eV } from '@/lib/twin/mono';
import { criticalEnergy_eV } from '@/lib/twin/source';
import { applyCommand } from '@/lib/twin/twin';
import type { TwinState } from '@/lib/twin/types';
import { hutchLive } from './hutch-live';
import { PARTS } from './hutch-parts';
import { PART_PHYSICS, partEquation } from './part-physics';
import { DEFAULT_TWIN, PROFILE_PRESETS } from './twin-state';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

/** Typesets display LaTeX, or every $...$ span of a prose string, and fails on any KaTeX error. */
function typesets(tex: string, prose: boolean) {
  const spans = prose ? tex.split('$').filter((_, i) => i % 2) : [tex];
  if (prose) expect(tex.split('$').length % 2, `unbalanced $ in: ${tex}`).toBe(1);
  for (const span of spans) expect(() => katex.renderToString(span, { throwOnError: true, strict: 'error' }), span).not.toThrow();
}

// Built after the tables load: switching profile looks up edge energies.
const profiles = (): TwinState[] => PROFILE_PRESETS.map(p => applyCommand(DEFAULT_TWIN, { type: 'profile', id: p.id }).state);

describe('part physics cards', () => {
  it('cover every part of the scene', () => {
    expect(Object.keys(PART_PHYSICS).sort()).toEqual(PARTS.map(p => p.id).sort());
  });

  it('stack the two-line equations on two rows', () => {
    for (const id of ['i0', 'it', 'iref', 'fluorescence-detector'] as const) {
      const tex = partEquation(id, DEFAULT_TWIN);
      if (tex.includes('gathered')) expect(tex, id).toContain(' \\\\ ');
    }
  });

  it('typeset without errors and show real numbers on every profile', () => {
    for (const twin of profiles()) {
      const live = hutchLive(twin);
      for (const part of PARTS) {
        const card = PART_PHYSICS[part.id];
        typesets(partEquation(part.id, twin), false);
        for (const text of [card.typical, card.wrong, card.source]) typesets(text, true);
        const line = card.live?.(twin, live) ?? null;
        if (line === null) continue;
        typesets(line, true);
        expect(line, `${twin.profile.preset} ${part.id}`).not.toMatch(/NaN|undefined|Infinity|null/);
      }
    }
  });

  it('states the same numbers as the models', () => {
    const twin = DEFAULT_TWIN, s = twin.profile.source;
    // The card's critical energy is the source model's.
    const card = PART_PHYSICS.source.live!(twin, hutchLive(twin))!;
    const shown = Number(/varepsilon_c = ([\d.]+)/.exec(card)![1]);
    expect(shown * 1000).toBeCloseTo(criticalEnergy_eV(s.ring_GeV, s.field_T!), -1);
    expect(Math.round(backscatterEnergy_eV('Si111'))).toBe(1977);
    expect(PART_PHYSICS['harmonic-rejection-mirror'].typical).toContain(`${REJECTION_KEEP_FUNDAMENTAL * 100} %`);
    expect(PART_PHYSICS['harmonic-rejection-mirror'].typical).toContain(`${REJECTION_PASS_HARMONIC * 100} %`);
  });

  it('gives sensible transmissions for the helium path and the beam stop', () => {
    const live = hutchLive({ ...DEFAULT_TWIN, energy_eV: 3000 });
    const helium = PART_PHYSICS['helium-path'].live!(DEFAULT_TWIN, live)!;
    const [air, he] = [...helium.matchAll(/passes \$([\d.]+)\\,\\%\$/g)].map(m => Number(m[1]));
    expect(air).toBeGreaterThan(0);
    expect(he).toBeGreaterThan(air);
    expect(he).toBeLessThan(100);
    expect(PART_PHYSICS['beam-stop'].live!(DEFAULT_TWIN, live)).toMatch(/10\^\{-\d+\}/);
  });
});
