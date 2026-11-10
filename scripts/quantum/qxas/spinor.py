"""Core spectra with spin orbit coupling, in a spin orbital active space (Phase 10 of docs/PLAN-quantum.md: Mn L
edges).

A 2p hole splits into 2p3/2 and 2p1/2, so an L edge needs spin orbit coupling, and with it the Hamiltonian is
complex and no longer keeps S_z. The problem is built in spin orbitals:

* Orbitals from a spin free X2C ROHF (scalar relativity), the absorber's 2p and 3d shells as the active space, the
  rest frozen with their mean field.
* The spin orbit part is the spin dependent remainder of the one electron X2C Hamiltonian (PySCF's GHF.x2c1e, minus
  its spin free average). That is the bare nuclear term: the screening by the other electrons (the two electron spin
  orbit terms) is left out, which overestimates a 2p splitting by a few percent; the comparison with the measured
  splitting says how much here.
* Two electron integrals are the spin free Coulomb ones. Core valence separation as for the K edges (problem.py), on
  the 2p spin orbitals.

The determinant space is small (16 spin orbitals for 2p and 3d), so each sector's Hamiltonian is built as a dense
matrix from sparse excitation operators E_pq = a+_p a_q, with the two electron part as 1/2 sum_L lambda_L B_L^2
from the eigenvectors of the spatial (pq|rs) supermatrix, B_L = sum_pq v_L,pq (E_pq,alpha + E_pq,beta).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import scipy.sparse as sp
from pyscf import ao2mo, gto, qmmm, scf
from pyscf.fci import cistring

from .builder import HARTREE_EV


@dataclass
class SpinorProblem:
    """n spatial orbitals, spin orbitals alpha 0..n-1 then beta n..2n-1."""
    name: str
    n: int
    n_elec: int
    e_core: float
    h1: np.ndarray  # (2n, 2n) complex, spin orbit coupling included
    h2: np.ndarray  # (n, n, n, n) spatial, chemists' notation
    dipoles: np.ndarray  # (3, n, n) spatial
    core: list[int]  # spatial indices of the core (2p) orbitals
    notes: dict = field(default_factory=dict)

    @property
    def n_so(self) -> int:
        return 2 * self.n

    def core_spin_orbitals(self) -> list[int]:
        return self.core + [c + self.n for c in self.core]


def build(name: str, mol: gto.Mole, d_electrons: int, absorber: str = "Mn", spin_orbit: float = 1.0, point_charges=None,
          notes: dict | None = None) -> SpinorProblem:
    """The absorber's 2p and 3d shells over the spin free X2C ROHF orbitals of `mol`, with CVS on 2p. `spin_orbit`
    scales the spin orbit term (0 gives the spin free problem in spin orbitals); `point_charges` is (coordinates in
    Angstrom, charges), a crystal field from the ligands."""
    # An open d shell in a crystal field has several ROHF solutions, and which one a run finds depends on where it
    # starts; some even move an electron from 3d to 4s. Try a fixed set of starts and keep the lowest with
    # `d_electrons` in the five orbitals of most 3d character, so the orbitals are the same on every run.
    best = None
    for guess, shift in (("minao", 0.0), ("minao", 0.3), ("atom", 0.0), ("atom", 0.3), ("huckel", 0.3), ("1e", 0.5)):
        mf = scf.ROHF(mol).sfx2c1e()
        if point_charges is not None:
            mf = qmmm.mm_charge(mf, *point_charges)
        mf.conv_tol, mf.max_cycle, mf.level_shift, mf.init_guess = 1e-10, 200, shift, guess
        mf.kernel()
        if not mf.converged:  # finish with second order steps from where it got to
            mf = mf.newton()
            mf.kernel(mf.make_rdm1())
        if mf.converged and round(_d_occupation(mol, mf, absorber)) == d_electrons and (best is None or mf.e_tot < best.e_tot - 1e-8):
            best = mf
    if best is None:
        raise RuntimeError(f"{name}: no converged spin free X2C ROHF with {d_electrons} electrons in 3d")
    mf = best
    c = mf.mo_coeff
    s = mol.intor("int1e_ovlp")
    labels = mol.ao_labels()

    def population(shell: str) -> np.ndarray:
        idx = [i for i, label in enumerate(labels) if label.split()[1] == absorber and shell in label]
        return np.einsum("pi,pq,qi->i", c[idx], s[idx], c)

    p2 = list(np.argsort(-population("2p"))[:3])
    d3 = list(np.argsort(-population("3d"))[:5])
    act = sorted(p2) + sorted(d3)
    frozen = [i for i in range(c.shape[1]) if mf.mo_occ[i] == 2 and i not in act]
    n = len(act)
    ca, cf = c[:, act], c[:, frozen]
    dm = 2 * cf @ cf.T
    hcore = mf.get_hcore()
    vj, vk = mf.get_jk(mol, dm)
    e_core = float(mol.energy_nuc() + np.einsum("ij,ji", dm, hcore + 0.5 * (vj - 0.5 * vk)))
    h1_sf = ca.T @ (hcore + vj - 0.5 * vk) @ ca
    h2 = ao2mo.restore(1, ao2mo.full(mol, ca), n)

    nao = mol.nao
    hx = scf.GHF(mol).x2c1e().get_hcore()
    average = 0.5 * (hx[:nao, :nao] + hx[nao:, nao:])
    so = lambda m: ca.T @ m @ ca  # noqa: E731
    h1 = np.zeros((2 * n, 2 * n), complex)
    h1[:n, :n] = h1_sf + spin_orbit * so(hx[:nao, :nao] - average)
    h1[n:, n:] = h1_sf + spin_orbit * so(hx[nao:, nao:] - average)
    h1[:n, n:] = spin_orbit * so(hx[:nao, nao:])
    h1[n:, :n] = spin_orbit * so(hx[nao:, :nao])
    h1 = 0.5 * (h1 + h1.conj().T)  # Hermitian to rounding

    centre = mol.atom_coords()[[i for i in range(mol.natm) if mol.atom_symbol(i) == absorber][0]]
    with mol.with_common_orig(centre):
        dipoles = np.einsum("pi,xpq,qj->xij", ca, mol.intor("int1e_r", comp=3), ca)
    core = list(range(3))
    # CVS: drop every integral with an odd number of 2p indices; the dipole keeps 2p to 3d only.
    is_core = np.zeros(n, int)
    is_core[core] = 1
    one = is_core[:, None] + is_core[None, :]
    two = one[:, :, None, None] + one[None, None, :, :]
    h2 = np.where(two % 2 == 0, h2, 0.0)
    dipoles = np.where((one == 1)[None], dipoles, 0.0)
    spin_one = np.tile(one, (2, 2))
    h1 = np.where(spin_one % 2 == 0, h1, 0.0)
    n_elec = int(round(mol.nelectron - 2 * len(frozen)))
    info = dict(notes or {})
    info.update({"orbital_energies_eV": (mf.mo_energy[act] * HARTREE_EV).round(3).tolist(), "frozen": len(frozen),
                 "d_occupation": float(np.asarray(mf.mo_occ)[d3].sum()), "scf_energy": float(mf.e_tot),
                 "spin_orbit_scale": spin_orbit})
    return SpinorProblem(name, n, n_elec, e_core, h1, h2, dipoles, core, info)


def _d_occupation(mol: gto.Mole, mf, absorber: str) -> float:
    """Electrons in the five occupied or virtual orbitals of most 3d character on the absorber."""
    idx = [i for i, label in enumerate(mol.ao_labels()) if label.split()[1] == absorber and "3d" in label]
    c, s = mf.mo_coeff, mol.intor("int1e_ovlp")
    d = np.argsort(-np.einsum("pi,pq,qi->i", c[idx], s[idx], c))[:5]
    return float(np.asarray(mf.mo_occ)[d].sum())


class Operators:
    """Sparse E_pq = a+_p a_q over every determinant of n_elec electrons in n_so spin orbitals."""

    def __init__(self, n_so: int, n_elec: int):
        self.n_so, self.n_elec = n_so, n_elec
        self.strings = cistring.make_strings(range(n_so), n_elec)
        size = len(self.strings)
        link = cistring.gen_linkstr_index(range(n_so), n_elec)  # [a, i, target, sign]: a+_a a_i |source>
        source = np.repeat(np.arange(size), link.shape[1])
        a, i, target, sign = (link[..., k].ravel() for k in range(4))
        self.e = {}
        for p in range(n_so):
            for q in range(n_so):
                keep = (a == p) & (i == q)
                self.e[p, q] = sp.csr_matrix((sign[keep].astype(float), (target[keep], source[keep])), shape=(size, size))

    def occupation(self, orbitals: list[int]) -> np.ndarray:
        mask = sum(1 << o for o in orbitals)
        return np.array([bin(int(s) & mask).count("1") for s in self.strings])

    def one_body(self, m: np.ndarray) -> sp.csr_matrix:
        out = sp.csr_matrix((len(self.strings), len(self.strings)), dtype=complex)
        for (p, q), e in self.e.items():
            if m[p, q] != 0:
                out = out + m[p, q] * e
        return out


def hamiltonian(problem: SpinorProblem, ops: Operators) -> tuple[sp.csr_matrix, sp.csr_matrix]:
    """The one and two electron parts of H over the whole determinant space: E_core + sum h'_pq E_pq, and
    1/2 sum_L lambda_L B_L^2. Their sum is H; apart they are the two halves of a product formula."""
    n = problem.n
    h2 = problem.h2
    # h'_ps = h_ps - 1/2 sum_q (pq|qs), spin diagonal for spin free (pq|rs)
    k = np.einsum("pqqs->ps", h2)
    h1 = problem.h1.copy()
    h1[:n, :n] -= 0.5 * k
    h1[n:, n:] -= 0.5 * k
    one = ops.one_body(h1) + problem.e_core * sp.identity(len(ops.strings), format="csr")
    two = sp.csr_matrix(one.shape, dtype=complex)
    values, vectors = np.linalg.eigh(h2.reshape(n * n, n * n))
    for value, vector in zip(values, vectors.T):
        if abs(value) < 1e-12:
            continue
        b = ops.one_body(np.kron(np.eye(2), vector.reshape(n, n)))
        two = two + 0.5 * value * (b @ b)
    return one, two


def dipole_operators(problem: SpinorProblem, ops: Operators) -> list[sp.csr_matrix]:
    return [ops.one_body(np.kron(np.eye(2), d).astype(complex)) for d in problem.dipoles]


def sector(ops: Operators, problem: SpinorProblem, holes: int) -> np.ndarray:
    """Determinants with `holes` electrons missing from the 2p spin orbitals. Core valence separation keeps each
    sector apart: with three 2p orbitals the terms that the K edge parity rule keeps can still empty two more of them,
    so the sector's own block of H is the separated Hamiltonian."""
    return np.nonzero(ops.occupation(problem.core_spin_orbitals()) == 2 * len(problem.core) - holes)[0]


def absorption(h: sp.csr_matrix, dipoles: list[sp.csr_matrix], full: np.ndarray, hole: np.ndarray,
               kelvin: float = 300.0, window_eV: float = 0.25) -> dict:
    """Exact stick spectrum (w = E_F - E_0 in Ha, weights summed over x, y, z) from the low states of the full core
    sector, Boltzmann weighted at `kelvin` up to `window_eV` above the lowest, and the core-excited states."""
    e_full, v_full = np.linalg.eigh(h[full][:, full].toarray())
    e_hole, v_hole = np.linalg.eigh(h[hole][:, hole].toarray())
    low = np.nonzero(e_full - e_full[0] < window_eV / HARTREE_EV)[0]
    boltzmann = np.exp(-(e_full[low] - e_full[0]) * HARTREE_EV / (8.617333262e-5 * kelvin))
    boltzmann /= boltzmann.sum()
    weights = np.zeros(len(e_hole))
    starts = []
    for k, b in zip(low, boltzmann):
        psi = np.zeros(h.shape[0], complex)
        psi[full] = v_full[:, k]
        for d in dipoles:
            m = (d @ psi)[hole]
            weights += b * np.abs(v_hole.conj().T @ m) ** 2
            starts.append((b, m))
    return {"e0": float(e_full[0]), "levels_eV": ((e_full[:12] - e_full[0]) * HARTREE_EV).tolist(),
            "centres": e_hole - e_full[0], "weights": weights, "starts": starts, "initial": e_full[low]}


def trotter_signal(one: sp.csr_matrix, two: sp.csr_matrix, hole: np.ndarray, spectrum: dict, offset: float,
                   tau: float, jmax: int, steps: int) -> np.ndarray:
    """G(t_j) = sum over starts of their weight times <m I|e^{-i(H - E_I - offset) t_j}|m I>, t_j = j tau, with
    `steps` second order product formula steps of the one and two electron parts per tau: what the Hadamard tests
    measure before shots, on the axis w - offset with w = E_F - E_I."""
    from scipy.linalg import expm

    a = one[hole][:, hole].toarray() - (spectrum["e0"] + offset) * np.eye(len(hole))
    b = two[hole][:, hole].toarray()
    dt = tau / steps
    half = expm(-0.5j * dt * a)
    step = np.linalg.matrix_power(half @ expm(-1j * dt * b) @ half, steps)
    times = tau * np.arange(1, jmax + 1)
    initial = np.repeat(spectrum["initial"], len(spectrum["starts"]) // len(spectrum["initial"]))
    total = np.zeros(jmax, complex)
    for (weight, m), e_i in zip(spectrum["starts"], initial):
        v, values = m.copy(), np.zeros(jmax, complex)
        for j in range(jmax):
            v = step @ v
            values[j] = np.vdot(m, v)
        total += weight * values * np.exp(1j * (e_i - spectrum["e0"]) * times)
    return total
