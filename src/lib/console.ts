/**
 * Lab console: a small command language over the X-ray tables.
 *
 * Everything here is pure. `runCommand` turns one input line into lines of plain text and an
 * optional effect (clear the screen, open a module, set the lab sample); the console component
 * renders the lines and applies the effect. Commands that read the tables need
 * `await loadXrayData()` first. Output is plain text with proper symbols (μ, cm⁻¹, ×10ⁿ, −).
 */
import { ELEMENT_SYMBOLS, elementInfo, isXrayDataLoaded, mu, parseFormula } from './xraydata';
import { defaultEdge, resolveSample, samplePlan, validateSample, type Sample } from './sample';

export type ConsoleLine =
  | { kind: 'title' | 'text' | 'hint' | 'ok' | 'error'; text: string }
  | { kind: 'row'; label: string; value: string; note?: string }
  | { kind: 'code'; filename: string; text: string };

export type ConsoleEffect =
  | { type: 'clear' }
  | { type: 'navigate'; href: string }
  | { type: 'sample'; sample: Sample; energy: number };

export interface ConsoleResult { lines: ConsoleLine[]; effect?: ConsoleEffect }

/** What the console can see of the lab: the current sample and the beamline photon energy in eV. */
export interface ConsoleContext { sample: Sample; energy: number }

interface CommandInfo {
  name: string;
  usage: string;
  summary: string;
  /** Allowed numbers of values after the command name. */
  counts: readonly number[];
  needs: string;
  example?: string;
  details?: readonly string[];
  /** Reads the X-ray tables. */
  data?: boolean;
  /** Takes a formula, so stray spaces inside it are a likely mistake. */
  formula?: boolean;
}

export const COMMANDS: readonly CommandInfo[] = [
  { name: 'help', usage: 'help [command]', summary: 'List the commands, or explain one.', counts: [0, 1], needs: 'at most one command name', example: 'help plan' },
  { name: 'edges', usage: 'edges <element>', summary: 'Absorption edges of one element.', counts: [1], needs: 'one element symbol', example: 'edges Fe', data: true },
  {
    name: 'mu', usage: 'mu <formula> <density> <energy>', summary: 'Attenuation of a material at one photon energy.', counts: [3, 4],
    needs: 'a formula, a density in g/cm³ and an energy', example: 'mu Fe2O3 5.26 7.2keV', data: true, formula: true,
    details: ['Density is in g/cm³. Energy is in eV unless you add keV: 7200, 7200eV and 7.2keV are the same.', 'The listed edge energy and the tabulated discontinuity can differ slightly. Use plan for the edge step and thickness.'],
  },
  {
    name: 'plan', usage: 'plan <formula> <density> <absorber> <edge>', summary: 'Transmission sample thickness and measurement mode.', counts: [0, 4],
    needs: 'a formula, a density, an absorber and an edge, or nothing at all to plan the current sample', example: 'plan Fe2O3 5.26 Fe K', data: true, formula: true,
    details: ['Aims for an edge step Δμ·d = 1 while μ·d just above the edge stays at or below 3.', 'With no values, it plans the current sample.'],
  },
  {
    name: 'sample', usage: 'sample <formula> <density> [absorber edge]', summary: 'Set the sample that every module uses.', counts: [2, 3, 4],
    needs: 'a formula and a density, optionally followed by an absorber and an edge', example: 'sample LiCoO2 5.05 Co K', data: true, formula: true,
    details: ['Without an absorber, the current one is kept if the formula contains it; otherwise the heaviest element is used.', 'Without an edge, K is used if it lies between 100 eV and 100 keV, then L3.'],
  },
  {
    name: 'open', usage: 'open <module>', summary: 'Go to a module.', counts: [1], needs: 'one module name', example: 'open beamline',
    details: ['Modules: overview, sample, beamline, spectra, electronic, quantum, experiments, validation.'],
  },
  {
    name: 'python', usage: 'python', summary: 'Python script (xraydb) that recomputes the current sample’s numbers.', counts: [0], needs: 'no values', data: true,
    details: ['It uses material_mu, xray_edge and the same thickness rule as plan, with comments.'],
  },
  { name: 'clear', usage: 'clear', summary: 'Clear the screen.', counts: [0], needs: 'no values' },
];

export const MODULES = [
  { name: 'overview', href: '/', title: 'Overview' },
  { name: 'sample', href: '/crystal/', title: 'Sample' },
  { name: 'beamline', href: '/beamline/', title: 'XAS beamline' },
  { name: 'spectra', href: '/spectra/', title: 'Spectra studio' },
  { name: 'electronic', href: '/electronic/', title: 'Electronic structure' },
  { name: 'quantum', href: '/quantum/', title: 'Quantum dynamics' },
  { name: 'experiments', href: '/experiments/', title: 'Experiments' },
  { name: 'validation', href: '/validation/', title: 'Methods & validation' },
] as const;
const MODULE_ALIASES: Record<string, string> = { home: 'overview', crystal: 'sample', methods: 'validation' };

export const WELCOME: readonly ConsoleLine[] = [
  { kind: 'title', text: 'XAS Lab console' },
  { kind: 'text', text: 'It uses the same X-ray tables as the rest of the lab. The sample command changes the sample in every module.' },
  { kind: 'hint', text: 'Type help for the commands, or try: plan Fe2O3 5.26 Fe K' },
];

// ---------------------------------------------------------------- formatting

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Plain-text number: 4 significant digits, a power of ten outside 0.001 to 10⁶, and a true minus sign. */
export function formatNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1e-3 && abs < 1e6) text = new Intl.NumberFormat('en-US', { maximumSignificantDigits: digits }).format(abs);
  else {
    const [mantissa, exponent] = abs.toExponential(digits - 1).split('e');
    text = Number(mantissa) + '×10' + [...String(Number(exponent))].map(c => c === '-' ? '⁻' : SUPERSCRIPT[Number(c)]).join('');
  }
  return (value < 0 ? '−' : '') + text;
}

/** Edge and photon energies keep their tabulated digits: 7,112 or 844.6. */
const formatEnergy = (energy_eV: number) => energy_eV.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Library messages print negative numbers with a hyphen; show a true minus sign. */
const tidy = (message: string) => message.replace(/(^|[\s(])-(?=\d)/g, '$1−');

// ---------------------------------------------------------------- parsing

class CommandError extends Error {}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function parseDensity(token: string): number {
  const text = token.replace(/g\/cm(?:3|³|\^3)$/i, '');
  if (!NUMBER.test(text)) throw new CommandError(`Density "${token}" is not a number. Give it in g/cm³, for example 5.26.`);
  const value = Number(text);
  if (!(value > 0) || value > 1000) throw new CommandError(`Density must be greater than 0 and at most 1000 g/cm³, not ${tidy(token)}.`);
  return value;
}

/** "7112", "7112eV", "7.112keV", or a number followed by a separate "eV" or "keV". */
function parseEnergy(token: string, unit?: string): number {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(k?ev)?$/i.exec(token);
  if (!match) throw new CommandError(`Energy "${token}" is not understood. Write it in eV or keV, for example 7112 or 7.112keV.`);
  let suffix = match[2];
  if (unit !== undefined) {
    if (suffix || !/^k?ev$/i.test(unit)) throw new CommandError(`"${unit}" after the energy is not understood. Write the energy as 7112, 7112eV or 7.112keV.`);
    suffix = unit;
  }
  const value = Number(match[1]) * (suffix?.toLowerCase() === 'kev' ? 1000 : 1);
  if (!suffix && value > 0 && value < 100) throw new CommandError(`${match[1]} eV is below the tabulated range of 100 eV to 100 keV. For keV, write ${match[1]}keV.`);
  return value;
}

const symbolCase = (token: string) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();

function elementSymbol(token: string): string {
  const symbol = symbolCase(token);
  if (!ELEMENT_SYMBOLS.includes(symbol)) throw new CommandError(`"${token}" is not an element symbol. Use one symbol from H to Cf, such as Fe.`);
  return symbol;
}

/** Builds a sample the way the Sample page does: same defaults, same validation. */
function sampleFrom(args: string[], current: Sample): Sample {
  const [formula, densityText, absorberText, edgeText] = args;
  const elements = Object.keys(parseFormula(formula));
  const density = parseDensity(densityText);
  let absorber: string;
  if (absorberText === undefined) absorber = elements.includes(current.absorber) ? current.absorber : [...elements].sort((a, b) => elementInfo(b).Z - elementInfo(a).Z)[0];
  else {
    absorber = symbolCase(absorberText);
    if (!elements.includes(absorber)) throw new CommandError(`${absorberText} is not in ${formula}. Choose one of ${elements.join(', ')}.`);
  }
  const labels = elementInfo(absorber).edges.map(e => e.edge);
  const edge = edgeText === undefined ? defaultEdge(formula, absorber)?.edge : edgeText.toUpperCase();
  if (!edge || !labels.includes(edge)) throw new CommandError(`${absorber} has no ${edgeText ?? ''} edge. Its edges are ${labels.join(', ')}.`.replace('no  edge', 'no tabulated edge'));
  return validateSample({ formula, density, absorber, edge, preset: null });
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}

function closest(word: string, options: readonly string[]): string | undefined {
  let best: string | undefined, bestDistance = 3;
  for (const option of options) {
    const distance = levenshtein(word, option);
    if (distance < bestDistance) { best = option; bestDistance = distance; }
  }
  return best;
}

// ---------------------------------------------------------------- commands

const row = (label: string, value: string, note?: string): ConsoleLine => note ? { kind: 'row', label, value, note } : { kind: 'row', label, value };
const inTables = (energy_eV: number) => energy_eV > 100 && energy_eV < 100000;

function planLines(sample: Sample): ConsoleLine[] {
  const info = samplePlan(sample);
  const lines: ConsoleLine[] = [{ kind: 'title', text: `${sample.formula} · ${formatNumber(sample.density)} g/cm³ · ${sample.absorber} ${sample.edge} edge at ${formatEnergy(info.edge.energy_eV)} eV` }];
  if (!info.inRange) return [...lines, { kind: 'hint', text: 'This edge is outside the 100 eV to 100 keV tables, so no thickness can be planned.' }];
  const { plan, mode } = info;
  if (plan) lines.push(
    row('edge step Δμ', `${formatNumber(plan.edgeStep.deltaMu_cm_inv)} cm⁻¹`),
    row('μ above the edge', `${formatNumber(plan.edgeStep.muAbove_cm_inv)} cm⁻¹`, 'including scattering'),
    row('thickness', `${formatNumber(plan.thickness_um)} μm`, 'uniform, fully dense layer'),
    row('mass per area', `${formatNumber(plan.massPerArea_mg_cm2)} mg/cm²`),
    row('13 mm pellet', `${formatNumber(plan.sampleMass_mg)} mg`, `area ${formatNumber(plan.pelletArea_cm2)} cm²`),
    row('edge step Δμ·d', formatNumber(plan.achievedEdgeStep, 3), plan.limitedBy === 'edge-step' ? 'the target' : 'limited by total absorption'),
    row('μ·d above the edge', formatNumber(plan.totalAbsorptionAbove, 3), 'kept at or below 3'),
  );
  else lines.push({ kind: 'hint', text: info.note });
  if (mode) lines.push(row('suggested mode', mode.mode), { kind: 'text', text: mode.reason });
  if (plan) lines.push(...plan.notes.map((text): ConsoleLine => ({ kind: 'hint', text })));
  return lines;
}

type Handler = (args: string[], context: ConsoleContext) => ConsoleResult;

const HANDLERS: Record<string, Handler> = {
  help: args => {
    if (!args.length) return {
      lines: [
        { kind: 'title', text: 'Commands' },
        ...COMMANDS.map(c => row(c.usage, c.summary)),
        { kind: 'hint', text: 'Formulas are case-sensitive: Co is cobalt, CO is carbon monoxide. Density is in g/cm³; energy is in eV unless you add keV.' },
        { kind: 'hint', text: 'Tab completes commands and element symbols. Up and Down recall earlier commands. Esc closes the console.' },
      ],
    };
    const info = COMMANDS.find(c => c.name === args[0].toLowerCase());
    if (!info) {
      const guess = closest(args[0].toLowerCase(), COMMANDS.map(c => c.name));
      throw new CommandError(`There is no command "${args[0]}".${guess ? ` Did you mean ${guess}?` : ''} Type help to list the commands.`);
    }
    return {
      lines: [
        { kind: 'title', text: info.usage },
        { kind: 'text', text: info.summary },
        ...(info.details ?? []).map((text): ConsoleLine => ({ kind: 'text', text })),
        ...(info.example ? [{ kind: 'hint', text: 'Example: ' + info.example } as const] : []),
      ],
    };
  },

  edges: ([token]) => {
    const symbol = elementSymbol(token), info = elementInfo(symbol);
    return {
      lines: [
        { kind: 'title', text: `${symbol} · ${info.name} · Z = ${info.Z}` },
        ...info.edges.map(e => row(e.edge, `${formatEnergy(e.energy_eV)} eV`, inTables(e.energy_eV) ? `fluorescence yield ${formatNumber(e.fluorescenceYield, 3)}` : 'outside the 100 eV to 100 keV tables')),
      ],
    };
  },

  mu: ([formula, densityText, energyText, unit]) => {
    parseFormula(formula);
    const density = parseDensity(densityText), energy = parseEnergy(energyText, unit);
    const value = mu(formula, density, energy);
    return {
      lines: [
        { kind: 'title', text: `${formula} · ${formatNumber(density)} g/cm³ · ${formatEnergy(energy)} eV` },
        row('μ total', `${formatNumber(value.total)} cm⁻¹`, 'photoabsorption plus scattering'),
        row('μ photoabsorption', `${formatNumber(value.photo)} cm⁻¹`),
        row('μ/ρ total', `${formatNumber(value.total / density)} cm²/g`),
        row('attenuation length', `${formatNumber(1e4 / value.total)} μm`, '1/μ, where the beam falls to 1/e'),
        { kind: 'hint', text: 'Isolated-atom values from XrayDB, without near-edge structure.' },
      ],
    };
  },

  plan: (args, { sample }) => ({ lines: planLines(args.length ? sampleFrom(args, sample) : sample) }),

  sample: (args, context) => {
    const sample = sampleFrom(args, context.sample), window = resolveSample(sample);
    return {
      lines: [
        { kind: 'ok', text: `Sample set: ${sample.formula}, ${formatNumber(sample.density)} g/cm³, ${sample.absorber} ${sample.edge} edge at ${formatEnergy(window.edge.energy_eV)} eV.` },
        window.inRange
          ? { kind: 'hint', text: 'Every module now uses this sample, and the beamline energy is on the edge. Next: plan, python or open beamline.' }
          : { kind: 'hint', text: 'This edge is outside the 100 eV to 100 keV tables, so the beamline shows the whole tabulated range.' },
      ],
      effect: { type: 'sample', sample, energy: Math.min(window.end, Math.max(window.start, window.edge.energy_eV)) },
    };
  },

  open: ([token]) => {
    const key = token.toLowerCase(), target = MODULES.find(m => m.name === (MODULE_ALIASES[key] ?? key));
    if (!target) throw new CommandError(`There is no module "${token}". Choose one of ${MODULES.map(m => m.name).join(', ')}.`);
    return { lines: [{ kind: 'ok', text: `Opening ${target.title}.` }], effect: { type: 'navigate', href: target.href } };
  },

  python: (_args, { sample, energy }) => {
    const { filename, code } = pythonScript(sample, energy);
    return {
      lines: [
        { kind: 'title', text: `xraydb script for ${sample.formula}, ${sample.absorber} ${sample.edge} edge` },
        { kind: 'code', filename, text: code },
        { kind: 'hint', text: `Run it with: pip install "xraydb>=4.5,<4.6", then python ${filename}. Interpolation and rounding can differ from the browser tables, especially at a discontinuity.` },
      ],
    };
  },

  clear: () => ({ lines: [], effect: { type: 'clear' } }),
};

const fail = (text: string): ConsoleResult => ({ lines: [{ kind: 'error', text }] });

/** Runs one input line. Never throws: problems come back as error lines. */
export function runCommand(input: string, context: ConsoleContext): ConsoleResult {
  if (input.length > 1000) return fail('Keep commands under 1000 characters; formulas can have at most 240 characters.');
  const [name = '', ...args] = input.trim().split(/\s+/).filter(Boolean);
  if (!name) return { lines: [] };
  const info = COMMANDS.find(c => c.name === name.toLowerCase());
  if (!info) {
    const guess = closest(name.toLowerCase(), COMMANDS.map(c => c.name));
    return fail(`Unknown command "${name}".${guess ? ` Did you mean ${guess}?` : ''} Type help to list the commands.`);
  }
  if (!info.counts.includes(args.length)) {
    const extra = args.length > Math.max(...info.counts) && info.formula ? ` Got ${args.length} values: write the formula without spaces, such as CuSO4·5H2O.` : '';
    return fail(`${info.name} needs ${info.needs}.${extra}${info.example ? ` Example: ${info.example}` : ''}`);
  }
  if (info.data && !isXrayDataLoaded()) return fail('The X-ray tables have not loaded yet. Wait a moment and run the command again; if this repeats, reload the page.');
  try {
    return HANDLERS[info.name](args, context);
  } catch (error) {
    return fail(error instanceof Error ? tidy(error.message) : 'That command failed. Check the values and try again.');
  }
}

// ---------------------------------------------------------------- completion

export interface Completion { input: string; options: string[] }

function symbolsIn(formula: string | undefined): string[] | null {
  try { return formula ? Object.keys(parseFormula(formula)) : null; } catch { return null; }
}

/**
 * Completes the last word: command names first, then element symbols (edges, and the absorber
 * of plan and sample), module names (open) or command names (help). One match is completed with
 * a trailing space; several are extended to their shared start and returned as options.
 */
export function completeInput(input: string): Completion {
  const words = input.replace(/^\s+/, '').split(/\s+/);
  const index = words.length - 1, partial = words[index], command = words[0].toLowerCase();
  let candidates: readonly string[] = [];
  if (index === 0 || (command === 'help' && index === 1)) candidates = COMMANDS.map(c => c.name);
  else if (['edges', 'mu', 'plan', 'sample'].includes(command) && index === 1) {
    // A valid compound such as CO or NO must not become the element Co or No.
    if (command !== 'edges' && (symbolsIn(partial)?.length ?? 0) > 1) return { input, options: [] };
    candidates = ELEMENT_SYMBOLS;
  }
  else if ((command === 'plan' || command === 'sample') && index === 3) candidates = symbolsIn(words[1]) ?? ELEMENT_SYMBOLS;
  else if (command === 'open' && index === 1) candidates = MODULES.map(m => m.name);
  const lower = partial.toLowerCase(), matches = candidates.filter(c => c.toLowerCase().startsWith(lower));
  if (!matches.length) return { input, options: [] };
  const head = input.slice(0, input.length - partial.length);
  if (matches.length === 1) return { input: head + matches[0] + ' ', options: [] };
  let shared = matches[0];
  for (const match of matches) while (!match.toLowerCase().startsWith(shared.toLowerCase())) shared = shared.slice(0, -1);
  return { input: head + (shared.length > partial.length ? shared : partial), options: matches };
}

// ---------------------------------------------------------------- python

/** Explicit counts avoid material-name collisions such as CO (cobalt in xraydb). */
function countText(count: number): string {
  const text = String(Number(count.toPrecision(12)));
  if (!/e/i.test(text)) return text;
  const [mantissa, exponent] = text.split('e');
  const digits = mantissa.replace('.', '');
  const point = (mantissa.indexOf('.') < 0 ? mantissa.length : mantissa.indexOf('.')) + Number(exponent);
  return point <= 0 ? '0.' + '0'.repeat(-point) + digits
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
      : digits.slice(0, point) + '.' + digits.slice(point);
}

/**
 * A Python script that recomputes the console's numbers for a sample with xraydb 4.5:
 * material_mu at one energy, xray_edge, and the transmission thickness rule of `plan`
 * (edge step Δμ·d = 1 unless μ·d above the edge would pass 3).
 */
export function pythonScript(sample: Sample, energy_eV: number): { filename: string; code: string } {
  validateSample(sample);
  mu(sample.formula, sample.density, energy_eV); // Validate the exported photon energy too.
  // xraydb.chemparse cannot read square brackets or a '.' hydrate dot, so the formula is written out as atom counts.
  const flat = Object.entries(parseFormula(sample.formula)).map(([symbol, count]) => symbol + countText(count)).join('');
  const { absorber, edge, density } = sample;
  const info = samplePlan(sample);
  const slug = (sample.formula.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'sample') + `_${absorber}_${edge}`;
  const filename = `xas_${slug.toLowerCase()}.py`;
  const lines = [
    `"""XAS Lab numbers for ${sample.formula} at the ${absorber} ${edge} edge, recomputed with xraydb.`,
    '',
    'Written by the XAS Lab console (https://tss99.github.io/quantum-battery-xas-lab/).',
    'Install xraydb 4.5 first:  pip install "xraydb>=4.5,<4.6"',
    'XAS Lab interpolates compressed XrayDB tables. Rounding and interpolation',
    'can differ, especially at a discontinuity. These are isolated-atom values,',
    'without chemical shifts or near-edge fine structure.',
    '"""',
    'import math',
    '',
    'import xraydb',
    '',
    `formula = '${flat}'  # ${flat === sample.formula ? 'chemical formula' : `${sample.formula}, written out as atom counts`}`,
    `density = ${density}  # g/cm^3`,
    `absorber = '${absorber}'`,
    `edge = '${edge}'`,
    `energy = ${energy_eV}  # photon energy for the single-energy values, eV`,
    '',
    "# material_mu() first looks the name up in xraydb's list of materials, where",
    "# formulas are compared without regard to case: 'CO' would be read as cobalt.",
    '# Explicit atom counts avoid this ambiguity (C1O1 means carbon monoxide).',
    '',
    "# Linear attenuation coefficient mu in 1/cm. kind='total' includes coherent and",
    "# incoherent scattering; kind='photo' is photoabsorption alone.",
    "mu_total = xraydb.material_mu(formula, energy, density=density, kind='total')",
    "mu_photo = xraydb.material_mu(formula, energy, density=density, kind='photo')",
    "print(f'mu total at {energy} eV: {mu_total:.4g} 1/cm')",
    "print(f'mu photo at {energy} eV: {mu_photo:.4g} 1/cm')",
    "print(f'attenuation length 1/mu: {1e4 / mu_total:.4g} um')",
    '',
    '# Edge energy (eV), fluorescence yield and jump ratio, from Elam, Ravel and Sieber (2002).',
    'edge_data = xraydb.xray_edge(absorber, edge)',
    'e0 = edge_data.energy',
    "print(f'{absorber} {edge} edge: {e0} eV, fluorescence yield {edge_data.fyield:.3g}, jump ratio {edge_data.jump_ratio:.4g}')",
  ];
  if (!info.inRange) lines.push(
    '',
    `# No thickness plan: this edge (${info.edge.energy_eV} eV) is outside the 100 eV to 100 keV`,
    '# tables that XAS Lab uses.',
  );
  else if (!info.plan) lines.push(
    '',
    '# No thickness plan: the tables have no jump at this edge, so there is no edge step.',
  );
  else lines.push(
    '',
    "# Edge step. Only the absorber's cross section jumps at its own edge, so",
    "# delta_mu = density * (absorber mass fraction) * (jump in the absorber's mu/rho).",
    'counts = xraydb.chemparse(formula)',
    'masses = {element: n * xraydb.atomic_mass(element) for element, n in counts.items()}',
    'mass_fraction = masses[absorber] / sum(masses.values())',
    '# Estimate one-sided values at offsets of 0.01 % of the listed edge energy.',
    '# The browser instead reads the stored knots on either side of the jump.',
    'e_below, e_above = e0 * (1 - 1e-4), e0 * (1 + 1e-4)',
    'mu_rho_below, mu_rho_above = xraydb.mu_elam(absorber, [e_below, e_above])  # cm^2/g',
    'delta_mu = density * mass_fraction * (mu_rho_above - mu_rho_below)  # 1/cm',
    'if delta_mu <= 0:',
    "    raise ValueError('No positive edge step at these offsets; inspect the tabulated edge before planning thickness.')",
    'mu_above = xraydb.material_mu(formula, e_above, density=density)  # 1/cm, total',
    "print(f'edge step delta_mu: {delta_mu:.4g} 1/cm')",
    "print(f'mu just above the edge: {mu_above:.4g} 1/cm')",
    '',
    '# Transmission sample: aim for an edge step delta_mu * d = 1, but keep the',
    '# total absorption mu * d just above the edge at or below 3.',
    'd_cm = 1 / delta_mu',
    'if mu_above * d_cm > 3:',
    '    d_cm = 3 / mu_above',
    'pellet_area = math.pi * 0.65**2  # 13 mm pellet die, cm^2',
    'mass_per_area = density * d_cm * 1000  # mg/cm^2',
    "print(f'thickness: {d_cm * 1e4:.4g} um (uniform, fully dense layer)')",
    "print(f'mass per area: {mass_per_area:.4g} mg/cm^2')",
    "print(f'pellet mass, 13 mm die: {mass_per_area * pellet_area:.4g} mg')",
    "print(f'edge step delta_mu*d: {delta_mu * d_cm:.3g}')",
    "print(f'total absorption mu*d above the edge: {mu_above * d_cm:.3g}')",
  );
  return { filename, code: lines.join('\n') + '\n' };
}
