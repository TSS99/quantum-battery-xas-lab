#!/usr/bin/env python
"""The cost of every library problem on a fault tolerant quantum computer (Phase 4 of docs/PLAN-quantum.md).

  python scripts/quantum/estimates.py

For each instance: logical qubits, Toffoli gates in the longest circuit and for the whole spectrum, from PennyLane's
estimator with the circuit model and settings of repro_resources.py (the paper's Table I model, which this engine
reproduces within 5 percent from 14 orbitals up), then what that means on named machine generations and in run time,
next to the classical cost of the same answer. Results go to src/data/quantum/estimates.json; every row names the
instance hash and the settings, so each number can be reproduced.

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

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pennylane as qml
import pennylane.estimator as qre

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import library  # noqa: E402

spec = importlib.util.spec_from_file_location("repro_resources", HERE / "repro_resources.py")
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)

OUT = library.ROOT / "src" / "data" / "quantum" / "estimates.json"
CLOCK_HZ = 1e6
ACTIVE_VOLUME_CYCLES_PER_TOFFOLI = 8.1e10 / 4.58e11  # the paper's 18 orbital numbers
MACHINES = [
    {"id": "starling", "name": "IBM Starling class", "year": 2029, "logical_qubits": 200, "gates": 1e8,
     "source": "IBM roadmap, June 2025"},
    {"id": "blue-jay", "name": "IBM Blue Jay class", "year": 2033, "logical_qubits": 2000, "gates": 1e9,
     "source": "IBM roadmap, June 2025"},
]


def classical_hours(orbitals: int) -> float:
    """The paper's rough restricted active space model (Sec. V D of 2506.15784), optimistic by its own account."""
    return 113.0 * np.exp(orbitals - 23) * 1000


def cost(orbitals: int) -> dict:
    cfg = model.config()
    ham = qre.CDFHamiltonian(num_orbitals=orbitals, num_fragments=orbitals)
    longest_steps = int(np.ceil(2 * model.JMAX + 1) * model.TAU / model.DELTA)
    big = qre.estimate(model.circuit, config=cfg)(hamiltonian=ham, steps=longest_steps)
    one = qre.estimate(model.circuit, config=cfg)(hamiltonian=ham, steps=1, prepare=False).gate_counts["Toffoli"]
    prep = qre.estimate(model.circuit, config=cfg)(hamiltonian=ham, steps=0).gate_counts["Toffoli"]
    j = np.arange(1, 2 * model.JMAX + 1)
    kernel = np.exp(-model.ALPHA * model.TAU * model.ETA * j)
    n_trot = 6 * model.SHOTS * model.TAU / model.DELTA * np.sum(j * kernel) / kernel.sum()
    total = float(n_trot * one + 6 * model.SHOTS * prep)
    longest = float(big.gate_counts["Toffoli"])
    qubits = int(np.ceil(2 * orbitals + 5 * np.log2(1e4) - 3))
    return {
        "orbitals": orbitals, "logical_qubits": qubits, "logical_qubits_estimator": int(big.total_wires),
        "toffoli_longest_circuit": longest, "toffoli_whole_spectrum": total, "circuits": 6 * model.SHOTS,
        "seconds_sequential_1MHz": total / CLOCK_HZ,
        "seconds_active_volume_1MHz": total * ACTIVE_VOLUME_CYCLES_PER_TOFFOLI / CLOCK_HZ,
        "fits": {m["id"]: bool(qubits <= m["logical_qubits"] and longest <= m["gates"]) for m in MACHINES},
        "classical_hours_paper_model": classical_hours(orbitals),
    }


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
        rows.append(row)
        print(f"{recipe.id}: {row['orbitals']} orbitals, {row['logical_qubits']} qubits, longest {row['toffoli_longest_circuit']:.3g}, "
              f"whole {row['toffoli_whole_spectrum']:.3g} Toffolis, fits {row['fits']}", flush=True)
    curve = [cost(n) for n in (6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28)]
    out = {"schema": 1, "pennylane": qml.__version__,
           "settings": {"eta_Ha": model.ETA, "jmax": model.JMAX, "h_norm_Ha": model.H_NORM, "tau_per_Ha": model.TAU,
                        "trotter_step_per_Ha": model.DELTA, "alpha": model.ALPHA, "shots": model.SHOTS,
                        "rotation_precision": 1e-3, "slater_determinants": 1e4, "fragments": "L = N",
                        "clock_Hz": CLOCK_HZ, "active_volume_cycles_per_toffoli": ACTIVE_VOLUME_CYCLES_PER_TOFFOLI},
           "machines": MACHINES, "problems": rows, "curve": curve}
    OUT.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
