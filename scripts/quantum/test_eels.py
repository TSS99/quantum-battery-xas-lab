"""Checks of the EELS engine (qxas/eels.py) and its data (src/data/quantum/eels). Run with the engine tests:

  python -B -m unittest discover -s scripts/quantum -p "test_*.py"

The off-diagonal Hadamard test must give the exact cross correlation; S(q, w) must turn with the sample and average
to the XAS spectrum over orientations; CO's pi* must need a momentum transfer across the bond; and the emulated
signals must rebuild into the exact oriented spectrum.
"""

from __future__ import annotations

import dataclasses
import json
import unittest

import numpy as np
from pyscf import fci

import eels_data
import library
import packs
from qxas import builder, cdf, eels, emulate, exact, sampling

WATER = "h2o-o-k-sto3g"
ETA = 0.05


def rotation(a: float = 0.7, b: float = 0.4, c: float = 1.1) -> np.ndarray:
    rz = lambda t: np.array([[np.cos(t), -np.sin(t), 0], [np.sin(t), np.cos(t), 0], [0, 0, 1]])
    ry = lambda t: np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])
    return rz(a) @ ry(b) @ rz(c)


def turned(prob, r):
    """The same problem with the sample turned by r: the dipole operator rotates as a vector."""
    return dataclasses.replace(prob, dipoles=np.einsum("ab,bij->aij", r, prob.dipoles))


def broadened(sticks, w):
    return exact.lorentzian(w, *sticks, ETA)


class Engine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prob, cls.data = builder.load(library.OUT / f"{WATER}.json")
        cls.e0, cls.ci0 = cls.prob.ground_state()
        cls.w = cls.data["reference"]["edge_Ha"] + np.linspace(-0.2, 1.0, 241)

    def test_the_off_diagonal_test_is_the_exact_cross_correlation(self):
        prob = turned(self.prob, rotation())
        states, norms = prob.dipole_states(self.ci0)
        addr, matrix = fci.direct_spin1.pspace(prob.h1, prob.h2, prob.n_orb, prob.n_elec, np=self.ci0.size)
        energies, vectors = np.linalg.eigh(matrix)
        a, b = states[0].ravel()[addr] @ vectors, states[2].ravel()[addr] @ vectors
        times = 0.05 * np.arange(1, 7)
        truth = (a * b * np.exp(-1j * np.outer(times, energies + prob.e_core))).sum(axis=1)
        self.assertGreater(np.abs(truth).max(), 0.05)  # turned, the x and z tests overlap
        frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method="exact")
        signal = emulate.HadamardTest(prob, frags).signal(states[2], 0.05, 6, substeps=8, bra=states[0])
        self.assertLess(np.abs(signal - truth).max(), 1e-3)

    def test_the_spectrum_turns_with_the_sample_and_averages_to_xas(self):
        r = rotation()
        m = eels.measures(self.prob, self.ci0, self.e0)
        mt = eels.measures(turned(self.prob, r), self.ci0, self.e0)
        q = np.array([0.3, -0.5, 0.8]) / np.linalg.norm([0.3, -0.5, 0.8])
        here, there = broadened(eels.direction_sticks(m, q), self.w), broadened(eels.direction_sticks(mt, r @ q), self.w)
        self.assertLess(np.abs(here - there).max(), 1e-6 * here.max())
        average = sum(broadened(eels.direction_sticks(mt, axis), self.w) for axis in np.eye(3))
        xas = broadened((np.array(self.data["reference"]["centres_Ha"]), np.array(self.data["reference"]["weights"])), self.w)
        self.assertLess(np.abs(average - xas).max(), 1e-6 * xas.max())

    def test_the_emulated_signals_rebuild_into_the_exact_oriented_spectrum(self):
        stored = json.loads((eels_data.OUT / f"{WATER}.json").read_text())
        pack = json.loads((packs.OUT / f"{WATER}.json").read_text())
        s = pack["settings"]
        as_complex = lambda g: None if g is None else np.array(g[0]) + 1j * np.array(g[1])
        diagonal = [as_complex(g) for g in pack["signals"][stored["signals"]["factorization"]]["by_direction"]]
        cross = {k: as_complex(g) for k, g in stored["signals"]["cross"].items()}
        m = {k: (np.array(v["centres_Ha"]), np.array(v["weights"])) for k, v in stored["measures"].items()}
        for q in (np.eye(3)[1], np.ones(3) / np.sqrt(3)):
            sticks = eels.direction_sticks(m, q)
            signal = eels.direction_signal(diagonal, cross, np.array(stored["dipole_norms"]), q)
            times = s["tau_per_Ha"] * np.arange(1, s["jmax"] + 1)
            rebuilt = sampling.spectrum(self.w + stored["initial_energy_Ha"], times, signal, sticks[1].sum(), ETA, s["tau_per_Ha"])
            truth = broadened(sticks, self.w)
            self.assertLess(np.abs(rebuilt - truth).max(), 0.05 * truth.max(), q)

    def test_the_stored_water_data_come_back(self):
        stored = json.loads((eels_data.OUT / f"{WATER}.json").read_text())
        fresh = json.loads(json.dumps(eels_data.data(WATER)))
        for key in ("measures", "signals", "check", "dipole_norms"):
            self.assertEqual(fresh[key], stored[key], key)


class Data(unittest.TestCase):
    def test_co_pi_star_needs_a_momentum_transfer_across_the_bond(self):
        stored = json.loads((eels_data.OUT / "co-o-k-sto3g.json").read_text())
        m = {k: (np.array(v["centres_Ha"]), np.array(v["weights"])) for k, v in stored["measures"].items()}
        pi, sigma = 540.0 / builder.HARTREE_EV, 556.3 / builder.HARTREE_EV  # the model's peaks (validation.py)
        along, across = (broadened(eels.direction_sticks(m, q), np.array([pi, sigma])) for q in (np.eye(3)[2], np.eye(3)[0]))
        # The bond is z: pi* needs q across it. Along it only Lorentzian tails of the sigma states remain (0.9 %).
        self.assertLess(along[0], 0.02 * across[0])
        self.assertGreater(along[1], 3 * across[1])  # and sigma* along it

    def test_every_problem_has_its_data_and_its_check_values(self):
        index = json.loads((eels_data.OUT / "index.json").read_text())["problems"]
        # The other Mn clusters wait for a run of eels_data.py (about ten minutes each on this PC).
        self.assertTrue({WATER, "co-o-k-sto3g", "li2mno3-o2-k"} <= set(index), index)
        self.assertEqual(index, [p.stem for p in sorted(eels_data.OUT.glob("*.json"), key=eels_data.order) if p.name != "index.json"])
        for problem_id in index:
            d = json.loads((eels_data.OUT / f"{problem_id}.json").read_text())
            self.assertEqual(d["instance_hash"], json.loads((library.OUT / f"{problem_id}.json").read_text())["hash"])
            m = {k: (np.array(v["centres_Ha"]), np.array(v["weights"])) for k, v in d["measures"].items()}
            w = np.array(d["check"]["energies_eV"]) / builder.HARTREE_EV
            self.assertTrue(np.allclose(exact.lorentzian(w, *eels.direction_sticks(m, d["check"]["q"]), ETA), d["check"]["values"], rtol=1e-9))


if __name__ == "__main__":
    unittest.main()
