"""Resonant inelastic X-ray scattering from the same problems (Phase 9 of docs/PLAN-quantum.md; Loaiza, Kunitsa,
Fomichev et al., arXiv 2602.20270).

A photon of energy w_I and polarization a is absorbed, one of polarization b leaves, and the sample is left in a
valence state F. In the Kramers-Heisenberg form of the paper (Eqs. 6 to 8)

  P_ab(w_I, w) = sum_F |<F|R_ab|I>|^2 delta(w - w_F),   R_ab = m_b G(w_I) m_a,   G(w_I) = 1 / (w_I - (H - E_I) + i Gamma),

with w = E_F - E_I the energy loss. With CVS, m_a|I> has one core hole and G keeps it there; m_b then fills it (the
part of m_b that would open a second hole cannot reach a valence state and is dropped).

* Exact reference. G(w_I) m_a|I> from the Lanczos tridiagonal of m_a|I> among the core-excited states, then the
  spectral measure of phi_ab = m_b G m_a|I> among the valence states, by Lanczos on its real and imaginary parts (H is
  real, so their measures add).
* A powder (randomly oriented sample) needs three invariants of R per final state, as two-photon absorption does
  (McClain, J. Chem. Phys. 55, 2789, 1971): |tr R|^2, sum_ab |R_ab|^2 and sum_ab R_ab R_ba^*. For parallel linear
  polarizations the average is their sum over 15, for crossed ones (4 sum |R_ab|^2 - |tr R|^2 - sum R_ab R_ba^*) / 30,
  and parallel plus twice crossed is the isotropic sum_ab |R_ab|^2 / 3. The two cross invariants come from the
  measures of sum_a phi_aa and of phi_ab + phi_ba.
* On a quantum computer (Sec. III of the paper) R_ab|I> is made by a block encoding: the dipole state m_a|I> is
  prepared, Gamma G is applied as a Chebyshev polynomial of degree K_G in H / lambda by generalized QSP on the qubitized
  walk, and m_b / lambda_D by a block encoding of the dipole. That succeeds with probability
  P_R = (Gamma |R| / (lambda_D |m_a I|))^2 (Eq. 31), raised by K_A rounds of amplitude amplification, and phase
  estimation of the walk then samples the loss w_F with probability |<F|R|I>|^2 / |R|^2. `chebyshev_green` and
  `rixs_states(..., polynomial=...)` apply the polynomial the circuit applies, in the Ritz basis of the core-excited
  states, so its error can be measured against the exact G.
"""

from __future__ import annotations

import numpy as np
from pyscf import fci
from pyscf.fci import cistring
from scipy.fft import dct

from .builder import HARTREE_EV
from .problem import Problem

GAMMA = 0.3 / HARTREE_EV  # the core hole's half width, the paper's 0.3 eV
AXES = "xyz"
ORIENTED = [a + b for a in AXES for b in AXES]  # "xz": in along x, out along z
SWAPS = ("xy+yx", "xz+zx", "yz+zy")


def _ritz(problem: Problem, v: np.ndarray, steps: int, h_eff: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Lanczos of a unit vector with full reorthogonalization: Ritz energies, their eigenvectors in the Krylov basis
    (columns), and the basis (rows)."""
    basis = np.empty((steps, v.size))
    basis[0] = v.ravel()
    alphas, betas = [], []
    for k in range(steps):
        w = problem.apply_h(basis[k].reshape(v.shape), h_eff).ravel()
        alphas.append(float(basis[k] @ w))
        w -= alphas[-1] * basis[k] + (betas[-1] * basis[k - 1] if betas else 0.0)
        w -= basis[:k + 1].T @ (basis[:k + 1] @ w)
        beta = float(np.linalg.norm(w))
        if beta < 1e-10 or k == steps - 1:
            break
        betas.append(beta)
        basis[k + 1] = w / beta
    size = len(alphas)
    theta, s = np.linalg.eigh(np.diag(alphas) + np.diag(betas[:size - 1], 1) + np.diag(betas[:size - 1], -1))
    return theta, s, basis[:size]


def initial_state(problem: Problem, steps: int = 300) -> tuple[float, np.ndarray]:
    """The lowest state among the determinants with a full core, where the final states of RIXS live: the lowest of
    P0 H P0 (`valence`), by Lanczos from Problem.ground_state(). That one is the lowest state of the whole CVS
    Hamiltonian projected onto a full core; the terms with two core indices that CVS keeps mix it with doubly
    core-ionized determinants (H|I> has a part of norm about 0.03 there), so within P0 H P0 it is an eigenvector only
    to about 1e-4. Nothing for XAS, whose states keep one hole; RIXS returns to a full core and needs the elastic line
    exactly at zero loss."""
    small, ia, ib = valence(problem)
    _, ci0 = problem.ground_state()
    start = ci0[np.ix_(ia, ib)]
    theta, s, basis = _ritz(small, start / np.linalg.norm(start), steps, small.h_eff())
    ci = np.zeros(ci0.shape)
    ci[np.ix_(ia, ib)] = (basis.T @ s[:, 0]).reshape(start.shape)
    return float(theta[0]), ci / np.linalg.norm(ci)


def core_krylov(problem: Problem, ci0: np.ndarray, steps: int = 300) -> list:
    """For each direction a, the Lanczos of m_a|I> among the core-excited states as (norm, Ritz energies, first Ritz
    components, Ritz vectors as columns), or None where m_a|I> vanishes. Then G(z) m_a|I> = norm Y (s0 / (z - theta))."""
    states, norms = problem.dipole_states(ci0)
    h_eff = problem.h_eff()
    out = []
    for v, n in zip(states, norms):
        if n < 1e-10:
            out.append(None)
            continue
        theta, s, basis = _ritz(problem, v, steps, h_eff)
        out.append((float(n), theta, s[0], basis.T @ s))
    return out


def apply_dipole(problem: Problem, d: np.ndarray, v: np.ndarray, holes: int) -> np.ndarray:
    """d applied to a complex CI vector, kept to the determinants with `holes` core holes."""
    part = lambda x: problem.project_core(fci.direct_spin1.contract_1e(d, np.ascontiguousarray(x), problem.n_orb,
                                                                       problem.n_elec).reshape(v.shape), holes)
    return part(v.real) + 1j * part(v.imag)


def green_states(krylov: list, shape: tuple, w_in: float, e0: float, gamma: float = GAMMA,
                 polynomial=None) -> dict[str, np.ndarray]:
    """G(w_in) m_a|I> for the directions a with a dipole state. With `polynomial` (a function of the absolute energy,
    as `chebyshev_green` returns) G is replaced by it / gamma."""
    z = w_in + e0 + 1j * gamma
    green = {}
    for a, k in zip(AXES, krylov):
        if k is None:
            continue
        n, theta, s0, ritz = k
        g = polynomial(theta) / gamma if polynomial is not None else 1 / (z - theta)
        green[a] = (n * (ritz @ (s0 * g))).reshape(shape)
    return green


def outgoing(problem: Problem, green: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """phi_ab = m_b G m_a|I> for the nine oriented pairs, with sum_a phi_aa ("tr") and phi_ab + phi_ba."""
    zero = np.zeros(next(iter(green.values())).shape, dtype=complex)
    phi = {a + b: apply_dipole(problem, problem.dipoles[AXES.index(b)], green[a], holes=0) if a in green else zero
           for a in AXES for b in AXES}
    phi["tr"] = phi["xx"] + phi["yy"] + phi["zz"]
    for key in SWAPS:
        phi[key] = phi[key[:2]] + phi[key[3:]]
    return phi


def rixs_states(problem: Problem, ci0: np.ndarray, krylov: list, w_in: float, e0: float, gamma: float = GAMMA,
                polynomial=None) -> dict[str, np.ndarray]:
    return outgoing(problem, green_states(krylov, ci0.shape, w_in, e0, gamma, polynomial))


def valence(problem: Problem) -> tuple[Problem, np.ndarray, np.ndarray]:
    """The sector with a full core as a problem of its own, the core orbitals frozen doubly occupied, with the full CI
    rows and columns of its alpha and beta strings. For the 11 orbital clusters it has a third of the determinants.
    PySCF orders a determinant's creation operators by orbital, so with the core orbitals first no sign changes."""
    core = list(problem.core)
    act = [p for p in range(problem.n_orb) if p not in core]
    h1, h2 = problem.h1, problem.h2
    e_core = problem.e_core + sum(2 * h1[c, c] for c in core) + sum(2 * h2[c, c, d, d] - h2[c, d, d, c] for c in core for d in core)
    h1v = h1[np.ix_(act, act)] + sum(2 * h2[np.ix_(act, act, [c], [c])][:, :, 0, 0] - h2[np.ix_(act, [c], [c], act)][:, 0, 0, :] for c in core)
    h2v = h2[np.ix_(act, act, act, act)]
    n_elec = (problem.n_elec[0] - len(core), problem.n_elec[1] - len(core))
    small = Problem(problem.name + " (valence)", len(act), n_elec, float(e_core), h1v, h2v,
                    problem.dipoles[:, act][:, :, act], [], problem.notes)

    def rows(n_spin: int) -> np.ndarray:
        strings = cistring.make_strings(range(problem.n_orb), n_spin)
        full = [i for i, s in enumerate(strings) if all(int(s) >> c & 1 for c in core)]
        packed = [sum(1 << k for k, p in enumerate(act) if int(strings[i]) >> p & 1) for i in full]
        order = cistring.strs2addr(len(act), n_spin - len(core), np.array(packed, dtype=np.int64))
        out = np.empty(len(full), dtype=int)
        out[order] = full
        return out

    return small, rows(problem.n_elec[0]), rows(problem.n_elec[1])


def lanczos_measure(problem: Problem, v: np.ndarray, steps: int) -> tuple[np.ndarray, np.ndarray]:
    """Ritz energies and weights of a real vector by Lanczos without reorthogonalization, which keeps three vectors:
    the lost orthogonality only repeats converged states, and their copies share the weight (Paige; Greenbaum)."""
    h_eff = problem.h_eff()
    norm = float(np.linalg.norm(v))
    q, prev, beta, alphas, betas = v / norm, np.zeros_like(v), 0.0, [], []
    for _ in range(steps):
        w = problem.apply_h(q, h_eff) - beta * prev
        alphas.append(float(np.vdot(q, w)))
        w -= alphas[-1] * q
        beta = float(np.linalg.norm(w))
        if beta < 1e-10:
            break
        betas.append(beta)
        prev, q = q, w / beta
    k = len(alphas)
    theta, s = np.linalg.eigh(np.diag(alphas) + np.diag(betas[:k - 1], 1) + np.diag(betas[:k - 1], -1))
    return theta, s[0] ** 2 * norm ** 2


def measure(problem: Problem, v: np.ndarray, e0: float, steps: int) -> tuple[np.ndarray, np.ndarray]:
    """Spectral measure (w = E - E_I, weights) of a complex vector: its real and imaginary parts add. For RIXS final
    states pass `valence(problem)` and the vector's part on its strings: the whole CVS Hamiltonian would also reach the
    doubly core-ionized determinants and shift every level by a little."""
    centres, weights = [np.zeros(0)], [np.zeros(0)]
    for part in (v.real, v.imag):
        if np.linalg.norm(part) < 1e-12:
            continue
        theta, w = lanczos_measure(problem, np.ascontiguousarray(part), steps)
        centres.append(theta - e0)
        weights.append(w)
    return np.concatenate(centres), np.concatenate(weights)


def geometry_sticks(m: dict, geometry: str) -> tuple[np.ndarray, np.ndarray]:
    """Sticks of one geometry from the measures of `rixs_states`: an oriented pair ("xz"), "parallel" or "crossed"
    (a powder), or "isotropic" (sum_ab |R_ab|^2 / 3). Powder sticks can have negative weights; their sum cannot."""
    if geometry in ORIENTED:
        coefficients = {geometry: 1.0}
    else:
        # sum_ab R_ab R_ba^* = sum_a |R_aa|^2 + sum_{a<b} (|R_ab + R_ba|^2 - |R_ab|^2 - |R_ba|^2)
        all9 = {k: 1.0 for k in ORIENTED}
        swap = {k: 1.0 for k in ("xx", "yy", "zz")}
        for key in SWAPS:
            swap[key] = 1.0
            swap[key[:2]] = swap.get(key[:2], 0.0) - 1.0
            swap[key[3:]] = swap.get(key[3:], 0.0) - 1.0
        terms = {"isotropic": ((all9, 1 / 3),), "parallel": (({"tr": 1.0}, 1 / 15), (all9, 1 / 15), (swap, 1 / 15)),
                 "crossed": (({"tr": 1.0}, -1 / 30), (all9, 4 / 30), (swap, -1 / 30))}[geometry]
        coefficients = {}
        for keys, factor in terms:
            for k, c in keys.items():
                coefficients[k] = coefficients.get(k, 0.0) + factor * c
    centres = np.concatenate([m[k][0] for k, c in coefficients.items() if c])
    weights = np.concatenate([c * m[k][1] for k, c in coefficients.items() if c])
    return centres, weights


# ---- the polynomial the circuit applies ----

def trace_shift(problem: Problem) -> float:
    """tr H / 2^(2N), the identity coefficient of the qubit Hamiltonian (each spin orbital half filled on average):
    E_core + sum_p h_pp + 1/2 sum_pr (pp|rr) - 1/4 sum_pq (pq|qp)."""
    h2 = problem.h2
    return float(problem.e_core + np.trace(problem.h1) + 0.5 * np.einsum("pprr->", h2) - 0.25 * np.einsum("pqqp->", h2))


def lambda_df(problem: Problem, tol: float = 1e-8) -> float:
    """The one-norm of the double factorized Hamiltonian (as openfermion's compute_lambda for DF): the eigenvalues of
    the one-body part h - 1/2 sum_r (pr|rq) + sum_r (rr|pq), plus a quarter of the squared one-norm of each factor of
    the two-body supermatrix. It stands in for the one-norm of the tensor hypercontraction the paper uses, which this
    engine does not build."""
    n, h2 = problem.n_orb, problem.h2
    one = problem.h1 - 0.5 * np.einsum("prrq->pq", h2) + np.einsum("rrpq->pq", h2)
    total = float(np.abs(np.linalg.eigvalsh(one)).sum())
    values, vectors = np.linalg.eigh(h2.reshape(n * n, n * n))
    for value, vector in zip(values, vectors.T):
        if value > tol:
            total += 0.25 * value * float(np.abs(np.linalg.eigvalsh(vector.reshape(n, n))).sum()) ** 2
    return total


def green_degree(lam: float) -> int:
    """The paper's degree for Gamma = 0.3 eV, K_G = lambda (472 + 91 ln lambda) with lambda in Ha (Sec. IV)."""
    return int(np.ceil(lam * (472 + 91 * np.log(lam))))


def chebyshev_green(w_in: float, e0: float, shift: float, lam: float, degree: int, gamma: float = GAMMA):
    """Gamma G(w_in) as the degree `degree` Chebyshev interpolant in x = (E - shift) / lam, as a function of the
    absolute energy E. Coefficients from the values at the Chebyshev points by a type II DCT."""
    k = np.arange(degree + 1)
    x = np.cos(np.pi * (k + 0.5) / (degree + 1))
    f = gamma / (w_in + e0 + 1j * gamma - (lam * x + shift))
    c = (dct(f.real, type=2) + 1j * dct(f.imag, type=2)) / (degree + 1)
    c[0] /= 2

    def evaluate(energies: np.ndarray) -> np.ndarray:
        t = (np.asarray(energies) - shift) / lam
        if np.abs(t).max() > 1:
            raise ValueError("an energy lies outside [shift - lambda, shift + lambda]")
        b1 = b2 = np.zeros_like(t, dtype=complex)  # Clenshaw
        for ck in c[:0:-1]:
            b1, b2 = ck + 2 * t * b1 - b2, b1
        return c[0] + t * b1 - b2

    return evaluate
