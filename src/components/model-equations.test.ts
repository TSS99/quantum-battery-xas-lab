import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import katex from 'katex';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { MODEL_EQUATIONS, ModelEquations } from './model-equations';
import { mu as batteryMu, nominalMnOxidation, sampleCounts, transmission, type XASParams } from '@/lib/xas';
import { edgeStep, elementInfo, elementMuOverRho, loadXrayData, massFractions, mu, muAcrossEdge, recommendMode, recommendThickness } from '@/lib/xraydata';
import { modelSpectrum } from '@/lib/xas-general';
import { derivativeSpectrum, estimateEdge, fitSpectrum, normalizeSpectrum, type Spectrum } from '@/lib/spectra';
import { compareSpectra, ranks } from '@/lib/comparison';
import { defaultQuantumParams, evolveTrotter, hamiltonianMatrix, pauliTerms, simulateQuantum, solveHamiltonian, type Complex, type PauliTerm } from '@/lib/quantum';
import { HAMILTONIAN_EXAMPLE, evolveCustomTrotter } from '@/lib/custom-hamiltonian';

const entries = MODEL_EQUATIONS.flatMap(group => group.equations);
const close = (actual: number, expected: number, tolerance = 1e-12) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(expected)));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const spectrum = (energy_eV: number[], mu_cm_inv: number[], sigma_mu_cm_inv?: number[]): Spectrum => ({ id: 'test', name: 'test', provenance: 'synthetic', energy_eV, mu_cm_inv, sigma_mu_cm_inv });
const trapezoid = (x: number[], y: number[]) => sum(y.slice(1).map((v, i) => (x[i + 1] - x[i]) * (v + y[i]) / 2));

describe('model equations panel', () => {
  it('cites functions that exist', () => {
    for (const entry of entries) for (const source of entry.sources) {
      const [file, names] = source.split(': ');
      const path = ['src/lib', 'src/components'].map(dir => join(process.cwd(), dir, file)).find(existsSync);
      expect(path, source).toBeTruthy();
      const text = readFileSync(path!, 'utf8');
      for (const name of names.split(', ')) expect(text, source).toMatch(new RegExp(`(?:function|const) ${name}\\b`));
    }
  });
  it('typesets every line strictly and renders without KaTeX errors', () => {
    for (const entry of entries) for (const line of entry.lines) expect(() => katex.renderToString(line, { throwOnError: true, strict: 'error' }), line).not.toThrow();
    const html = renderToStaticMarkup(createElement(ModelEquations));
    expect(html).not.toContain('katex-error');
    expect(html).not.toContain('—');
    expect(html.match(/<h3>/g)).toHaveLength(MODEL_EQUATIONS.length);
  });
});

describe('the listed equations reproduce the code', () => {
  beforeAll(async () => { await loadXrayData(); });

  it('mixture rule, transmission and counts', () => {
    const counts: Record<string, number> = { Cu: 1, S: 1, O: 9, H: 10 }, total = sum(Object.entries(counts).map(([el, n]) => n * elementInfo(el).molarMass));
    const w = massFractions('CuSO4·5H2O');
    for (const [el, n] of Object.entries(counts)) close(w[el], n * elementInfo(el).molarMass / total);
    close(mu('CuSO4·5H2O', 2.286, 9000).total, 2.286 * sum(Object.entries(w).map(([el, wj]) => wj * elementMuOverRho(el, 9000).total)));
    const t = transmission(120, 35, 1e5);
    close(t.expectedTransmitted, 1e5 * Math.exp(-120 * 35e-4));
    close(t.opticalDepth, Math.log(t.expectedIncident / t.expectedTransmitted));
    const c = sampleCounts(80, 50, 2000, 7);
    close(c.apparentMu!, Math.log(c.incident / c.transmitted) / 50e-4);
    expect(sampleCounts(1e6, 1000, 10, 1).apparentMu).toBeNull();
  });

  it('edge step, suggested thickness and measurement mode', () => {
    const pure = edgeStep('Fe', 'Fe', 'K', 7.874), mixed = edgeStep('Fe2O3', 'Fe', 'K', 5.24);
    close(mixed.deltaMuOverRho, mixed.absorberMassFraction * pure.deltaMuOverRho, 1e-10);
    close(mixed.deltaMu_cm_inv, 5.24 * mixed.deltaMuOverRho);
    const limits = new Set<string>();
    for (const [formula, density, absorber, edge] of [['Fe2O3', 5.24, 'Fe', 'K'], ['FeC1000', 2, 'Fe', 'K'], ['Al2O3', 3.95, 'Al', 'K']] as const) {
      const plan = recommendThickness(formula, absorber, edge, density), s = plan.edgeStep;
      const mA = Math.min(1 / s.deltaMuOverRho, 3 / s.muOverRhoAbove);
      close(plan.massPerArea_mg_cm2, mA * 1000);
      close(plan.thickness_um, mA / density * 1e4);
      close(plan.sampleMass_mg, mA * Math.PI * 0.65 ** 2 * 1000);
      close(plan.achievedEdgeStep, mA * s.deltaMuOverRho);
      close(plan.totalAbsorptionAbove, mA * s.muOverRhoAbove);
      limits.add(plan.limitedBy);
      const mode = recommendMode(formula, absorber, edge), sMax = Math.min(1, 3 * s.deltaMuOverRho / s.muOverRhoAbove);
      close(mode.achievableEdgeStep, sMax);
      expect(mode.mode).toBe(s.edgeEnergy_eV >= 2000 && sMax >= 0.3 ? 'transmission' : 'fluorescence');
    }
    expect([...limits].sort()).toEqual(['edge-step', 'total-absorption']);
  });

  it('battery teaching spectrum and charge balance', () => {
    const p: XASParams = { x: 0.4, edge: 6552, shift: 2.5, width: 1.4, whiteLine: 70, preEdge: 12, oscillation: 0.1 };
    const e0 = p.edge - p.shift * p.x, G = (E: number, c: number, s: number) => Math.exp(-((E - c) ** 2) / (2 * s * s));
    for (const E of [6531, 6545.3, 6549.1, 6553, 6556, 6575]) {
      const eps = Math.max(0, E - e0), L = 1 / (1 + Math.exp(-(E - e0) / p.width)), M = 1 + p.oscillation * Math.sin(0.8 * eps) * Math.exp(-eps / 18);
      close(batteryMu(E, p), 18 + 110 * L * M + p.preEdge * G(E, e0 - 7, 0.8) + p.whiteLine * G(E, e0 + 4, 1.8));
    }
    close(nominalMnOxidation(0.3), 4 - 0.3);
  });

  it('near-edge model for any compound', () => {
    const s = modelSpectrum({ formula: 'Fe2O3', density: 5.24, absorber: 'Fe', edge: 'K', edgeShift_eV: 1.5 });
    const { tabulatedEdge_eV: tab, modelEdge_eV: e0, edgeWidth_eV: width, features: f } = s.metadata;
    expect(e0).toBe(tab + 1.5);
    expect(width).toBe(Math.max(0.3, 2e-4 * tab));
    expect(f).toEqual({ preEdgeHeight: 0.05, preEdgeOffset_eV: Math.max(2, 1.2e-3 * tab), preEdgeWidth_eV: Math.max(0.4, 1.5e-4 * tab), whiteLineHeight: 0.4, whiteLineOffset_eV: Math.max(1.5, 1e-3 * tab), whiteLineWidth_eV: Math.max(0.8, 4e-4 * tab), oscillation: 0.06, distance_A: 2, sigma2_A2: 0.008 });
    const G = (E: number, c: number, w: number) => Math.exp(-((E - c) ** 2) / (2 * w * w));
    s.energy_eV.forEach((E, i) => {
      const below = muAcrossEdge('Fe2O3', 5.24, 'Fe', 'K', E, 'below'), above = muAcrossEdge('Fe2O3', 5.24, 'Fe', 'K', E, 'above');
      const A = 0.5 + Math.atan((E - e0) / width) / Math.PI, k = Math.sqrt(0.2624684 * Math.max(0, E - e0));
      const S = A + f!.preEdgeHeight * G(E, e0 - f!.preEdgeOffset_eV, f!.preEdgeWidth_eV) + f!.whiteLineHeight * G(E, e0 + f!.whiteLineOffset_eV, f!.whiteLineWidth_eV)
        + (E > e0 ? f!.oscillation * A * Math.sin(2 * k * f!.distance_A) * Math.exp(-2 * f!.sigma2_A2 * k * k) : 0);
      close(s.mu_cm_inv[i], below + (above - below) * S);
    });
  });

  it('edge estimators', () => {
    const E = Array.from({ length: 25 }, (_, i) => 6540 + i + 0.3 * Math.sin(i)), y = E.map(e => 20 + 100 / (1 + Math.exp(-(e - 6552) / 1.5)));
    const curve = spectrum(E, y), d = derivativeSpectrum(curve), doc = [(y[1] - y[0]) / (E[1] - E[0])];
    for (let i = 1; i < E.length - 1; i++) {
      const hm = E[i] - E[i - 1], hp = E[i + 1] - E[i];
      doc.push(-hp * y[i - 1] / (hm * (hm + hp)) + (hp - hm) * y[i] / (hm * hp) + hm * y[i + 1] / (hp * (hm + hp)));
    }
    doc.push((y[24] - y[23]) / (E[24] - E[23]));
    doc.forEach((v, i) => close(d[i], v));
    expect(estimateEdge(curve)).toBe(E[doc.indexOf(Math.max(...doc))]);
    const m = Math.max(1, Math.floor(E.length / 10)), pre = sum(y.slice(0, m)) / m, post = sum(y.slice(-m)) / m, n = y.map(v => (v - pre) / (post - pre));
    normalizeSpectrum(curve).forEach((v, i) => close(v, n[i]));
    const i = n.findIndex((v, j) => j > 0 && n[j - 1] <= 0.5 && v >= 0.5 && v > n[j - 1]);
    close(estimateEdge(curve, 'half-height')!, E[i - 1] + (0.5 - n[i - 1]) / (n[i] - n[i - 1]) * (E[i] - E[i - 1]));
  });

  it('similarity scores and residual errors', () => {
    expect(ranks([3, 1, 3, 2])).toEqual([3.5, 1, 3.5, 2]);
    const refE = Array.from({ length: 41 }, (_, i) => i), refMu = refE.map(e => 10 + 5 * Math.tanh((e - 20) / 3) + 0.1 * e);
    const selE = Array.from({ length: 27 }, (_, i) => 0.3 + 1.5 * i), selMu = selE.map(e => 11 + 5.5 * Math.tanh((e - 21) / 3) + 0.3 * Math.sin(e));
    const s = 0.4, out = compareSpectra(spectrum(refE, refMu), spectrum(selE, selMu), s, [5, 35]);
    const e: number[] = [], p: number[] = [], q: number[] = [];
    selE.forEach((energy, i) => {
      const x = energy + s;
      if (x < 5 || x > 35) return;
      const j = Math.min(Math.floor(x), 39);
      e.push(x); p.push(refMu[j] + (x - j) * (refMu[j + 1] - refMu[j])); q.push(selMu[i]);
    });
    const cos = (a: number[], b: number[]) => sum(a.map((v, i) => v * b[i])) / Math.sqrt(sum(a.map(v => v * v)) * sum(b.map(v => v * v)));
    const centre = (a: number[]) => a.map(v => v - sum(a) / a.length);
    const rank = (a: number[]) => a.map(v => 1 + a.filter(u => u < v).length + (a.filter(u => u === v).length - 1) / 2);
    const residual = q.map((v, i) => v - p[i]);
    expect(out.energies).toEqual(e);
    close(out.cosine!, cos(p, q));
    close(out.pearson!, cos(centre(p), centre(q)));
    close(out.spearman!, cos(centre(rank(p)), centre(rank(q))));
    close(out.relativeL1!, trapezoid(e, residual.map(Math.abs)) / trapezoid(e, p.map(Math.abs)));
    close(out.rmse, Math.sqrt(sum(residual.map(v => v * v)) / residual.length));
  });

  it('illustrative shape fit', () => {
    const params: XASParams = { x: 0.5, edge: 6550, shift: 3, width: 1.2, whiteLine: 65, preEdge: 10, oscillation: 0.06 };
    const E = Array.from({ length: 101 }, (_, i) => 6530 + 0.5 * i), sigma = E.map((_, i) => 0.5 + 0.01 * i);
    const y = E.map(e => 4 + 0.9 * batteryMu(e, { ...params, edge: params.edge + 1.3 }) + 0.5 * Math.sin(e));
    const fit = fitSpectrum({ ...spectrum(E, y, sigma), provenance: 'imported' }, params);
    const w = sigma.map(s => s ** -2), W = sum(w), mean = (v: number[]) => sum(v.map((x, i) => w[i] * x)) / W;
    const solve = (shift: number) => {
      const m = E.map(e => batteryMu(e, { ...params, edge: params.edge + shift })), mBar = mean(m), yBar = mean(y);
      const a = Math.max(0, sum(m.map((v, i) => w[i] * (v - mBar) * (y[i] - yBar))) / sum(m.map((v, i) => w[i] * (v - mBar) ** 2)));
      const b = yBar - a * mBar, fitted = m.map(v => b + a * v);
      return { a, b, fitted, Q: sum(y.map((v, i) => w[i] * (v - fitted[i]) ** 2)) };
    };
    expect(Math.abs(fit.shift_eV * 10 - Math.round(fit.shift_eV * 10))).toBeLessThan(1e-9);
    const best = solve(fit.shift_eV);
    close(fit.scale, best.a, 1e-9); close(fit.baseline_cm_inv, best.b, 1e-9);
    expect(best.Q).toBeLessThanOrEqual(solve(fit.shift_eV - 0.1).Q);
    expect(best.Q).toBeLessThanOrEqual(solve(fit.shift_eV + 0.1).Q);
    const residual = y.map((v, i) => v - best.fitted[i]);
    close(fit.rmse_cm_inv, Math.sqrt(sum(residual.map(r => r * r)) / y.length), 1e-9);
    close(fit.reducedChiSquare!, sum(residual.map((r, i) => (r / sigma[i]) ** 2)) / (y.length - 3), 1e-9);
  });
});

// Dense complex matrices with q0 as the leftmost (most significant) Kronecker factor.
type M = Complex[][];
const c = (re: number, im = 0): Complex => ({ re, im });
const mul = (a: Complex, b: Complex) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const PAULI: Record<string, M> = { I: [[c(1), c(0)], [c(0), c(1)]], X: [[c(0), c(1)], [c(1), c(0)]], Y: [[c(0), c(0, -1)], [c(0, 1), c(0)]], Z: [[c(1), c(0)], [c(0), c(-1)]] };
const kron = (a: M, b: M): M => a.flatMap(ra => b.map(rb => ra.flatMap(x => rb.map(y => mul(x, y)))));
const pauli = (label: string) => [...label].map(s => PAULI[s]).reduce(kron);
const apply = (m: M, v: Complex[]) => m.map(row => row.reduce((acc, x, j) => { const p = mul(x, v[j]); return c(acc.re + p.re, acc.im + p.im); }, c(0)));
const dot = (a: Complex[], b: Complex[]) => a.reduce((acc, x, i) => c(acc.re + x.re * b[i].re + x.im * b[i].im, acc.im + x.re * b[i].im - x.im * b[i].re), c(0));
/** The documented product formula: e^{iE_g t} [e^{-i c_M P_M t/r} ... e^{-i c_1 P_1 t/r}]^r v, with e^{-i theta P} = cos(theta) I - i sin(theta) P. */
function productFormula(v: Complex[], terms: PauliTerm[], t: number, r: number, eg: number) {
  let psi = v;
  for (let step = 0; step < r; step++) for (const term of terms) {
    const theta = term.coefficient * t / r, p = apply(pauli(term.label), psi);
    psi = psi.map((z, j) => c(Math.cos(theta) * z.re + Math.sin(theta) * p[j].im, Math.cos(theta) * z.im - Math.sin(theta) * p[j].re));
  }
  return psi.map(z => mul(z, c(Math.cos(eg * t), Math.sin(eg * t))));
}

describe('the listed quantum equations reproduce the code', () => {
  const p = { ...defaultQuantumParams, qubits: 3, coupling: 0.45, field: 0.8, timeMax: 30, samples: 64, padding: 2, trotterSteps: 6, broadening: 0.15 };
  const run = simulateQuantum(p);
  const n = p.qubits, N = p.samples, P = p.padding, T = p.timeMax, dt = T / (N - 1);
  const label = (sites: number[], s: string) => Array.from({ length: n }, (_, i) => sites.includes(i) ? s : 'I').join('');
  const documented: PauliTerm[] = [
    ...Array.from({ length: n }, (_, i) => ({ label: label([i], 'Z'), coefficient: p.field * (1 + 0.13 * i) })),
    ...Array.from({ length: n - 1 }, (_, i) => ({ label: label([i, i + 1], 'X'), coefficient: p.coupling })),
    ...Array.from({ length: n }, (_, i) => ({ label: label([i], 'X'), coefficient: 0.17 })),
  ];
  const { eigenvalues, vectors } = solveHamiltonian(p), eg = eigenvalues[0];
  const g = vectors.map(row => c(row[0])), v = apply(pauli('X' + 'I'.repeat(n - 1)), g);
  const weights = eigenvalues.map((_, k) => dot(vectors.map(row => c(row[k])), v).re ** 2);
  const exact = (t: number) => vectors.map(row => eigenvalues.reduce((acc, e, k) => {
    const amplitude = mul(c(dot(vectors.map(r => c(r[k])), v).re), c(Math.cos((e - eg) * t), -Math.sin((e - eg) * t)));
    return c(acc.re + row[k] * amplitude.re, acc.im + row[k] * amplitude.im);
  }, c(0)));

  it('Hamiltonian, kick and sum rule', () => {
    const h = documented.map(term => pauli(term.label).map(row => row.map(z => term.coefficient * z.re))).reduce((a, b) => a.map((row, i) => row.map((x, j) => x + b[i][j])));
    expect(pauliTerms(p)).toEqual(documented);
    hamiltonianMatrix(p).forEach((row, i) => row.forEach((x, j) => close(x, h[i][j])));
    close(sum(weights), 1, 1e-12);
  });

  it('product formula ordering and phase, for built-in and loaded Hamiltonians', () => {
    const start = Array.from({ length: 8 }, (_, j) => c(Math.cos(j + 1), Math.sin(2 * j))), norm = Math.sqrt(dot(start, start).re), s = start.map(z => c(z.re / norm, z.im / norm));
    const built = evolveTrotter(s, documented, 2.3, 5, 0.4), expected = productFormula(s, documented, 2.3, 5, 0.4);
    built.forEach((z, j) => { close(z.re, expected[j].re); close(z.im, expected[j].im); });
    const s2 = s.slice(0, 4), custom = evolveCustomTrotter(s2, HAMILTONIAN_EXAMPLE.terms, 1.7, 3, -0.2), expected2 = productFormula(s2, HAMILTONIAN_EXAMPLE.terms, 1.7, 3, -0.2);
    custom.forEach((z, j) => { close(z.re, expected2[j].re); close(z.im, expected2[j].im); });
  });

  it('time grid, correlation and fidelity', () => {
    run.times.forEach((t, j) => close(t, j * dt));
    run.times.forEach((t, j) => {
      close(run.correlationReal[j], sum(weights.map((w, k) => w * Math.cos((eigenvalues[k] - eg) * t))), 1e-10);
      close(run.correlationImag[j], sum(weights.map((w, k) => -w * Math.sin((eigenvalues[k] - eg) * t))), 1e-10);
    });
    for (const j of [1, 20, N - 1]) {
      const overlap = dot(exact(run.times[j]), productFormula(v, documented, run.times[j], p.trotterSteps, eg));
      close(run.fidelity[j], overlap.re ** 2 + overlap.im ** 2, 1e-9);
    }
  });

  it('Fourier reconstruction, Lorentzian reference, errors, resolution and Nyquist energy', () => {
    const weight = (j: number) => (j === 0 || j === N - 1 ? 0.5 : 1) * Math.exp(-p.broadening * j * dt) * 0.5 * (1 + Math.cos(Math.PI * j * dt / T));
    const S = (re: number[], im: number[]) => Array.from({ length: P * N / 2 + 1 }, (_, k) => {
      const w = 2 * Math.PI * k / (P * N * dt);
      return dt / Math.PI * sum(re.map((x, j) => weight(j) * (x * Math.cos(w * j * dt) - im[j] * Math.sin(w * j * dt))));
    });
    const exactS = S(run.correlationReal, run.correlationImag), trotterS = S(run.trotterReal, run.trotterImag);
    exactS.forEach((x, k) => { close(run.spectralEnergy[k], 2 * Math.PI * k / (P * N * dt)); close(run.spectrumFourierSigned[k], x, 1e-10); close(run.spectrumFourierClipped[k], Math.max(0, run.spectrumFourierSigned[k])); });
    trotterS.forEach((x, k) => close(run.spectrumTrotterSigned[k], x, 1e-10));
    const L = run.spectralEnergy.map(w => sum(weights.map((wn, k) => wn / Math.PI * p.broadening / ((w - (eigenvalues[k] - eg)) ** 2 + p.broadening ** 2))));
    L.forEach((x, k) => close(run.spectrumReference[k], x, 1e-10));
    const grid = run.spectralEnergy, sx = run.spectrumFourierSigned, sr = run.spectrumTrotterSigned;
    close(run.validation.spectralL1TrotterVsExact, trapezoid(grid, sr.map((x, k) => Math.abs(x - sx[k]))) / trapezoid(grid, sx.map(Math.abs)), 1e-9);
    close(run.validation.spectralL1FourierVsReference, trapezoid(grid, sx.map((x, k) => Math.abs(x - L[k]))) / trapezoid(grid, L), 1e-9);
    close(run.validation.spectralRmseFourierVsReference, Math.sqrt(sum(sx.map((x, k) => (x - L[k]) ** 2)) / grid.length), 1e-9);
    close(run.validation.resolution, 2 * Math.PI / T);
    close(run.validation.nyquist, Math.PI * (N - 1) / T);
  });
});
