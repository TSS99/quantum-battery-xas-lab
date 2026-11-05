"""Core loss EELS from the same problems (Phase 8 of docs/PLAN-quantum.md; Kunitsa et al., arXiv 2508.15935).

In the dipole limit the dynamic structure factor for a momentum transfer q is

  S(q, w) = sum_ab q_a q_b I_ab(w),   I_ab(w) = sum_F <I|m_a|F><F|m_b|I> delta(w - w_F),

so an oriented sample needs the cross terms I_ab as well as the three XAS intensities I_aa, while the average over
orientations is |q|^2/3 times the XAS spectrum. With a real Hamiltonian and real states I_ab = I_ba, and the cross
terms follow from the spectral measure of (m_a + m_b)|I>: I_ab = (I_{a+b} - I_aa - I_bb) / 2. That is how the exact
reference is built. The quantum algorithm instead measures G_ab(t) = <m_a I|e^{-iHt}|m_b I> with a Hadamard test on a
linear combination of the two state preparations; the emulator computes it as the off-diagonal test of
`HadamardTest.signal(..., bra=...)`.
"""

from __future__ import annotations

import numpy as np

from . import exact
from .emulate import HadamardTest
from .problem import Problem

AXES = "xyz"
PAIRS = ((0, 1), (0, 2), (1, 2))


def measures(problem: Problem, ci0: np.ndarray, e0: float, steps: int = 300) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Spectral measures (w = E - E_I, weights) of m_a|I> for a = x, y, z and of (m_a + m_b)|I> for the pairs, with
    their norms squared in the weights: keys 'x', 'y', 'z', 'xy', 'xz', 'yz'."""
    states, norms = problem.dipole_states(ci0)
    vectors = {AXES[a]: states[a] * norms[a] for a in range(3)}
    vectors.update({AXES[a] + AXES[b]: states[a] * norms[a] + states[b] * norms[b] for a, b in PAIRS})
    out = {}
    for key, v in vectors.items():
        norm = float(np.linalg.norm(v))
        if norm < 1e-12:
            out[key] = (np.zeros(0), np.zeros(0))
            continue
        a, b = exact.lanczos(problem, v, steps)
        theta, vecs = np.linalg.eigh(np.diag(a) + np.diag(b, 1) + np.diag(b, -1))
        out[key] = (theta - e0, vecs[0] ** 2 * norm ** 2)
    return out


def direction_sticks(m: dict[str, tuple[np.ndarray, np.ndarray]], q) -> tuple[np.ndarray, np.ndarray]:
    """Sticks of S(q, w) in the dipole limit: sum_a q_a^2 I_aa + sum_{a<b} q_a q_b (I_{a+b} - I_aa - I_bb). Some
    weights are negative; their broadened sum is not."""
    q = np.asarray(q, dtype=float)
    coefficients = {AXES[a]: q[a] ** 2 - sum(q[a] * q[b] for b in range(3) if b != a) for a in range(3)}
    coefficients.update({AXES[a] + AXES[b]: q[a] * q[b] for a, b in PAIRS})
    centres = np.concatenate([m[k][0] for k in coefficients])
    weights = np.concatenate([c * m[k][1] for k, c in coefficients.items()])
    keep = weights != 0
    return centres[keep], weights[keep]


def cross_signals(test: HadamardTest, states: list[np.ndarray], norms: np.ndarray, tau: float, jmax: int,
                  substeps: int) -> dict[str, np.ndarray | None]:
    """The off-diagonal Hadamard test signals <m_a I|U(t_j)|m_b I> of the normalized states, for the three pairs."""
    return {AXES[a] + AXES[b]: (test.signal(states[b], tau, jmax, substeps=substeps, bra=states[a])
                                if norms[a] and norms[b] else None) for a, b in PAIRS}


def direction_signal(diagonal: list[np.ndarray | None], cross: dict[str, np.ndarray | None], norms: np.ndarray, q) -> np.ndarray:
    """G_q(t) = sum_ab q_a q_b ||m_a I|| ||m_b I|| G_ab(t), from the diagonal and off-diagonal tests (G_ab = G_ba for a
    real Hamiltonian and real states), so that it rebuilds into S(q, w) as the XAS signal rebuilds into the spectrum."""
    q = np.asarray(q, dtype=float)
    total = 0
    for a in range(3):
        if diagonal[a] is not None:
            total = total + q[a] ** 2 * norms[a] ** 2 * diagonal[a]
    for a, b in PAIRS:
        g = cross[AXES[a] + AXES[b]]
        if g is not None:
            total = total + 2 * q[a] * q[b] * norms[a] * norms[b] * g
    return total
