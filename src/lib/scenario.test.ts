import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, scenarioFromJSON, scenarioFromURL, scenarioToJSON, scenarioToURL, validateScenario } from './scenario';

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
