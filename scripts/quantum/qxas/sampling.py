"""Shots for the Hadamard tests, and the spectrum rebuilt from the measured time signal.

Measuring the auxiliary qubit n times in X gives k outcomes +1 with probability (1 + <X>)/2, so the estimate of <X>
is 2k/n - 1 (and the same in Y). Shots are spread over the times t_j = j tau in proportion to exp(-alpha eta t_j), the
Lorentzian-shaped allocation of 2506.15784 Sec. IV B (alpha = 0 is the uniform allocation).

The spectrum is the discrete Fourier sum of Eq. 11 of that paper,
  f(w) = tau / (2 pi) [ G(0) + 2 sum_j exp(-eta t_j) Re( G(t_j) exp(i w t_j) ) ],
with G summed over dipole directions and weighted by ||m_rho|I>||^2, so f is the absorption spectrum broadened by a
Lorentzian of half width eta (a periodic one: energies are only known modulo 2 pi / tau).
"""

from __future__ import annotations

import numpy as np


def allocate(total: int, times: np.ndarray, eta: float, alpha: float) -> np.ndarray:
    """Shots per time point (each of X and Y gets this many), summing to about total / 2 per observable."""
    weights = np.exp(-alpha * eta * times)
    return np.maximum(1, np.round(total / 2 * weights / weights.sum())).astype(int)


def measure(signal: np.ndarray, shots: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Shot-noise estimate of <X> + i<Y> from binomial outcomes of the auxiliary qubit."""
    p_x = np.clip((1 + signal.real) / 2, 0, 1)
    p_y = np.clip((1 + signal.imag) / 2, 0, 1)
    x = 2 * rng.binomial(shots, p_x) / shots - 1
    y = 2 * rng.binomial(shots, p_y) / shots - 1
    return x + 1j * y


def spectrum(w: np.ndarray, times: np.ndarray, signal: np.ndarray, g0: float, eta: float, tau: float) -> np.ndarray:
    """Eq. 11 on a grid of energies w (the same reference as the times' phases)."""
    phases = np.exp(1j * np.outer(w, times))
    damped = np.exp(-eta * times) * signal
    return tau / (2 * np.pi) * (g0 + 2 * (phases * damped[None, :]).real.sum(axis=1))
