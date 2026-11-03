#!/usr/bin/env python
"""Reproduce the N2 checks of the time domain XAS algorithm: the PennyLane demo and Fig. 8 of 2506.15784.

Run in the pinned environment (scripts/quantum/requirements.txt), from the repository root:

  python scripts/quantum/repro_n2.py demo      # N2, STO-3G, CAS(4e,5o), 10 + 1 qubits, the demo's settings
  python scripts/quantum/repro_n2.py fig8      # N2, STO-3G, CAS(14e,10o), 20 + 1 qubits, the paper's settings

Each case builds the problem with PySCF, factorizes it (CDF), emulates the Hadamard tests exactly (emulate.py, held to
the PennyLane circuit by the tests), draws shots, rebuilds the spectrum and compares it with two exact references:
the lowest eigenstates, as the paper did, and a Lanczos spectral measure that holds every state the dipole reaches.
Results go to src/data/quantum/repro/<case>.json.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from pyscf import gto, scf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qxas import cdf, emulate, exact, problem, sampling  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "quantum" / "repro"
HARTREE_EV = 27.211386245988

CASES = {
    # The demo: r = 1.0 A, CAS(4e,5o), eta 0.05 Ha, ||H|| = pi so tau = 0.5, 200 times, 500 x 2 x 100 shots, alpha 1.1.
    "demo": dict(r=1.0, cas=(5, 4), eta=0.05, h_norm=np.pi, jmax=200, shots=100_000, alpha=1.1, randomized=False,
                 factors=None, nroots=100, window=(0.0, 4.0)),
    # Fig. 8: r = 1.077 A, CAS(14e,10o), j_max = 50, S = 1e4, ||H||_w = 3 Ha, tau = Delta = pi / (2 ||H||_w),
    # randomized second order Trotter, the 250 lowest full CI states as the paper's reference. The paper does not give
    # eta or alpha for this figure; we use its Table I values, eta = 0.05 Ha and alpha = 1.3384.
    "fig8": dict(r=1.077, cas=(10, 14), eta=0.05, h_norm=3.0, jmax=50, shots=10_000, alpha=1.3384, randomized=True,
                 factors=10, nroots=250, window=(0.0, 4.0)),
}


def peaks(w: np.ndarray, s: np.ndarray, floor: float) -> list[float]:
    i = np.where((s[1:-1] > s[:-2]) & (s[1:-1] >= s[2:]) & (s[1:-1] > floor))[0] + 1
    return [float(w[k]) for k in i]


def run(name: str, seed: int = 7) -> dict:
    c = CASES[name]
    t_start = time.time()
    # Point group symmetry pins the degenerate pi orbitals, so the problem (and its hash) is the same on every run.
    mol = gto.M(atom=[["N", (0, 0, -c["r"] / 2)], ["N", (0, 0, c["r"] / 2)]], basis="sto3g", symmetry=True, verbose=0)
    mf = scf.RHF(mol).run()
    n_orb, n_elec = c["cas"]
    prob = problem.from_casci(f"n2-{name}", mol, mf, n_orb, n_elec)
    e0, ci0 = prob.ground_state()
    states, norms = prob.dipole_states(ci0)

    # Exact references. The Lanczos measure is converged: a run with twice the steps changes nothing visible.
    w_eig, wt_eig = exact.eigen_spectrum(prob, ci0, e0, c["nroots"])
    w_kry, wt_kry = exact.krylov_measure(prob, ci0, e0, steps=300)
    tau = np.pi / (2 * c["h_norm"])
    period = 2 * np.pi / tau
    # The algorithm measures energies modulo 2 pi / tau, so every state also shows at its images.
    images = np.arange(-3, 4)
    w_fold = (w_kry[:, None] + period * images[None, :]).ravel()
    wt_fold = np.repeat(wt_kry, len(images))

    times = tau * np.arange(1, c["jmax"] + 1)
    shots = sampling.allocate(c["shots"], times, c["eta"], c["alpha"])
    grid = np.linspace(*c["window"], 801)
    eta = c["eta"]
    g0 = float(np.sum(norms ** 2))
    spec = {
        "lowest_states": exact.lorentzian(grid, w_eig, wt_eig, eta),
        "all_states": exact.lorentzian(grid, w_kry, wt_kry, eta),
        "all_states_with_images": exact.lorentzian(grid, w_fold, wt_fold, eta),
        # The exact G(t) at the same times, rebuilt the same way: what a perfect quantum computer would give.
        "all_states_same_times": sampling.spectrum(grid, times, exact.time_signal(w_kry, wt_kry, times), g0, eta, tau),
    }
    runs = {}
    for method, factors in (("exact", None), ("cdf", c["factors"])):
        t0 = time.time()
        frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method=method, num_factors=factors)
        t_factor = time.time() - t0
        h1f, h2f = cdf.reconstruct(frags)
        prob_f = problem.Problem(prob.name + "-" + method, prob.n_orb, prob.n_elec, prob.e_core, h1f, h2f, prob.dipoles)
        w_f, wt_f = exact.krylov_measure(prob_f, ci0, e0, steps=300)
        test = emulate.HadamardTest(prob, frags)
        rng = np.random.default_rng(seed)
        ideal = np.zeros(c["jmax"], dtype=complex)
        measured = np.zeros(c["jmax"], dtype=complex)
        t0 = time.time()
        for k, (psi, norm) in enumerate(zip(states, norms)):
            if norm == 0:
                continue
            g = test.signal(psi, tau, c["jmax"], seed=(seed + k) if c["randomized"] else None)
            ideal += norm ** 2 * g
            measured += norm ** 2 * sampling.measure(g, shots, rng)
        spec[f"{method}_factorized_all_states"] = exact.lorentzian(grid, w_f, wt_f, eta)
        spec[f"quantum_{method}_no_shot_noise"] = sampling.spectrum(grid + e0, times, ideal, g0, eta, tau)
        spec[f"quantum_{method}_with_shots"] = sampling.spectrum(grid + e0, times, measured, g0, eta, tau)
        runs[method] = {"fragments": frags.count, "factor_max_error_Ha": frags.max_error,
                        "seconds_factorize": round(t_factor, 1), "seconds_emulate": round(time.time() - t0, 2)}

    ref = spec["all_states"]
    floor = 0.1 * ref.max()
    def rel(a, b):
        return round(float(np.abs(a - b).max() / ref.max()), 4)
    out = {
        "case": name,
        "source": "2506.15784 Fig. 8" if name == "fig8" else "PennyLane demo tutorial_xas",
        "problem": {"molecule": "N2", "bond_A": c["r"], "basis": "STO-3G", "symmetry": "D2h orbitals",
                    "active_orbitals": n_orb, "active_electrons": n_elec, "qubits": 2 * n_orb + 1,
                    "hash": prob.recipe_hash(), "ground_energy_Ha": e0, "dipole_norms": norms.tolist()},
        "algorithm": {"eta_Ha": eta, "tau_per_Ha": tau, "period_Ha": period, "jmax": c["jmax"],
                      "shots": int(2 * shots.sum()), "alpha": c["alpha"],
                      "trotter": "randomized second order" if c["randomized"] else "second order",
                      "trotter_step_per_Ha": tau, "seed": seed, "factorizations": runs},
        "references": {"lowest_states": c["nroots"], "lanczos_steps": 300},
        "seconds_total": round(time.time() - t_start, 1),
        "grid_Ha": np.round(grid, 6).tolist(),
        "spectra": {k: np.round(v, 6).tolist() for k, v in spec.items()},
        "peaks_Ha": {k: [round(p, 4) for p in peaks(grid, v, floor)] for k, v in spec.items()},
        "differences_relative_to_peak": {
            "lowest_states_vs_all_states": rel(spec["lowest_states"], ref),
            "images_vs_all_states": rel(spec["all_states_with_images"], ref),
            "finite_times_vs_images": rel(spec["all_states_same_times"], spec["all_states_with_images"]),
            "trotter_exact_factorization": rel(spec["quantum_exact_no_shot_noise"], spec["all_states_same_times"]),
            "shots_exact_factorization": rel(spec["quantum_exact_with_shots"], spec["quantum_exact_no_shot_noise"]),
            "cdf_factorization_error": rel(spec["cdf_factorized_all_states"], ref),
            "quantum_cdf_with_shots_vs_all_states": rel(spec["quantum_cdf_with_shots"], ref),
            "quantum_cdf_with_shots_vs_images": rel(spec["quantum_cdf_with_shots"], spec["all_states_with_images"]),
        },
        "weight_above_window": round(float(wt_kry[w_kry > c["window"][1]].sum() / wt_kry.sum()), 4),
    }
    return out


def main() -> None:
    names = sys.argv[1:] or list(CASES)
    OUT.mkdir(parents=True, exist_ok=True)
    for name in names:
        result = run(name)
        (OUT / f"n2-{name}.json").write_text(json.dumps(result, separators=(",", ":")) + "\n")
        print(name, json.dumps({k: result[k] for k in ("algorithm", "seconds_total", "peaks_Ha",
                                                      "differences_relative_to_peak", "weight_above_window")},
                               indent=1))


if __name__ == "__main__":
    main()
