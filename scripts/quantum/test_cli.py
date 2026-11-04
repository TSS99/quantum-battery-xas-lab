"""Checks of the qxas command line (python -m qxas, or qxas once installed). Run with the engine tests:

  python -B -m unittest discover -s scripts/quantum -p "test_*.py"

The FCIDUMP must read back to the stored integrals and give the stored ground state energy (O 1s kept full), an estimate must equal
the stored rows, and a recipe file must build the library problem it came from.
"""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import asdict
from pathlib import Path

import numpy as np
from pyscf import ao2mo, fci
from pyscf.tools import fcidump

import library
from qxas import builder, problem
from qxas.__main__ import main

WATER = library.OUT / "h2o-o-k-sto3g.json"
ESTIMATES = json.loads((library.ROOT / "src" / "data" / "quantum" / "estimates.json").read_text())


def run(*argv: str) -> str:
    out = io.StringIO()
    with redirect_stdout(out):
        main(list(argv))
    return out.getvalue()


class Cli(unittest.TestCase):
    def test_fcidump_reads_back_and_gives_the_stored_ground_state(self):
        stored, data = builder.load(WATER)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "FCIDUMP"
            self.assertIn("O 1s is orbital 1", run("fcidump", str(WATER), "--out", str(path)))
            dump = fcidump.read(str(path))
        n = dump["NORB"]
        self.assertEqual((n, dump["NELEC"], dump["MS2"]), (7, 10, 0))
        self.assertLess(np.abs(dump["H1"] - stored.h1).max(), 1e-12)
        self.assertLess(np.abs(ao2mo.restore(1, dump["H2"], n) - stored.h2).max(), 1e-12)
        # The ground state keeps the O 1s doubly occupied; a plain full CI on the separated Hamiltonian mixes in double
        # core holes (the terms with two core indices stay) and lands 2.5e-5 Ha lower for water.
        read = problem.Problem("dump", n, (5, 5), dump["ECORE"], dump["H1"], ao2mo.restore(1, dump["H2"], n), stored.dipoles, stored.core, {})
        self.assertAlmostEqual(read.ground_state()[0], data["reference"]["initial_energy_Ha"], places=8)
        plain = fci.direct_spin1.FCI().kernel(dump["H1"], dump["H2"], n, (5, 5), ecore=dump["ECORE"])[0]
        self.assertLess(plain, data["reference"]["initial_energy_Ha"] - 1e-6)

    def test_estimate_gives_the_stored_rows(self):
        row = json.loads(run("estimate", "--orbitals", "11"))
        stored = next(r for r in ESTIMATES["problems"] if r["id"] == "li2mno3-o2-k")
        for key, value in row.items():
            self.assertEqual(value, stored[key], key)
        fine = json.loads(run("estimate", "--orbitals", "11", "--eta", "0.01"))
        self.assertEqual(fine["toffoli_longest_circuit"],
                         next(r for r in ESTIMATES["resolution"] if r["eta_Ha"] == 0.01)["toffoli_longest_circuit"])

    def test_a_recipe_file_builds_the_library_problem(self):
        recipe = next(r for r in library.RECIPES if r.id == "h2o-o-k-sto3g")
        stored, data = builder.load(WATER)
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "recipe.json"
            source.write_text(json.dumps(asdict(recipe)))
            self.assertIn("CAS(10e,7o), 15 qubits, 441 determinants", run("build", str(source), "--out", tmp))
            fresh, built = builder.load(Path(tmp) / f"{recipe.id}.json")
        # SCF stops at 1e-9 Ha, which leaves the integrals equal to about 1e-7 between runs (as in test_library).
        self.assertLess(np.abs(fresh.h2 - stored.h2).max(), 1e-6)
        self.assertAlmostEqual(built["reference"]["edge_eV"], data["reference"]["edge_eV"], places=4)


if __name__ == "__main__":
    unittest.main()
