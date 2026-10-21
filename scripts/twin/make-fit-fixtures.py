"""Reproducible synthetic EXAFS fits from xraylarch, not measured spectra.

Run the pinned Python with -B. No FEFF rerun, installation, or network access.
The serialized FEFF columns are reconstructed in Larch, as in check_exafs.py.
Only worktree-local JSON is written. --check verifies byte reproducibility.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import larch
import lmfit
import numpy as np
import scipy
from larch import Group
from larch.fitting import param, param_group
from larch.xafs import feffit, feffit_dataset, feffit_transform, ff2chi
from larch.xafs.feffdat import FeffDatFile, FeffPathGroup


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "src/data/twin/exafs-fit-fixtures.json"
COLUMNS = ("k", "real_phc", "mag_feff", "pha_feff", "red_fact", "lam", "rep")
K = np.arange(321, dtype=float) * 0.05


def make_path(record: dict, material: dict, **parameters) -> FeffPathGroup:
    arrays = {name: np.asarray(record[name], dtype=float) for name in COLUMNS}
    feff = FeffDatFile()
    feff._set_from_dict(
        **arrays, reff=record["reff"], nleg=record["nleg"], degen=record["degen"],
        shell=material["edge"], absorber=material["absorber"], rnorman=0.0,
        gam_ch=0.0, rs_int=0.0, vint=0.0, vmu=0.0, vfermi=0.0,
        filename=f"{material['id']}/{record['id']}", title="Reconstructed serialized FEFF path",
        version="FEFF6L", edge=0.0, exch="", potentials=[],
        pha=arrays["real_phc"] + arrays["pha_feff"],
        amp=arrays["mag_feff"] * arrays["red_fact"],
        geom=[(a["label"], a["atomic_number"], a["ipot"], a["mass_amu"], *a["xyz_A"])
              for a in record["geometry"]],
    )
    path = FeffPathGroup(_feffdat=feff, label=record["id"])
    path.filename = feff.filename
    path.init_path_params(**parameters)
    return path


def rounded(values):
    return [float(f"{v:.14g}") for v in values]


def make_case(material_id: str, count: int, seed: int) -> dict:
    source = ROOT / f"src/data/twin/feff/{material_id}.json"
    material = json.loads(source.read_bytes())
    records = sorted((p for p in material["sites"][0]["paths"] if p["nleg"] == 2),
                     key=lambda p: p["reff"])[:count]
    truth = {"s02": 0.88, "e0": 1.7}
    definitions = {"s02": {"value": 0.95, "min": 0.3, "max": 1.5},
                   "e0": {"value": 0.3, "min": -10.0, "max": 10.0}}
    for i in range(count):
        truth[f"dr{i}"] = 0.015 if i == 0 else -0.012
        truth[f"ss{i}"] = 0.0045 + i * 0.001
        definitions[f"dr{i}"] = {"value": 0.0, "min": -0.15, "max": 0.15}
        definitions[f"ss{i}"] = {"value": 0.003, "min": 0.0001, "max": 0.03}
    exact_paths = [make_path(record, material, s02=truth["s02"], e0=truth["e0"],
                             deltar=truth[f"dr{i}"], sigma2=truth[f"ss{i}"])
                   for i, record in enumerate(records)]
    exact = Group()
    ff2chi(exact_paths, group=exact, k=K)
    noise_sigma = 0.0005
    observed = exact.chi + np.random.default_rng(seed).normal(0, noise_sigma, len(K))
    settings = {"kmin": 3.0, "kmax": 13.0, "rmin": 1.5 if count == 1 else 1.0,
                "rmax": 3.2 if count == 1 else 3.5, "dk": 1.0, "dk2": 1.5,
                "window": "hanning", "kweight": 2, "kstep": 0.05, "nfft": 2048}
    outputs = {}
    # Both fitting spaces plus automatic-noise and array-noise cases protect the weighting conventions.
    for case_name, fitspace, noise in [("r", "r", noise_sigma), ("k", "k", noise_sigma),
                                      ("r_auto", "r", None),
                                      ("k_array", "k", noise_sigma * (1 + K / 16)),
                                      ("r_array", "r", noise_sigma * (1 + K / 16))]:
        params = param_group(**{name: param(vary=True, **spec) for name, spec in definitions.items()})
        fit_paths = [make_path(record, material, s02="s02", e0="e0",
                               deltar=f"dr{i}", sigma2=f"ss{i}")
                     for i, record in enumerate(records)]
        trans = feffit_transform(fitspace=fitspace, **settings)
        dataset = feffit_dataset(data=Group(k=K, chi=observed), paths=fit_paths,
                                transform=trans, epsilon_k=noise)
        result = feffit(params, dataset, tol=1e-9, rmax_out=10, path_outputs=False)
        if not result.success or not result.errorbars:
            raise RuntimeError(f"Larch fit failed: {material_id}/{case_name}: {result.message}")
        outputs[case_name] = {
            "space": fitspace, "epsilonK": None if noise is None else rounded(noise) if isinstance(noise, np.ndarray) else noise,
            "parameters": {name: {"value": result.params[name].value, "stderr": result.params[name].stderr}
                           for name in definitions},
            "variableNames": result.var_names,
            "covariance": [rounded(row) for row in result.fit_details.scaled_covar],
            "correlations": [[1.0 if a == b else result.params[a].correl[b]
                              for b in result.var_names] for a in result.var_names],
            "nIdp": result.n_independent, "nResiduals": result.ndata,
            "residualSumSquares": result.fit_details.chisqr,
            "chiSquare": result.chi_square, "reducedChiSquare": result.chi2_reduced,
            "rFactor": result.rfactor,
            "resolvedEpsilonK": rounded(np.broadcast_to(dataset.epsilon_k, K.shape)),
            "epsilonR": float(dataset.epsilon_r),
            "modelChi": rounded(dataset.model.chi), "r_A": rounded(dataset.model.r),
            "modelR": {"real": rounded(dataset.model.chir_re), "imaginary": rounded(dataset.model.chir_im)},
            "dataR": {"real": rounded(dataset.data.chir_re), "imaginary": rounded(dataset.data.chir_im)},
            "window": rounded(dataset.transform.kwin[:len(K)]),
        }
    return {
        "material": material_id, "site": material["sites"][0]["id"],
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "paths": [{"id": p["id"], "reff_A": p["reff"], "degen": p["degen"]} for p in records],
        "seed": seed, "noise_sigma": noise_sigma, "truth": truth,
        "parameters": definitions, "transform": settings,
        "k_A_inv": rounded(K), "chi": rounded(observed), "exactChi": rounded(exact.chi), "fits": outputs,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    payload = {
        "schema_version": 1, "provenance": "synthetic",
        "versions": {"xraylarch": larch.__version__, "lmfit": lmfit.__version__,
                     "numpy": np.__version__, "scipy": scipy.__version__},
        "reference": "https://xraypy.github.io/xraylarch/xafs_feffit.html",
        "calls": ["ff2chi(exact_paths, group=exact, k=arange(321)*0.05)",
                  "observed = exact.chi + default_rng(seed).normal(0, 0.0005, 321)",
                  "feffit_transform(fitspace=space, **case.transform)",
                  "feffit_dataset(data=Group(k=k, chi=observed), paths=fit_paths, transform=trans, epsilon_k=epsilonK)",
                  "feffit(params, dataset, tol=1e-9, rmax_out=10, path_outputs=False)"],
        "conventions": {"nIdp": "1 + 2*(kmax-kmin)*(rmax-rmin)/pi",
                        "covariance": "fit_details.scaled_covar (not result.covar, which is unscaled)",
                        "uncertainty_scope": "local fit statistics only; no calibration, FEFF or background uncertainty"},
        "cases": [make_case("cu", 1, 2101), make_case("nio", 2, 2102)],
    }
    encoded = (json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    if args.check:
        if OUTPUT.read_bytes() != encoded:
            raise RuntimeError("Fixture differs from the current pinned Larch calculation.")
        print(f"Verified byte-identical {OUTPUT.relative_to(ROOT)}")
    else:
        OUTPUT.write_bytes(encoded)
        print(f"Wrote {OUTPUT.relative_to(ROOT)} ({len(encoded):,} bytes)")
    for case in payload["cases"]:
        print(case["material"], case["paths"])
        for name in ("r", "k"):
            print(name, case["fits"][name]["parameters"])


if __name__ == "__main__":
    main()
