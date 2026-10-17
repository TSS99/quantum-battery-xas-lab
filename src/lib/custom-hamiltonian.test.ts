import { describe, expect, it } from 'vitest';
import { customMatrix, evolveCustomExact, evolveCustomTrotter, parseHamiltonian, simulateCustomQuantum, solveCustomHamiltonian, validateHamiltonian, HAMILTONIAN_EXAMPLE } from './custom-hamiltonian';
import { defaultQuantumParams, inner, pauliTerms, simulateQuantum } from './quantum';
describe('custom Hamiltonian workflow', () => {
  it('validates the complete JSON contract and rejects malformed input', () => {
    expect(parseHamiltonian(JSON.stringify(HAMILTONIAN_EXAMPLE))).toEqual(HAMILTONIAN_EXAMPLE);
    for (const value of [null, [], { ...HAMILTONIAN_EXAMPLE, qubits: 7 }, { ...HAMILTONIAN_EXAMPLE, qubits: 1.5 }, { ...HAMILTONIAN_EXAMPLE, unknown: true }, { ...HAMILTONIAN_EXAMPLE, terms: [] }, { ...HAMILTONIAN_EXAMPLE, terms: [{ label: 'AX', coefficient: 1 }] }, { ...HAMILTONIAN_EXAMPLE, terms: [{ label: 'X', coefficient: 1 }] }, { ...HAMILTONIAN_EXAMPLE, terms: [{ label: 'XX', coefficient: Infinity }] }, { ...HAMILTONIAN_EXAMPLE, terms: [{ label: 'XX', coefficient: '1' }] }, { ...HAMILTONIAN_EXAMPLE, terms: [{ label: 'XX', coefficient: 0 }] }, { ...HAMILTONIAN_EXAMPLE, terms: Array(65).fill({ label: 'XX', coefficient: 1 }) }]) expect(() => validateHamiltonian(value)).toThrow();
    expect(() => parseHamiltonian('{')).toThrow('JSON');
    expect(() => parseHamiltonian(' '.repeat(16001))).toThrow('16 kB');
    expect(() => validateHamiltonian({ ...HAMILTONIAN_EXAMPLE, terms: [{ label: 'XX', coefficient: 1 }, { label: 'XX', coefficient: 2 }] })).toThrow('duplicate');
  });
  it('builds and solves complex Y matrices with analytic eigenvalues', () => {
    const h = { name: 'Y plus Z', qubits: 1, terms: [{ label: 'Y', coefficient: 3 }, { label: 'Z', coefficient: 4 }] };
    expect(customMatrix(h)).toEqual([[{ re: 4, im: 0 }, { re: 0, im: -3 }], [{ re: 0, im: 3 }, { re: -4, im: 0 }]]);
    const solved = solveCustomHamiltonian(h);
    expect(solved.eigenvalues[0]).toBeCloseTo(-5, 12);
    expect(solved.eigenvalues[1]).toBeCloseTo(5, 12);
    expect(Math.hypot(...Object.values(inner(solved.vectors[0], solved.vectors[1])))).toBeLessThan(1e-12);
  });
  it('evolves a Y kick with the correct complex sign and unit norm', () => {
    const h = { name: 'Y', qubits: 1, terms: [{ label: 'Y', coefficient: 1 }] };
    const solved = solveCustomHamiltonian(h), initial = [{ re: 1, im: 0 }, { re: 0, im: 0 }];
    const exact = evolveCustomExact(initial, solved.eigenvalues, solved.vectors, Math.PI / 2);
    const trotter = evolveCustomTrotter(initial, h.terms, Math.PI / 2, 1);
    expect(exact[1].re).toBeCloseTo(1, 12);
    expect(trotter[1].re).toBeCloseTo(1, 12);
    expect(inner(exact, exact).re).toBeCloseTo(1, 12);
  });
  it('handles degeneracy and many-body Pauli terms up to the six-qubit limit', () => {
    const h = { name: 'Six spins', qubits: 6, terms: [{ label: 'XYZXYZ', coefficient: .5 }] };
    const solved = solveCustomHamiltonian(h);
    expect(solved.eigenvalues).toHaveLength(64);
    expect(solved.eigenvalues.filter(e => e < 0)).toHaveLength(32);
    expect(solved.eigenvalues[0]).toBeCloseTo(-.5, 10);
  });
  it('matches the existing model when given its Pauli terms', () => {
    const p = { ...defaultQuantumParams, samples: 64, timeMax: 5, padding: 1 };
    const old = simulateQuantum(p), custom = simulateCustomQuantum(p, { name: 'Same model', qubits: p.qubits, terms: pauliTerms(p) });
    custom.correlationReal.forEach((v, i) => expect(v).toBeCloseTo(old.correlationReal[i], 10));
    custom.spectrumTrotterSigned.forEach((v, i) => expect(v).toBeCloseTo(old.spectrumTrotterSigned[i], 10));
    expect(custom.validation.groundResidual).toBeLessThan(1e-12);
    expect(custom.validation.unitarityError).toBeLessThan(1e-12);
  });
  it('gives finite spectra and no fictitious gate estimate for custom Y terms', () => {
    const result = simulateCustomQuantum({ ...defaultQuantumParams, samples: 64, timeMax: 5 }, HAMILTONIAN_EXAMPLE);
    expect(result.validation.normError).toBeLessThan(1e-12);
    expect(result.validation.transitionWeightError).toBeLessThan(1e-12);
    expect(result.spectrumFourierSigned.every(Number.isFinite)).toBe(true);
    expect(result.customHamiltonian).toEqual(HAMILTONIAN_EXAMPLE);
    expect(result.circuit).toEqual([]);
    expect(result.resources.convention).toContain('Not compiled');
  });
});
