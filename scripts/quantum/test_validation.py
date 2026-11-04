"""Checks of the comparison with published measurements (src/data/quantum/validation.json). Run with the engine tests:

  python -B -m unittest discover -s scripts/quantum -p "test_*.py"

The stored rows must come back when recomputed from the instance files, every row must name its source, and the
claims in docs/QUANTUM_VALIDATION.md must hold: the small models sit 5 to 9 eV above experiment, while water's peak
spacing is within 0.3 eV.
"""

from __future__ import annotations

import json
import unittest

import validation

DATA = json.loads(validation.OUT.read_text())


class Validation(unittest.TestCase):
    def test_the_rows_come_back_when_recomputed(self):
        self.assertEqual(DATA["rows"], validation.compare())

    def test_every_row_names_its_source(self):
        for row in DATA["rows"]:
            self.assertTrue(row["source"] and row["doi"].startswith("10."), row["feature"])

    def test_absolute_energies_are_high_and_the_water_spacing_is_close(self):
        first = [r for r in DATA["rows"] if len(r["peaks"]) == 1]
        self.assertTrue(all(5 < r["difference_eV"] < 9 for r in first), [r["difference_eV"] for r in first])
        spacing = next(r for r in DATA["rows"] if len(r["peaks"]) == 2)
        self.assertLess(abs(spacing["difference_eV"]), 0.3)


if __name__ == "__main__":
    unittest.main()
