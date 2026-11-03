"""Checks of the instance library (src/data/quantum/instances). Run with the engine tests:

  python -B -m unittest discover -s scripts/quantum -p "test_*.py"

Every file must match its own hash, have consistent shapes and the eightfold integral symmetry core-valence separation
keeps, and appear in the index. Water rebuilds from its recipe to the stored numbers. The Mn clusters must have the
active orbitals their recipes promise; rebuilding them takes minutes, so that runs only with QXAS_SLOW=1.
"""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

import numpy as np

import library
from qxas import builder, exact

FILES = sorted(p for p in library.OUT.glob("*.json") if p.name != "index.json")


class Files(unittest.TestCase):
    def test_every_file_matches_its_hash_and_shapes(self):
        self.assertTrue(FILES)
        for path in FILES:
            with self.subTest(path.name):
                prob, data = builder.load(path)
                n = prob.n_orb
                self.assertEqual(prob.h1.shape, (n, n))
                self.assertEqual(prob.h2.shape, (n, n, n, n))
                self.assertEqual(prob.dipoles.shape, (3, n, n))
                self.assertEqual(data["meta"]["qubits"], 2 * n + 1)
                self.assertTrue(0 <= prob.core[0] < n)
                self.assertLess(np.abs(prob.h1 - prob.h1.T).max(), 1e-10)
                for axes in ((1, 0, 2, 3), (0, 1, 3, 2), (2, 3, 0, 1)):
                    self.assertLess(np.abs(prob.h2 - prob.h2.transpose(axes)).max(), 1e-10)

    def test_the_index_lists_every_file(self):
        index = json.loads((library.OUT / "index.json").read_text())["instances"]
        self.assertEqual({e["id"]: e["hash"] for e in index},
                         {json.loads(p.read_text())["recipe"]["id"]: json.loads(p.read_text())["hash"] for p in FILES})

    def test_every_recipe_has_a_file(self):
        self.assertEqual({r.id for r in library.RECIPES}, {p.stem for p in FILES})


class Rebuild(unittest.TestCase):
    def test_water_rebuilds_to_the_stored_numbers(self):
        recipe = next(r for r in library.RECIPES if r.id == "h2o-o-k-sto3g")
        stored, data = builder.load(library.OUT / f"{recipe.id}.json")
        fresh, meta = builder.build(recipe)
        # SCF stops at 1e-9 Ha, which leaves the orbitals, and so the integrals, equal to about 1e-7 between runs.
        self.assertLess(np.abs(fresh.h1 - stored.h1).max(), 1e-6)
        self.assertLess(np.abs(fresh.h2 - stored.h2).max(), 1e-6)
        self.assertLess(np.abs(np.abs(fresh.dipoles) - np.abs(stored.dipoles)).max(), 1e-6)
        e0, ci0 = stored.ground_state()
        self.assertAlmostEqual(e0, data["reference"]["initial_energy_Ha"], places=8)
        centres, weights = exact.krylov_measure(stored, ci0, e0, steps=60)
        grid = np.linspace(19, 25, 301)
        ref = data["reference"]
        a = exact.lorentzian(grid, centres, weights, 0.05)
        b = exact.lorentzian(grid, np.array(ref["centres_Ha"]), np.array(ref["weights"]), 0.05)
        self.assertLess(np.abs(a - b).max() / b.max(), 1e-6)


class ActiveSpaces(unittest.TestCase):
    def test_li2mno3_clusters_keep_ten_mn_3d_orbitals_and_the_o_1s(self):
        for path in FILES:
            data = json.loads(path.read_text())
            if "li2mno3" not in data["recipe"]["tags"] or "quantum-target" in data["recipe"]["tags"]:
                continue
            with self.subTest(path.name):
                comp = data["meta"]["composition"]
                self.assertEqual(len(comp), 11)
                core = comp[data["meta"]["core_index"]]
                self.assertIn("O 1s", core[0][0])
                self.assertGreater(core[0][1], 0.9)
                mn = [c for k, c in enumerate(comp) if k != data["meta"]["core_index"]]
                self.assertTrue(all("Mn 3d" in c[0][0] for c in mn), mn)

    @unittest.skipUnless(os.environ.get("QXAS_SLOW"), "set QXAS_SLOW=1 to rebuild a Mn cluster (minutes)")
    def test_li4mn2o_rebuilds_to_the_stored_numbers(self):
        recipe = next(r for r in library.RECIPES if r.id == "li2mno3-o2-k")
        stored, _ = builder.load(library.OUT / f"{recipe.id}.json")
        fresh, _ = builder.build(recipe)
        # PySCF's second order SCF stops this cluster at an orbital gradient of about 3e-5, so the orbitals, and the
        # integrals, agree to about 1e-5 Ha between runs: two thousand times below the 1 eV scale of the spectra.
        self.assertLess(np.abs(np.abs(fresh.h2) - np.abs(stored.h2)).max(), 1e-4)


if __name__ == "__main__":
    unittest.main()
