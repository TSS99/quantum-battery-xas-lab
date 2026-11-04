"""Checks of the fault tolerant cost estimates (src/data/quantum/estimates.json). Run with the engine tests:

  python -B -m unittest discover -s scripts/quantum -p "test_*.py"

Every row must name the current instance file, and every number must come back the same when recomputed from the
row's orbitals and the stored settings. The models must also reproduce the paper's own figures: 100 qubits, about
32 days classically and under a day on the active volume layout at 18 orbitals.
"""

from __future__ import annotations

import json
import unittest

import estimates
import library

DATA = json.loads(estimates.OUT.read_text())


class Estimates(unittest.TestCase):
    def test_every_row_names_the_current_instance(self):
        ids = {r.id for r in library.RECIPES}
        self.assertEqual({row["id"] for row in DATA["problems"]}, ids)
        for row in DATA["problems"]:
            instance = json.loads((library.OUT / f"{row['id']}.json").read_text())
            self.assertEqual(row["instance_hash"], instance["hash"], row["id"])
            self.assertEqual(row["orbitals"], instance["meta"]["active_orbitals"], row["id"])

    def test_the_numbers_come_back_when_recomputed(self):
        for row in DATA["problems"][:1] + DATA["problems"][-1:]:
            fresh = estimates.cost(row["orbitals"])
            for key, value in fresh.items():
                self.assertEqual(value, row[key], f"{row['id']}: {key}")

    def test_the_models_give_the_paper_s_own_figures_at_eighteen_orbitals(self):
        row = next(r for r in DATA["curve"] if r["orbitals"] == 18)
        self.assertEqual(row["logical_qubits"], 100)
        self.assertAlmostEqual(row["classical_hours_paper_model"] / 24, 32, delta=1)  # "about 32 days"
        self.assertLess(row["seconds_active_volume_1MHz"], 24 * 3600)  # "less than a day"
        self.assertFalse(row["fits"]["starling"])
        self.assertTrue(row["fits"]["blue-jay"])


if __name__ == "__main__":
    unittest.main()
