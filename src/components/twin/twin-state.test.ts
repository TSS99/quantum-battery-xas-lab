import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import katex from 'katex';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TWIN_MODES } from '@/lib/twin/types';
import { DEFAULT_TWIN, INITIAL_STORE, MODES, PROFILE_PRESETS, RESULT_TABS, energyChange, formatHash, modeInfo, parseHash, shortcutAction, si111BraggDeg, twinReducer, type TwinAction } from './twin-state';
import { TwinPage } from './twin-page';

const run = (...actions: TwinAction[]) => actions.reduce(twinReducer, INITIAL_STORE);
const parses = (source: string) => katex.renderToString(source, { throwOnError: true, strict: 'error' });

describe('modes', () => {
  it('lists the eight contract modes on keys 1 to 8 in three groups', () => {
    expect(MODES.map(m => m.id)).toEqual(TWIN_MODES);
    expect(MODES.map(m => m.key)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(MODES.map(m => m.group)).toEqual(['Measure', 'Measure', 'Measure', 'Tune', 'Tune', 'Tune', 'Learn', 'Learn']);
    expect(MODES.map(m => m.name)).toEqual(['Transmission', 'Fluorescence', 'Electron yield', 'XRF spectrum', 'Monochromator', 'Energy calibration', 'Time resolved', 'Beam damage']);
  });
});

describe('default state', () => {
  it('starts on the 3 GeV bending magnet with Si(111), Rh mirrors at 3 mrad and a 7 µm Cu foil in transmission', () => {
    expect(DEFAULT_TWIN.mode).toBe('transmission');
    expect(DEFAULT_TWIN.seed).toBe(1);
    expect(DEFAULT_TWIN.realistic).toBe(false);
    expect(DEFAULT_TWIN.profile.preset).toBe('bm3');
    expect(DEFAULT_TWIN.profile.source).toMatchObject({ kind: 'bending-magnet', ring_GeV: 3 });
    expect(DEFAULT_TWIN.profile.mono.crystal).toBe('Si111');
    // Rh collimating and focusing mirrors in the beam; the Si harmonic rejection mirror starts retracted.
    expect(DEFAULT_TWIN.profile.mirrors.filter(m => m.inserted).every(m => m.coating === 'Rh' && m.angle_mrad === 3)).toBe(true);
    expect(DEFAULT_TWIN.profile.mirrors.find(m => m.role === 'harmonic-rejection')?.inserted).toBe(false);
    expect(DEFAULT_TWIN.sample).toMatchObject({ formula: 'Cu', absorber: 'Cu', edge: 'K', thickness_um: 7, form: 'foil' });
    // Just above the Cu K edge, 8979.0 eV in xraydb.
    expect(DEFAULT_TWIN.energy_eV).toBeGreaterThan(8979);
  });
  it('offers the three generic profiles of plan 3.8', () => {
    expect(PROFILE_PRESETS.map(p => p.id)).toEqual(['bm3', 'und6', 'tender']);
  });
});

describe('reducer', () => {
  it('applies twin commands and turns a failed one into the change line', () => {
    const detuned = twinReducer(INITIAL_STORE, { type: 'command', command: { type: 'detune', detune: 0.3 } });
    expect(detuned.twin.profile.mono.detune).toBe(0.3);
    expect(detuned.view.change).toMatch(/30 %/);
    const failed = twinReducer(INITIAL_STORE, { type: 'command', command: { type: 'mirror', id: 'M9', inserted: true } });
    expect(failed.twin).toBe(INITIAL_STORE.twin);
    expect(failed.view.change).toMatch(/could not be made/);
  });

  it('switches mode and says what changed', () => {
    const s = run({ type: 'mode', mode: 'xrf' });
    expect(s.twin.mode).toBe('xrf');
    expect(s.view.change).toBe(modeInfo('xrf').switched);
  });
  it('toggles the realistic detectors, and an explicit value that matches is a no-op', () => {
    const on = run({ type: 'realistic' });
    expect(on.twin.realistic).toBe(true);
    expect(on.view.change).toMatch(/^Realistic/);
    expect(twinReducer(on, { type: 'realistic', value: true })).toBe(on);
    expect(twinReducer(on, { type: 'realistic' }).twin.realistic).toBe(false);
  });
  it('clamps the energy to the preset range and ignores values that are not numbers', () => {
    expect(run({ type: 'energy', energy_eV: 100 }).twin.energy_eV).toBe(4500);
    expect(run({ type: 'energy', energy_eV: 1e6 }).twin.energy_eV).toBe(30000);
    expect(run({ type: 'energy', energy_eV: 7112 }).twin.energy_eV).toBe(7112);
    expect(run({ type: 'energy', energy_eV: NaN })).toBe(INITIAL_STORE);
  });
  it('toggles labels, enlarge and both rails; Escape-style enlarge false is a no-op when already small', () => {
    expect(run({ type: 'labels' }).view.labels).toBe(false);
    expect(run({ type: 'enlarge' }).view.enlarged).toBe(true);
    expect(run({ type: 'enlarge' }, { type: 'enlarge', value: false }).view.enlarged).toBe(false);
    expect(run({ type: 'enlarge', value: false })).toBe(INITIAL_STORE);
    expect(run({ type: 'rail', side: 'left' }).view.leftHidden).toBe(true);
    expect(run({ type: 'rail', side: 'right' }, { type: 'rail', side: 'right' }).view.rightHidden).toBe(false);
  });
  it('changes tab, and Acquire says honestly that nothing was recorded', () => {
    expect(run({ type: 'tab', tab: 'chik' }).view.tab).toBe('chik');
    const acquired = run({ type: 'acquire' });
    expect(acquired.view.change).toMatch(/Acquiring one scan/);
    expect(acquired.view.acquireRequest).toBe(1);
  });
  it('takes mode and seed from the hash and marks the hash as read', () => {
    const s = run({ type: 'hash', mode: 'damage', seed: 42 });
    expect([s.twin.mode, s.twin.seed, s.view.hashRead]).toEqual(['damage', 42, true]);
    const empty = run({ type: 'hash' });
    expect([empty.twin.mode, empty.twin.seed, empty.view.hashRead]).toEqual(['transmission', 1, true]);
  });
});

describe('URL hash', () => {
  it('round-trips the settings that define a shared twin', () => {
    const shared = twinReducer(INITIAL_STORE, { type: 'command', command: { type: 'thickness', thickness_um: 11.5 } }).twin;
    const changed = { ...shared, mode: 'fluorescence' as const, seed: 4294967295, energy_eV: 9012.5, realistic: true };
    const hash = formatHash(changed), parsed = parseHash(hash);
    expect(hash).toMatch(/^#v=1&mode=fluorescence&seed=4294967295&s=/);
    expect(hash.length).toBeLessThanOrEqual(1800);
    const restored = twinReducer(INITIAL_STORE, { type: 'hash', ...parsed }).twin;
    expect(restored).toMatchObject({ mode: changed.mode, seed: changed.seed, energy_eV: changed.energy_eV, realistic: true });
    expect(restored.profile.preset).toBe(changed.profile.preset);
    expect(restored.sample).toMatchObject({ formula: changed.sample.formula, absorber: changed.sample.absorber, edge: changed.sample.edge, thickness_um: 11.5 });
    expect(restored.scan).toEqual(changed.scan);
  });
  it('keeps old mode and seed links working', () => {
    expect(parseHash('#mode=xrf&seed=7')).toEqual({ mode: 'xrf', seed: 7 });
    expect(twinReducer(INITIAL_STORE, { type: 'hash', ...parseHash('#mode=damage&seed=42') }).twin).toMatchObject({ mode: 'damage', seed: 42 });
  });
  it('drops unknown modes and invalid seeds', () => {
    expect(parseHash('#mode=raman&seed=-1')).toEqual({});
    expect(parseHash('#seed=1.5')).toEqual({});
    expect(parseHash('#seed=4294967296')).toEqual({});
    expect(parseHash('')).toEqual({});
    expect(parseHash('mode=xrf')).toEqual({ mode: 'xrf' });
    expect(parseHash('#v=1&mode=xrf&seed=7&s=not-base64')).toEqual({ mode: 'xrf', seed: 7 });
  });
});

describe('keyboard map', () => {
  it('maps 1 to 8 to the modes and C, L, I, X, [ and ] to their actions, in either case', () => {
    MODES.forEach(m => expect(shortcutAction(m.key)).toEqual({ type: 'mode', mode: m.id }));
    for (const key of ['c', 'C']) expect(shortcutAction(key)).toEqual({ type: 'realistic' });
    expect(shortcutAction('l')).toEqual({ type: 'labels' });
    expect(shortcutAction('I')).toEqual({ type: 'acquire' });
    expect(shortcutAction('x')).toEqual({ type: 'enlarge' });
    expect(shortcutAction('[')).toEqual({ type: 'rail', side: 'left' });
    expect(shortcutAction(']')).toEqual({ type: 'rail', side: 'right' });
    for (const key of ['0', '9', 'a', ' ', 'Enter', 'Escape', '`']) expect(shortcutAction(key)).toBeNull();
  });
});

describe('energy line', () => {
  it('uses the Si(111) Bragg angle from hc and the CODATA lattice parameter', () => {
    // Reference computed in Python: asin(12398.419843 / (2 * 5.431020511 / sqrt(3) * 9000)) = 12.689719 degrees.
    expect(si111BraggDeg(9000)).toBeCloseTo(12.689719, 5);
    expect(si111BraggDeg(1900)).toBeNull();
    expect(energyChange(9000)).toContain(String.raw`\theta = 12.69^\circ`);
    expect(energyChange(1900)).not.toContain('theta');
  });
});

// Every LaTeX fragment in the twin components must parse. Prose keeps maths between dollar signs.
const dir = join(process.cwd(), 'src/components/twin');
const sources = readdirSync(dir).filter(f => /\.tsx?$/.test(f) && !f.endsWith('.test.ts')).map(f => [f, readFileSync(join(dir, f), 'utf8')] as const);
const fragments = sources.flatMap(([file, text]) => [...text.matchAll(/String\.raw`([^`]*)`/g)].flatMap(m => {
  const body = m[1].replace(/\$\{[^}]*\}/g, '1');
  return body.includes('$') ? body.split('$').filter((_, i) => i % 2).map(tex => ({ file, tex, dollars: body.split('$').length - 1 })) : [{ file, tex: body, dollars: 0 }];
}));

describe('LaTeX in the twin', () => {
  it('finds the fragments', () => expect(fragments.length).toBeGreaterThan(50));
  it('pairs every dollar sign', () => fragments.forEach(f => expect(f.dollars % 2, f.file + ': ' + f.tex).toBe(0)));
  it.each(fragments.map(f => [f.file, f.tex]))('%s: %s', (_file, tex) => expect(() => parses(tex)).not.toThrow());
  it('parses the generated energy lines', () => {
    for (const e of [4500, 8979.5, 30000]) energyChange(e).split('$').filter((_, i) => i % 2).forEach(tex => expect(() => parses(tex)).not.toThrow());
  });
});

describe('server render', () => {
  const html = renderToStaticMarkup(createElement(TwinPage));
  it('has one h1, the eight mode buttons with their keys and all eight result tabs', () => {
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    MODES.forEach(m => expect(html).toContain(`aria-keyshortcuts="${m.key}"`));
    expect(html.match(/role="tab"/g)).toHaveLength(RESULT_TABS.length);
    expect(html).toContain('aria-live="polite"');
  });
  it('typesets without KaTeX errors', () => {
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('katex-error');
  });
});
