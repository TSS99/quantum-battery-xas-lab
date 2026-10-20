"""Generator regression checks. Run with reference Python -B -m unittest discover
-s scripts/twin -p test_feff_library.py. No FEFF executable is needed here.
"""

from dataclasses import replace
import importlib.util
from pathlib import Path
import unittest

import numpy as np

from structures import CRYSTALS, validate

spec = importlib.util.spec_from_file_location("feff_library", Path(__file__).with_name("make-feff-library.py"))
library = importlib.util.module_from_spec(spec)
spec.loader.exec_module(library)
CU = next(c for c in CRYSTALS if c.id == "cu")
LMO = next(c for c in CRYSTALS if c.id == "limn2o4")


class StructureChecks(unittest.TestCase):
    def test_all_admitted_cells(self):
        for crystal in CRYSTALS:
            with self.subTest(crystal=crystal.id):
                structure, checks, sites = validate(crystal)
                self.assertTrue(checks["passed"])
                self.assertAlmostEqual(sum(s["weight"] for s in sites), 1)
                text, count = library.make_input(crystal, structure, sites[0])
                self.assertEqual((text, count), library.make_input(crystal, structure, sites[0]))
                self.assertIn(f"HOLE {1 if crystal.edge == 'K' else 4} 1.0", text)
                self.assertIn("RMAX 6.0", text)
                self.assertNotIn("CRITERIA", text)
                atoms = text.split("ATOMS\n")[1].split("END")[0].strip().splitlines()
                self.assertEqual(count, len(atoms))
                xyz = np.array([[float(v) for v in line.split()[:3]] for line in atoms])
                radii = np.linalg.norm(xyz, axis=1)
                self.assertEqual(np.count_nonzero(radii < 1e-6), 1)
                self.assertTrue(np.all(radii <= 7.0 + 1e-7))
                self.assertEqual(len({tuple(row) for row in xyz}), count)

    def test_rejects_wrong_formula_density_distance_element_and_orbit(self):
        mutations = [
            (replace(CU, formula="CuO"), "composition"),
            (replace(CU, density_g_cm3=1), "density"),
            (replace(CU, nearest=(replace(CU.nearest[0], distance_A=3),)), "nearest distance"),
            (replace(CU, nearest=(replace(CU.nearest[0], element="O"),)), "nearest element"),
            (replace(CU, nearest=()), "nearest-neighbour"),
            (replace(CU, space_group=229), "space group"),
            (replace(CU, positions=(replace(CU.positions[0], wyckoff="8a"),)), "multiplicity"),
            (replace(CU, positions=(replace(CU.positions[0], fractional=(float("nan"), 0, 0)),)), "fractional"),
            # Applying origin-choice-2 coordinates in choice 1 changes orbits.
            (replace(LMO, setting="Fd-3m:1"), "composition"),
        ]
        for crystal, message in mutations:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    validate(crystal)

    def test_rounding_preserves_flags_and_rejects_nonfinite_data(self):
        self.assertIs(library.rounded({"passed": True})["passed"], True)
        self.assertEqual(library.rounded(np.array([1.234567, -0.0])), [1.2346, 0])
        for value in (float("nan"), float("inf"), -float("inf")):
            with self.assertRaises(ValueError):
                library.rounded(value)


if __name__ == "__main__":
    unittest.main()
