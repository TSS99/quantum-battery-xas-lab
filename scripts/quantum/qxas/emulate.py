"""Exact emulation of the time domain circuit (Fig. 3 of 2506.15784) in the determinant basis.

The circuit is a Hadamard test: an auxiliary qubit in |+> controls a Trotterized evolution of m|I>/||m|I>||, and its
<X> and <Y> give the real and imaginary parts of G(t). With the double phase trick of the paper (and the PennyLane demo)
every rotation is applied with angle +a when the auxiliary qubit is 1 and -a when it is 0, so the two branches evolve
under exp(-i s F / 2) and exp(+i s F / 2) for each fragment F, and <X> + i<Y> = <phi_0|phi_1>.

So the whole register never has to be stored: two vectors in the determinant basis of the right electron numbers (120
by 120 for N2 in 10 orbitals instead of 2^21 amplitudes) hold exactly what the circuit holds, gate for gate. A basis
rotation is the determinant transform of PySCF's transform_ci; a fragment is then a diagonal phase.
"""

from __future__ import annotations

import numpy as np
from pyscf.fci import cistring

from .cdf import Fragments
from .problem import Problem


def string_transform(n_orb: int, n_elec: int, u: np.ndarray) -> np.ndarray:
    """T[i, j] = det(u[occ(i), occ(j)]): old string i to new string j for orbitals |new> = |old> u (PySCF's rule)."""
    strings = cistring.make_strings(range(n_orb), n_elec)
    occ = np.array([[k for k in range(n_orb) if int(s) >> k & 1] for s in strings])
    if n_elec == 0:
        return np.ones((1, 1))
    return np.linalg.det(u[occ[:, None, :, None], occ[None, :, None, :]])


def occupations(n_orb: int, n_elec: int) -> np.ndarray:
    strings = cistring.make_strings(range(n_orb), n_elec)
    return np.array([[int(s) >> k & 1 for k in range(n_orb)] for s in strings], dtype=float)


class HadamardTest:
    """The two branches of the Hadamard test, advanced by product formula steps of the CDF fragments."""

    def __init__(self, problem: Problem, fragments: Fragments):
        n, (na, nb) = problem.n_orb, problem.n_elec
        occ_a, occ_b = occupations(n, na), occupations(n, nb)
        occ = occ_a[:, None, :] + occ_b[None, :, :]  # N_k for every determinant
        self.e_core = fragments.e_core
        self.parts = []  # (T_alpha, T_beta, diagonal value of the fragment)
        bases = [fragments.u0] + list(fragments.u)
        values = [np.einsum("abk,k->ab", occ, fragments.z0)]
        for z in fragments.z:
            values.append(0.5 * np.einsum("abk,kl,abl->ab", occ, z, occ) - np.einsum("abk,k->ab", occ, z.sum(axis=-1)))
        for u, value in zip(bases, values):
            ta = string_transform(n, na, u)
            tb = ta if na == nb else string_transform(n, nb, u)
            self.parts.append((ta, tb, value))

    def _fragment(self, ci: np.ndarray, index: int, angle: float) -> np.ndarray:
        ta, tb, value = self.parts[index]
        x = ta.T @ ci @ tb
        x = x * np.exp(-1j * angle * value)
        return ta @ x @ tb.T

    def first_order(self, phi0: np.ndarray, phi1: np.ndarray, step: float, order) -> tuple[np.ndarray, np.ndarray]:
        for index in order:
            phi1 = self._fragment(phi1, index, step / 2)
            phi0 = self._fragment(phi0, index, -step / 2)
        phase = np.exp(-0.5j * step * self.e_core)
        return phi0 * np.conj(phase), phi1 * phase

    def second_order(self, phi0, phi1, step: float, rng: np.random.Generator | None = None):
        """One symmetric step: forward half step, then the same fragments reversed. With `rng` the fragment order is
        shuffled each step (the randomized second order formula the paper found best for 1 eV targets)."""
        order = list(range(len(self.parts)))
        if rng is not None:
            rng.shuffle(order)
        phi0, phi1 = self.first_order(phi0, phi1, step / 2, order)
        return self.first_order(phi0, phi1, step / 2, order[::-1])

    def signal(self, psi: np.ndarray, tau: float, jmax: int, substeps: int = 1, seed: int | None = None) -> np.ndarray:
        """<X> + i<Y> at t_j = j tau for j = 1..jmax, carrying the state from one time to the next as a simulator
        can (hardware would rerun each time from the start; the circuit for time j is j steps of the same formula)."""
        rng = None if seed is None else np.random.default_rng(seed)
        phi0 = psi.astype(complex)
        phi1 = psi.astype(complex)
        out = np.empty(jmax, dtype=complex)
        for j in range(jmax):
            for _ in range(substeps):
                phi0, phi1 = self.second_order(phi0, phi1, tau / substeps, rng)
            out[j] = np.vdot(phi0, phi1)
        return out
