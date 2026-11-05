#!/usr/bin/env python
"""EELS data for the Quantum XAS page (Phase 8 of docs/PLAN-quantum.md, qxas/eels.py).

  python scripts/quantum/eels_data.py [ids...]

For each library problem with an exact reference, src/data/quantum/eels/<id>.json holds the exact spectral measures
of m_a|I> and (m_a + m_b)|I>, from which the page builds S(q, w) for any direction of q, and the off-diagonal Hadamard
test signals of the emulated circuit, with the factorization and Trotter steps of the problem's pack, so that with
the pack's diagonal signals the page can rebuild S(q, w) the way the quantum algorithm would. Directions are those
of the problem's own frame (the atoms in its pack).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import library  # noqa: E402
import packs  # noqa: E402
from qxas import builder, cdf, eels, emulate, exact  # noqa: E402
from qxas.builder import HARTREE_EV  # noqa: E402

OUT = library.ROOT / "src" / "data" / "quantum" / "eels"
CHECK_Q = (1 / np.sqrt(3), 1 / np.sqrt(3), 1 / np.sqrt(3))


def data(instance_id: str) -> dict:
    prob, inst = builder.load(library.OUT / f"{instance_id}.json")
    pack = json.loads((packs.OUT / f"{instance_id}.json").read_text())
    e0, ci0 = prob.ground_state()
    states, norms = prob.dipole_states(ci0)
    t0 = time.time()
    m = eels.measures(prob, ci0, e0)
    seconds_measures = time.time() - t0
    method = "exact" if "exact" in pack["signals"] else "cdf"
    s = pack["signals"][method]
    t0 = time.time()
    frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method=method, num_factors=None if method == "exact" else prob.n_orb)
    cross = eels.cross_signals(emulate.HadamardTest(prob, frags), states, norms, pack["settings"]["tau_per_Ha"],
                               pack["settings"]["jmax"], s["substeps"])
    # A check value for the TypeScript side: S(q, w) along (1,1,1) at a few energies, broadened by the pack's eta.
    centres, weights = eels.direction_sticks(m, CHECK_Q)
    w = pack["reference"]["edge_Ha"] + np.array([0.0, 0.05, 0.1, 0.2])
    return {"schema": 1, "id": instance_id, "instance_hash": inst["hash"], "initial_energy_Ha": e0,
            "dipole_norms": packs.rounded(norms),
            "measures": {k: {"centres_Ha": packs.rounded(c), "weights": packs.rounded(wt)} for k, (c, wt) in m.items()},
            "signals": {"factorization": method, "substeps": s["substeps"], "fragments": frags.count,
                        "cross": {k: packs.complex_list(g) if g is not None else None for k, g in cross.items()}},
            "check": {"q": list(CHECK_Q), "energies_eV": packs.rounded(w * HARTREE_EV),
                      "values": packs.rounded(exact.lorentzian(w, centres, weights, pack["settings"]["eta_Ha"]))},
            "seconds": {"measures": round(seconds_measures, 1), "cross_signals": round(time.time() - t0, 1)}}


def order(path: Path) -> int:
    """Library order, so the index lists problems as the page does."""
    ids = [r.id for r in library.RECIPES]
    return ids.index(path.stem) if path.stem in ids else len(ids)


def main() -> None:
    ids = sys.argv[1:] or [r.id for r in library.RECIPES if "quantum-target" not in r.tags]
    OUT.mkdir(parents=True, exist_ok=True)
    for instance_id in ids:
        d = data(instance_id)
        path = OUT / f"{instance_id}.json"
        path.write_text(json.dumps(d, separators=(",", ":")) + "\n")
        print(f"{instance_id}: {path.stat().st_size // 1024} KB, measures {d['seconds']['measures']} s, "
              f"cross signals ({d['signals']['factorization']}) {d['seconds']['cross_signals']} s", flush=True)
    index = [p.stem for p in sorted(OUT.glob("*.json"), key=order) if p.name != "index.json"]
    (OUT / "index.json").write_text(json.dumps({"schema": 1, "problems": index}, indent=1) + "\n")


if __name__ == "__main__":
    main()
