"""Checks of the quantum XAS engine. Run in the pinned environment from the repository root:

  python -B -m unittest discover -s scripts/quantum -p "test_*.py"

They hold the fast determinant-basis emulator to the PennyLane circuit gate for gate, the two exact references to each
other, the Trotter product to the exact evolution, core-valence separation to its definition on the oxygen K edge of
water (and the emulator and the exact reference to the same core-hole Hamiltonian), the spectrum rebuild to the Lorentzian it should give, and the resource model to Table I of 2506.15784.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

import numpy as np
from pyscf import gto, scf

from qxas import cdf, circuit, emulate, exact, problem, sampling

HERE = Path(__file__).resolve().parent


def n2_small() -> problem.Problem:
    mol = gto.M(atom=[["N", (0, 0, -0.5)], ["N", (0, 0, 0.5)]], basis="sto3g", symmetry=True, verbose=0)
    return problem.from_casci("n2", mol, scf.RHF(mol).run(), 5, 4)


def water_k_edge() -> problem.Problem:
    """H2O in STO-3G, all 7 orbitals active, the O 1s (orbital 0) treated by core-valence separation."""
    mol = gto.M(atom="O 0 0 0.1173; H 0 0.7572 -0.4692; H 0 -0.7572 -0.4692", basis="sto3g", verbose=0)
    return problem.from_casci("h2o-k", mol, scf.RHF(mol).run(), 7, 10, core_mo=[0])


class Emulator(unittest.TestCase):
    def test_matches_the_pennylane_circuit_gate_for_gate(self):
        prob = n2_small()
        e0, ci0 = prob.ground_state()
        states, norms = prob.dipole_states(ci0)
        rho = int(np.argmax(norms))
        frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method="exact")
        fast = emulate.HadamardTest(prob, frags).signal(states[rho], 0.5, 4)
        slow = circuit.signal(frags, circuit.statevector(states[rho], prob.n_orb, prob.n_elec), prob.n_orb, 0.5, 4)
        self.assertLess(np.abs(fast - slow).max(), 1e-9)

    def test_trotter_error_falls_as_the_step_squared(self):
        prob = n2_small()
        e0, ci0 = prob.ground_state()
        states, norms = prob.dipole_states(ci0)
        rho = int(np.argmax(norms))
        frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method="exact")
        test = emulate.HadamardTest(prob, frags)
        a, b = exact.lanczos(prob, states[rho], 100)
        theta, vecs = np.linalg.eigh(np.diag(a) + np.diag(b, 1) + np.diag(b, -1))
        times = 0.5 * np.arange(1, 9)
        truth = (vecs[0] ** 2 * np.exp(-1j * np.outer(times, theta))).sum(axis=1)
        errors = [np.abs(test.signal(states[rho], 0.5, 8, substeps=k) - truth).max() for k in (2, 4)]
        self.assertLess(errors[1], errors[0] / 3)  # second order: about a quarter
        self.assertLess(errors[1], 0.02)

    def test_exact_factorization_rebuilds_the_integrals(self):
        # Core-valence separation leaves the integral supermatrix indefinite; the factorization must stay exact.
        for prob in (n2_small(), water_k_edge()):
            frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method="exact")
            h1, h2 = cdf.reconstruct(frags)
            self.assertLess(np.abs(h1 - prob.h1).max(), 1e-9, prob.name)
            self.assertLess(np.abs(h2 - prob.h2).max(), 1e-9, prob.name)


class References(unittest.TestCase):
    def test_lanczos_measure_equals_the_full_eigen_spectrum(self):
        prob = n2_small()
        e0, ci0 = prob.ground_state()
        grid = np.linspace(0, 4, 401)
        w1, wt1 = exact.eigen_spectrum(prob, ci0, e0, nroots=100)
        w2, wt2 = exact.krylov_measure(prob, ci0, e0, steps=100)
        self.assertLess(np.abs(exact.lorentzian(grid, w1, wt1, 0.05) - exact.lorentzian(grid, w2, wt2, 0.05)).max(), 1e-9)
        self.assertAlmostEqual(wt1.sum(), wt2.sum(), places=9)

    def test_spectrum_rebuild_gives_the_lorentzian(self):
        tau, eta, w_f = 0.25, 0.05, 1.3
        times = tau * np.arange(1, 4001)
        signal = np.exp(-1j * w_f * times)
        grid = np.array([w_f, w_f + eta])
        s = sampling.spectrum(grid, times, signal, 1.0, eta, tau)
        self.assertAlmostEqual(s[0], 1 / (np.pi * eta), delta=0.02 / (np.pi * eta))
        self.assertAlmostEqual(s[1] / s[0], 0.5, delta=0.01)


class CoreValenceSeparation(unittest.TestCase):
    def test_the_hamiltonian_keeps_the_core_hole_and_the_dipole_makes_one(self):
        prob = water_k_edge()
        e0, ci0 = prob.ground_state()
        self.assertLess(np.abs(ci0 - prob.project_core(ci0, holes=0)).max(), 1e-12)
        states, norms = prob.dipole_states(ci0)
        rng = np.random.default_rng(1)
        for v in states:
            self.assertLess(np.abs(v - prob.project_core(v, holes=1)).max(), 1e-12)
        x = prob.project_core(rng.normal(size=ci0.shape), holes=1)
        hx = prob.apply_h(x)
        self.assertLess(np.abs(hx - prob.project_core(hx, holes=1)).max(), 1e-10)

    def test_emulator_and_exact_reference_share_the_core_hole_hamiltonian(self):
        prob = water_k_edge()
        e0, ci0 = prob.ground_state()
        states, norms = prob.dipole_states(ci0)
        rho = int(np.argmax(norms))
        frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method="exact")
        a, b = exact.lanczos(prob, states[rho], 80)
        theta, vecs = np.linalg.eigh(np.diag(a) + np.diag(b, 1) + np.diag(b, -1))
        times = 0.05 * np.arange(1, 7)
        truth = (vecs[0] ** 2 * np.exp(-1j * np.outer(times, theta))).sum(axis=1)
        signal = emulate.HadamardTest(prob, frags).signal(states[rho], 0.05, 6, substeps=8)
        self.assertLess(np.abs(signal - truth).max(), 1e-3)

    def test_the_edge_lands_at_the_oxygen_k_edge(self):
        prob = water_k_edge()
        e0, ci0 = prob.ground_state()
        w, wt = exact.krylov_measure(prob, ci0, e0, steps=60)
        first = w[wt > 0.01 * wt.max()].min() * 27.211386
        self.assertTrue(500 < first < 580, first)  # measured near 534 eV; frozen orbitals put it higher


class Resources(unittest.TestCase):
    def test_table_one_at_eighteen_orbitals(self):
        spec = importlib.util.spec_from_file_location("repro_resources", HERE / "repro_resources.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        import pennylane.estimator as qre

        cfg = mod.config()
        ham = qre.CDFHamiltonian(num_orbitals=18, num_fragments=18)
        longest = int(np.ceil(2 * mod.JMAX + 1) * mod.TAU / mod.DELTA)
        toffoli = qre.estimate(mod.circuit, config=cfg)(hamiltonian=ham, steps=longest).gate_counts["Toffoli"]
        self.assertLess(abs(toffoli / 3.11e8 - 1), 0.05)


if __name__ == "__main__":
    unittest.main()
