import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_STATE, elementFromURL, selectElement, scenarioFromJSON, scenarioFromURL, scenarioToJSON, scenarioToURL, validateScenario } from './scenario';
import { loadXrayData } from './xraydata';

describe('portable reproducible scenarios', () => {
  it('roundtrips all controls through JSON and URL without losing seed', () => {
    const state = { ...DEFAULT_STATE, seed: 4294967295, x: 0.75, expert: true };
    expect(scenarioFromJSON(scenarioToJSON(state))).toEqual(state);
    const url = scenarioToURL(state, 'https://example.com/quantum-lab/experiments?keep=yes');
    expect(scenarioFromURL(url)).toEqual(state);
    expect(new URL(url).searchParams.get('keep')).toBe('yes');
    expect(scenarioFromURL('https://example.com')).toBeNull();
  });

  it('rejects malformed, unknown and out-of-range controls instead of changing experiments', () => {
    expect(() => validateScenario({ ...DEFAULT_STATE, x: 1.1 })).toThrow('x');
    expect(() => validateScenario({ ...DEFAULT_STATE, width: 0 })).toThrow('width');
    expect(() => validateScenario({ ...DEFAULT_STATE, seed: 2.5 })).toThrow('integer');
    expect(() => validateScenario({ ...DEFAULT_STATE, photons: '100' })).toThrow('photons');
    expect(() => validateScenario({ ...DEFAULT_STATE, expert: 1 })).toThrow('expert');
    expect(() => validateScenario({ ...DEFAULT_STATE, unrecognized: true })).toThrow('unknown');
    expect(() => scenarioFromJSON('{')).toThrow('JSON');
    expect(() => scenarioFromJSON(JSON.stringify({ schema: 'quantum-battery-xas-lab', version: 2, parameters: DEFAULT_STATE }))).toThrow('version');
    expect(() => scenarioFromJSON(' '.repeat(12001))).toThrow('large');
  });
});

describe('element URL validation', () => {
  beforeAll(async () => { await loadXrayData(); });
  it('ignores unrelated queries and accepts exact tabulated symbol and shell names', () => {
    expect(elementFromURL('/crystal/?other=value')).toBeNull();
    expect(elementFromURL('/beamline/?element=Cu&edge=L3')).toEqual({ element: 'Cu', edge: 'L3' });
    expect(elementFromURL('/crystal/?element=%46e&edge=K')).toEqual({ element: 'Fe', edge: 'K' });
  });
  it.each([
    'element=Fe', 'edge=K', 'element=&edge=K', 'element=Og&edge=K', 'element=fe&edge=K',
    'element=Fe&edge=k', 'element=Fe&edge=K1', 'element=Fe&edge=L4', 'element=Fe&edge=N8',
    'element=Fe&edge=K&element=Cu', 'element=Fe&edge=K&edge=L3', 'element=%3Cscript%3E&edge=K',
  ])('rejects a malformed or ambiguous link: %s', query => {
    expect(() => elementFromURL('/crystal/?' + query)).toThrow();
  });
  it('rejects nonexistent shells before changing settings and keeps unrelated controls', () => {
    const state = { ...DEFAULT_STATE, seed: 17, expert: true, sample: { ...DEFAULT_STATE.sample, density: 2.5 } };
    const original = structuredClone(state);
    expect(() => selectElement(state, elementFromURL('/crystal/?element=H&edge=L3')!)).toThrow('has no');
    expect(state).toEqual(original);
    const selected = selectElement(state, { element: 'Cu', edge: 'L3' });
    expect(selected).toMatchObject({ seed: 17, expert: true, energy: 932.7, sample: { formula: 'Cu', density: 2.5, absorber: 'Cu', edge: 'L3', preset: null } });
  });
});
