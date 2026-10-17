import { EigenvalueDecomposition, Matrix } from 'ml-matrix';
import { inner, reconstructSpectrum, validateQuantumParams, type Complex, type PauliTerm, type QuantumParams, type QuantumResult } from './quantum';
export interface CustomHamiltonian { name: string; qubits: number; terms: PauliTerm[] }
export const HAMILTONIAN_EXAMPLE: CustomHamiltonian = { name: 'Two coupled spins', qubits: 2, terms: [{ label: 'ZI', coefficient: .7 }, { label: 'IZ', coefficient: .791 }, { label: 'XX', coefficient: .35 }, { label: 'YI', coefficient: .17 }] };
export function validateHamiltonian(value: unknown): CustomHamiltonian {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hamiltonian must be a JSON object.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['name', 'qubits', 'terms'].includes(k))) throw new Error('Unknown Hamiltonian field. Use name, qubits and terms.');
  if (typeof v.qubits !== 'number' || !Number.isInteger(v.qubits) || v.qubits < 1 || v.qubits > 6) throw new Error('Use 1 to 6 qubits.');
  const qubits = v.qubits;
  if (v.name !== undefined && (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100)) throw new Error('Name must contain 1 to 100 characters.');
  if (!Array.isArray(v.terms) || !v.terms.length || v.terms.length > 64) throw new Error('Use 1 to 64 Pauli terms.');
  const terms = v.terms.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each term needs a label and coefficient.');
    const t = item as Record<string, unknown>;
    if (Object.keys(t).some(k => !['label', 'coefficient'].includes(k))) throw new Error('Unknown term field. Use label and coefficient.');
    if (typeof t.label !== 'string' || t.label.length !== qubits || !/^[IXYZ]+$/.test(t.label)) throw new Error('Each Pauli label must have ' + qubits + ' letters from I, X, Y, Z.');
    if (typeof t.coefficient !== 'number' || !Number.isFinite(t.coefficient) || Math.abs(t.coefficient) > 100) throw new Error('Coefficients must be finite real numbers between −100 and 100 eV.');
    return { label: t.label, coefficient: t.coefficient };
  });
  if (new Set(terms.map(t => t.label)).size !== terms.length) throw new Error('Combine duplicate Pauli labels before loading.');
  if (terms.every(t => t.coefficient === 0)) throw new Error('At least one coefficient must be nonzero.');
  return { name: (v.name as string | undefined)?.trim() ?? 'Custom Hamiltonian', qubits, terms };
}
export function parseHamiltonian(text: string): CustomHamiltonian {
  if (text.length > 16000) throw new Error('Hamiltonian JSON must be at most 16 kB.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid JSON. Check commas, quotes and brackets.'); }
  return validateHamiltonian(value);
}
const mul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
function compile(label: string) {
  return Array.from({ length: 1 << label.length }, (_, source) => {
    let target = source, phase: Complex = { re: 1, im: 0 };
    [...label].forEach((symbol, q) => {
      const bit = 1 << (label.length - 1 - q), occupied = !!(source & bit);
      if (symbol === 'X' || symbol === 'Y') target ^= bit;
      if (symbol === 'Y') phase = mul(phase, { re: 0, im: occupied ? -1 : 1 });
      if (symbol === 'Z' && occupied) phase = { re: -phase.re, im: -phase.im };
    });
    return { target, phase };
  });
}
export function customMatrix(input: CustomHamiltonian): Complex[][] {
  const h = validateHamiltonian(input), n = 1 << h.qubits;
  const matrix = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ re: 0, im: 0 })));
  for (const t of h.terms) compile(t.label).forEach(({ target, phase }, source) => {
    matrix[target][source] = add(matrix[target][source], { re: phase.re * t.coefficient, im: phase.im * t.coefficient });
  });
  return matrix;
}
/** Realification [Re H, -Im H; Im H, Re H], then complex Gram-Schmidt removes duplicate eigenvectors. */
export function solveCustomHamiltonian(input: CustomHamiltonian) {
  const h = customMatrix(input), n = h.length;
  const block = Array.from({ length: n * 2 }, (_, i) => Array.from({ length: n * 2 }, (_, j) =>
    i < n ? (j < n ? h[i][j].re : -h[i][j - n].im) : (j < n ? h[i - n][j].im : h[i - n][j - n].re)));
  const eig = new EigenvalueDecomposition(new Matrix(block), { assumeSymmetric: true });
  const order = eig.realEigenvalues.map((_, i) => i).sort((a, b) => eig.realEigenvalues[a] - eig.realEigenvalues[b]);
  const vectors: Complex[][] = [], eigenvalues: number[] = [];
  for (const k of order) {
    let v = Array.from({ length: n }, (_, j) => ({ re: eig.eigenvectorMatrix.get(j, k), im: eig.eigenvectorMatrix.get(j + n, k) }));
    for (const previous of vectors) {
      const projection = inner(previous, v);
      v = v.map((z, j) => { const part = mul(previous[j], projection); return { re: z.re - part.re, im: z.im - part.im }; });
    }
    const norm = Math.sqrt(inner(v, v).re);
    if (norm > 1e-7) {
      vectors.push(v.map(z => ({ re: z.re / norm, im: z.im / norm })));
      eigenvalues.push(eig.realEigenvalues[k]);
    }
    if (vectors.length === n) break;
  }
  if (vectors.length !== n) throw new Error('The eigensolver could not resolve an orthogonal basis.');
  return { h, eigenvalues, vectors };
}
export function evolveCustomExact(initial: Complex[], eigenvalues: number[], vectors: Complex[][], time: number, reference = 0) {
  const coefficients = vectors.map((v, k) => mul(inner(v, initial), { re: Math.cos((eigenvalues[k] - reference) * time), im: -Math.sin((eigenvalues[k] - reference) * time) }));
  return initial.map((_, j) => coefficients.reduce((sum, c, k) => add(sum, mul(vectors[k][j], c)), { re: 0, im: 0 }));
}
export function evolveCustomTrotter(initial: Complex[], terms: PauliTerm[], time: number, steps: number, reference = 0) {
  let re = Float64Array.from(initial, z => z.re), im = Float64Array.from(initial, z => z.im);
  let rr = new Float64Array(re.length), ii = new Float64Array(re.length);
  const compiled = terms.map(t => ({ map: compile(t.label), c: Math.cos(t.coefficient * time / steps), s: Math.sin(t.coefficient * time / steps) }));
  for (let step = 0; step < steps; step++) for (const { map, c, s } of compiled) {
    for (let source = 0; source < re.length; source++) {
      const { target, phase } = map[source];
      const pr = phase.re * re[source] - phase.im * im[source], pi = phase.re * im[source] + phase.im * re[source];
      rr[target] = c * re[target] + s * pi;
      ii[target] = c * im[target] - s * pr;
    }
    [re, rr] = [rr, re]; [im, ii] = [ii, im];
  }
  const phase = { re: Math.cos(reference * time), im: Math.sin(reference * time) };
  return Array.from(re, (r, i) => mul({ re: r, im: im[i] }, phase));
}
export function simulateCustomQuantum(input: QuantumParams, supplied: unknown): QuantumResult {
  const custom = validateHamiltonian(supplied);
  const p = { ...validateQuantumParams({ ...input, qubits: Math.max(2, custom.qubits) }), qubits: custom.qubits };
  const { h, eigenvalues, vectors } = solveCustomHamiltonian(custom), n = h.length, groundEnergy = eigenvalues[0], groundState = vectors[0];
  const initial = groundState.map((_, j) => ({ ...groundState[j ^ (1 << (p.qubits - 1))] }));
  const weights = vectors.map(v => { const a = inner(v, initial); return a.re ** 2 + a.im ** 2; });
  const transitions = eigenvalues.map((e, k) => ({ energy: Math.max(0, e - groundEnergy), weight: weights[k], kind: (e - groundEnergy < 1e-9 ? 'elastic' : 'inelastic') as 'elastic' | 'inelastic' })).filter(t => t.weight > 1e-12);
  const times = Array.from({ length: p.samples }, (_, i) => i * p.timeMax / (p.samples - 1));
  const correlationReal: number[] = [], correlationImag: number[] = [], trotterReal: number[] = [], trotterImag: number[] = [], fidelity: number[] = [];
  let normError = 0, groundResidual = 0, hermiticityError = 0, unitarityError = 0;
  for (const t of times) {
    const exact = evolveCustomExact(initial, eigenvalues, vectors, t, groundEnergy), approximate = evolveCustomTrotter(initial, custom.terms, t, p.trotterSteps, groundEnergy);
    const c = inner(initial, exact), a = inner(initial, approximate), f = inner(exact, approximate);
    correlationReal.push(c.re); correlationImag.push(c.im); trotterReal.push(a.re); trotterImag.push(a.im);
    fidelity.push(Math.min(1, Math.max(0, f.re ** 2 + f.im ** 2)));
    normError = Math.max(normError, Math.abs(inner(exact, exact).re - 1), Math.abs(inner(approximate, approximate).re - 1));
  }
  for (let i = 0; i < n; i++) {
    const hg = h[i].reduce((sum, v, j) => add(sum, mul(v, groundState[j])), { re: 0, im: 0 });
    groundResidual = Math.max(groundResidual, Math.hypot(hg.re - groundEnergy * groundState[i].re, hg.im - groundEnergy * groundState[i].im));
    for (let j = 0; j < n; j++) hermiticityError = Math.max(hermiticityError, Math.hypot(h[i][j].re - h[j][i].re, h[i][j].im + h[j][i].im));
  }
  const columns = Array.from({ length: n }, (_, k) => evolveCustomExact(Array.from({ length: n }, (_, j) => ({ re: j === k ? 1 : 0, im: 0 })), eigenvalues, vectors, p.timeMax, groundEnergy));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const z = inner(columns[i], columns[j]); unitarityError = Math.max(unitarityError, Math.hypot(z.re - (i === j ? 1 : 0), z.im)); }
  const fft = reconstructSpectrum(correlationReal, correlationImag, p), tf = reconstructSpectrum(trotterReal, trotterImag, p);
  const reference = fft.energy.map(e => transitions.reduce((sum, t) => sum + t.weight * p.broadening / (Math.PI * ((e - t.energy) ** 2 + p.broadening ** 2)), 0));
  const area = (v: number[]) => v.reduce((sum, x, i) => sum + x * fft.spacing * (i === 0 || i === v.length - 1 ? .5 : 1), 0);
  const groundDegeneracy = eigenvalues.filter(e => Math.abs(e - groundEnergy) < 1e-9).length;
  const caveats = ['User-supplied Pauli Hamiltonian in eV; coefficients do not establish a material model.', 'D = X0 is a fixed unitary kick; elastic weight is retained. It is not a supplied physical dipole.', 'First-order product formula follows term order in the JSON. Gate synthesis and hardware cost are not calculated.', 'One-sided positive-sign FFT with lifetime damping. Signed arrays are retained; displayed absorption is clipped at zero.'];
  if (Math.max(...transitions.map(t => t.energy)) > fft.nyquist) caveats.push('ALIASING WARNING: a transition exceeds the Nyquist energy. Increase samples or shorten time.');
  if (groundDegeneracy > 1) caveats.push('DEGENERATE GROUND SPACE: one ground eigenvector is selected, without averaging.');
  return {
    engine: 'Complex Hermitian diagonalization + first-order Pauli evolution', provenance: 'exact-toy', params: p, customHamiltonian: custom, terms: custom.terms,
    groundEnergy, groundState, eigenvalues, transitions, times, correlationReal, correlationImag, trotterReal, trotterImag, fidelity, finalFidelity: fidelity.at(-1)!,
    spectralEnergy: fft.energy, spectrumReference: reference, spectrumFourierSigned: fft.signed, spectrumFourierClipped: fft.clipped, spectrumTrotterSigned: tf.signed, spectrumTrotterClipped: tf.clipped,
    circuit: [], resources: { gatesPerStep: 0, depth: 0, entanglingGates: 0, steps: p.trotterSteps, convention: 'Not compiled for custom Hamiltonians; zeros are placeholders, not cost estimates.' },
    validation: { hermiticityError, normError, unitarityError, groundResidual, correlationAtZeroError: Math.hypot(correlationReal[0] - 1, correlationImag[0]), transitionWeightError: Math.abs(weights.reduce((a, b) => a + b, 0) - 1),
      fftMinimum: fft.minimum, negativeBins: fft.negativeBins, clippedArea: fft.clippedArea, resolution: 2 * Math.PI / p.timeMax, paddedGridSpacing: fft.spacing, nyquist: fft.nyquist,
      spectralL1TrotterVsExact: area(fft.signed.map((v, i) => Math.abs(tf.signed[i] - v))) / Math.max(1e-15, area(fft.signed.map(Math.abs))),
      spectralL1FourierVsReference: area(fft.signed.map((v, i) => Math.abs(v - reference[i]))) / Math.max(1e-15, area(reference)),
      spectralRmseFourierVsReference: Math.sqrt(fft.signed.reduce((sum, v, i) => sum + (v - reference[i]) ** 2, 0) / reference.length),
      groundGap: eigenvalues[1] - groundEnergy, groundDegeneracy, trotterFftMinimum: tf.minimum, trotterNegativeBins: tf.negativeBins, trotterClippedArea: tf.clippedArea },
    caveats,
  };
}
