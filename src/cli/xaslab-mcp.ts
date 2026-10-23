// MCP server for the beamline twin, over stdio: one JSON-RPC 2.0 message per line in, one per line out. Logs go to
// stderr so they never mix with the protocol. Build and run with `npm run --silent mcp`.
import { createInterface } from 'node:readline';
import { HeadlessTwin, loadTables, plain } from './headless';
import { SAMPLE_PRESETS } from '../lib/twin/presets';
import { COMMAND_EXAMPLES } from '../lib/twin/command-bar';
import type { Acquisition } from '../lib/twin/types';

const VERSION = '1.0.0';
const PROTOCOL = '2025-06-18';

type Json = Record<string, unknown>;
interface Request { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Json }
interface Tool { name: string; description: string; inputSchema: Json; run: (args: Json) => Promise<string> }

const str = (value: unknown, label: string) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be text.`); return value; };
const object = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const sig = (value: number | null | undefined, unit = '') => value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${Number(value.toPrecision(3))}${unit ? ' ' + unit : ''}`;

export function createServer() {
  let twin = new HeadlessTwin();
  const pick = (n: unknown): Acquisition => {
    if (!twin.acquisitions.length) throw new Error('No acquisitions yet: run twin_acquire first.');
    const index = n === undefined ? twin.acquisitions.length : Number(n);
    const found = twin.acquisitions[index - 1];
    if (!found) throw new Error(`There are ${twin.acquisitions.length} acquisitions; pick 1 to ${twin.acquisitions.length}.`);
    return found;
  };
  const describe = () => {
    const s = twin.state, st = twin.status();
    return [
      `Mode ${s.mode}; mono ${s.energy_eV.toFixed(1)} eV on ${s.profile.mono.crystal} (Bragg ${sig(st.theta_deg, 'deg')}, resolution ${sig(st.deltaE_eV, 'eV')}); profile ${s.profile.name}.`,
      `Sample ${s.sample.formula}, ${s.sample.absorber} ${s.sample.edge} edge, ${s.sample.thickness_um} um, ${s.environment.kind} at ${s.environment.temperature_K} K; ${s.realistic ? 'realistic' : 'educational'} detectors.`,
      `Flux at I0 ${sig(st.flux, 'ph/s')}, harmonic fraction ${sig(st.harmonicFraction)}, sample transmission ${sig(st.sampleTransmission)}, edge step ${sig(st.edgeStep)}.`,
      `I0 ${sig(st.i0?.voltage_V, 'V')}${st.i0?.saturated ? ' (saturated)' : ''}, It ${sig(st.it?.voltage_V, 'V')}${st.it?.saturated ? ' (saturated)' : ''}, Iref ${sig(st.iref?.voltage_V, 'V')}; fluorescence ${sig(st.fluorescence_per_s, '/s')}, dead time ${sig(st.deadFraction)}; dose rate ${sig(st.doseRate_Gy_per_s, 'Gy/s')}.`,
      ...st.notes.map(plain),
      `Acquisitions so far: ${twin.acquisitions.length}.`,
    ].join('\n');
  };
  const summary = (a: Acquisition, n: number) => {
    const s = twin.summarize(a);
    return `Acquisition ${n}: ${a.kind}, ${s.points} points, E0 ${sig(s.e0_eV, 'eV')}, edge step ${sig(s.edgeStep)}${s.firstShell_A ? `, first-shell peak in |chi(R)| at ${s.firstShell_A.toFixed(2)} A` : ''}.${s.problem ? ` Not reduced: ${s.problem}` : ''}`;
  };

  const tools: Tool[] = [
    {
      name: 'twin_status', description: 'Current settings and live readings of the beamline twin: mode, energy, crystal, sample, flux, chamber voltages, fluorescence rate, dead time and dose rate.',
      inputSchema: object({}), run: async () => describe(),
    },
    {
      name: 'twin_command', description: `Change the twin with a typed command, the same grammar as the page's command bar. Examples: ${COMMAND_EXAMPLES.map(c => `"${c}"`).join(', ')}. Returns what changed.`,
      inputSchema: object({ command: { type: 'string', description: 'One command, for example "set energy 8979" or "insert harmonic mirror".' } }, ['command']),
      run: async args => (await twin.say(str(args.command, 'command'))).join('\n'),
    },
    {
      name: 'twin_acquire', description: 'Run a scan with the current settings and store it. Optionally choose the plan (default: XANES and EXAFS; xanes: edge only) and the number of scans to average.',
      inputSchema: object({ plan: { type: 'string', enum: ['default', 'xanes'] }, repeats: { type: 'integer', minimum: 1, maximum: 50 } }),
      run: async args => {
        if (args.plan) twin.usePlan(args.plan === 'xanes' ? 'xanes' : 'default', Number(args.repeats ?? twin.state.scan.repeats));
        const { acquisition } = await twin.acquire(args.repeats === undefined ? undefined : Number(args.repeats));
        return summary(acquisition, twin.acquisitions.length);
      },
    },
    {
      name: 'twin_analyze', description: 'Edge position, edge step and the first-shell peak of |chi(R)| for one stored acquisition (the latest by default).',
      inputSchema: object({ acquisition: { type: 'integer', minimum: 1 } }),
      run: async args => { const a = pick(args.acquisition); return summary(a, twin.acquisitions.indexOf(a) + 1); },
    },
    {
      name: 'twin_export', description: 'One stored acquisition as XDI (standard XAS data file), CSV, JSON, or a Larch script that reads the XDI and reduces it.',
      inputSchema: object({ acquisition: { type: 'integer', minimum: 1 }, format: { type: 'string', enum: ['xdi', 'csv', 'json', 'larch'] } }, ['format']),
      run: async args => {
        const a = pick(args.acquisition), n = twin.acquisitions.indexOf(a) + 1;
        if (args.format === 'json') return JSON.stringify(a);
        if (args.format === 'larch') return twin.larch(a, `acquisition-${n}.xdi`).code;
        if (args.format === 'csv') { const labels = Object.keys(a.columns); return [labels.join(','), ...a.columns.energy.map((_, i) => labels.map(l => a.columns[l][i]).join(','))].join('\n'); }
        return twin.xdi(a);
      },
    },
    {
      name: 'twin_reset', description: 'Put the twin back to its starting settings and forget the stored acquisitions.',
      inputSchema: object({}), run: async () => { twin = new HeadlessTwin(); return 'The twin is back to its starting settings, with no acquisitions.'; },
    },
    {
      name: 'simulate', description: `One-off scan on a fresh twin, returned as an XDI file. Sample presets: ${SAMPLE_PRESETS.map(p => p.id).join(', ')}. Commands run in order before the scan.`,
      inputSchema: object({
        sample: { type: 'string', description: 'A sample preset id.' },
        profile: { type: 'string', enum: ['bm3', 'und6', 'tender'] },
        mode: { type: 'string', description: 'transmission, fluorescence, electron-yield, ...' },
        plan: { type: 'string', enum: ['default', 'xanes'] },
        repeats: { type: 'integer', minimum: 1, maximum: 50 },
        realistic: { type: 'boolean' },
        seed: { type: 'integer', minimum: 0 },
        commands: { type: 'array', items: { type: 'string' } },
      }),
      run: async args => {
        const one = new HeadlessTwin();
        one.state = { ...one.state, seed: Number(args.seed ?? 7) >>> 0 };
        if (args.profile) one.command({ type: 'profile', id: str(args.profile, 'profile') });
        if (args.sample) one.command({ type: 'samplePreset', id: str(args.sample, 'sample') });
        if (args.mode) await one.say(str(args.mode, 'mode'));
        if (args.realistic) one.command({ type: 'realistic', value: true });
        one.usePlan(args.plan === 'xanes' ? 'xanes' : 'default', Number(args.repeats ?? 1));
        for (const text of (Array.isArray(args.commands) ? args.commands : [])) await one.say(str(text, 'command'));
        const { acquisition } = await one.acquire();
        return one.xdi(acquisition);
      },
    },
  ];

  const ready = loadTables();

  /** Handle one message; notifications get no reply (null). */
  async function handle(message: Request): Promise<Json | null> {
    const reply = (result: Json) => ({ jsonrpc: '2.0', id: message.id ?? null, result });
    const fail = (code: number, text: string) => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code, message: text } });
    if (message.id === undefined) return null;
    switch (message.method) {
      case 'initialize': return reply({ protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'xaslab-twin', version: VERSION } });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const tool = tools.find(t => t.name === message.params?.name);
        if (!tool) return fail(-32602, `Unknown tool "${String(message.params?.name)}".`);
        try {
          await ready;
          return reply({ content: [{ type: 'text', text: await tool.run((message.params?.arguments ?? {}) as Json) }] });
        } catch (error) {
          return reply({ content: [{ type: 'text', text: (error as Error).message }], isError: true });
        }
      }
      default: return fail(-32601, `Method not found: ${message.method}`);
    }
  }
  return { handle, tools };
}

// Run when bundled as the entry point (the tests import createServer instead).
if (process.argv[1] && /xaslab-mcp\.(m?js|ts)$/.test(process.argv[1])) {
  const { handle } = createServer();
  const lines = createInterface({ input: process.stdin });
  let queue = Promise.resolve();
  lines.on('line', line => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let message: Request;
      try { message = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
      const response = await handle(message);
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    });
  });
  lines.on('close', () => { void queue.then(() => process.exit(0)); });
  console.error(`xaslab-twin MCP server ${VERSION} ready on stdio.`);
}
