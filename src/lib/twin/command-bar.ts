// Typed commands for the twin ("set energy 8979", "detune 30 %", "insert harmonic mirror", "acquire 3 scans"), shared
// by the command bar on the page and the MCP server. Misspelt words are corrected against the vocabulary below, and the
// caller asks before running a corrected command.
import { edgeEnergy } from './acquire';
import { PROFILE_PRESETS, SAMPLE_PRESETS } from './presets';
import type { TwinCommand } from './twin';
import type { LockKey } from './scenarios';
import type { ChamberConfig, Crystal, EnvironmentConfig, MirrorConfig, TwinMode, TwinState } from './types';

/** A twin command, or a request to acquire (optionally setting the number of repeats first). */
export type CommandIntent = TwinCommand | { type: 'acquire'; repeats?: number };

export type ParsedCommand =
  | { ok: true; intents: CommandIntent[]; /** What was understood, in canonical words. */ understood: string; corrected: boolean }
  | { ok: false; error: string };

const MODE_WORDS: [TwinMode, string[]][] = [
  ['transmission', ['transmission']],
  ['fluorescence', ['fluorescence', 'fluo', 'fy']],
  ['electron-yield', ['electron yield', 'tey', 'electron']],
  ['xrf', ['xrf spectrum', 'xrf']],
  ['mono', ['monochromator', 'mono', 'harmonics']],
  ['calibration', ['energy calibration', 'calibration', 'calibrate']],
  ['time-resolved', ['time resolved', 'qexafs', 'operando series']],
  ['damage', ['beam damage', 'damage']],
];
const MODE_KEYS: TwinMode[] = MODE_WORDS.map(([mode]) => mode);
const GASES: Record<string, ChamberConfig['gas']> = { helium: { He: 1 }, he: { He: 1 }, nitrogen: { N2: 1 }, n2: { N2: 1 }, argon: { Ar: 1 }, ar: { Ar: 1 }, krypton: { Kr: 1 }, kr: { Kr: 1 } };
const ENVIRONMENTS: Record<string, EnvironmentConfig['kind']> = { ambient: 'ambient', cryostat: 'cryostat', furnace: 'furnace', operando: 'operando-cell', 'operando cell': 'operando-cell', liquid: 'liquid-cell', 'liquid cell': 'liquid-cell' };
const MIRROR_ROLES: Record<string, MirrorConfig['role']> = { harmonic: 'harmonic-rejection', 'harmonic rejection': 'harmonic-rejection', focusing: 'focusing', collimating: 'collimating' };

/** Every word the grammar knows; anything else of four letters or more is checked against it for a typo. */
const VOCABULARY = new Set([
  ...MODE_WORDS.flatMap(([, words]) => words.flatMap(w => w.split(' '))), ...Object.keys(GASES), ...Object.keys(ENVIRONMENTS).flatMap(w => w.split(' ')),
  'switch', 'change', 'mode', 'set', 'the', 'energy', 'kev', 'detune', 'percent', 'insert', 'retract', 'remove', 'harmonic', 'rejection', 'focusing',
  'collimating', 'mirror', 'crystal', 'realistic', 'educational', 'auto', 'gain', 'gas', 'fill', 'with', 'thickness', 'microns', 'temperature',
  'sample', 'profile', 'acquire', 'scan', 'scans', 'repeats', 'times', 'measure', 'focus', 'beam', 'edge', 'cell', 'to', 'by', 'on', 'off', 'go',
  'move', 'use', 'bending', 'magnet', 'undulator', 'tender', 'foil', 'pellet', 'water', 'solution', 'alumina', 'cathode',
]);

/** Edit distance counting a swap of two neighbouring letters as one edit (optimal string alignment). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Lower case, unify units and symbols, and fix words one or two letters away from a known one. */
function normalize(text: string): { text: string; corrected: boolean } {
  let corrected = false;
  const words = text.toLowerCase().replace(/[µμ]m\b/g, ' um').replace(/%/g, ' percent').replace(/[(),]/g, ' ').replace(/×/g, ' x ').trim().split(/\s+/).filter(Boolean);
  const fixed = words.map(word => {
    if (VOCABULARY.has(word) || word.length < 4 || /\d/.test(word)) return word;
    const limit = word.length >= 7 ? 2 : 1;
    let best = '', bestDistance = Infinity, tie = false;
    for (const known of VOCABULARY) {
      const d = distance(word, known);
      if (d < bestDistance) { best = known; bestDistance = d; tie = false; } else if (d === bestDistance) tie = true;
    }
    if (bestDistance <= limit && !tie) { corrected = true; return best; }
    return word;
  });
  return { text: fixed.join(' '), corrected };
}

const number = (text: string) => Number(text);
const modeName = (mode: TwinMode) => MODE_WORDS.find(([m]) => m === mode)![1][0];

function matchMode(text: string): TwinMode | null {
  const rest = text.replace(/^(?:switch|change|go|move)\s+(?:to\s+)?/, '').replace(/^mode\s+/, '').replace(/\s+mode$/, '').trim();
  if (/^[1-8]$/.test(rest)) return MODE_KEYS[Number(rest) - 1];
  return MODE_WORDS.find(([, words]) => words.includes(rest))?.[0] ?? null;
}

/** The best preset whose id or name contains every word typed, such as "cu foil" or "nio". */
function findPreset<T extends { id: string; name: string }>(list: readonly T[], query: string): T | undefined {
  const words = query.split(' ').filter(w => w && w !== 'the');
  const haystack = (p: T) => (p.id.replace(/-/g, ' ') + ' ' + p.name.normalize('NFKD')).toLowerCase();
  return list.find(p => words.every(w => haystack(p).includes(w)));
}

/** Parse one typed command against the current state of the twin. */
export function parseCommand(input: string, state: TwinState): ParsedCommand {
  const { text: t, corrected } = normalize(input);
  if (!t) return { ok: false, error: 'Type a command, for example "set energy 8979" or "acquire 3 scans".' };
  const ok = (intents: CommandIntent[], understood: string): ParsedCommand => ({ ok: true, intents, understood, corrected });
  let m: RegExpMatchArray | null;

  if ((m = t.match(/^(?:acquire|scan|measure)(?:\s+(\d+)(?:\s+(?:scans?|repeats?|times))?)?$/))) {
    const repeats = m[1] ? number(m[1]) : undefined;
    if (repeats !== undefined && (repeats < 1 || repeats > 50)) return { ok: false, error: 'Acquire 1 to 50 scans at a time.' };
    return ok([repeats ? { type: 'acquire', repeats } : { type: 'acquire' }], repeats ? `acquire ${repeats} scan${repeats === 1 ? '' : 's'}` : 'acquire');
  }
  if ((m = t.match(/^(?:(?:set|go|move)\s+)?(?:(?:the|to)\s+)*(?:energy\s+)?(?:to\s+)?(\d+(?:\.\d+)?)\s*(kev|ev)?$/)) && (/energy|ev|^set|^go|^move/.test(t))) {
    const value = number(m[1]), energy_eV = m[2] === 'kev' || (!m[2] && value < 100) ? value * 1000 : value;
    return ok([{ type: 'energy', energy_eV }], `set energy ${Math.round(energy_eV * 100) / 100} eV`);
  }
  if (/^(?:(?:go|move|set)\s+(?:to\s+)?(?:the\s+)?(?:energy\s+to\s+the\s+)?)?edge$/.test(t)) {
    const energy_eV = edgeEnergy(state.sample);
    return ok([{ type: 'energy', energy_eV }], `set energy to the ${state.sample.absorber} ${state.sample.edge} edge, ${energy_eV} eV`);
  }
  if ((m = t.match(/^detune\s+(?:by\s+|to\s+)?(\d+(?:\.\d+)?)\s*(percent)?$/))) {
    const value = number(m[1]), detune = m[2] || value > 1 ? value / 100 : value;
    if (detune < 0 || detune > 1) return { ok: false, error: 'Detune between 0 and 100 %.' };
    return ok([{ type: 'detune', detune }], `detune ${Math.round(detune * 100)} %`);
  }
  if ((m = t.match(/^(insert|retract|remove|put in|take out)\s+(?:the\s+)?(harmonic rejection|harmonic|focusing|collimating)\s+mirror$/))) {
    const role = MIRROR_ROLES[m[2]], mirror = state.profile.mirrors.find(r => r.role === role), inserted = m[1] === 'insert' || m[1] === 'put in';
    if (!mirror) return { ok: false, error: `This beamline profile has no ${role.replace('-', ' ')} mirror.` };
    return ok([{ type: 'mirror', id: mirror.id, inserted }], `${inserted ? 'insert' : 'retract'} the ${role.replace('-', ' ')} mirror`);
  }
  if ((m = t.match(/^(?:crystal|use)\s+si\s*(111|311|220)$/))) {
    return ok([{ type: 'crystal', crystal: `Si${m[1]}` as Crystal }], `crystal Si(${m[1]})`);
  }
  if ((m = t.match(/^(realistic|educational)(?:\s+(on|off))?$/))) {
    const value = (m[1] === 'realistic') === (m[2] !== 'off');
    return ok([{ type: 'realistic', value }], value ? 'realistic detectors' : 'educational view');
  }
  if (/^auto\s*gain$/.test(t)) return ok([{ type: 'autoGain' }], 'auto gain');
  if ((m = t.match(/^(?:fill\s+)?(i0|it|iref)\s+(?:with\s+|gas\s+)?(helium|nitrogen|argon|krypton|he|n2|ar|kr)$/))) {
    const chamber = ({ i0: 'I0', it: 'It', iref: 'Iref' } as const)[m[1] as 'i0' | 'it' | 'iref'];
    return ok([{ type: 'gas', chamber, gas: GASES[m[2]] }], `fill ${chamber} with ${Object.keys(GASES[m[2]])[0]}`);
  }
  if ((m = t.match(/^thickness\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(um|microns?|mm)?$/))) {
    const thickness_um = number(m[1]) * (m[2] === 'mm' ? 1000 : 1);
    return ok([{ type: 'thickness', thickness_um }], `thickness ${thickness_um} µm`);
  }
  if ((m = t.match(/^(?:temperature|temp)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*k?$/))) {
    return ok([{ type: 'temperature', temperature_K: number(m[1]) }], `temperature ${number(m[1])} K`);
  }
  if ((m = t.match(/^(?:(?:beam|focus|defocus)\s+(?:to\s+)?)(\d+(?:\.\d+)?)\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:um|microns?)?$/))) {
    return ok([{ type: 'beam', beam_um: [number(m[1]), number(m[2])] }], `beam ${number(m[1])} × ${number(m[2])} µm`);
  }
  const environment = ENVIRONMENTS[t.replace(/^(?:use\s+(?:the\s+)?|environment\s+)/, '')];
  if (environment) return ok([{ type: 'environment', kind: environment }], `environment ${environment.replace('-', ' ')}`);
  if ((m = t.match(/^sample\s+(.+)$/))) {
    const preset = findPreset(SAMPLE_PRESETS, m[1]);
    if (!preset) return { ok: false, error: `No sample preset matches "${m[1]}". Try ${SAMPLE_PRESETS.slice(0, 3).map(p => `"sample ${p.id.replace(/-/g, ' ')}"`).join(', ')}.` };
    return ok([{ type: 'samplePreset', id: preset.id }], `sample ${preset.name}`);
  }
  if ((m = t.match(/^profile\s+(.+)$/))) {
    const words = m[1].replace(/bending magnet|bending/, 'bm3').replace(/undulator/, 'und6');
    const preset = PROFILE_PRESETS.find(p => p.id === words) ?? findPreset(PROFILE_PRESETS, m[1]);
    if (!preset) return { ok: false, error: `No beamline profile matches "${m[1]}". Try "profile bending magnet", "profile undulator" or "profile tender".` };
    return ok([{ type: 'profile', id: preset.id }], `profile ${preset.name}`);
  }
  const mode = matchMode(t);
  if (mode) return ok([{ type: 'mode', mode }], `switch to ${modeName(mode)}`);
  return { ok: false, error: `Not understood: "${input.trim()}". Try "set energy 8979", "fluorescence", "detune 30 %", "insert harmonic mirror" or "acquire 3 scans".` };
}

/** The training lock that blocks each command, matching the controls the rail disables. */
const LOCKS: Partial<Record<CommandIntent['type'], LockKey>> = { profile: 'profile', crystal: 'mono', samplePreset: 'sample', sample: 'sample' };

/** The first lock among `locked` that one of the intents would break, or null. */
export function blockedBy(intents: readonly CommandIntent[], locked: readonly LockKey[]): LockKey | null {
  for (const intent of intents) { const key = LOCKS[intent.type]; if (key && locked.includes(key)) return key; }
  return null;
}

/** The commands the bar and the MCP server understand, for help texts. */
export const COMMAND_EXAMPLES = [
  'set energy 8979', 'energy 9 keV', 'go to edge', 'fluorescence', 'mode 5', 'detune 30 %', 'insert harmonic mirror', 'crystal Si(311)',
  'realistic on', 'auto gain', 'fill I0 with nitrogen', 'thickness 20 um', 'temperature 80 K', 'beam 5 x 5 um', 'cryostat', 'sample NiO',
  'profile undulator', 'acquire 3 scans',
];
