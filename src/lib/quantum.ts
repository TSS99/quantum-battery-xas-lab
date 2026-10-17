import { EigenvalueDecomposition, Matrix } from 'ml-matrix';

/** All energies are a toy eV scale. Time is eV^-1, with hbar = 1. */
export interface QuantumParams {
  qubits: number;
  coupling: number;
  field: number;
  timeMax: number;
  samples: number;
  trotterSteps: number;
  broadening: number;
  window: 'cosine' | 'none';
  padding: number;
}

export interface PauliTerm { label: string; coefficient: number }
export interface Complex { re: number; im: number }
export interface CircuitGate { gate: 'Rz' | 'Rx' | 'CX'; qubits: number[]; angle?: number; termIndex: number }
export interface QuantumResult {
  customHamiltonian?: { name: string; qubits: number; terms: PauliTerm[] };
  engine: string;
  provenance: 'exact-toy';
  params: QuantumParams;
  terms: PauliTerm[];
  groundEnergy: number;
  groundState: Complex[];
  eigenvalues: number[];
  transitions: { energy: number; weight: number; kind: 'elastic' | 'inelastic' }[];
  times: number[];
  correlationReal: number[];
  correlationImag: number[];
  trotterReal: number[];
  trotterImag: number[];
  fidelity: number[];
  finalFidelity: number;
  spectralEnergy: number[];
  spectrumReference: number[];
  spectrumFourierSigned: number[];
  spectrumFourierClipped: number[];
  spectrumTrotterSigned: number[];
  spectrumTrotterClipped: number[];
  circuit: CircuitGate[];
  resources: { gatesPerStep: number; depth: number; entanglingGates: number; steps: number; convention: string };
  validation: {
    hermiticityError: number; normError: number; unitarityError: number; groundResidual: number;
    correlationAtZeroError: number; transitionWeightError: number; fftMinimum: number;
    negativeBins: number; clippedArea: number; resolution: number; paddedGridSpacing: number;
    nyquist: number; spectralL1TrotterVsExact: number; spectralL1FourierVsReference: number;
    spectralRmseFourierVsReference: number; expmError?: number;
    groundGap: number; groundDegeneracy: number; trotterFftMinimum: number;
    trotterNegativeBins: number; trotterClippedArea: number;
  };
  caveats: string[];
}

export const defaultQuantumParams: QuantumParams = {
  qubits: 2, coupling: 0.35, field: 0.7, timeMax: 40, samples: 256,
  trotterSteps: 24, broadening: 0.12, window: 'cosine', padding: 4,
};

export function validateQuantumParams(value: unknown): QuantumParams {
  if (!value || typeof value !== 'object') throw new Error('Quantum parameters must be an object.');
  const p = value as QuantumParams;
  const ranges: [keyof QuantumParams, number, number, boolean][] = [
    ['qubits', 2, 6, true], ['coupling', -1, 1, false], ['field', 0, 2, false],
    ['timeMax', 5, 120, false], ['samples', 64, 512, true], ['trotterSteps', 1, 128, true],
    ['broadening', 0.02, 1, false], ['padding', 1, 8, true],
  ];
  for (const [key, min, max, integer] of ranges) {
    const n = p[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)))
      throw new Error(`${key} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`);
  }
  if (![64, 128, 256, 512].includes(p.samples)) throw new Error('samples must be 64, 128, 256 or 512.');
  if (![1, 2, 4, 8].includes(p.padding)) throw new Error('padding must be 1, 2, 4 or 8.');
  if (!['cosine', 'none'].includes(p.window)) throw new Error('window must be cosine or none.');
  return { qubits:p.qubits, coupling:p.coupling, field:p.field, timeMax:p.timeMax, samples:p.samples,
    trotterSteps:p.trotterSteps, broadening:p.broadening, window:p.window, padding:p.padding };
}

/** q0 is the leftmost / most significant bit. This model contains only X and Z. */
export function pauliTerms(p: QuantumParams): PauliTerm[] {
  const label = (indices: number[], symbol: string) => Array.from({ length: p.qubits }, (_, i) => indices.includes(i) ? symbol : 'I').join('');
  return [
    ...Array.from({ length: p.qubits }, (_, i) => ({ label: label([i], 'Z'), coefficient: p.field * (1 + 0.13 * i) })),
    ...Array.from({ length: p.qubits - 1 }, (_, i) => ({ label: label([i, i + 1], 'X'), coefficient: p.coupling })),
    ...Array.from({ length: p.qubits }, (_, i) => ({ label: label([i], 'X'), coefficient: 0.17 })),
  ];
}

function masks(label: string): { flip: number; z: number } {
  let flip = 0, z = 0;
  for (let q = 0; q < label.length; q++) {
    if (label[q] === 'X') flip |= 1 << (label.length - q - 1);
    else if (label[q] === 'Z') z |= 1 << (label.length - q - 1);
    else if (label[q] !== 'I') throw new Error('This effective model supports I, X and Z terms.');
  }
  return { flip, z };
}
function parity(n: number): number { let sign = 1; while (n) { sign = -sign; n &= n - 1; } return sign; }

export function hamiltonianMatrix(p: QuantumParams): number[][] {
  const dimension = 1 << p.qubits;
  const h = Array.from({ length: dimension }, () => Array<number>(dimension).fill(0));
  for (const term of pauliTerms(p)) {
    const { flip, z } = masks(term.label);
    for (let j = 0; j < dimension; j++) h[j ^ flip][j] += term.coefficient * parity(j & z);
  }
  return h;
}

export function solveHamiltonian(p: QuantumParams) {
  const h = hamiltonianMatrix(p);
  const eig = new EigenvalueDecomposition(new Matrix(h), { assumeSymmetric: true });
  const rawValues = eig.realEigenvalues;
  const order = rawValues.map((_, i) => i).sort((a, b) => rawValues[a] - rawValues[b]);
  const vectors = eig.eigenvectorMatrix.to2DArray().map(row => order.map(i => row[i]));
  return { h, eigenvalues: order.map(i => rawValues[i]), vectors };
}

/** Exact dense propagation, useful for independent unitary tests as well as the worker. */
export function evolveExact(initial: Complex[], eigenvalues: number[], vectors: number[][], time: number, energyReference = 0): Complex[] {
  const n = initial.length;
  const amplitudes = eigenvalues.map((e, k) => {
    let re = 0, im = 0;
    for (let j = 0; j < n; j++) { re += vectors[j][k] * initial[j].re; im += vectors[j][k] * initial[j].im; }
    const angle = (e - energyReference) * time, c = Math.cos(angle), s = Math.sin(angle);
    return { re: re * c + im * s, im: im * c - re * s };
  });
  return initial.map((_, j) => amplitudes.reduce((acc, a, k) => ({ re: acc.re + vectors[j][k] * a.re, im: acc.im + vectors[j][k] * a.im }), { re: 0, im: 0 }));
}

export function evolveTrotter(initial: Complex[], terms: PauliTerm[], time: number, steps: number, energyReference = 0): Complex[] {
  let re = Float64Array.from(initial, z => z.re), im = Float64Array.from(initial, z => z.im);
  let outRe = new Float64Array(re.length), outIm = new Float64Array(re.length);
  const compiled = terms.map(term => ({ ...masks(term.label), c: Math.cos(term.coefficient * time / steps), s: Math.sin(term.coefficient * time / steps) }));
  for (let step = 0; step < steps; step++) {
    for (const { flip, z, c, s } of compiled) {
      for (let j = 0; j < re.length; j++) {
        const source = j ^ flip, sign = parity(source & z);
        outRe[j] = c * re[j] + s * sign * im[source];
        outIm[j] = c * im[j] - s * sign * re[source];
      }
      [re, outRe] = [outRe, re]; [im, outIm] = [outIm, im];
    }
  }
  const c = Math.cos(energyReference * time), s = Math.sin(energyReference * time);
  return Array.from(re, (r, j) => ({ re: c * r - s * im[j], im: s * r + c * im[j] }));
}

export function inner(a: Complex[], b: Complex[]): Complex {
  return a.reduce((sum, z, i) => ({ re: sum.re + z.re * b[i].re + z.im * b[i].im,
    im: sum.im + z.re * b[i].im - z.im * b[i].re }), { re: 0, im: 0 });
}

/** Unnormalised positive-sign radix-2 FFT: sum_j z[j] exp(+2 pi i j k / N). */
function positiveFFT(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = 2 * Math.PI / size;
    for (let offset = 0; offset < n; offset += size) {
      for (let j = 0; j < size / 2; j++) {
        const a = offset + j, b = a + size / 2, c = Math.cos(angle * j), s = Math.sin(angle * j);
        const br = re[b] * c - im[b] * s, bi = re[b] * s + im[b] * c;
        re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi;
      }
    }
  }
}

export function reconstructSpectrum(real: number[], imaginary: number[], p: QuantumParams) {
  const dt = p.timeMax / (p.samples - 1), n = p.samples * p.padding;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < p.samples; i++) {
    const t = i * dt;
    const taper = p.window === 'cosine' ? 0.5 * (1 + Math.cos(Math.PI * t / p.timeMax)) : 1;
    const weight = Math.exp(-p.broadening * t) * taper * ((i === 0 || i === p.samples - 1) ? 0.5 : 1);
    re[i] = real[i] * weight; im[i] = imaginary[i] * weight;
  }
  positiveFFT(re, im);
  const spacing = 2 * Math.PI / (n * dt);
  const energy = Array.from({ length: n / 2 + 1 }, (_, k) => k * spacing);
  const signed = energy.map((_, k) => re[k] * dt / Math.PI);
  return { energy, signed, clipped: signed.map(y => Math.max(0, y)), spacing, nyquist: Math.PI / dt,
    minimum: Math.min(...signed), negativeBins: signed.filter(y => y < -1e-12).length,
    clippedArea: signed.reduce((sum, y, i) => sum + Math.max(0, -y) * spacing * ((i === 0 || i === signed.length - 1) ? 0.5 : 1), 0) };
}

/** Circuit is one chronological product-formula step, evaluated at final time. */
export function buildCircuit(terms: PauliTerm[], p: QuantumParams): CircuitGate[] {
  return terms.flatMap((term, termIndex): CircuitGate[] => {
    const indices = [...term.label].flatMap((s, q) => s === 'I' ? [] : [q]);
    const angle = 2 * term.coefficient * p.timeMax / p.trotterSteps;
    if (indices.length === 1) return [{ gate: term.label[indices[0]] === 'Z' ? 'Rz' : 'Rx', qubits: indices, angle, termIndex }];
    // CX(control, target) Rx(control) CX(control, target) = exp(-i angle XX/2).
    return [{ gate: 'CX', qubits: indices, termIndex }, { gate: 'Rx', qubits: [indices[0]], angle, termIndex }, { gate: 'CX', qubits: indices, termIndex }];
  });
}

export function simulateQuantum(input: QuantumParams): QuantumResult {
  const p = validateQuantumParams(input), terms = pauliTerms(p);
  const { h, eigenvalues, vectors } = solveHamiltonian(p);
  const n = eigenvalues.length, groundEnergy = eigenvalues[0];
  const groundState = vectors.map(row => ({ re: row[0], im: 0 }));
  const initial = groundState.map((_, j) => ({ ...groundState[j ^ (1 << (p.qubits - 1))] }));
  const weights = eigenvalues.map((_, k) => vectors.reduce((sum, row, j) => sum + row[k] * initial[j].re, 0) ** 2);
  const transitions = eigenvalues.map((e, k) => ({ energy: Math.max(0, e - groundEnergy), weight: weights[k],
    kind: (e - groundEnergy < 1e-9 ? 'elastic' : 'inelastic') as 'elastic' | 'inelastic' })).filter(t => t.weight > 1e-12);
  const times = Array.from({ length: p.samples }, (_, i) => i * p.timeMax / (p.samples - 1));
  const correlationReal: number[] = [], correlationImag: number[] = [], trotterReal: number[] = [], trotterImag: number[] = [], fidelity: number[] = [];
  let normError = 0;
  for (const t of times) {
    const exact = evolveExact(initial, eigenvalues, vectors, t, groundEnergy);
    const approximate = evolveTrotter(initial, terms, t, p.trotterSteps, groundEnergy);
    const c = inner(initial, exact), tc = inner(initial, approximate), overlap = inner(exact, approximate);
    correlationReal.push(c.re); correlationImag.push(c.im); trotterReal.push(tc.re); trotterImag.push(tc.im);
    fidelity.push(Math.min(1, Math.max(0, overlap.re ** 2 + overlap.im ** 2)));
    normError = Math.max(normError, Math.abs(inner(exact, exact).re - 1), Math.abs(inner(approximate, approximate).re - 1));
  }
  let hermiticityError = 0, unitarityError = 0, groundResidual = 0;
  for (let i = 0; i < n; i++) {
    groundResidual = Math.max(groundResidual, Math.abs(h[i].reduce((sum, value, j) => sum + value * groundState[j].re, 0) - groundEnergy * groundState[i].re));
    for (let j = 0; j < n; j++) {
      hermiticityError = Math.max(hermiticityError, Math.abs(h[i][j] - h[j][i]));
    }
  }
  const propagatorColumns = Array.from({ length: n }, (_, column) => evolveExact(
    Array.from({ length: n }, (_, row) => ({ re: row === column ? 1 : 0, im: 0 })), eigenvalues, vectors, p.timeMax, groundEnergy));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const overlap = inner(propagatorColumns[i], propagatorColumns[j]);
    unitarityError = Math.max(unitarityError, Math.hypot(overlap.re - (i === j ? 1 : 0), overlap.im));
  }
  const fft = reconstructSpectrum(correlationReal, correlationImag, p);
  const trotterFft = reconstructSpectrum(trotterReal, trotterImag, p);
  const reference = fft.energy.map(e => transitions.reduce((sum, t) => sum + t.weight * p.broadening / (Math.PI * ((e - t.energy) ** 2 + p.broadening ** 2)), 0));
  const area = (values: number[]) => values.reduce((sum, value, i) => sum + value * fft.spacing * ((i === 0 || i === values.length - 1) ? 0.5 : 1), 0);
  const spectralL1TrotterVsExact = area(fft.signed.map((v, i) => Math.abs(trotterFft.signed[i] - v))) / Math.max(1e-15, area(fft.signed.map(Math.abs)));
  const spectralL1FourierVsReference = area(fft.signed.map((v, i) => Math.abs(v - reference[i]))) / Math.max(1e-15, area(reference));
  const spectralRmseFourierVsReference = Math.sqrt(fft.signed.reduce((sum, v, i) => sum + (v - reference[i]) ** 2, 0) / reference.length);
  const circuit = buildCircuit(terms, p);
  const maxGap = Math.max(...transitions.map(t => t.energy));
  const groundDegeneracy = eigenvalues.filter(e => Math.abs(e - groundEnergy) < 1e-9).length;
  const caveats = [
    'Exactly solved effective spin model with D = X0; not an ab initio MnO6 core-level XAS calculation.',
    'Toy energies are eV and times are eV^-1 with hbar = 1 (multiply time by 0.6582119569 for fs). No mapping to the Mn K edge.',
    'q0 is the most significant bit. Terms and circuit gates are applied in their displayed chronological order; the ground-energy reference contributes only a global phase.',
    'The X0 excitation is unitary in this toy model. A physical many-body dipole operator and its state preparation are generally not unitary.',
    'The zero-energy elastic weight |<g|X0|g>|² is retained and labeled; it is not an absorption excitation. The dipole expectation is not subtracted in this convention.',
    'First-order Trotter fidelity is evaluated on D|g>, not averaged over inputs; it need not improve monotonically at every time.',
    'Circuit resources count the displayed unoptimized serial decomposition, including zero-angle gates; ground-state preparation, excitation, measurement and routing are excluded.',
    'Fourier reconstruction uses positive-sign FFT, exponential lifetime damping and a stated time window. Negative finite-window values are retained separately; the absorption display is clipped with its removed area reported.',
    'Zero padding refines the plotted grid, not the physical resolution. Cosine taper further broadens peaks; the positive Lorentzian reference has lifetime broadening only.',
    'Spectral L1 diagnostics integrate absolute differences on the returned nonnegative energy grid. Fourier/reference mismatch includes finite-time window and sampling effects. Trotter spectra use the same window and damping as exact spectra.',
    'These are classical numerical simulations. No quantum hardware execution or quantum advantage is claimed.',
  ];
  if (maxGap > fft.nyquist) caveats.push('ALIASING WARNING: at least one nonzero-weight transition exceeds the Nyquist energy. Increase samples or reduce timeMax.');
  if (groundDegeneracy > 1) caveats.push('DEGENERATE GROUND SPACE: this run uses one normalized eigenvector returned by the eigensolver, not an incoherent ground-space average. Another solver may select a different ground-state vector.');
  return {
    engine: 'Browser exact diagonalization (ml-matrix) + first-order Pauli product formula', provenance: 'exact-toy', params: p, terms,
    groundEnergy, groundState, eigenvalues, transitions, times, correlationReal, correlationImag, trotterReal, trotterImag, fidelity,
    finalFidelity: fidelity[fidelity.length - 1], spectralEnergy: fft.energy,
    spectrumReference: reference, spectrumFourierSigned: fft.signed, spectrumFourierClipped: fft.clipped,
    spectrumTrotterSigned: trotterFft.signed, spectrumTrotterClipped: trotterFft.clipped, circuit,
    resources: { gatesPerStep: circuit.length, depth: circuit.length * p.trotterSteps,
      entanglingGates: circuit.filter(g => g.gate === 'CX').length * p.trotterSteps, steps: p.trotterSteps,
      convention: 'Serial unoptimized CX–Rx–CX decomposition of XX; no state preparation, excitation, measurement or routing.' },
    validation: { hermiticityError, normError, unitarityError, groundResidual,
      correlationAtZeroError: Math.hypot(correlationReal[0] - 1, correlationImag[0]),
      transitionWeightError: Math.abs(weights.reduce((a, b) => a + b, 0) - 1),
      fftMinimum: fft.minimum, negativeBins: fft.negativeBins, clippedArea: fft.clippedArea,
      resolution: 2 * Math.PI / p.timeMax, paddedGridSpacing: fft.spacing, nyquist: fft.nyquist,
      spectralL1TrotterVsExact, spectralL1FourierVsReference, spectralRmseFourierVsReference,
      groundGap: eigenvalues[1] - groundEnergy, groundDegeneracy,
      trotterFftMinimum: trotterFft.minimum, trotterNegativeBins: trotterFft.negativeBins,
      trotterClippedArea: trotterFft.clippedArea }, caveats,
  };
}
