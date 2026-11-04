import { describe, expect, it } from 'vitest';
import water from '@/data/quantum/packs/h2o-o-k-sto3g.json';
import { determinant, HadamardTest, stringTransform, type Fragments, type LiveProblem } from './emulate';
import { allocate, lorentzian, rebuild } from './spectrum';

const live = water.live as unknown as LiveProblem & { states: number[][][]; fragments: Record<string, Fragments> };
const largest = water.dipole_norms.indexOf(Math.max(...water.dipole_norms));

describe('the browser emulator matches the Python one', () => {
  it('computes determinants and keeps a rotation orthogonal on determinants', () => {
    expect(determinant(Float64Array.from([2, 1, 1, 3]), 2)).toBeCloseTo(5, 12);
    expect(determinant(Float64Array.from([0, 1, 1, 0]), 2)).toBeCloseTo(-1, 12);
    const u = live.fragments.exact.u[0];
    const t = stringTransform(live.n_orb, live.strings_alpha, u);
    const n = live.strings_alpha.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += t[i * n + k] * t[j * n + k];
      expect(Math.abs(s - (i === j ? 1 : 0))).toBeLessThan(1e-10);
    }
  });

  it.each(['exact', 'cdf'])('reproduces the stored %s factorization signal of water to 1e-6 over 100 steps', method => {
    const test = new HadamardTest(live, live.fragments[method]);
    const [re, im] = test.signal(live.states[largest], water.settings.tau_per_Ha, water.settings.jmax, water.settings.substeps);
    const [pyRe, pyIm] = (water.signals as Record<string, { by_direction: (number[][] | null)[] }>)[method].by_direction[largest]!;
    let worst = 0;
    for (let j = 0; j < re.length; j++) worst = Math.max(worst, Math.abs(re[j] - pyRe[j]), Math.abs(im[j] - pyIm[j]));
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('the spectrum rebuild', () => {
  it('turns one exact exponential into a Lorentzian of half width eta at its energy', () => {
    const tau = 0.25, eta = 0.05, wF = 1.3, n = 4000;
    const times = Float64Array.from({ length: n }, (_, j) => tau * (j + 1));
    const signal: [Float64Array, Float64Array] = [Float64Array.from(times, t => Math.cos(wF * t)), Float64Array.from(times, t => -Math.sin(wF * t))];
    const [peak, half] = rebuild(Float64Array.from([wF, wF + eta]), times, signal, 1, eta, tau);
    expect(peak * Math.PI * eta).toBeCloseTo(1, 1);
    expect(half / peak).toBeCloseTo(0.5, 2);
  });

  it('puts the water signal on its exact reference at the edge', () => {
    const { tau_per_Ha: tau, jmax, eta_Ha: eta } = water.settings;
    const times = Float64Array.from({ length: jmax }, (_, j) => tau * (j + 1));
    const norms = water.dipole_norms;
    const re = new Float64Array(jmax), im = new Float64Array(jmax);
    (water.signals.exact.by_direction as (number[][] | null)[]).forEach((g, k) => {
      if (!g) return;
      for (let j = 0; j < jmax; j++) { re[j] += norms[k] ** 2 * g[0][j]; im[j] += norms[k] ** 2 * g[1][j]; }
    });
    const edge = water.reference.edge_Ha;
    const w = Float64Array.from({ length: 121 }, (_, i) => edge - 0.5 + i * 0.025);
    const quantum = rebuild(Float64Array.from(w, x => x + water.initial_energy_Ha), times, [re, im], norms.reduce((s, x) => s + x * x, 0), eta, tau);
    const exact = lorentzian(w, water.reference.centres_Ha, water.reference.weights, eta);
    const top = Math.max(...exact);
    const worst = quantum.reduce((m, q, i) => Math.max(m, Math.abs(q - exact[i])), 0);
    expect(worst / top).toBeLessThan(0.05);
    expect(Math.abs(w[quantum.indexOf(Math.max(...quantum))] - w[exact.indexOf(top)])).toBeLessThanOrEqual(0.025);
  });

  it('spreads shots along the Lorentzian kernel', () => {
    const times = Float64Array.from({ length: 50 }, (_, j) => 0.5 * (j + 1));
    const shots = allocate(10_000, times, 0.05, 1.3384);
    expect(shots[0]).toBeGreaterThan(shots[49]);
    expect(Math.abs(shots.reduce((s, x) => s + x, 0) - 5000)).toBeLessThan(50);
  });
});
