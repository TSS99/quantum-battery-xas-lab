/** Portable, versioned experiment state. Units are eV, micrometres and counts. */
export interface LabState {
  x: number;
  energy: number;
  thickness: number;
  photons: number;
  seed: number;
  edge: number;
  shift: number;
  width: number;
  whiteLine: number;
  preEdge: number;
  oscillation: number;
  expert: boolean;
}

export const DEFAULT_STATE: LabState = {
  x: 0.5, energy: 6550, thickness: 20, photons: 100000, seed: 42,
  edge: 6550, shift: 3, width: 1.2, whiteLine: 65, preEdge: 10,
  oscillation: 0.06, expert: false,
};

export const STATE_BOUNDS: Record<Exclude<keyof LabState, 'expert'>, readonly [number, number]> = {
  x: [0, 1], energy: [6530, 6580], thickness: [0.1, 1000],
  photons: [1, 10000000], seed: [0, 4294967295], edge: [6530, 6580],
  shift: [-10, 10], width: [0.2, 8], whiteLine: [0, 300], preEdge: [0, 100],
  oscillation: [0, 0.3],
};

/** Reject invalid values instead of silently changing the experiment. */
export function validateScenario(value: unknown): LabState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scenario parameters must be an object.');
  const data = value as Record<string, unknown>;
  const allowed = new Set([...Object.keys(STATE_BOUNDS), 'expert']);
  if (Object.keys(data).some(key => !allowed.has(key))) throw new Error('Scenario contains an unknown parameter.');
  const validated: Record<string, number | boolean> = {};
  for (const [key, bounds] of Object.entries(STATE_BOUNDS)) {
    const number = data[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < bounds[0] || number > bounds[1]) {
      throw new Error(`${key} must be a finite number from ${bounds[0]} to ${bounds[1]}.`);
    }
    if (key === 'seed' && !Number.isInteger(number)) throw new Error('seed must be an integer.');
    validated[key] = number;
  }
  if (typeof data.expert !== 'boolean') throw new Error('expert must be true or false.');
  validated.expert = data.expert;
  return validated as unknown as LabState;
}

export function scenarioToJSON(state: LabState): string {
  return JSON.stringify({ schema: 'quantum-battery-xas-lab', version: 1, parameters: validateScenario(state) }, null, 2);
}

export function scenarioFromJSON(text: string): LabState {
  if (text.length > 12000) throw new Error('Scenario file is too large (12 kB limit).');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Scenario is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Scenario must be an object.');
  const data = parsed as Record<string, unknown>;
  if (data.schema !== 'quantum-battery-xas-lab' || data.version !== 1) throw new Error('Unsupported scenario schema or version.');
  if (Object.keys(data).some(key => !['schema', 'version', 'parameters'].includes(key))) throw new Error('Scenario contains an unknown field.');
  return validateScenario(data.parameters);
}

export function scenarioToURL(state: LabState, base = 'http://localhost:3000/experiments'): string {
  const url = new URL(base);
  url.searchParams.set('scenario', scenarioToJSON(state));
  return url.toString();
}

export function scenarioFromURL(input: string | URL): LabState | null {
  const url = typeof input === 'string' ? new URL(input, 'http://localhost:3000') : input;
  const encoded = url.searchParams.get('scenario');
  return encoded === null ? null : scenarioFromJSON(encoded);
}
