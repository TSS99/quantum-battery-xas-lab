#!/usr/bin/env python
"""The cost of every library problem on a fault tolerant quantum computer (Phase 4 of docs/PLAN-quantum.md).

  python scripts/quantum/estimates.py

For each instance: logical qubits, Toffoli gates in the longest circuit and for the whole spectrum, from PennyLane's
estimator with the circuit model and settings of qxas/resources.py (the paper's Table I model, which this engine
reproduces within 5 percent from 14 orbitals up), then what that means on named machine generations and in run time,
next to the classical cost of the same answer. Each row also carries the cost of a RIXS sample (Phase 9, Loaiza et
al. 2026) with the problem's own double factorized one-norm, and `rixs_paper` reruns that paper's Table 1 with the
same model. Results go to src/data/quantum/estimates.json; every row names the instance hash and the settings, so each
number can be reproduced.

Everything here is a model, labelled as such on the page:
* Machine generations are the vendor's announced targets (IBM, June 2025), not machines that exist. A problem "fits"
  when its logical qubits and its longest circuit's Toffoli gates are within the announced qubits and gates; other
  gates are not counted, so the fit is optimistic.
* Run time is given two ways: one Toffoli after another at a logical clock of 1 MHz, and the paper's active volume
  layout, scaled from its own 18 orbital numbers (8.1e10 logical cycles for 4.58e11 Toffolis, at 1 MHz).
* The classical cost is the paper's rough model of a restricted active space calculation (113 hours per state at 23
  orbitals on a large supercomputer, 1000 states, growing as e^N), which the paper itself calls optimistic.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pennylane as qml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import library  # noqa: E402
from qxas import builder, rixs  # noqa: E402
from qxas.resources import MACHINES, cost, rixs_cost, settings  # noqa: E402

OUT = library.ROOT / "src" / "data" / "quantum" / "estimates.json"
# Finer resolutions for the 11 orbital cathode clusters: what telling their oxygen environments apart in a measured
# spectrum costs (docs/QUANTUM_MEASURE.md).
RESOLUTIONS_HA = (0.05, 0.02, 0.01, 0.005)
RIXS_TABLE_1 = ((16, 105.37, 351, 1.38e10), (18, 117.46, 384, 1.68e10), (20, 125.51, 414, 2.00e10), (22, 141.43, 449, 2.55e10),
                (24, 148.47, 479, 2.93e10), (26, 166.23, 509, 3.59e10), (28, 160.45, 539, 3.72e10), (30, 205.65, 570, 5.25e10))


def main() -> None:
    rows = []
    for recipe in library.RECIPES:
        data = json.loads((library.OUT / f"{recipe.id}.json").read_text())
        row = {"id": recipe.id, "title": recipe.title, "why": recipe.why, "instance_hash": data["hash"],
               "active_electrons": data["meta"]["active_electrons"], "determinants": data["meta"]["ci_dimension"],
               **cost(data["meta"]["active_orbitals"])}
        ref = data.get("reference")
        row["classical_seconds_here"] = ref["seconds"] if ref else None  # the exact Lanczos reference on the build PC
        # A problem without a browser pack (too large to emulate) borrows the atoms of one built on the same cluster.
        geometry = (recipe.structure, recipe.site, recipe.remove, recipe.atoms)
        row["same_atoms_as"] = next((r.id for r in library.RECIPES if r.id != recipe.id and "quantum-target" not in r.tags
                                     and (r.structure, r.site, r.remove, r.atoms) == geometry), None)
        # RIXS at the paper's K_A; the one-norm is the double factorized one of this problem's integrals.
        row["rixs"] = rixs_cost(row["orbitals"], round(rixs.lambda_df(builder.load(library.OUT / f"{recipe.id}.json")[0]), 4))
        rows.append(row)
        print(f"{recipe.id}: {row['orbitals']} orbitals, {row['logical_qubits']} qubits, longest {row['toffoli_longest_circuit']:.3g}, "
              f"whole {row['toffoli_whole_spectrum']:.3g} Toffolis, fits {row['fits']}", flush=True)
    curve = [cost(n) for n in (6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28)]
    resolution = [{"eta_Ha": eta, **cost(11, eta)} for eta in RESOLUTIONS_HA]
    # Table 1 of the RIXS paper (2602.20270): its orbitals and one-norms, its qubits and Toffolis, and this model's.
    rixs_paper = [{"orbitals": n, "one_norm_Ha": lam, "paper_qubits": q, "paper_toffoli": t, **rixs_cost(n, lam)}
                  for n, lam, q, t in RIXS_TABLE_1]
    out = {"schema": 1, "pennylane": qml.__version__,
           "settings": settings(),
           "machines": MACHINES, "problems": rows, "curve": curve, "resolution": resolution, "rixs_paper": rixs_paper}
    OUT.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
