#!/usr/bin/env python
"""Reproduce Table I of 2506.15784 (fault tolerant resources for the Li4Mn2O cluster) with PennyLane's estimator.

Run in the pinned environment from the repository root:  python scripts/quantum/repro_resources.py

The circuit model, in qxas/resources.py, is the one of the PennyLane demo `tutorial_resource_estimation_spectroscopy` (Apache 2.0): load a
sum of 1e4 Slater determinants with QROM, then a Hadamard test around a controlled second order Trotter evolution of a
compressed double factorized Hamiltonian with L = N fragments, rotations to 1e-3 synthesized with a semi adder (phase
gradient), basis rotations as Givens networks, and controlled RZ by the double phase trick (two CNOTs and an RZ).
Settings are the paper's: eta = 0.05 Ha, ||H||_w = 2 Ha so tau = pi/4, j_max = 100, a Trotter step of
sqrt(eta / Y3) with Y3 = 1 Ha, alpha = 1.3384 and a shot budget S = 2500. The longest circuit evolves for the demo's
(2 j_max + 1) tau.

The whole spectrum follows the paper's Eqs. 31 and 32: S_j = S exp(-alpha tau eta j) / A for j = 1..2 j_max, three
dipole directions, real and imaginary parts, so N_Trot = 6 S (tau / Delta) sum_j j exp(-alpha tau eta j) / A Trotter
steps at the per step cost from the estimator, plus a state preparation per circuit. Logical qubits are reported both
from the estimator and from the paper's Eq. 40, 2N + 5 log2(D) - 3. Results go to
src/data/quantum/repro/resources.json, next to the paper's numbers.
"""

from __future__ import annotations

import json
from pathlib import Path

import sys

import numpy as np
import pennylane.estimator as qre

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qxas.resources import ALPHA, DELTA, ETA, H_NORM, JMAX, SHOTS, TAU, circuit, config  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "quantum" / "repro" / "resources.json"

# Table I of 2506.15784: N, logical qubits, Toffolis for the whole algorithm, Toffolis in the longest circuit.
PAPER = [(6, 76, 2.42e10, 1.39e7), (9, 82, 6.21e10, 3.99e7), (10, 84, 8.26e10, 5.39e7), (11, 86, 1.08e11, 7.12e7),
         (14, 92, 2.17e11, 1.46e8), (16, 96, 3.22e11, 2.18e8), (18, 100, 4.58e11, 3.11e8),
         (24, 112, 1.09e12, 7.45e8), (28, 120, 1.74e12, 1.19e9)]

def main() -> None:
    cfg = config()
    longest = int(np.ceil(2 * JMAX + 1) * TAU / DELTA)
    j = np.arange(1, 2 * JMAX + 1)
    kernel = np.exp(-ALPHA * TAU * ETA * j)
    n_trot = 6 * SHOTS * TAU / DELTA * np.sum(j * kernel) / kernel.sum()  # Eq. 32
    circuits = 6 * SHOTS
    rows = []
    for n, qubits_paper, total_paper, longest_paper in PAPER:
        ham = qre.CDFHamiltonian(num_orbitals=n, num_fragments=n)
        big = qre.estimate(circuit, config=cfg)(hamiltonian=ham, steps=longest)
        one = qre.estimate(circuit, config=cfg)(hamiltonian=ham, steps=1, prepare=False).gate_counts["Toffoli"]
        prep = qre.estimate(circuit, config=cfg)(hamiltonian=ham, steps=0).gate_counts["Toffoli"]
        total = float(n_trot * one + circuits * prep)
        rows.append({"orbitals": n, "qubits": int(big.total_wires),
                     "qubits_eq40": int(np.ceil(2 * n + 5 * np.log2(1e4) - 3)), "qubits_paper": qubits_paper,
                     "toffoli_longest": float(big.gate_counts["Toffoli"]), "toffoli_longest_paper": longest_paper,
                     "toffoli_per_step": float(one), "toffoli_state_prep": float(prep),
                     "toffoli_total": total, "toffoli_total_paper": total_paper})
    out = {"source": "2506.15784 Table I; circuit model of PennyLane demo tutorial_resource_estimation_spectroscopy",
           "settings": {"eta_Ha": ETA, "jmax": JMAX, "h_norm_Ha": H_NORM, "tau_per_Ha": TAU, "trotter_step_per_Ha": DELTA,
                        "longest_steps": longest, "total_steps": float(n_trot), "alpha": ALPHA, "shots": SHOTS,
                        "rotation_precision": 1e-3,
                        "slater_determinants": 1e4, "fragments": "L = N"},
           "rows": rows}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"{'N':>3} {'qubits, Eq. 40':>20} {'longest Toffoli':>24} {'total Toffoli':>24}")
    for r in rows:
        print(f"{r['orbitals']:>3} {r['qubits']:>5} {r['qubits_eq40']:>4} ({r['qubits_paper']:>3}) "
              f"{r['toffoli_longest']:>10.3g} ({r['toffoli_longest_paper']:.3g}) "
              f"{r['toffoli_total']:>10.3g} ({r['toffoli_total_paper']:.3g})")


if __name__ == "__main__":
    main()
