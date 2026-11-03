"""Double factorization of the Hamiltonian into fragments that are diagonal in their own orbitals.

Following 2506.15784 Sec. III A and the PennyLane demo `tutorial_xas`:

  H = E_core + sum_k z0_k N0_k + sum_l [ 1/2 sum_kl Z^l_kl N^l_k N^l_l - sum_k Z'^l_k N^l_k ]

where N^l_k counts the electrons (both spins) in orbital k of fragment l, whose orbitals are the columns of U^l, and
Z'^l_k = sum_m Z^l_km. The one-body fragment absorbs h_pq - 1/2 sum_r (pr|rq) and the Z' terms (the one-Z terms the
Jordan-Wigner form of each two-body fragment produces); (U0, z0) diagonalize it. The fragment operators are exactly
the ones the demo's circuit implements, so the same Trotter product gives the same answer here and on a circuit.

Two ways to get the fragments:

* "cdf", compressed double factorization (PennyLane's `qchem.factorize(compressed=True)`), the paper's choice: few
  fragments, at the price of an error in the two-electron integrals. PennyLane starts its optimizer from zero
  rotations, where the gradient of every rotation that mixes orbitals of different symmetry vanishes; with symmetry
  adapted orbitals it then stops at a poor fit (0.05 Ha for N2 in the demo's active space). A small seeded random
  start breaks the symmetry and brings the error to about 0.003 Ha.
* "exact", the full eigen double factorization: every eigenvector of the integral supermatrix, each diagonalized.
  More fragments, no error beyond 1e-10; it separates the algorithm's own error from the factorization. Core-valence
  separation zeroes some integrals and leaves the supermatrix indefinite, so negative eigenvalues are kept too, with
  their sign in Z.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Fragments:
    e_core: float
    u0: np.ndarray
    z0: np.ndarray
    u: np.ndarray
    z: np.ndarray
    max_error: float
    method: str

    @property
    def count(self) -> int:
        return len(self.u)


def _one_body(h1: np.ndarray, h2: np.ndarray, u: np.ndarray, z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    one = h1 - 0.5 * np.einsum("prrq->pq", h2) + np.einsum("tpk,tk,tqk->pq", u, z.sum(axis=-1), u)
    z0, u0 = np.linalg.eigh(one)
    return u0, z0


def factorize(h1: np.ndarray, h2: np.ndarray, e_core: float, method: str = "cdf", num_factors: int | None = None,
              seed: int = 0) -> Fragments:
    """Fragments of (h1, h2), h2 in chemists' notation. For "cdf", `num_factors` defaults to PennyLane's 2N (the paper
    uses N); `seed` fixes the symmetry-breaking start, so the result is the same on every run."""
    n = h1.shape[0]
    if method == "exact":
        values, vectors = np.linalg.eigh(h2.reshape(n * n, n * n))
        us, zs = [], []
        for value, vector in zip(values, vectors.T):
            if abs(value) < 1e-10:
                continue
            mu, u = np.linalg.eigh(np.sqrt(abs(value)) * vector.reshape(n, n))
            us.append(u)
            zs.append(np.sign(value) * np.outer(mu, mu))
        u, z = np.array(us), np.array(zs)
    elif method == "cdf":
        from jax import config

        config.update("jax_enable_x64", True)  # JAX defaults to single precision; the integrals need double.
        import pennylane as qml

        count = 2 * n if num_factors is None else num_factors
        x = np.random.default_rng(seed).normal(scale=0.1, size=(count, n, n))
        start = {"X": x - np.swapaxes(x, 1, 2), "Z": np.zeros((count, n, n))}
        _, z, u = qml.qchem.factorize(h2, compressed=True, num_factors=count, init_params=start)
        z, u = np.asarray(z, dtype=float), np.asarray(u, dtype=float)
    else:
        raise ValueError(f"Unknown factorization {method!r}.")
    approx = np.einsum("tpk,tqk,tkl,trl,tsl->pqrs", u, u, z, u, u)
    u0, z0 = _one_body(h1, h2, u, z)
    return Fragments(e_core, u0, z0, u, z, float(np.abs(approx - h2).max()), method)


def reconstruct(fr: Fragments) -> tuple[np.ndarray, np.ndarray]:
    """The (h1, h2) the fragments represent, to compare spectra of H and of its factorized form."""
    h2 = np.einsum("tpk,tqk,tkl,trl,tsl->pqrs", fr.u, fr.u, fr.z, fr.u, fr.u)
    one = fr.u0 @ np.diag(fr.z0) @ fr.u0.T - np.einsum("tpk,tk,tqk->pq", fr.u, fr.z.sum(axis=-1), fr.u)
    h1 = one + 0.5 * np.einsum("prrq->pq", h2)
    return h1, h2
