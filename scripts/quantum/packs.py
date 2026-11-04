#!/usr/bin/env python
"""Browser packs for the Quantum XAS page (Phase 3 of docs/PLAN-quantum.md).

  python scripts/quantum/packs.py [ids...]

For each library instance, src/data/quantum/packs/<id>.json holds what the page needs:

* the exact reference (stick spectrum, edge, initial state energy) from the instance file;
* the noiseless time signal of the Hadamard tests for each dipole direction, at the page's default settings, so the
  page can draw shots and rebuild spectra at once for any problem size. Up to `BOTH_DETERMINANTS` determinants both
  factorizations are run with four Trotter steps per tau; above it (the Mn clusters, where one exact factorization
  pack would take about six hours here) only the compressed one, with one step per tau as in Fig. 9 of the paper;
* for problems small enough to emulate live in the browser (at most `LIVE_DETERMINANTS` determinants), the dipole
  excited states, both sets of fragments and the determinant strings, so the browser emulator can rerun the
  algorithm itself; the stored signal is then also the check that the TypeScript emulator matches this one.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pyscf.fci import cistring  # noqa: E402

import library  # noqa: E402
from qxas import builder, cdf, emulate  # noqa: E402

OUT = library.ROOT / "src" / "data" / "quantum" / "packs"
LIVE_DETERMINANTS = 500
BOTH_DETERMINANTS = 20_000
ETA, H_NORM, JMAX = 0.05, 2.0, 100
# The Trotter step of the paper's cost estimates, sqrt(eta / 1 Ha). One step per tau (the setting of its Figs. 8 and 9)
# leaves an 11 percent Trotter error on the water edge; four steps per tau leave 0.7 percent.
SUBSTEPS = int(np.ceil((np.pi / (2 * H_NORM)) / np.sqrt(ETA / 1.0)))


def rounded(a: np.ndarray, digits: int = 12) -> list:
    return np.vectorize(lambda x: float(f"{x:.{digits}g}"))(np.asarray(a, dtype=float)).tolist()


def complex_list(z: np.ndarray) -> list:
    return [rounded(np.real(z)), rounded(np.imag(z))]


def pack(instance_id: str) -> dict:
    prob, data = builder.load(library.OUT / f"{instance_id}.json")
    ref = data["reference"]
    e0, ci0 = prob.ground_state()
    states, norms = prob.dipole_states(ci0)
    tau = np.pi / (2 * H_NORM)
    out = {"schema": 1, "id": instance_id, "title": data["recipe"]["title"], "instance_hash": data["hash"],
           "meta": data["meta"], "why": data["recipe"]["why"],
           "atoms": [[s, list(xyz)] for s, xyz in builder.geometry(builder.Recipe(**{
               k: tuple(v) if isinstance(v, list) else v for k, v in data["recipe"].items()}))],
           "reference": {k: ref[k] for k in ("initial_energy_Ha", "edge_Ha", "edge_eV", "centres_Ha", "weights")},
           "settings": {"eta_Ha": ETA, "h_norm_Ha": H_NORM, "tau_per_Ha": tau, "jmax": JMAX, "substeps": SUBSTEPS,
                        "trotter_step_per_Ha": tau / SUBSTEPS, "trotter": "second order, fixed fragment order"},
           "initial_energy_Ha": e0, "dipole_norms": norms.tolist(), "signals": {}}
    live = ci0.size <= LIVE_DETERMINANTS
    if live:
        out["live"] = {"n_orb": prob.n_orb, "n_elec": list(prob.n_elec), "e_core": prob.e_core,
                       "strings_alpha": [int(s) for s in cistring.make_strings(range(prob.n_orb), prob.n_elec[0])],
                       "strings_beta": [int(s) for s in cistring.make_strings(range(prob.n_orb), prob.n_elec[1])],
                       "states": [rounded(v) for v in states], "fragments": {}}
    small = ci0.size <= BOTH_DETERMINANTS
    runs = (("exact", None, SUBSTEPS), ("cdf", prob.n_orb, SUBSTEPS)) if small else (("cdf", prob.n_orb, 1),)
    for method, factors, substeps in runs:
        t0 = time.time()
        frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method=method, num_factors=factors)
        test = emulate.HadamardTest(prob, frags)
        out["signals"][method] = {
            "fragments": frags.count, "factor_max_error_Ha": frags.max_error, "substeps": substeps,
            "by_direction": [complex_list(test.signal(v, tau, JMAX, substeps=substeps)) if n else None
                             for v, n in zip(states, norms)],
            "seconds": round(time.time() - t0, 1)}
        if live:
            out["live"]["fragments"][method] = {"u0": rounded(frags.u0), "z0": rounded(frags.z0),
                                                "u": rounded(frags.u), "z": rounded(frags.z)}
    return out


def main() -> None:
    ids = sys.argv[1:] or [r.id for r in library.RECIPES if "quantum-target" not in r.tags]
    OUT.mkdir(parents=True, exist_ok=True)
    for instance_id in ids:
        data = pack(instance_id)
        path = OUT / f"{instance_id}.json"
        path.write_text(json.dumps(data, separators=(",", ":")) + "\n")
        print(f"{instance_id}: {'live' if 'live' in data else 'replay'}, {path.stat().st_size // 1024} KB, "
              + ", ".join(f"{m} {s['fragments']} fragments {s['seconds']} s" for m, s in data["signals"].items()),
              flush=True)
    order = [r.id for r in library.RECIPES]
    index = []
    for path in sorted(OUT.glob("*.json"), key=lambda p: order.index(p.stem) if p.stem in order else len(order)):
        if path.name == "index.json":
            continue
        d = json.loads(path.read_text())
        index.append({"id": d["id"], "title": d["title"], "live": "live" in d, "qubits": d["meta"]["qubits"],
                      "determinants": d["meta"]["ci_dimension"], "edge_eV": d["reference"]["edge_eV"],
                      "kilobytes": path.stat().st_size // 1024})
    (OUT / "index.json").write_text(json.dumps({"schema": 1, "packs": index}, indent=1) + "\n")


if __name__ == "__main__":
    main()
