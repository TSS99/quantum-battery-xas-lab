#!/usr/bin/env python
"""Mn L edge data for the Quantum XAS page (Phase 10 of docs/PLAN-quantum.md, qxas/spinor.py).

  python scripts/quantum/ledge_data.py

Three manganese oxidation states in octahedral crystal fields: the Mn ion with its 2p and 3d shells active and the
six oxide ligands as point charges of -2. Mn4+ sits in the octahedron of Li2MnO3 (COD 1008373, as the oxygen K edge
clusters); Mn3+ in an octahedron elongated as Jahn-Teller makes it (4 x 1.93 and 2 x 2.27 A, mean 2.045 A, the sum of
Shannon's ionic radii), and Mn2+ in a regular one at 2.222 A (MnO, half its cubic cell). Each is built with spin orbit coupling and
without, and src/data/quantum/ledge/<id>.json holds the exact stick spectrum (Boltzmann weighted over the low states
at 300 K), the L3 and L2 analysis, and the Hadamard test signal G(t_j) with product formula steps, from which the page
draws shots and rebuilds the spectrum as for the oxygen K edge.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from pyscf import gto

sys.path.insert(0, str(Path(__file__).resolve().parent))
import library  # noqa: E402
import packs  # noqa: E402
from qxas import cluster, exact, resources, spinor  # noqa: E402
from qxas.builder import HARTREE_EV  # noqa: E402

OUT = library.ROOT / "src" / "data" / "quantum" / "ledge"
BASIS = "cc-pvdz-dk"
ETA_EV = 0.3  # Lorentzian half width, about the Mn 2p3/2 core hole
TAU = 3.0  # per Ha: a window of 2 pi / tau = 2.1 Ha (57 eV) around the offset, wide enough for L3 and L2
JMAX = 140  # t_max eta = 4.6: the signal has fallen to 1 %
STEPS = 8  # product formula steps per tau
WINDOW_EV = (-15.0, 25.0)  # the plotted range around the L3 centroid


def octahedron(r: float, axial: float | None = None) -> list[list[float]]:
    z = r if axial is None else axial
    return [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, z], [0, 0, -z]]


def problems() -> list[dict]:
    shell = cluster.first_shells(library.ROOT / "scripts" / "quantum" / "structures" / library.LI2MNO3, centre="Mn")[0]
    return [
        {"id": "mn2-oct", "title": "Mn²⁺, octahedral (MnO)", "charge": 2, "spin": 5, "d": 5,
         "why": "High spin d5 as in MnO: Mn-O 2.222 A, half the rock salt cell.", "ligands": octahedron(2.222)},
        {"id": "mn3-oct", "title": "Mn³⁺, octahedral, Jahn-Teller", "charge": 3, "spin": 4, "d": 4,
         "why": "High spin d4 in an octahedron elongated as Jahn-Teller makes it, Mn-O 4 x 1.93 and 2 x 2.27 A, whose "
                "mean is the 2.045 A sum of Shannon's ionic radii.", "ligands": octahedron(1.93, 2.27)},
        {"id": "mn4-li2mno3", "title": "Mn⁴⁺ in Li₂MnO₃", "charge": 4, "spin": 3, "d": 3,
         "why": "d3 in the octahedron of Li2MnO3 (Mn-O 1.904 to 1.919 A), the cathode of the oxygen K edge problems.",
         "ligands": [xyz for _, xyz in shell["atoms"][1:]]},
    ]


def l_edge_shape(centres_eV: np.ndarray, weights: np.ndarray) -> dict:
    """L3 and L2 centroids, split at the deepest minimum 4 to 14 eV above the strongest peak of the broadened
    spectrum, and L3's share of the intensity (the branching ratio)."""
    grid = np.arange(centres_eV.min() - 5, centres_eV.max() + 5, 0.02)
    y = exact.lorentzian(grid, centres_eV, weights, ETA_EV)
    top = grid[y.argmax()]
    between = (grid > top + 4) & (grid < top + 14)
    cut = grid[between][y[between].argmin()]
    low = centres_eV < cut
    return {"strongest_eV": round(float(top), 3), "l3_eV": round(float(np.average(centres_eV[low], weights=weights[low])), 3),
            "l2_eV": round(float(np.average(centres_eV[~low], weights=weights[~low])), 3), "cut_eV": round(float(cut), 3),
            "l3_share": round(float(weights[low].sum() / weights.sum()), 4)}


def data(p: dict) -> dict:
    mol = gto.M(atom="Mn 0 0 0", basis=BASIS, charge=p["charge"], spin=p["spin"], verbose=0)
    charges = (np.array(p["ligands"], float), -2.0 * np.ones(len(p["ligands"])))
    out = {"schema": 1, "id": p["id"], "title": p["title"], "why": p["why"], "basis": BASIS, "d_electrons": p["d"],
           "ligands_A": [[round(x, 6) for x in xyz] for xyz in p["ligands"]],
           "settings": {"eta_eV": ETA_EV, "tau_per_Ha": TAU, "jmax": JMAX, "trotter_steps": STEPS, "kelvin": 300}}
    offset = None
    for key, scale in (("spin_orbit", 1.0), ("spin_free", 0.0)):
        t0 = time.time()
        prob = spinor.build(p["id"], mol, p["d"], spin_orbit=scale, point_charges=charges, notes={"why": p["why"]})
        ops = spinor.Operators(prob.n_so, prob.n_elec)
        one, two = spinor.hamiltonian(prob, ops)
        full, hole = spinor.sector(ops, prob, 0), spinor.sector(ops, prob, 1)
        s = spinor.absorption(one + two, spinor.dipole_operators(prob, ops), full, hole)
        keep = s["weights"] > 1e-7 * s["weights"].max()
        centres_eV, weights = s["centres"][keep] * HARTREE_EV, s["weights"][keep]
        # Without spin orbit coupling there is one 2p edge: its strongest peak and centroid, nothing to split.
        shape = l_edge_shape(centres_eV, weights) if scale else {
            "strongest_eV": round(float(centres_eV[weights.argmax()]), 3), "centroid_eV": round(float(np.average(centres_eV, weights=weights)), 3)}
        if offset is None:  # both spectra share the axis of the spin orbit one
            offset = shape["l3_eV"]
            out["settings"]["offset_eV"] = offset
        signal = spinor.trotter_signal(one, two, hole, s, offset / HARTREE_EV, TAU, JMAX, STEPS)
        times = TAU * np.arange(1, JMAX + 1)
        exact_signal = (s["weights"][None, :] * np.exp(-1j * np.outer(times, s["centres"] - offset / HARTREE_EV))).sum(1)
        out[key] = {"centres_eV": packs.rounded(centres_eV, 10), "weights": packs.rounded(weights, 10), **shape,
                    "levels_eV": packs.rounded(s["levels_eV"], 6), "signal": packs.complex_list(signal),
                    "trotter_error": float(f"{np.abs(signal - exact_signal).max() / s['weights'].sum():.3g}"),
                    "sectors": [len(full), len(hole)], "seconds": round(time.time() - t0, 1)}
        out["spin_orbitals"], out["electrons"] = prob.n_so, prob.n_elec
        out["orbital_energies_eV"] = prob.notes["orbital_energies_eV"]
        out["scf"] = {"energy_Ha": prob.notes["scf_energy"], "d_occupation": prob.notes["d_occupation"]}
    # The fault tolerant cost in the oxygen K edge model, with the spin orbitals as qubits and this resolution.
    out["cost"] = resources.cost(out["spin_orbitals"] // 2, ETA_EV / HARTREE_EV)
    out["check"] = {"energies_eV": [offset, offset + 10.0],
                    "values": packs.rounded(exact.lorentzian(np.array([offset, offset + 10.0]), np.array(out["spin_orbit"]["centres_eV"]),
                                                             np.array(out["spin_orbit"]["weights"]), ETA_EV), 10)}
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ids = []
    for p in problems():
        d = data(p)
        (OUT / f"{p['id']}.json").write_text(json.dumps(d, separators=(",", ":")) + "\n")
        ids.append(p["id"])
        so = d["spin_orbit"]
        print(f"{p['id']}: L3 {so['l3_eV']} eV, L2 {so['l2_eV']} eV, split {so['l2_eV'] - so['l3_eV']:.2f} eV, L3 share {so['l3_share']}, "
              f"product formula error {so['trotter_error']:.1e}, {so['seconds'] + d['spin_free']['seconds']:.0f} s", flush=True)
    (OUT / "index.json").write_text(json.dumps({"schema": 1, "problems": ids}, indent=1) + "\n")


if __name__ == "__main__":
    main()
