"""Checks of the RIXS engine (qxas/rixs.py) and its data (src/data/quantum/rixs). Run with the engine tests:

  python -B -m unittest discover -s scripts/quantum -p "test_*.py"

The Krylov reference must equal the Kramers-Heisenberg sum over every eigenstate; the powder formulas must be the
average over orientations; crossed polarizations along different symmetry axes must leave the molecules no elastic
line; the paper's Chebyshev polynomial must reproduce the Green's function where it matters; and the stored data
must come back.
"""

from __future__ import annotations

import json
import unittest

import numpy as np
from pyscf import fci, lib

import library
import rixs_data
from qxas import builder, exact, rixs
from qxas.builder import HARTREE_EV

WATER = "h2o-o-k-sto3g"
_threads = 1


def setUpModule():
    # Water's vectors are tiny, so PySCF's threads would mostly wait on each other: on 24 cores these checks ran 20
    # times slower than on one.
    global _threads
    _threads = lib.num_threads()
    lib.num_threads(1)


def tearDownModule():
    lib.num_threads(_threads)


def rotations():
    """A product quadrature over the rotation group, exact for polynomials of degree 4 in the matrix entries:
    8 x 8 equally spaced alpha and gamma, Gauss-Legendre in cos(beta)."""
    nodes, weights = np.polynomial.legendre.leggauss(5)
    angles = 2 * np.pi * np.arange(8) / 8
    rz = lambda t: np.array([[np.cos(t), -np.sin(t), 0], [np.sin(t), np.cos(t), 0], [0, 0, 1]])
    ry = lambda c: np.array([[c, 0, np.sqrt(1 - c * c)], [0, 1, 0], [-np.sqrt(1 - c * c), 0, c]])
    for a in angles:
        for c, w in zip(nodes, weights):
            for g in angles:
                yield rz(a) @ ry(c) @ rz(g), w / 2 / 64


class Engine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prob, cls.inst = builder.load(library.OUT / f"{WATER}.json")
        cls.e0, cls.ci0 = rixs.initial_state(cls.prob)
        cls.krylov = rixs.core_krylov(cls.prob, cls.ci0, 300)
        cls.w_in = cls.inst["reference"]["edge_Ha"] + 2.1 / HARTREE_EV  # water's 2b2 resonance
        # Every eigenstate, sector by sector: the CVS Hamiltonian keeps the number of core holes.
        prob, shape = cls.prob, cls.ci0.shape
        addr, matrix = fci.direct_spin1.pspace(prob.h1, prob.h2, prob.n_orb, prob.n_elec, np=cls.ci0.size)

        def sector(holes):
            keep = prob.project_core(np.ones(shape), holes).ravel()[addr] > 0
            energies, v = np.linalg.eigh(matrix[np.ix_(keep, keep)])
            vectors = np.zeros((len(energies), cls.ci0.size))
            vectors[:, addr[keep]] = v.T
            return energies + prob.e_core, vectors.reshape(len(energies), *shape)

        cls.valence, cls.core = sector(0), sector(1)

    def tensors(self, w_in):
        """R_F[a, b] = sum over every core-excited state n of <F|m_b|n><n|m_a|I> / (w_in - (E_n - E_I) + i Gamma)."""
        prob, (en, vn), (ef, vf) = self.prob, self.core, self.valence
        apply = lambda d, v: fci.direct_spin1.contract_1e(d, v, prob.n_orb, prob.n_elec).ravel()
        flat_n, flat_f = vn.reshape(len(en), -1), vf.reshape(len(ef), -1)
        d_in = np.array([flat_n @ apply(d, self.ci0) for d in prob.dipoles])  # (a, n)
        d_out = np.array([flat_f @ np.array([apply(d, v) for v in vn]).T for d in prob.dipoles])  # (b, F, n)
        g = 1 / (w_in + self.e0 + 1j * rixs.GAMMA - en)
        return ef - self.e0, np.einsum("bfn,an,n->fab", d_out, d_in, g)

    def test_the_krylov_reference_is_the_sum_over_every_state(self):
        loss, r = self.tensors(self.w_in)
        small, ia, ib = rixs.valence(self.prob)
        m = {k: rixs.measure(small, v[np.ix_(ia, ib)], self.e0, 300) for k, v in
             rixs.rixs_states(self.prob, self.ci0, self.krylov, self.w_in, self.e0).items()}
        grid = np.linspace(-0.05, 1.2, 400)
        trace = np.einsum("faa->f", r)
        exact_weights = {"xz": np.abs(r[:, 0, 2]) ** 2, "zz": np.abs(r[:, 2, 2]) ** 2, "yz": np.abs(r[:, 1, 2]) ** 2,
                         "parallel": (np.abs(trace) ** 2 + (np.abs(r) ** 2).sum((1, 2)) + np.einsum("fab,fba->f", r, r.conj()).real) / 15,
                         "crossed": (4 * (np.abs(r) ** 2).sum((1, 2)) - np.abs(trace) ** 2 - np.einsum("fab,fba->f", r, r.conj()).real) / 30}
        for geometry, w in exact_weights.items():
            truth = exact.lorentzian(grid, loss, w, 0.005)
            ours = exact.lorentzian(grid, *rixs.geometry_sticks(m, geometry), 0.005)
            self.assertLess(np.abs(ours - truth).max(), 1e-8 * max(truth.max(), 1e-30) + 1e-14, geometry)

    def test_the_powder_formulas_are_averages_over_orientations(self):
        _, r = self.tensors(self.w_in)
        r = r[np.abs(r).sum((1, 2)) > 1e-8 * np.abs(r).sum((1, 2)).max()]
        parallel = crossed = 0
        for rot, w in rotations():
            e_in, e_out = rot[:, 2], rot[:, 0]
            parallel = parallel + w * np.abs(np.einsum("a,fab,b->f", e_in, r, e_in)) ** 2
            crossed = crossed + w * np.abs(np.einsum("a,fab,b->f", e_in, r, e_out)) ** 2
        trace, swap, total = np.abs(np.einsum("faa->f", r)) ** 2, np.einsum("fab,fba->f", r, r.conj()).real, (np.abs(r) ** 2).sum((1, 2))
        self.assertTrue(np.allclose(parallel, (trace + total + swap) / 15, rtol=1e-9, atol=0))
        self.assertTrue(np.allclose(crossed, (4 * total - trace - swap) / 30, rtol=1e-9, atol=0))
        self.assertTrue(np.allclose(parallel + 2 * crossed, total / 3, rtol=1e-9, atol=0))  # the isotropic sum rule

    def test_crossed_polarizations_leave_water_no_elastic_line(self):
        _, r = self.tensors(self.w_in)
        ground = r[0]  # the lowest valence state is the initial one
        self.assertGreater(abs(ground[2, 2]) ** 2 + abs(ground[1, 1]) ** 2, 1e-6)
        self.assertLess(abs(ground[1, 2]) ** 2 + abs(ground[2, 1]) ** 2, 1e-20)  # y then z: symmetry yz, never A1

    def test_the_papers_polynomial_reproduces_the_green_function(self):
        prob = self.prob
        # The shift is the trace of H over the whole Fock space, every sector of every electron number.
        trace, size = 0.0, 0
        for na in range(prob.n_orb + 1):
            for nb in range(prob.n_orb + 1):
                diagonal = fci.direct_spin1.make_hdiag(prob.h1, prob.h2, prob.n_orb, (na, nb)) if na + nb else np.zeros(1)
                trace += float(np.sum(diagonal)) + prob.e_core * diagonal.size
                size += diagonal.size
        self.assertEqual(size, 4 ** prob.n_orb)
        shift, lam = rixs.trace_shift(prob), rixs.lambda_df(prob)
        self.assertAlmostEqual(shift, trace / size, places=9)
        energies = np.concatenate([self.core[0], self.valence[0]])
        self.assertLess(np.abs(energies - shift).max(), lam)  # the spectrum fits the polynomial's interval
        p = rixs.chebyshev_green(self.w_in, self.e0, shift, lam, rixs.green_degree(lam))(self.core[0])
        g = rixs.GAMMA / (self.w_in + self.e0 + 1j * rixs.GAMMA - self.core[0])
        self.assertLess(np.abs(p - g).max(), 1e-3)  # Gamma G is at most 1


class Data(unittest.TestCase):
    def test_every_problem_has_its_data(self):
        index = json.loads((rixs_data.OUT / "index.json").read_text())["problems"]
        self.assertTrue({WATER, "co-o-k-sto3g"} <= set(index), index)
        self.assertEqual(index, [p.stem for p in sorted(rixs_data.OUT.glob("*.json"), key=rixs_data.order) if p.name != "index.json"])
        for problem_id in index:
            d = json.loads((rixs_data.OUT / f"{problem_id}.json").read_text())
            self.assertEqual(d["instance_hash"], json.loads((library.OUT / f"{problem_id}.json").read_text())["hash"])
            m, c = d["maps"][d["check"]["geometry"]], d["check"]
            stored = m["values"][c["row"] * len(d["loss_eV"]) + c["bin"]] * m["scale"] / d["settings"]["levels"]
            self.assertAlmostEqual(stored / c["value"], 1, delta=1e-3)
            self.assertLess(d["polynomial"]["largest_change"], 1e-3, problem_id)
            for g in rixs_data.GEOMETRIES:  # the elastic line and the window hold no more than every final state
                self.assertTrue(all(0 <= e <= t * (1 + 1e-9) for e, t in zip(d["elastic"][g], d["totals"][g])), (problem_id, g))

    def test_co_scatters_without_an_elastic_line_across_its_axis(self):
        d = json.loads((rixs_data.OUT / "co-o-k-sto3g.json").read_text())
        top = max(d["elastic"]["xx"])
        for g in ("xz", "zx", "xy", "yz"):
            self.assertLess(max(d["elastic"][g]) / top, 1e-8, g)

    def test_the_stored_water_data_come_back(self):
        # One incident energy, the strongest, recomputed the way rixs_data.py computes every row.
        stored = json.loads((rixs_data.OUT / f"{WATER}.json").read_text())
        prob, inst = builder.load(library.OUT / f"{WATER}.json")
        e0, ci0 = rixs.initial_state(prob)
        row = stored["polynomial"]["row"]
        w_in = rixs_data.incident_grid(inst["reference"])[row]  # the stored energies are rounded to 8 digits
        green = rixs.green_states(rixs.core_krylov(prob, ci0, rixs_data.CORE_STEPS), ci0.shape, w_in, e0)
        small, ia, ib = rixs.valence(prob)
        m = {k: rixs.measure(small, v[np.ix_(ia, ib)], e0, rixs_data.STEPS) for k, v in rixs.outgoing(prob, green).items()}
        loss, n = np.array(stored["loss_eV"]), len(stored["loss_eV"])
        for g in rixs_data.GEOMETRIES:
            elastic, c, w = rixs_data.split(m, g)
            self.assertAlmostEqual(elastic, stored["elastic"][g][row], delta=1e-7 * stored["totals"][g][row] + 1e-12)
            self.assertAlmostEqual(float(rixs.geometry_sticks(m, g)[1].sum()), stored["totals"][g][row], delta=1e-7 * stored["totals"][g][row] + 1e-12)
            mine = rixs_data.binned(c, w, loss)
            theirs = np.array(stored["maps"][g]["values"][row * n:(row + 1) * n]) * stored["maps"][g]["scale"] / stored["settings"]["levels"]
            self.assertLess(np.abs(mine - theirs).max(), stored["maps"][g]["scale"] / stored["settings"]["levels"], g)  # one level of rounding


if __name__ == "__main__":
    unittest.main()
