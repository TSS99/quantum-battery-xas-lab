import { describe, expect, it } from 'vitest';
import { buildCircuit, defaultQuantumParams, evolveExact, evolveTrotter, hamiltonianMatrix, inner, pauliTerms, reconstructSpectrum, simulateQuantum, solveHamiltonian, validateQuantumParams, type Complex } from './quantum';

const basis = (dimension: number, k: number): Complex[] => Array.from({ length: dimension }, (_, j) => ({ re: j === k ? 1 : 0, im: 0 }));
const difference = (a: Complex[], b: Complex[]) => Math.max(...a.map((z, j) => Math.hypot(z.re - b[j].re, z.im - b[j].im)));

describe('exact effective quantum model', () => {
  it.each([2, 3, 4, 5, 6])('satisfies invariants and independent eigenstate correlation identity at %i qubits', qubits => {
    const p = { ...defaultQuantumParams, qubits, samples: 64, trotterSteps: 4, timeMax: 5 };
    const r = simulateQuantum(p);
    for (const key of ['hermiticityError', 'normError', 'unitarityError', 'groundResidual', 'correlationAtZeroError', 'transitionWeightError'] as const) expect(r.validation[key]).toBeLessThan(1e-10);
    expect(r.validation.groundDegeneracy).toBe(1);
    for (const i of [0, 13, 32, 63]) {
      const re = r.transitions.reduce((s, a) => s + a.weight * Math.cos(a.energy * r.times[i]), 0);
      const im = r.transitions.reduce((s, a) => s - a.weight * Math.sin(a.energy * r.times[i]), 0);
      expect(r.correlationReal[i]).toBeCloseTo(re, 10);
      expect(r.correlationImag[i]).toBeCloseTo(im, 10);
    }
    expect(r.spectrumReference.every(v => v >= 0)).toBe(true);
    expect(r.fidelity.every(v => v >= 0 && v <= 1)).toBe(true);
    expect(r.resources.entanglingGates).toBe(2 * (qubits - 1) * p.trotterSteps);
    expect(r.transitions.some(t => t.kind === 'elastic' && t.energy < 1e-9)).toBe(true);
  });

  it('uses the correct tensor ordering and matches an analytic uncoupled Hamiltonian spectrum', () => {
    const p = { ...defaultQuantumParams, coupling: 0 };
    const { eigenvalues } = solveHamiltonian(p);
    const a = Math.hypot(p.field, 0.17), b = Math.hypot(1.13 * p.field, 0.17);
    const expected = [-a - b, a - b, -a + b, a + b].sort((x, y) => x - y);
    eigenvalues.forEach((e, i) => expect(e).toBeCloseTo(expected[i], 12));
    const h = hamiltonianMatrix(p);
    expect(h[0][0]).toBeCloseTo(2.13 * p.field, 12);
    expect(h[0][2]).toBeCloseTo(0.17, 12);
  });

  it('improves a fixed noncommuting propagation and directly checks Trotter unitarity', () => {
    const p = defaultQuantumParams, { eigenvalues, vectors } = solveHamiltonian(p);
    const initial = vectors.map((_, j) => ({ re: vectors[j ^ 2][0], im: 0 }));
    const exact = evolveExact(initial, eigenvalues, vectors, 2);
    const errors = [1, 8, 64].map(steps => {
      const z = inner(exact, evolveTrotter(initial, pauliTerms(p), 2, steps));
      return 1 - z.re ** 2 - z.im ** 2;
    });
    expect(errors[2]).toBeLessThan(errors[1]); expect(errors[1]).toBeLessThan(errors[0]);
    const columns = Array.from({ length: 4 }, (_, j) => evolveTrotter(basis(4, j), pauliTerms(p), 2, 7));
    for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      const overlap = inner(columns[j], columns[k]);
      expect(overlap.re).toBeCloseTo(j === k ? 1 : 0, 12); expect(overlap.im).toBeCloseTo(0, 12);
    }
  });

  it('implements chronological CX-Rx-CX as the XX product formula', () => {
    const p = { ...defaultQuantumParams, timeMax: 5, trotterSteps: 1 };
    for (let k = 0; k < 4; k++) {
      let state = basis(4, k);
      for (const gate of buildCircuit(pauliTerms(p), p)) {
        if (gate.gate === 'CX') {
          const [control, target] = gate.qubits;
          state = state.map((_, i) => state[i & (1 << (1 - control)) ? i ^ (1 << (1 - target)) : i]);
        } else {
          const angle = gate.angle! / 2, c = Math.cos(angle), s = Math.sin(angle), mask = 1 << (1 - gate.qubits[0]);
          state = state.map((z, i) => {
            const source = gate.gate === 'Rx' ? state[i ^ mask] : z;
            const sign = gate.gate === 'Rz' && (i & mask) ? -1 : 1;
            return { re: c * z.re + s * sign * source.im, im: c * z.im - s * sign * source.re };
          });
        }
      }
      expect(difference(state, evolveTrotter(basis(4, k), pauliTerms(p), p.timeMax, 1))).toBeLessThan(1e-12);
    }
  });
});

describe('spectral reconstruction and input bounds', () => {
  it('places an isolated transition at its positive gap and distinguishes padding from resolution', () => {
    const p = { ...defaultQuantumParams, timeMax: 120, samples: 512, broadening: 0.02, padding: 8 };
    const times = Array.from({ length: p.samples }, (_, i) => i * p.timeMax / (p.samples - 1));
    const re = times.map(t => Math.cos(1.4 * t)), im = times.map(t => -Math.sin(1.4 * t));
    const fft = reconstructSpectrum(re, im, p), coarse = reconstructSpectrum(re, im, { ...p, padding: 1 });
    const peak = fft.energy[fft.signed.indexOf(Math.max(...fft.signed))];
    expect(Math.abs(peak - 1.4)).toBeLessThan(fft.spacing);
    expect(fft.spacing).toBeCloseTo(coarse.spacing / 8, 12);
    expect(fft.nyquist).toBe(coarse.nyquist);
  });
  it('preserves signed finite-time artifacts, reports removed area, and detects aliasing', () => {
    const p = { ...defaultQuantumParams, timeMax: 5, samples: 64, broadening: 0.02, window: 'none' as const, padding: 8 };
    const t = Array.from({ length: p.samples }, (_, i) => i * p.timeMax / (p.samples - 1));
    const fft = reconstructSpectrum(t.map(t => Math.cos(1.4 * t)), t.map(t => -Math.sin(1.4 * t)), p);
    expect(fft.minimum).toBeLessThan(0); expect(fft.negativeBins).toBeGreaterThan(0); expect(fft.clippedArea).toBeGreaterThan(0);
    expect(Math.min(...fft.clipped)).toBe(0);
    const r = simulateQuantum({ ...p, field: 2, timeMax: 120 });
    expect(r.caveats.some(c => c.startsWith('ALIASING WARNING'))).toBe(true);
    expect(Number.isFinite(r.validation.spectralL1TrotterVsExact)).toBe(true);
  });
  it.each([{ qubits: 7 }, { qubits: 2.5 }, { samples: 65 }, { padding: 3 }, { field: NaN }, { broadening: 0 }, { window: 'hann' }])('rejects invalid request %o', patch => {
    expect(() => validateQuantumParams({ ...defaultQuantumParams, ...patch })).toThrow();
  });
});
