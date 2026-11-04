"""Checks of the browser packs (src/data/quantum/packs). Run with the engine tests:

  python -B -m unittest discover -s scripts/quantum -p "test_*.py"

Every pack must come from the current instance file (same hash), carry a signal for every dipole direction with a
nonzero dipole, and list in the index. Water's stored signal must be what the emulator gives today.
"""

from __future__ import annotations

import json
import unittest

import numpy as np

import library
import packs
from qxas import builder, cdf, emulate

FILES = sorted(p for p in packs.OUT.glob("*.json") if p.name != "index.json")


class Packs(unittest.TestCase):
    def test_every_pack_comes_from_the_current_instance(self):
        self.assertTrue(FILES)
        for path in FILES:
            with self.subTest(path.name):
                pack = json.loads(path.read_text())
                instance = json.loads((library.OUT / f"{pack['id']}.json").read_text())
                self.assertEqual(pack["instance_hash"], instance["hash"])
                self.assertTrue(pack["signals"])
                for method, signal in pack["signals"].items():
                    directions = signal["by_direction"]
                    self.assertEqual([d is not None for d in directions], [n > 0 for n in pack["dipole_norms"]], method)
                    for d in directions:
                        if d is not None:
                            self.assertEqual(len(d[0]), pack["settings"]["jmax"])
                            self.assertLessEqual(np.hypot(d[0], d[1]).max(), 1 + 1e-9)  # an overlap of unit vectors

    def test_the_index_lists_every_pack(self):
        index = json.loads((packs.OUT / "index.json").read_text())["packs"]
        self.assertEqual(sorted(e["id"] for e in index), sorted(p.stem for p in FILES))

    def test_water_signal_is_what_the_emulator_gives(self):
        pack = json.loads((packs.OUT / "h2o-o-k-sto3g.json").read_text())
        prob, _ = builder.load(library.OUT / "h2o-o-k-sto3g.json")
        e0, ci0 = prob.ground_state()
        states, norms = prob.dipole_states(ci0)
        k = int(np.argmax(norms))
        frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method="exact")
        signal = pack["signals"]["exact"]
        fresh = emulate.HadamardTest(prob, frags).signal(states[k], pack["settings"]["tau_per_Ha"], 5, substeps=signal["substeps"])
        stored = np.array(signal["by_direction"][k][0][:5]) + 1j * np.array(signal["by_direction"][k][1][:5])
        self.assertLess(np.abs(fresh - stored).max(), 1e-8)


if __name__ == "__main__":
    unittest.main()
