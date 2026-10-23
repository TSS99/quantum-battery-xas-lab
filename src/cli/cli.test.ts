import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { XDI_REQUIRED, readXdi } from '../lib/twin/xdi';
import { main } from './twin-cli';
import { createServer } from './xaslab-mcp';

const dir = mkdtempSync(join(tmpdir(), 'xaslab-cli-'));
const validXdi = (text: string, symbol: string, edge: string) => {
  const xdi = readXdi(text);
  for (const field of XDI_REQUIRED) expect(xdi.fields[field], field).toBeTruthy();
  expect(xdi.fields['Element.symbol']).toBe(symbol);
  expect(xdi.fields['Element.edge']).toBe(edge);
  expect(xdi.labels[0]).toBe('energy');
  for (const label of ['i0', 'itrans', 'mutrans']) expect(xdi.labels).toContain(label);
  expect(xdi.columns.energy.length).toBeGreaterThan(50);
  return xdi;
};

describe('headless command line', () => {
  it('writes a valid XDI for a preset sample, with the commands it was given and a Larch script', async () => {
    const out = join(dir, 'limn2o4.xdi'), lines: string[] = [];
    const code = await main(['--sample', 'limn2o4-pellet', '--mode', 'fluorescence', '--scan', 'xanes', '--seed', '7', '--do', 'detune 30 %', '--out', out, '--larch'], line => lines.push(line));
    expect(code).toBe(0);
    const xdi = validXdi(readFileSync(out, 'utf8'), 'Mn', 'K');
    expect(xdi.fields['XASLab.measurement_mode']).toBe('fluorescence');
    expect(lines.join('\n')).toMatch(/detuned by 30 %/);
    expect(lines.join('\n')).toMatch(/E0 65\d\d\.\d eV/);
    expect(readFileSync(join(dir, 'limn2o4.py'), 'utf8')).toMatch(/read_xdi|read_ascii/);
  }, 120_000);

  it('takes any formula and edge, gives the same file for the same seed, and rejects unknown options', async () => {
    const run = async (name: string) => { const out = join(dir, name); await main(['--formula', 'CuO', '--edge', 'Cu-K', '--density', '6.3', '--thickness', '10', '--scan', 'xanes', '--seed', '3', '--realistic', '--out', out], () => {}); return readFileSync(out, 'utf8'); };
    const a = await run('a.xdi'), b = await run('b.xdi');
    expect(a).toBe(b);
    validXdi(a, 'Cu', 'K');
    await expect(main(['--colour', 'blue'], () => {})).rejects.toThrow(/Unknown option --colour/);
    await expect(main(['--formula', 'NiO', '--edge', 'Cu-K'], () => {})).rejects.toThrow(/Cu is not in NiO/);
  }, 120_000);
});

describe('MCP server', () => {
  it('lists its tools and drives a scan through typed commands', async () => {
    const { handle } = createServer();
    const call = async (name: string, args: object = {}) => {
      const response = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as { result: { content: { text: string }[]; isError?: boolean } };
      return response.result;
    };
    expect(await handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).toMatchObject({ result: { serverInfo: { name: 'xaslab-twin' }, capabilities: { tools: {} } } });
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const listed = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map(t => t.name)).toEqual(['twin_status', 'twin_command', 'twin_acquire', 'twin_analyze', 'twin_export', 'twin_reset', 'simulate']);
    expect((await call('twin_command', { command: 'sample fe 2 mm' })).content[0].text).toMatch(/Fe, 2 mM in water/);
    expect((await call('twin_command', { command: 'swich to fluorescence' })).content[0].text).toMatch(/Read as "switch to fluorescence"/);
    expect((await call('twin_status')).content[0].text).toMatch(/Mode fluorescence/);
    expect((await call('twin_acquire', { plan: 'xanes' })).content[0].text).toMatch(/^Acquisition 1: fluorescence/);
    expect((await call('twin_analyze')).content[0].text).toMatch(/E0 71\d\d/);
    validXdi((await call('twin_export', { format: 'xdi' })).content[0].text, 'Fe', 'K');
    // A thick NiO pellet saturates the fluorescence detector; the summary says why it cannot be reduced.
    await call('twin_command', { command: 'sample nio' });
    expect((await call('twin_acquire', { plan: 'xanes' })).content[0].text).toMatch(/E0 n\/a.*Not reduced: /);
    const bad = await call('twin_command', { command: 'make coffee' });
    expect(bad.isError).toBe(true);
    expect((await call('twin_export', { format: 'xdi', acquisition: 9 })).isError).toBe(true);
    expect(await handle({ jsonrpc: '2.0', id: 3, method: 'nope' })).toMatchObject({ error: { code: -32601 } });
  }, 120_000);

  it('answers over stdio once bundled: initialize, then a simulated scan as XDI', async () => {
    const file = join(dir, 'xaslab-mcp.mjs');
    await build({ entryPoints: ['src/cli/xaslab-mcp.ts'], bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'warning' });
    expect(existsSync(file)).toBe(true);
    const child = spawn(process.execPath, [file], { stdio: ['pipe', 'pipe', 'pipe'] });
    const replies: { id: number; result?: { content?: { text: string }[] } }[] = [];
    let buffer = '';
    const done = new Promise<void>((resolve, reject) => {
      child.stdout.on('data', chunk => {
        buffer += chunk;
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) { replies.push(JSON.parse(buffer.slice(0, at))); buffer = buffer.slice(at + 1); }
        if (replies.length === 2) { child.stdin.end(); resolve(); }
      });
      child.on('error', reject);
      setTimeout(() => reject(new Error('The server did not answer in time.')), 90_000);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'simulate', arguments: { sample: 'cu-foil', plan: 'xanes', seed: 1 } } }) + '\n');
    await done;
    expect(replies.map(r => r.id)).toEqual([1, 2]);
    validXdi(replies[1].result!.content![0].text, 'Cu', 'K');
  }, 120_000);
});
