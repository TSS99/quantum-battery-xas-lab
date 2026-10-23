// Headless beamline twin from the command line. Run `npm run twin -- --help`.
import { writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { HeadlessTwin, loadTables } from './headless';
import { SAMPLE_PRESETS } from '../lib/twin/presets';
import { parseFormula } from '../lib/xraydata';
import type { TwinMode } from '../lib/twin/types';

const HELP = `Beamline twin, headless: one scan to an XDI, CSV or JSON file.

  npm run twin -- [options]

  --profile <id>       bm3 (3 GeV bending magnet, default), und6 (6 GeV undulator) or tender
  --sample <preset>    ${SAMPLE_PRESETS.map(p => p.id).join(', ')}
  --formula <formula>  any formula instead of a preset, with --density, --thickness and --edge
  --edge <El-Edge>     absorber and edge, for example Mn-K or Pt-L3
  --density <g/cm3>    sample density
  --thickness <um>     sample thickness in micrometres
  --mode <mode>        transmission (default), fluorescence, electron-yield, ...
  --scan <plan>        default (XANES and EXAFS) or xanes
  --repeats <n>        scans to average (default 1)
  --realistic          counting noise, drift, glitches and dead time
  --seed <n>           random seed (default 7)
  --do "<command>"     any twin command, repeatable: --do "detune 30 %" --do "insert harmonic mirror"
  --out <file>         .xdi (default run.xdi), .csv or .json
  --larch              also write a Larch script next to the data
  --help               this text
`;

function parseArgs(argv: string[]) {
  const options: Record<string, string | boolean> = {}, commands: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}". Run with --help.`);
    const key = arg.slice(2);
    if (key === 'help' || key === 'realistic' || key === 'larch') { options[key] = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`--${key} needs a value.`);
    if (key === 'do') commands.push(value); else options[key] = value;
  }
  return { options, commands };
}

const csv = (columns: Record<string, number[]>) => {
  const labels = Object.keys(columns);
  return [labels.join(','), ...columns.energy.map((_, i) => labels.map(l => columns[l][i]).join(','))].join('\n') + '\n';
};

export async function main(argv: string[], log: (line: string) => void = console.log): Promise<number> {
  const { options, commands } = parseArgs(argv);
  if (options.help) { log(HELP); return 0; }
  const known = ['profile', 'sample', 'formula', 'edge', 'density', 'thickness', 'mode', 'scan', 'repeats', 'realistic', 'seed', 'out', 'larch'];
  for (const key of Object.keys(options)) if (!known.includes(key)) throw new Error(`Unknown option --${key}. Run with --help.`);
  await loadTables();
  const twin = new HeadlessTwin();
  twin.state = { ...twin.state, seed: Number(options.seed ?? 7) >>> 0 };
  if (options.profile) twin.command({ type: 'profile', id: String(options.profile) });
  if (options.sample) twin.command({ type: 'samplePreset', id: String(options.sample) });
  if (options.formula || options.edge || options.density || options.thickness) {
    const [absorber, edge] = String(options.edge ?? `${twin.state.sample.absorber}-${twin.state.sample.edge}`).split('-');
    const formula = String(options.formula ?? twin.state.sample.formula);
    if (!(absorber in parseFormula(formula))) throw new Error(`${absorber} is not in ${formula}.`);
    twin.command({ type: 'sample', patch: { formula, absorber, edge, ...(options.density ? { density: Number(options.density) } : {}), ...(options.thickness ? { thickness_um: Number(options.thickness) } : {}) } });
  }
  if (options.mode) twin.command({ type: 'mode', mode: String(options.mode) as TwinMode });
  if (options.realistic) twin.command({ type: 'realistic', value: true });
  twin.usePlan(options.scan === 'xanes' ? 'xanes' : 'default', Number(options.repeats ?? 1));
  for (const text of commands) for (const note of await twin.say(text)) log(note);

  const { acquisition, summary } = await twin.acquire();
  const out = String(options.out ?? 'run.xdi'), ext = extname(out).toLowerCase();
  writeFileSync(out, ext === '.json' ? JSON.stringify(acquisition, null, 2) + '\n' : ext === '.csv' ? csv(acquisition.columns) : twin.xdi(acquisition));
  log(`${twin.state.sample.formula}, ${twin.state.sample.absorber} ${twin.state.sample.edge} edge, ${twin.state.mode}, ${twin.state.profile.name}`);
  log(`${summary.points} points x ${summary.repeats}, about ${Math.round(summary.scanTime_s / 60)} min at a beamline; E0 ${summary.e0_eV.toFixed(1)} eV, edge step ${summary.edgeStep.toPrecision(3)}${summary.firstShell_A ? `, first shell peak at ${summary.firstShell_A.toFixed(2)} A` : ''}`);
  log(`Wrote ${out}`);
  if (options.larch) {
    const stem = out.slice(0, out.length - ext.length), script = twin.larch(acquisition, basename(ext === '.xdi' ? out : stem + '.xdi'));
    if (ext !== '.xdi') writeFileSync(stem + '.xdi', twin.xdi(acquisition));
    writeFileSync(stem + '.py', script.code);
    log(`Wrote ${stem}.py`);
  }
  return 0;
}

// Run when bundled as the entry point (the tests import main instead).
if (process.argv[1] && /twin-cli\.(m?js|ts)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(code => process.exit(code), (error: Error) => { console.error(error.message); process.exit(1); });
}
