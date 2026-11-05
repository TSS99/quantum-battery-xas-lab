import { describe, expect, it } from 'vitest';
import water from '@/data/quantum/instances/h2o-o-k-sto3g.json';
import o2 from '@/data/quantum/packs/li2mno3-o2-k.json';
import { seededRandom } from '@/lib/xas';
import { HARTREE_EV } from '@/lib/quantum/packs';
import { BEAMLINE, measure, scanEnergies, toCsv } from '@/lib/quantum/measure';
import { createServer } from './xaslab-mcp';

const { handle } = createServer();
const call = async (name: string, args: object = {}) => {
  const response = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as { result: { content: { text: string }[]; isError?: boolean } };
  return { text: response.result.content[0].text, error: response.result.isError === true };
};
const number = (text: string, pattern: RegExp) => parseFloat(text.match(pattern)![1]);

describe('quantum MCP tools', () => {
  it('are listed after the twin tools', async () => {
    const listed = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map(t => t.name).slice(-6)).toEqual(['quantum_problems', 'quantum_build', 'quantum_estimate', 'quantum_emulate', 'quantum_eels', 'quantum_compare']);
  });

  it('quantum_problems lists the library', async () => {
    const { text } = await call('quantum_problems');
    expect(text.split('\n')).toHaveLength(7);
    expect(text).toMatch(/^h2o-o-k-sto3g: .*CAS\(10e,7o\), 15 qubits, 441 determinants; exact edge 542\.2 eV; emulated circuits rerun here/m);
    expect(text).toMatch(/^li2mno3-o2-k-18: .*no exact reference.*cost only/m);
  });

  it('quantum_build exports a problem, its Hamiltonian as FCIDUMP that reads back to the stored integrals, its atoms and a new recipe', async () => {
    expect((await call('quantum_build', { problem: 'h2o-o-k-sto3g' })).text).toMatch(/CAS\(10e,7o\), 15 qubits.*O 1s is active orbital 1/s);
    const dump = (await call('quantum_build', { problem: 'h2o-o-k-sto3g', format: 'fcidump' })).text.trim().split('\n');
    expect(dump[0]).toBe('&FCI NORB=7,NELEC=10,MS2=0,');
    const n = 7, h1 = Array.from({ length: n }, () => new Array(n).fill(0)), h2 = Array.from({ length: n ** 4 }, () => 0);
    let core = NaN;
    for (const line of dump.slice(4)) {
      const [v, i, j, k, l] = line.trim().split(/\s+/).map(Number);
      if (i === 0) core = v;
      else if (k === 0) { h1[i - 1][j - 1] = v; h1[j - 1][i - 1] = v; }
      else for (const [a, b, c, d] of [[i, j, k, l], [j, i, k, l], [i, j, l, k], [j, i, l, k], [k, l, i, j], [l, k, i, j], [k, l, j, i], [l, k, j, i]]) h2[(((a - 1) * n + b - 1) * n + c - 1) * n + d - 1] = v;
    }
    expect(core).toBeCloseTo(water.integrals.e_core, 12);
    let worst = 0;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      worst = Math.max(worst, Math.abs(h1[a][b] - water.integrals.h1[a][b]));
      for (let c = 0; c < n; c++) for (let d = 0; d < n; d++) worst = Math.max(worst, Math.abs(h2[((a * n + b) * n + c) * n + d] - water.integrals.h2[a][b][c][d]));
    }
    expect(worst).toBeLessThan(1e-12);
    expect((await call('quantum_build', { problem: 'h2o-o-k-sto3g', format: 'xyz' })).text).toMatch(/^3\n.*\nO 0\.00000 0\.00000 0\.11730\n/);
    expect((await call('quantum_build', { problem: 'li2mno3-o2-k-18', format: 'xyz' })).text).toMatch(/^\d+\n/);
    const recipe = JSON.parse((await call('quantum_build', { problem: 'li3mn2o-o2-k', recipe_for: { id: 'li3mn2o-o1-k', site: 'O1' } })).text);
    expect(recipe).toMatchObject({ id: 'li3mn2o-o1-k', site: 'O1', remove: ['Li3'], spin: 1, structure: 'cod-1008373-Li2MnO3.cif' });
    expect((await call('quantum_build', { problem: 'nope' })).error).toBe(true);
  });

  it('quantum_estimate gives the stored cost of a problem, a size and a resolution', async () => {
    const own = (await call('quantum_estimate', { problem: 'h2o-o-k-sto3g' })).text;
    expect(own).toMatch(/Logical qubits 78/);
    expect(own).toMatch(/IBM Starling class .*: fits\./);
    expect((await call('quantum_estimate', { orbitals: 18 })).text).toMatch(/IBM Starling class .*: does not fit\.\nIBM Blue Jay class .*: fits\./);
    const fine = (await call('quantum_estimate', { resolution_eV: 0.27 })).text;
    expect(fine).toMatch(/eta 0\.01 Ha \(0\.27 eV\)/);
    expect(fine).toMatch(/Toffoli gates 7\.27e\+8 in the longest circuit/);
    expect((await call('quantum_estimate', { orbitals: 13 })).error).toBe(true);
  });

  it('quantum_emulate puts the measured peak on the exact one and reruns water\'s circuits to the Python signal', async () => {
    const summary = (await call('quantum_emulate', { problem: 'h2o-o-k-sto3g', shots: 100_000 })).text;
    expect(Math.abs(number(summary, /measured ([\d.]+) eV/) - number(summary, /exact ([\d.]+) eV/))).toBeLessThan(0.3);
    const live = (await call('quantum_emulate', { problem: 'h2o-o-k-sto3g', live: true })).text;
    expect(number(live, /from the Python emulator ([\d.e+-]+)\./)).toBeLessThan(1e-6);
    const csv = (await call('quantum_emulate', { problem: 'co-o-k-sto3g', format: 'csv' })).text.trim().split('\n');
    expect(csv[0]).toBe('energy_eV,exact,noiseless,measured');
    expect(csv).toHaveLength(482);
    expect((await call('quantum_emulate', { problem: 'li2mno3-o2-k', factorization: 'exact' })).error).toBe(true);
    expect((await call('quantum_emulate', { problem: 'li2mno3-o2-k-18' })).error).toBe(true);
  }, 300_000);

  it('quantum_eels finds the pi* of CO across the bond and its sigma* along it', async () => {
    const across = (await call('quantum_eels', { problem: 'co-o-k-sto3g', q: [1, 0, 0] })).text;
    const along = (await call('quantum_eels', { problem: 'co-o-k-sto3g', q: [0, 0, 2] })).text;
    expect(number(across, /exact ([\d.]+) eV/)).toBeCloseTo(540.0, 0);
    expect(number(along, /exact ([\d.]+) eV/)).toBeCloseTo(556.3, 0);
    expect(along).toMatch(/q along \(0\.000, 0\.000, 1\.000\)/);
    expect((await call('quantum_eels', { problem: 'li2mno3-o2-k-18', q: [0, 0, 1] })).error).toBe(true);
    expect((await call('quantum_eels', { problem: 'co-o-k-sto3g', q: [0, 0, 0] })).error).toBe(true);
  });

  it('quantum_compare reads a simulated mixture back, and aligns a measured spectrum passed as text', async () => {
    const crystal = (await call('quantum_compare', { sample: 'crystal' })).text;
    expect(Math.abs(number(crystal, /li2mno3-o2-k: ([\d.]+) ±/) - 66.7)).toBeLessThan(2);
    expect(crystal).toMatch(/surface dose \d+ MGy/);
    const sticks = { centres_eV: o2.reference.centres_Ha.map(c => c * HARTREE_EV), weights: o2.reference.weights };
    const scan = measure(sticks, scanEnergies([o2.reference.edge_eV]), BEAMLINE, seededRandom(3), 1);
    const shifted = toCsv({ ...scan, energies: scan.energies.map(e => e - 30) }, 'shifted');
    const fitted = (await call('quantum_compare', { spectrum: shifted })).text;
    expect(Math.abs(number(fitted, /shift (-?[\d.]+) eV/) + 30)).toBeLessThanOrEqual(0.1);
    expect(fitted).toMatch(/li2mno3-o2-k: .*alone ranks 1\./);
    expect((await call('quantum_compare', { sample: 'nope' })).error).toBe(true);
  }, 120_000);
});
