"""Checks of the spin orbit engine (qxas/spinor.py) and the Mn L edge data (src/data/quantum/ledge). Run with the
engine tests:

  python -B -m unittest discover -s scripts/quantum -p "test_*.py"

Without spin orbit coupling the spin orbital Hamiltonian must be PySCF's spin free one; with it, L3 and L2 must split
by about the 11 eV of the manganese 2p levels; the oxidation states must come in the measured order with their L3
shares; and the stored Mn4+ edge must come back, its product formula converging at second order.
"""

from __future__ import annotations

import json
import unittest

import numpy as np
from pyscf import fci, gto
from scipy.sparse.linalg import eigsh

import ledge_data
from qxas import exact, spinor
from qxas.builder import HARTREE_EV

ORDER = ["mn2-oct", "mn3-oct", "mn4-li2mno3"]
STORED = {i: json.loads((ledge_data.OUT / f"{i}.json").read_text()) for i in ORDER}


class Ledge(unittest.TestCase):
    def test_without_spin_orbit_coupling_it_is_the_spin_free_problem(self):
        mol = gto.M(atom="Mn 0 0 0", basis=ledge_data.BASIS, charge=4, spin=3, verbose=0)
        prob = spinor.build("mn4-ion", mol, 3, spin_orbit=0.0)
        n = prob.n
        self.assertEqual(np.abs(prob.h1[:n, n:]).max(), 0.0)  # no spin flips
        self.assertLess(np.abs(prob.h1[:n, :n].imag).max(), 1e-12)
        ops = spinor.Operators(prob.n_so, prob.n_elec)
        one, two = spinor.hamiltonian(prob, ops)
        ours = np.sort(eigsh(one + two, k=6, which="SA", tol=1e-12)[0])
        theirs = fci.direct_spin1.FCI().kernel(prob.h1[:n, :n].real, prob.h2, n, (6, 3), nroots=4, ecore=prob.e_core)[0]
        self.assertAlmostEqual(ours[0], np.min(theirs), delta=1e-8)

    def test_l3_and_l2_split_by_the_mn_2p_spin_orbit_splitting(self):
        for i, d in STORED.items():
            so = d["spin_orbit"]
            # Measured: about 11 eV (11.2 eV between Mn 2p3/2 and 2p1/2 in the metal's photoemission).
            self.assertLess(abs((so["l2_eV"] - so["l3_eV"]) / 11.0 - 1), 0.07, i)
            self.assertGreater(so["l3_share"], 0.5, i)
            self.assertNotIn("l3_eV", d["spin_free"])  # one edge without spin orbit coupling
            self.assertLess(so["l3_eV"], d["spin_free"]["centroid_eV"], i)
            self.assertLess(d["spin_free"]["centroid_eV"], so["l2_eV"], i)

    def test_the_oxidation_states_come_in_the_measured_order(self):
        l3 = [STORED[i]["spin_orbit"]["l3_eV"] for i in ORDER]
        share = [STORED[i]["spin_orbit"]["l3_share"] for i in ORDER]
        self.assertEqual(l3, sorted(l3))  # up with the valence
        self.assertEqual(share, sorted(share, reverse=True))  # and the L3 share down (Qiao et al. 2013)
        for i, d in STORED.items():  # each built on orbitals with its own number of 3d electrons
            self.assertEqual(round(d["scf"]["d_occupation"]), d["d_electrons"], i)

    def test_the_stored_mn4_edge_comes_back(self):
        d = STORED["mn4-li2mno3"]
        p = next(q for q in ledge_data.problems() if q["id"] == "mn4-li2mno3")
        mol = gto.M(atom="Mn 0 0 0", basis=ledge_data.BASIS, charge=p["charge"], spin=p["spin"], verbose=0)
        prob = spinor.build(p["id"], mol, p["d"], point_charges=(np.array(p["ligands"]), -2.0 * np.ones(6)))
        ops = spinor.Operators(prob.n_so, prob.n_elec)
        one, two = spinor.hamiltonian(prob, ops)
        hole = spinor.sector(ops, prob, 1)
        s = spinor.absorption(one + two, spinor.dipole_operators(prob, ops), spinor.sector(ops, prob, 0), hole)
        grid = np.linspace(d["spin_orbit"]["l3_eV"] - 10, d["spin_orbit"]["l2_eV"] + 10, 400)
        ours = exact.lorentzian(grid, s["centres"] * HARTREE_EV, s["weights"], ledge_data.ETA_EV)
        theirs = exact.lorentzian(grid, np.array(d["spin_orbit"]["centres_eV"]), np.array(d["spin_orbit"]["weights"]), ledge_data.ETA_EV)
        self.assertLess(np.abs(ours - theirs).max() / theirs.max(), 1e-6)
        # The product formula is second order: twice the steps, about a quarter of the error.
        offset = d["settings"]["offset_eV"] / HARTREE_EV
        times = ledge_data.TAU * np.arange(1, ledge_data.JMAX + 1)
        truth = (s["weights"][None, :] * np.exp(-1j * np.outer(times, s["centres"] - offset))).sum(1)
        error = {k: np.abs(spinor.trotter_signal(one, two, hole, s, offset, ledge_data.TAU, ledge_data.JMAX, k) - truth).max()
                 for k in (4, 8)}
        self.assertLess(error[8], error[4] / 3)
        self.assertAlmostEqual(error[8] / s["weights"].sum(), d["spin_orbit"]["trotter_error"], delta=1e-4)
        for edge in ("spin_orbit", "spin_free"):
            self.assertLess(d[edge]["trotter_error"], 0.04)


if __name__ == "__main__":
    unittest.main()
