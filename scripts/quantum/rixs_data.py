#!/usr/bin/env python
"""RIXS data for the Quantum XAS page (Phase 9 of docs/PLAN-quantum.md, qxas/rixs.py).

  python scripts/quantum/rixs_data.py [ids...]      (RIXS_WORKERS=12 for fewer processes)

For each library problem with an exact reference, src/data/quantum/rixs/<id>.json holds RIXS maps over incident
energy and energy loss for the nine oriented pairs of polarizations and the two powder geometries, as phase estimation
reads them: every loss spread by a normal distribution of the paper's resolution (0.2 eV) and counted in 0.2 eV bins
(the paper's histogram, its Fig. 9), so that the page can draw samples from any row. The elastic line (the final
state is the initial one) is kept apart, so the maps show the inelastic part on their own scale. With them: the norms
|R|^2 that set the block encoding's success probability, the one-norms and the degree of the Green's function
polynomial, and how far that polynomial moves the spectrum.

Each RIXS state's Lanczos runs on its own in a pool of one thread processes, among the valence states with the core
frozen (qxas/rixs.py valence). On the 24 core development PC that takes about a minute for water, a few for CO and
an hour or so for each 11 orbital cluster.
"""

from __future__ import annotations

import json
import multiprocessing
import os
import sys
import time
from pathlib import Path

import numpy as np
from scipy.special import ndtr

sys.path.insert(0, str(Path(__file__).resolve().parent))
import library  # noqa: E402
import packs  # noqa: E402
from qxas import builder, exact, rixs  # noqa: E402
from qxas.builder import HARTREE_EV  # noqa: E402

OUT = library.ROOT / "src" / "data" / "quantum" / "rixs"
# Lanczos steps among the valence states, per real vector. The clusters have about 30,000 valence states within 25 eV,
# and at 0.2 eV their spectra need 600 steps to settle within 0.2 % of the peak, 1,000 within 0.05 %.
STEPS = 1000
CORE_STEPS = 300
RESOLUTION_EV = 0.2  # the paper's epsilon_omega, here the standard deviation of a phase estimation readout
BIN_EV = 0.2
LOSS_EV = (-1.0, 25.0)  # bin centres
STEP_EV = 0.3  # between incident energies, half the core hole's full width
# The elastic line: final states within 50 meV of the initial one, which for the Mn pairs takes in the spin states of
# the pair that lie a few meV apart and that no 0.2 eV readout separates.
ELASTIC_HA = 0.05 / HARTREE_EV
GEOMETRIES = rixs.ORIENTED + ["parallel", "crossed"]
LEVELS = 9999

_valence = None


def _start(instance_id: str) -> None:
    global _valence
    _valence = rixs.valence(builder.load(library.OUT / f"{instance_id}.json")[0])[0]


def _measure(job: tuple[int, str, np.ndarray, float]) -> tuple[int, str, tuple[np.ndarray, np.ndarray]]:
    """The measure of one RIXS state among the valence states, the core frozen."""
    row, key, v, e0 = job
    return row, key, rixs.measure(_valence, v, e0, STEPS)


def incident_grid(ref: dict) -> np.ndarray:
    """From 2 eV below the first peak to 2 eV past the last part of the edge above a fifth of its height (within
    20 eV), every STEP_EV, in Ha above the initial state."""
    edge = ref["edge_Ha"]
    w = edge + np.arange(0, 20, 0.01) / HARTREE_EV
    xas = exact.lorentzian(w, np.array(ref["centres_Ha"]), np.array(ref["weights"]), rixs.GAMMA)
    top = w[np.nonzero(xas >= 0.2 * xas.max())[0][-1]]
    return edge + np.arange(-2.0, (top - edge) * HARTREE_EV + 2.0 + 1e-9, STEP_EV) / HARTREE_EV


def binned(centres: np.ndarray, weights: np.ndarray, loss_eV: np.ndarray) -> np.ndarray:
    """Weights spread by the readout's normal distribution and integrated over each bin."""
    c = centres * HARTREE_EV
    hi = (loss_eV[:, None] + BIN_EV / 2 - c[None, :]) / RESOLUTION_EV
    lo = (loss_eV[:, None] - BIN_EV / 2 - c[None, :]) / RESOLUTION_EV
    return ((ndtr(hi) - ndtr(lo)) * weights[None, :]).sum(axis=1)


def split(m: dict, geometry: str) -> tuple[float, np.ndarray, np.ndarray]:
    """The elastic weight and the inelastic sticks of one geometry."""
    c, w = rixs.geometry_sticks(m, geometry)
    elastic = np.abs(c) < ELASTIC_HA
    return float(w[elastic].sum()), c[~elastic], w[~elastic]


def data(instance_id: str, workers: int) -> dict:
    prob, inst = builder.load(library.OUT / f"{instance_id}.json")
    t0 = time.time()
    e0, ci0 = rixs.initial_state(prob)
    krylov = rixs.core_krylov(prob, ci0, CORE_STEPS)
    seconds_core = time.time() - t0
    w_in = incident_grid(inst["reference"])
    loss = np.round(np.arange(LOSS_EV[0], LOSS_EV[1] + 1e-9, BIN_EV), 6)
    lam, shift = rixs.lambda_df(prob), rixs.trace_shift(prob)
    degree = rixs.green_degree(lam)
    _, ia, ib = rixs.valence(prob)
    states = [rixs.outgoing(prob, rixs.green_states(krylov, ci0.shape, w, e0)) for w in w_in]
    # The polynomial is checked at the incident energy where sum_ab |R_ab|^2 is largest.
    strongest = int(np.argmax([sum(float(np.vdot(phi[k], phi[k]).real) for k in rixs.ORIENTED) for phi in states]))
    polynomial = rixs.chebyshev_green(w_in[strongest], e0, shift, lam, degree)
    states.append(rixs.outgoing(prob, rixs.green_states(krylov, ci0.shape, w_in[strongest], e0, polynomial=polynomial)))
    jobs = [(i, k, v[np.ix_(ia, ib)], e0) for i, phi in enumerate(states) for k, v in phi.items()]
    rows_count = len(states)
    del states, krylov  # about 2 GB for a cluster; the jobs hold what the workers need

    t0 = time.time()
    os.environ.update(OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1")
    measures = [{} for _ in range(rows_count)]
    with multiprocessing.get_context("spawn").Pool(workers, initializer=_start, initargs=(instance_id,)) as pool:
        for i, k, m in pool.imap_unordered(_measure, jobs):
            measures[i][k] = m
    *rows, with_polynomial = measures
    seconds_rows = time.time() - t0

    maps, elastic, totals, grids = {}, {}, {}, {}
    for geometry in GEOMETRIES:
        parts = [split(m, geometry) for m in rows]
        grids[geometry] = np.array([binned(c, w, loss) for _, c, w in parts])
        scale = float(max(grids[geometry].max(), 1e-300))
        maps[geometry] = {"scale": scale, "values": np.clip(np.round(LEVELS * grids[geometry] / scale), 0, LEVELS).astype(int).ravel().tolist()}
        elastic[geometry] = packs.rounded([e for e, _, _ in parts], 8)
        # Every final state, inside the loss window or not: |R|^2 for an oriented pair.
        totals[geometry] = packs.rounded([float(rixs.geometry_sticks(m, geometry)[1].sum()) for m in rows], 8)
    exact_row = binned(*rixs.geometry_sticks(rows[strongest], "parallel"), loss)
    poly_row = binned(*rixs.geometry_sticks(with_polynomial, "parallel"), loss)
    check_bin = int(np.argmax(grids["parallel"][strongest]))
    return {
        "schema": 1, "id": instance_id, "instance_hash": inst["hash"], "initial_energy_Ha": e0,
        "settings": {"gamma_eV": rixs.GAMMA * HARTREE_EV, "resolution_eV": RESOLUTION_EV, "bin_eV": BIN_EV,
                     "lanczos_steps": STEPS, "core_lanczos_steps": CORE_STEPS, "elastic_within_Ha": ELASTIC_HA, "levels": LEVELS},
        "incident_eV": packs.rounded(w_in * HARTREE_EV, 8), "loss_eV": loss.tolist(),
        "maps": maps, "elastic": elastic, "totals": totals,
        "dipole_norms": packs.rounded(prob.dipole_states(ci0)[1], 8),
        "dipole_lambda": packs.rounded([np.abs(np.linalg.eigvalsh(d)).sum() for d in prob.dipoles], 8),
        "one_norm_Ha": round(lam, 4), "shift_Ha": round(shift, 6), "green_degree": degree,
        "polynomial": {"row": strongest, "largest_change": float(f"{np.abs(poly_row - exact_row).max() / exact_row.max():.3g}")},
        "check": {"geometry": "parallel", "row": strongest, "bin": check_bin,
                  "value": float(f"{grids['parallel'][strongest, check_bin]:.10g}")},
        "seconds": {"core": round(seconds_core, 1), "rows": round(seconds_rows, 1)},
    }


def order(path: Path) -> int:
    """Library order, so the index lists problems as the page does."""
    ids = [r.id for r in library.RECIPES]
    return ids.index(path.stem) if path.stem in ids else len(ids)


def main() -> None:
    ids = sys.argv[1:] or [r.id for r in library.RECIPES if "quantum-target" not in r.tags]
    OUT.mkdir(parents=True, exist_ok=True)
    workers = int(os.environ.get("RIXS_WORKERS", max(1, (os.cpu_count() or 2) - 2)))  # fewer when memory is short
    for instance_id in ids:
        d = data(instance_id, workers)
        path = OUT / f"{instance_id}.json"
        path.write_text(json.dumps(d, separators=(",", ":")) + "\n")
        print(f"{instance_id}: {path.stat().st_size // 1024} KB, {len(d['incident_eV'])} incident energies, core "
              f"{d['seconds']['core']} s, rows {d['seconds']['rows']} s, the polynomial (degree {d['green_degree']}) "
              f"moves the spectrum by {d['polynomial']['largest_change']:.1e}", flush=True)
    index = [p.stem for p in sorted(OUT.glob("*.json"), key=order) if p.name != "index.json"]
    (OUT / "index.json").write_text(json.dumps({"schema": 1, "problems": index}, indent=1) + "\n")


if __name__ == "__main__":
    main()
