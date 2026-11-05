import { describe, expect, it } from 'vitest';
import index from '@/data/quantum/eels/index.json';
import waterEels from '@/data/quantum/eels/h2o-o-k-sto3g.json';
import waterPack from '@/data/quantum/packs/h2o-o-k-sto3g.json';
import mnEels from '@/data/quantum/eels/li2mno3-o2-k.json';
import mnPack from '@/data/quantum/packs/li2mno3-o2-k.json';
import { crossSignals, directionSignal, directionSticks, loadEels, type EelsData } from './eels';
import { storedSignals, type Pack } from './packs';
import { lorentzian, rebuild } from './spectrum';

const HARTREE_EV = 27.211386245988;

describe('EELS in the dipole limit', () => {
  it('gives the Python check values for every problem', async () => {
    for (const id of index.problems) {
      const d = await loadEels(id), s = directionSticks(d, d.check.q);
      const w = Float64Array.from(d.check.energies_eV, e => e / HARTREE_EV);
      const y = lorentzian(w, s.centres, s.weights, 0.05);
      d.check.values.forEach((v, i) => expect(y[i], `${id} at ${d.check.energies_eV[i]} eV`).toBeCloseTo(v, 9));
    }
  });

  it('averages over orientations to the XAS spectrum', () => {
    for (const [d, pack] of [[waterEels, waterPack], [mnEels, mnPack]] as unknown as [EelsData, Pack][]) {
      const w = Float64Array.from({ length: 200 }, (_, i) => pack.reference.edge_Ha - 0.2 + i * 0.006);
      const xas = lorentzian(w, pack.reference.centres_Ha, pack.reference.weights, 0.05);
      const sum = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(q => directionSticks(d, q))
        .reduce((acc, s) => { const y = lorentzian(w, s.centres, s.weights, 0.05); return acc.map((v, i) => v + y[i]); }, new Float64Array(w.length));
      const top = Math.max(...xas);
      sum.forEach((v, i) => expect(Math.abs(v - xas[i]) / top).toBeLessThan(1e-6));
    }
  });

  it('rebuilds the exact oriented spectrum from the emulated diagonal and off-diagonal tests', () => {
    // The Li2MnO3 cluster, where the cross terms are large: along (1,1,1) they change the spectrum.
    const d = mnEels as unknown as EelsData, pack = mnPack as unknown as Pack, s = pack.settings;
    const q = [1, 1, 1].map(v => v / Math.sqrt(3));
    const times = Float64Array.from({ length: s.jmax }, (_, j) => s.tau_per_Ha * (j + 1));
    const w = Float64Array.from({ length: 300 }, (_, i) => pack.reference.edge_Ha - 0.2 + i * 0.004);
    const sticks = directionSticks(d, q), g0 = sticks.weights.reduce((a, b) => a + b, 0);
    const signal = directionSignal(storedSignals(pack, d.signals.factorization), crossSignals(d), d.dipole_norms, q, s.jmax);
    const rebuilt = rebuild(Float64Array.from(w, x => x + d.initial_energy_Ha), times, signal, g0, s.eta_Ha, s.tau_per_Ha);
    const exact = lorentzian(w, sticks.centres, sticks.weights, s.eta_Ha), top = Math.max(...exact);
    const worst = rebuilt.reduce((m, v, i) => Math.max(m, Math.abs(v - exact[i])), 0) / top;
    // One Trotter step per time point, as in the pack: the compressed factorization's own error, as for XAS.
    expect(worst).toBeLessThan(0.1);
    const diagonalOnly = directionSignal(storedSignals(pack, d.signals.factorization), { xy: null, xz: null, yz: null }, d.dipole_norms, q, s.jmax);
    const without = rebuild(Float64Array.from(w, x => x + d.initial_energy_Ha), times, diagonalOnly, g0, s.eta_Ha, s.tau_per_Ha);
    expect(without.reduce((m, v, i) => Math.max(m, Math.abs(v - exact[i])), 0) / top).toBeGreaterThan(3 * worst);
  });
});
