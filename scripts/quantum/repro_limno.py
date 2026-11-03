#!/usr/bin/env python
"""The oxygen K edge of an O-centred Li4Mn2O cluster from Li2MnO3, as in Fig. 9 of 2506.15784.

  python scripts/quantum/repro_limno.py [spin]

The paper used CAS(14e,11o), the ten Mn 3d orbitals and the O 1s, in cc-pVDZ, with core-valence separation, j_max of
5 to 50, S = 5000 shots, ||H||_w = 2 Ha and tau = Delta = pi / (2 ||H||_w) with a second order product formula, and
had no classical reference at this size. It does not state the cluster's site, charge or spin. Here: the O2 site of
COD 1008373 (Li2MnO3, the more common oxygen site), a neutral cluster (the only charge for which AVAS gives 14
electrons in these 11 orbitals), spin 0 (for the neutral cluster AVAS then also gives the paper's 14 electrons; at
2S = 4 it gives 10), ROHF orbitals converged with PySCF's second order solver (plain DIIS did not converge in 200
cycles at any spin), AVAS for Mn 3d and O 1s, and an exact Lanczos reference for every core-excited state the
dipole reaches. Higher spins have lower ROHF energies; spin 0 is kept to match the paper's active space.

Results go to src/data/quantum/repro/limno-k.json.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from pyscf import gto, scf
from pyscf.mcscf import avas

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qxas import cdf, emulate, exact, problem, sampling  # noqa: E402
from qxas.cluster import first_shells  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CIF = Path(__file__).resolve().parent / "structures" / "cod-1008373-Li2MnO3.cif"
OUT = ROOT / "src" / "data" / "quantum" / "repro" / "limno-k.json"
HARTREE_EV = 27.211386245988
ETA, H_NORM, SHOTS = 0.05, 2.0, 5000
JMAXES = (5, 10, 25, 50)


def main() -> None:
    spin = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    t_start = time.time()
    shell = next(s for s in first_shells(CIF) if s["label"] == "O2")
    mol = gto.M(atom=[[sym, tuple(xyz)] for sym, xyz in shell["atoms"]], basis="cc-pvdz", charge=0, spin=spin,
                symmetry=False, verbose=0)
    mf = scf.ROHF(mol).newton()
    mf.max_cycle = 100
    e_scf = mf.kernel()
    n_orb, n_elec, mo = avas.avas(mf, ["Mn 3d", "O 1s"], threshold=0.5, canonicalize=True, verbose=0)
    # The O 1s is the active orbital with the most O 1s character; with canonical orbitals it is the lowest.
    ncore = (mol.nelectron - n_elec) // 2
    act = mo[:, ncore:ncore + n_orb]
    o1s = mol.search_ao_label(["O 1s"])[0]
    s = mol.intor("int1e_ovlp")
    core_index = int(np.argmax(np.abs((s @ act)[o1s])))
    prob = problem.from_casci("li4mn2o-o-k", mol, mf, n_orb, n_elec, mo_coeff=mo, core_mo=[core_index], ncore=ncore)
    e0, ci0 = prob.ground_state()
    states, norms = prob.dipole_states(ci0)
    w_kry, wt_kry = exact.krylov_measure(prob, ci0, e0, steps=300)

    edge = float(w_kry[wt_kry > 0.02 * wt_kry.max()].min())
    tau = np.pi / (2 * H_NORM)
    grid = np.linspace(edge - 1.0, edge + 5.0, 1201)
    spectra = {"all_states": exact.lorentzian(grid, w_kry, wt_kry, ETA)}
    runs = {}
    for method, factors in (("exact", None), ("cdf", n_orb)):
        t0 = time.time()
        frags = cdf.factorize(prob.h1, prob.h2, prob.e_core, method=method, num_factors=factors)
        test = emulate.HadamardTest(prob, frags)
        jmax = max(JMAXES)
        times = tau * np.arange(1, jmax + 1)
        signals = [(norm, test.signal(psi, tau, jmax)) for psi, norm in zip(states, norms) if norm]
        g0 = float(np.sum(norms ** 2))
        for jm in JMAXES:
            # Each dipole direction is its own set of Hadamard tests, with its own shots.
            rng = np.random.default_rng(jm)
            shots = sampling.allocate(SHOTS, times[:jm], ETA, 1.3384)
            measured = sum(norm ** 2 * sampling.measure(g[:jm], shots, rng) for norm, g in signals)
            spectra[f"quantum_{method}_jmax{jm}"] = sampling.spectrum(grid + e0, times[:jm], measured, g0, ETA, tau)
        runs[method] = {"fragments": frags.count, "factor_max_error_Ha": frags.max_error,
                        "seconds": round(time.time() - t0, 1)}
    ref = spectra["all_states"]
    out = {
        "case": "li4mn2o-o-k",
        "source": "2506.15784 Fig. 9 (model choices here where the paper is silent)",
        "problem": {"cluster": "O2 site of COD 1008373 with its first shell", "atoms": shell["atoms"],
                    "distances_A": shell["distances_A"], "basis": "cc-pVDZ", "charge": 0, "spin_2S": spin,
                    "scf": "ROHF", "scf_energy_Ha": e_scf, "scf_converged": bool(mf.converged),
                    "active_space": "AVAS Mn 3d + O 1s, threshold 0.5", "active_orbitals": n_orb,
                    "active_electrons": int(n_elec), "qubits": 2 * n_orb + 1, "cvs_core_index": core_index,
                    "hash": prob.recipe_hash(), "ground_energy_Ha": e0, "dipole_norms": norms.tolist()},
        "algorithm": {"eta_Ha": ETA, "tau_per_Ha": tau, "period_Ha": 2 * np.pi / tau, "jmax": list(JMAXES),
                      "shots": SHOTS, "trotter": "second order, step tau", "factorizations": runs},
        "edge_Ha": edge, "edge_eV": edge * HARTREE_EV,
        "seconds_total": round(time.time() - t_start, 1),
        "grid_Ha": np.round(grid, 6).tolist(),
        "spectra": {k: np.round(v, 6).tolist() for k, v in spectra.items()},
        "differences_relative_to_peak": {k: round(float(np.abs(v - ref).max() / ref.max()), 4)
                                         for k, v in spectra.items() if k != "all_states"},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(json.dumps({k: out[k] for k in ("problem", "algorithm", "edge_eV", "seconds_total",
                                          "differences_relative_to_peak")}, indent=1, default=str))


if __name__ == "__main__":
    main()
