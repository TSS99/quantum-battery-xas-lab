"""Exact classical references for a spectroscopy problem, with no Trotter error and no shot noise.

* `eigen_spectrum`: the lowest eigenstates and their dipole weights, as in the papers' classical references (Fig. 8 of
  2506.15784 used the 250 lowest full CI states of N2).
* `krylov_measure`: the spectral measure of m|I> from Lanczos with full reorthogonalization. It holds every state the
  dipole reaches, however high, so it also catches the core-excited states that a lowest-roots calculation misses.

Energies are absolute (they include the core constant); spectra are reported against w = E - E_I.
"""

from __future__ import annotations

import numpy as np
from pyscf import fci

from .problem import Problem


def lorentzian(w: np.ndarray, centres: np.ndarray, weights: np.ndarray, eta: float) -> np.ndarray:
    """(1/pi) sum_k w_k eta / ((w - c_k)^2 + eta^2), the broadened stick spectrum."""
    w = np.asarray(w, dtype=float)[:, None]
    return (weights[None, :] * eta / ((w - centres[None, :]) ** 2 + eta ** 2)).sum(axis=1) / np.pi


def eigen_spectrum(problem: Problem, ci0: np.ndarray, e0: float, nroots: int, dense_limit: int = 20000):
    """Stick spectrum from the `nroots` lowest eigenstates: (w_F = E_F - E_I, sum over rho of |<F|m_rho|I>|^2).

    Up to `dense_limit` determinants the Hamiltonian is built and diagonalized outright, which for hundreds of roots
    is far faster than Davidson; beyond it PySCF's Davidson solver finds the roots."""
    shape, size = ci0.shape, ci0.size
    if size <= dense_limit:
        # PySCF's pspace builds the Hamiltonian among the given determinants in compiled code; with all of them it is
        # the whole matrix, rows in the order of `addr`.
        addr, matrix = fci.direct_spin1.pspace(problem.h1, problem.h2, problem.n_orb, problem.n_elec, np=size)
        energies, vecs = np.linalg.eigh(matrix)
        energies = energies[:nroots] + problem.e_core
        vectors = []
        for k in range(min(nroots, size)):
            v = np.zeros(size)
            v[addr] = vecs[:, k]
            vectors.append(v.reshape(shape))
    else:
        solver = fci.direct_spin1.FCI()
        solver.conv_tol = 1e-10
        solver.max_cycle = 400
        solver.nroots = nroots
        energies, vectors = solver.kernel(problem.h1, problem.h2, problem.n_orb, problem.n_elec, ecore=problem.e_core)
        energies = np.atleast_1d(energies)
        vectors = [np.asarray(v).reshape(shape) for v in (vectors if nroots > 1 else [vectors])]
    states, norms = problem.dipole_states(ci0)
    weights = np.zeros(len(energies))
    for v, n in zip(states, norms):
        weights += np.array([abs(np.vdot(f, v)) ** 2 for f in vectors]) * n ** 2
    return np.asarray(energies) - e0, weights


def lanczos(problem: Problem, v0: np.ndarray, steps: int) -> tuple[np.ndarray, np.ndarray]:
    """Tridiagonal coefficients (alpha, beta) of H in the Krylov space of v0, with full reorthogonalization."""
    h_eff = problem.h_eff()
    basis = [v0.ravel() / np.linalg.norm(v0)]
    alphas, betas = [], []
    for k in range(steps):
        w = problem.apply_h(basis[-1].reshape(v0.shape), h_eff).ravel()
        alpha = float(np.dot(basis[-1], w))
        alphas.append(alpha)
        w -= alpha * basis[-1] + (betas[-1] * basis[-2] if betas else 0.0)
        for b in basis:  # Full reorthogonalization keeps the high-lying states honest.
            w -= np.dot(b, w) * b
        beta = float(np.linalg.norm(w))
        if beta < 1e-10 or k == steps - 1:
            break
        betas.append(beta)
        basis.append(w / beta)
    return np.array(alphas), np.array(betas[:len(alphas) - 1])


def krylov_measure(problem: Problem, ci0: np.ndarray, e0: float, steps: int = 400):
    """Ritz energies (w = E - E_I) and weights of every dipole direction, summed: an exact spectral measure up to
    the first 2*steps moments, which for the broadenings used here is the whole spectrum."""
    states, norms = problem.dipole_states(ci0)
    centres, weights = [], []
    for v, n in zip(states, norms):
        if n == 0:
            continue
        a, b = lanczos(problem, v, steps)
        theta, vecs = np.linalg.eigh(np.diag(a) + np.diag(b, 1) + np.diag(b, -1))
        centres.append(theta - e0)
        weights.append(vecs[0] ** 2 * n ** 2)
    return np.concatenate(centres), np.concatenate(weights)


def time_signal(centres: np.ndarray, weights: np.ndarray, times: np.ndarray) -> np.ndarray:
    """sum over states of |<F|m|I>|^2 exp(-i w_F t), with w measured from E_I: the exact G(t) times ||m|I>||^2."""
    return (weights[None, :] * np.exp(-1j * np.outer(times, centres))).sum(axis=1)
