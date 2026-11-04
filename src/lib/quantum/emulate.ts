/**
 * The time domain XAS circuit of Fomichev et al. (arXiv 2506.15784), emulated exactly in the determinant basis: a
 * TypeScript copy of scripts/quantum/qxas/emulate.py.
 *
 * The circuit is a Hadamard test of a Trotterized evolution. With the double phase trick every rotation turns one way
 * when the auxiliary qubit is 1 and the other way when it is 0, so the two branches evolve under exp(-i s F / 2) and
 * exp(+i s F / 2) for each Hamiltonian fragment F, and <X> + i<Y> = <phi0|phi1>. Two complex matrices (alpha strings
 * by beta strings) therefore hold everything the qubit register would. A fragment is a basis rotation, a diagonal
 * phase and the rotation back; the rotation acts on determinants through minors of the orbital rotation, as in
 * PySCF's transform_ci. The tests hold this file to the Python emulator's stored signals.
 */

export interface Fragments { u0: number[][]; z0: number[]; u: number[][][]; z: number[][][] }

export interface LiveProblem {
  n_orb: number;
  n_elec: [number, number] | number[];
  e_core: number;
  strings_alpha: number[];
  strings_beta: number[];
}

/** A complex matrix, row major, real and imaginary parts apart. */
export interface Complex2D { rows: number; cols: number; re: Float64Array; im: Float64Array }

const occupied = (string: number, nOrb: number) => {
  const occ: number[] = [];
  for (let k = 0; k < nOrb; k++) if ((string >> k) & 1) occ.push(k);
  return occ;
};

/** Determinant of an n by n matrix (row major), by LU with partial pivoting on a copy. */
export function determinant(m: Float64Array, n: number): number {
  const a = Float64Array.from(m);
  let det = 1;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[pivot * n + c])) pivot = r;
    if (a[pivot * n + c] === 0) return 0;
    if (pivot !== c) {
      for (let k = 0; k < n; k++) [a[c * n + k], a[pivot * n + k]] = [a[pivot * n + k], a[c * n + k]];
      det = -det;
    }
    const d = a[c * n + c];
    det *= d;
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c] / d;
      if (f !== 0) for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k];
    }
  }
  return det;
}

/** T[i][j] = det(u[occ(i), occ(j)]): old string i to new string j for orbitals |new> = |old> u. */
export function stringTransform(nOrb: number, strings: readonly number[], u: readonly number[][]): Float64Array {
  const count = strings.length;
  const occ = strings.map(s => occupied(s, nOrb));
  const n = occ[0]?.length ?? 0;
  const t = new Float64Array(count * count);
  if (n === 0) return t.fill(1);
  const minor = new Float64Array(n * n);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) minor[p * n + q] = u[occ[i][p]][occ[j][q]];
      t[i * count + j] = determinant(minor, n);
    }
  }
  return t;
}

/** out = A^T x (when `transpose`) or A x, A real (rows of A by rows of A), x complex. */
function leftMultiply(a: Float64Array, size: number, x: Complex2D, transpose: boolean): Complex2D {
  const re = new Float64Array(x.re.length), im = new Float64Array(x.im.length);
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < size; k++) {
      const f = transpose ? a[k * size + i] : a[i * size + k];
      if (f === 0) continue;
      const row = k * x.cols, out = i * x.cols;
      for (let j = 0; j < x.cols; j++) { re[out + j] += f * x.re[row + j]; im[out + j] += f * x.im[row + j]; }
    }
  }
  return { rows: x.rows, cols: x.cols, re, im };
}

/** out = x B (when `transpose` false) or x B^T, B real (cols by cols), x complex. */
function rightMultiply(x: Complex2D, b: Float64Array, size: number, transpose: boolean): Complex2D {
  const re = new Float64Array(x.re.length), im = new Float64Array(x.im.length);
  for (let i = 0; i < x.rows; i++) {
    for (let k = 0; k < size; k++) {
      const xr = x.re[i * size + k], xi = x.im[i * size + k];
      if (xr === 0 && xi === 0) continue;
      for (let j = 0; j < size; j++) {
        const f = transpose ? b[j * size + k] : b[k * size + j];
        re[i * size + j] += xr * f; im[i * size + j] += xi * f;
      }
    }
  }
  return { rows: x.rows, cols: x.cols, re, im };
}

interface Part { ta: Float64Array; tb: Float64Array; value: Float64Array }

/** The two branches of the Hadamard test, advanced by product formula steps of the fragments. */
export class HadamardTest {
  readonly na: number;
  readonly nb: number;
  private readonly parts: Part[] = [];
  private readonly eCore: number;

  constructor(problem: LiveProblem, fragments: Fragments) {
    const n = problem.n_orb;
    const occA = problem.strings_alpha.map(s => occupied(s, n));
    const occB = problem.strings_beta.map(s => occupied(s, n));
    this.na = occA.length;
    this.nb = occB.length;
    this.eCore = problem.e_core;
    // N_k for every determinant, alpha string a and beta string b: occupancy of orbital k, 0, 1 or 2.
    const counts = (a: number, b: number) => {
      const c = new Float64Array(n);
      for (const k of occA[a]) c[k] += 1;
      for (const k of occB[b]) c[k] += 1;
      return c;
    };
    const diagonal = (f: (c: Float64Array) => number) => {
      const v = new Float64Array(this.na * this.nb);
      for (let a = 0; a < this.na; a++) for (let b = 0; b < this.nb; b++) v[a * this.nb + b] = f(counts(a, b));
      return v;
    };
    const bases = [fragments.u0, ...fragments.u];
    const values = [diagonal(c => c.reduce((s, x, k) => s + fragments.z0[k] * x, 0))];
    for (const z of fragments.z) {
      const zPrime = z.map(row => row.reduce((s, x) => s + x, 0));
      values.push(diagonal(c => {
        let v = 0;
        for (let k = 0; k < n; k++) {
          if (!c[k]) continue;
          for (let l = 0; l < n; l++) v += 0.5 * z[k][l] * c[k] * c[l];
          v -= zPrime[k] * c[k];
        }
        return v;
      }));
    }
    bases.forEach((u, i) => {
      const ta = stringTransform(n, problem.strings_alpha, u);
      const tb = problem.strings_alpha.length === problem.strings_beta.length &&
        problem.strings_alpha.every((s, k) => s === problem.strings_beta[k]) ? ta : stringTransform(n, problem.strings_beta, u);
      this.parts.push({ ta, tb, value: values[i] });
    });
  }

  private fragment(ci: Complex2D, index: number, angle: number): Complex2D {
    const { ta, tb, value } = this.parts[index];
    const x = rightMultiply(leftMultiply(ta, this.na, ci, true), tb, this.nb, false);
    for (let k = 0; k < value.length; k++) {
      const c = Math.cos(angle * value[k]), s = -Math.sin(angle * value[k]);
      const re = x.re[k], im = x.im[k];
      x.re[k] = re * c - im * s;
      x.im[k] = re * s + im * c;
    }
    return rightMultiply(leftMultiply(ta, this.na, x, false), tb, this.nb, true);
  }

  private firstOrder(phi0: Complex2D, phi1: Complex2D, step: number, order: readonly number[]): [Complex2D, Complex2D] {
    for (const index of order) {
      phi1 = this.fragment(phi1, index, step / 2);
      phi0 = this.fragment(phi0, index, -step / 2);
    }
    const c = Math.cos(0.5 * step * this.eCore), s = Math.sin(0.5 * step * this.eCore);
    for (let k = 0; k < phi1.re.length; k++) {
      const r1 = phi1.re[k], i1 = phi1.im[k];
      phi1.re[k] = r1 * c + i1 * s; phi1.im[k] = i1 * c - r1 * s;  // times exp(-i s e_core / 2)
      const r0 = phi0.re[k], i0 = phi0.im[k];
      phi0.re[k] = r0 * c - i0 * s; phi0.im[k] = i0 * c + r0 * s;  // times exp(+i s e_core / 2)
    }
    return [phi0, phi1];
  }

  /** One symmetric step: a forward half step, then the same fragments reversed. */
  secondOrder(phi0: Complex2D, phi1: Complex2D, step: number): [Complex2D, Complex2D] {
    const order = this.parts.map((_, i) => i);
    [phi0, phi1] = this.firstOrder(phi0, phi1, step / 2, order);
    return this.firstOrder(phi0, phi1, step / 2, [...order].reverse());
  }

  /** <X> + i<Y> at t_j = j tau for j = 1..jmax, as [real parts, imaginary parts], with `substeps` symmetric steps per
   * tau; `onStep` reports progress. */
  signal(psi: readonly number[][], tau: number, jmax: number, substeps = 1, onStep?: (j: number) => void): [Float64Array, Float64Array] {
    const start = (): Complex2D => ({ rows: this.na, cols: this.nb, re: Float64Array.from(psi.flat()), im: new Float64Array(this.na * this.nb) });
    let phi0 = start(), phi1 = start();
    const re = new Float64Array(jmax), im = new Float64Array(jmax);
    for (let j = 0; j < jmax; j++) {
      for (let k = 0; k < substeps; k++) [phi0, phi1] = this.secondOrder(phi0, phi1, tau / substeps);
      let r = 0, i = 0;
      for (let k = 0; k < phi0.re.length; k++) {
        r += phi0.re[k] * phi1.re[k] + phi0.im[k] * phi1.im[k];
        i += phi0.re[k] * phi1.im[k] - phi0.im[k] * phi1.re[k];
      }
      re[j] = r; im[j] = i;
      onStep?.(j + 1);
    }
    return [re, im];
  }
}
