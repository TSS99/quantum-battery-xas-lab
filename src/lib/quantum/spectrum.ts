/**
 * Shots for the Hadamard tests and the spectrum rebuilt from the measured time signal: a TypeScript copy of
 * scripts/quantum/qxas/sampling.py.
 *
 * Measuring the auxiliary qubit n times in X gives k outcomes +1 with probability (1 + <X>)/2, so <X> is estimated as
 * 2k/n - 1 (and the same in Y). Shots are spread over the times t_j = j tau in proportion to exp(-alpha eta t_j), the
 * Lorentzian-shaped allocation of 2506.15784. The spectrum is that paper's Eq. 11,
 *   f(w) = tau / (2 pi) [ G(0) + 2 sum_j exp(-eta t_j) Re( G(t_j) exp(i w t_j) ) ],
 * with G summed over dipole directions and weighted by ||m_rho|I>||^2.
 */

export type Signal = [Float64Array, Float64Array];

/** Shots per time point for each of X and Y, summing to about total / 2 per observable. */
export function allocate(total: number, times: Float64Array, eta: number, alpha: number): Int32Array {
  const weights = Array.from(times, t => Math.exp(-alpha * eta * t));
  const sum = weights.reduce((s, w) => s + w, 0);
  return Int32Array.from(weights, w => Math.max(1, Math.round(total / 2 * w / sum)));
}

/** A binomial draw: exact (Bernoulli sum) up to 50 trials, a rounded normal draw above, clipped to [0, n]. */
export function binomial(n: number, p: number, random: () => number): number {
  if (n <= 50) {
    let k = 0;
    for (let i = 0; i < n; i++) if (random() < p) k++;
    return k;
  }
  let u = 0;
  while (u === 0) u = random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  return Math.min(n, Math.max(0, Math.round(n * p + z * Math.sqrt(n * p * (1 - p)))));
}

/** Shot-noise estimate of <X> + i<Y> from binomial outcomes of the auxiliary qubit. */
export function measure([re, im]: Signal, shots: Int32Array, random: () => number): Signal {
  const x = new Float64Array(re.length), y = new Float64Array(im.length);
  for (let j = 0; j < re.length; j++) {
    const px = Math.min(1, Math.max(0, (1 + re[j]) / 2)), py = Math.min(1, Math.max(0, (1 + im[j]) / 2));
    x[j] = 2 * binomial(shots[j], px, random) / shots[j] - 1;
    y[j] = 2 * binomial(shots[j], py, random) / shots[j] - 1;
  }
  return [x, y];
}

/** Eq. 11 on a grid of energies (in the same reference as the signal's phases). */
export function rebuild(w: Float64Array, times: Float64Array, [re, im]: Signal, g0: number, eta: number, tau: number): Float64Array {
  const out = new Float64Array(w.length);
  for (let i = 0; i < w.length; i++) {
    let sum = 0;
    for (let j = 0; j < times.length; j++) {
      const damp = Math.exp(-eta * times[j]), phase = w[i] * times[j];
      sum += damp * (re[j] * Math.cos(phase) - im[j] * Math.sin(phase));
    }
    out[i] = tau / (2 * Math.PI) * (g0 + 2 * sum);
  }
  return out;
}

/** (1/pi) sum_k w_k eta / ((w - c_k)^2 + eta^2), the broadened stick spectrum of an exact reference. */
export function lorentzian(w: Float64Array, centres: readonly number[], weights: readonly number[], eta: number): Float64Array {
  return Float64Array.from(w, x => centres.reduce((s, c, k) => s + weights[k] * eta / ((x - c) ** 2 + eta ** 2), 0) / Math.PI);
}
