"""A spectroscopy problem in an active space: integrals, dipoles, the initial state and the dipole-excited states.

Everything is built with PySCF and kept in the PySCF determinant (CI) basis, where applying an operator or a Hamiltonian
is cheap; qubit statevectors are made from it only when a circuit needs one (statevector.py). Conventions follow
Fomichev et al., arXiv 2405.11015 and 2506.15784:

* The Hamiltonian is H = E_core + sum_pq h_pq E_pq + 1/2 sum_pqrs (pq|rs) (E_pq E_rs - delta_qr E_ps), with h the
  one-electron integrals of the active orbitals including the frozen core, and (pq|rs) in chemists' notation.
* The dipole of direction rho acts as m_rho = sum_pq d_pq E_pq, with the origin at the nuclear charge centre. Its
  expectation value in the initial state is subtracted (m -> m - <I|m|I>), which removes the elastic peak at w = 0.
* With core-valence separation (CVS) the core orbitals are part of the active space, every integral with an odd
  number of core indices is dropped, and the dipole keeps only core to valence terms. Those odd terms are the ones
  that couple core-excited states to valence-excited ones; the terms with two core indices that move two electrons at
  once cannot act on a state with exactly one core hole, so a state with one core hole evolves among core-excited
  states only. Dropping by index parity keeps the integrals' eightfold symmetry, which PySCF's packed storage needs;
  a rule that also dropped the two-electron moves would break it, and PySCF would then use a different Hamiltonian.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

import numpy as np
from pyscf import ao2mo, fci, gto, mcscf, scf
from pyscf.fci import cistring


@dataclass
class Problem:
    name: str
    n_orb: int
    n_elec: tuple[int, int]
    e_core: float
    h1: np.ndarray
    h2: np.ndarray
    dipoles: np.ndarray
    core: list[int] = field(default_factory=list)
    notes: dict = field(default_factory=dict)

    @property
    def qubits(self) -> int:
        return 2 * self.n_orb

    def recipe_hash(self) -> str:
        """A short hash of everything that defines the problem, so results can name the exact problem they used."""
        digest = hashlib.sha256()
        for array in (self.h1, self.h2, self.dipoles):
            digest.update(np.ascontiguousarray(np.round(array, 10)).tobytes())
        digest.update(json.dumps([self.n_orb, list(self.n_elec), round(self.e_core, 10), self.core]).encode())
        return digest.hexdigest()[:16]

    # ---- the Hamiltonian in the determinant basis ----
    def h_eff(self) -> np.ndarray:
        return fci.direct_spin1.absorb_h1e(self.h1, self.h2, self.n_orb, self.n_elec, 0.5)

    def apply_h(self, ci: np.ndarray, h_eff: np.ndarray | None = None) -> np.ndarray:
        h_eff = self.h_eff() if h_eff is None else h_eff
        return fci.direct_spin1.contract_2e(h_eff, ci, self.n_orb, self.n_elec) + self.e_core * ci

    def ci_shape(self) -> tuple[int, int]:
        return (cistring.num_strings(self.n_orb, self.n_elec[0]), cistring.num_strings(self.n_orb, self.n_elec[1]))

    def ground_state(self) -> tuple[float, np.ndarray]:
        """Lowest eigenstate in the sector of full core orbitals (for CVS problems) or overall."""
        solver = fci.direct_spin1.FCI()
        solver.conv_tol = 1e-12
        energy, ci = solver.kernel(self.h1, self.h2, self.n_orb, self.n_elec, ecore=self.e_core)
        ci = np.asarray(ci).reshape(self.ci_shape())
        if self.core:
            ci = self.project_core(ci, holes=0)
            ci /= np.linalg.norm(ci)
            energy = float(np.vdot(ci, self.apply_h(ci)).real)
        return float(energy), ci

    def project_core(self, ci: np.ndarray, holes: int) -> np.ndarray:
        """Keep the determinants with exactly `holes` electrons missing from the core orbitals."""
        full = 2 * len(self.core)
        mask_a = _core_count(self.n_orb, self.n_elec[0], self.core)
        mask_b = _core_count(self.n_orb, self.n_elec[1], self.core)
        keep = (mask_a[:, None] + mask_b[None, :]) == full - holes
        return np.where(keep, ci, 0.0)

    def dipole_states(self, ci0: np.ndarray) -> tuple[list[np.ndarray], np.ndarray]:
        """m_rho|I> for rho = x, y, z, normalized, and their norms; m has <I|m|I> subtracted."""
        states, norms = [], []
        for d in self.dipoles:
            v = fci.direct_spin1.contract_1e(d, ci0, self.n_orb, self.n_elec).reshape(ci0.shape)
            v = v - np.vdot(ci0, v) * ci0
            norm = float(np.linalg.norm(v))
            states.append(v / norm if norm > 1e-10 else np.zeros_like(v))
            norms.append(norm)
        return states, np.array(norms)


def _core_count(n_orb: int, n_elec: int, core: list[int]) -> np.ndarray:
    strings = cistring.make_strings(range(n_orb), n_elec)
    core_bits = sum(1 << c for c in core)
    return np.array([bin(int(s) & core_bits).count("1") for s in strings])


def apply_cvs(h1: np.ndarray, h2: np.ndarray, dipoles: np.ndarray, core: list[int]):
    """Drop every integral with an odd number of core indices; keep only core to valence dipole terms."""
    n = h1.shape[0]
    is_core = np.zeros(n, dtype=int)
    is_core[core] = 1
    one = is_core[:, None] + is_core[None, :]
    h1 = np.where(one % 2 == 0, h1, 0.0)
    two = one[:, :, None, None] + one[None, None, :, :]
    h2 = np.where(two % 2 == 0, h2, 0.0)
    dipoles = np.where((one == 1)[None], dipoles, 0.0)
    return h1, h2, dipoles


def from_casci(name: str, mol: gto.Mole, mf: scf.hf.SCF, n_orb: int, n_elec, mo_coeff=None, core_mo: list[int] | None = None,
               ncore: int | None = None, notes: dict | None = None) -> Problem:
    """Active-space integrals and dipoles of a mean-field calculation. `core_mo` lists active orbitals treated by CVS."""
    mc = mcscf.CASCI(mf, n_orb, n_elec, ncore=ncore)
    # An orbital's overall sign is arbitrary and can differ between runs; fix it (largest coefficient positive) so the
    # integrals, and the hash, are the same every time.
    mo = np.array(mf.mo_coeff if mo_coeff is None else mo_coeff, dtype=float)
    mo *= np.sign(mo[np.abs(mo).argmax(axis=0), np.arange(mo.shape[1])])
    mc.mo_coeff = mo
    h1, e_core = mc.get_h1eff()
    h2 = ao2mo.restore(1, mc.get_h2eff(), n_orb)
    charges = mol.atom_charges()
    centre = np.einsum("z,zx->x", charges, mol.atom_coords()) / charges.sum()
    with mol.with_common_orig(centre):
        d_ao = mol.intor("int1e_r", comp=3)
    c_act = mc.mo_coeff[:, mc.ncore:mc.ncore + n_orb]
    dipoles = np.einsum("pi,xpq,qj->xij", c_act, d_ao, c_act)
    core = list(core_mo or [])
    if core:
        h1, h2, dipoles = apply_cvs(h1, h2, dipoles, core)
    nelec = mc.nelecas
    return Problem(name, n_orb, (int(nelec[0]), int(nelec[1])), float(e_core), np.asarray(h1), np.asarray(h2),
                   np.asarray(dipoles), core, dict(notes or {}))
