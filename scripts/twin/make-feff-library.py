"""Generate FEFF6L paths and Larch golden data, offline after source transcription.

Run with the reference Python environment and -B. --check regenerates everything
in a fresh worktree-local temporary directory and compares every output byte.
There is deliberately no network access, random input, timestamp or absolute
path in the outputs. No FEFF executable is redistributed.
"""

import argparse
from copy import deepcopy
from dataclasses import asdict
import gzip
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import tempfile

import numpy as np
from larch.xafs import feff6l, feffpath, ff2chi, sigma2_eins
from larch.xafs.feffdat import FeffPathGroup
from larch.xafs.feffrunner import find_exe
import xraydb

from structures import CRYSTALS as AUDITED, DROPPED, validate
from structures_cod import cod_crystals

# The hand-audited structures, then those built from COD CIFs (see structures_cod.py).
CRYSTALS = AUDITED + cod_crystals()

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "src/data/twin"
COLUMNS = ("k", "real_phc", "mag_feff", "pha_feff", "red_fact", "lam", "rep")
MAX_GZIP = 40_000
MAX_PATHS = 80
K = np.arange(321, dtype=float) / 20
FIXTURE_IDS = ("cu", "fe-bcc", "pt", "limn2o4", "licoo2", "lifepo4", "nio", "fe3o4", "zno", "ceo2")
PARAMETERS = (
    {"id": "a", "s02": .9, "e0_eV": 0, "deltar_fraction": 0, "sigma2_A2": .003},
    {"id": "b", "s02": .8, "e0_eV": 3, "deltar_fraction": .01, "sigma2_A2": .006},
    {"id": "c", "s02": 1, "e0_eV": -2, "deltar_fraction": 0,
     "temperature_K": 300, "theta_einstein_K": 250},
)


def rounded(value, digits=5):
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (float, np.floating)):
        if not np.isfinite(value):
            raise ValueError("Cannot serialize a nonfinite number")
        return float(f"{value:.{digits}g}") if value != 0 else 0
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, dict):
        return {k: rounded(v, digits) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [rounded(v, digits) for v in value]
    return value


def encode(value):
    return (json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":")) + "\n").encode()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def gzip_size(data):
    return len(gzip.compress(data, compresslevel=9, mtime=0))


def make_input(crystal, structure, site):
    """Sorted periodic images, with the central absorber included exactly once."""
    center = structure[site["index"]]
    neighbours = structure.get_neighbors(center, 7.0)
    atoms = [(n.specie.symbol, np.asarray(n.coords - center.coords), n.properties["orbit"]) for n in neighbours]
    atoms.sort(key=lambda a: (round(float(np.linalg.norm(a[1])), 8), a[0],
                              *(round(float(x), 8) for x in a[1]), a[2]))
    elements = sorted({a[0] for a in atoms}, key=xraydb.atomic_number)
    potentials = {element: i + 1 for i, element in enumerate(elements)}
    # FEFF6 uses HOLE, not FEFF8's EDGE card. 1 = K, 4 = L3.
    lines = [
        f"TITLE XAS Lab {crystal.id} {site['id']}",
        f"HOLE {1 if crystal.edge == 'K' else 4} 1.0",
        "CONTROL 1 1 1 1",
        "PRINT 1 0 0 0",
        "RMAX 6.0",
        "POTENTIALS",
        f"0 {xraydb.atomic_number(crystal.absorber)} {crystal.absorber}",
    ]
    lines += [f"{ipot} {xraydb.atomic_number(e)} {e}" for e, ipot in potentials.items()]
    lines += ["ATOMS", f"0.00000000 0.00000000 0.00000000 0 {crystal.absorber}"]
    for element, xyz, _ in atoms:
        # Normalize near-zero floating-point signs for a stable input hash.
        xyz = [0 if abs(float(x)) < 5e-9 else float(x) for x in xyz]
        lines.append(" ".join(f"{x:.8f}" for x in xyz) + f" {potentials[element]} {element}")
    lines.append("END")
    return "\n".join(lines) + "\n", len(atoms) + 1


def serialize_path(path, filename):
    fd = path._feffdat
    geometry = [
        {"label": g[0], "atomic_number": int(g[1]), "ipot": int(g[2]),
         "mass_amu": float(g[3]), "xyz_A": [float(v) for v in g[4:7]]}
        for g in fd.geom
    ]
    data = rounded({
        "id": filename, "reff": path.reff, "degen": path.degen, "nleg": path.nleg,
        "geometry": geometry, **{key: getattr(fd, key) for key in COLUMNS},
    })
    if not 0 < data["reff"] <= 6 or len(geometry) != data["nleg"]:
        raise ValueError(f"Invalid path geometry: {filename}")
    k = np.array(data["k"])
    if len(k) < 4 or not np.all(np.diff(k) > 0) or k[0] > 0 or k[-1] < 16:
        raise ValueError(f"Invalid native FEFF k grid: {filename}")
    for col in COLUMNS:
        if len(data[col]) != len(k) or not np.all(np.isfinite(data[col])):
            raise ValueError(f"Invalid FEFF column: {filename}/{col}")
    if min(data["lam"]) <= 0:
        raise ValueError(f"Invalid mean free path: {filename}")
    return data


def rounded_path(original, data):
    """Re-enter *stored* values through Larch, including combined amp/phase.

    A separate rounded-data golden curve prevents a downstream engine test from
    confusing five-significant-digit quantization with an interpolation error.
    """
    fd = deepcopy(original._feffdat)
    arrays = {col: np.array(data[col]) for col in COLUMNS}
    fd._set_from_dict(
        **arrays, reff=data["reff"], nleg=data["nleg"], degen=data["degen"],
        pha=arrays["real_phc"] + arrays["pha_feff"],
        amp=arrays["mag_feff"] * arrays["red_fact"],
        geom=[(g["label"], g["atomic_number"], g["ipot"], g["mass_amu"], *g["xyz_A"])
              for g in data["geometry"]],
    )
    return FeffPathGroup(_feffdat=fd, label=data["id"])


def evaluate(paths, parameters):
    sigma = []
    for path in paths:
        s2 = parameters.get("sigma2_A2")
        if s2 is None:
            s2 = sigma2_eins(parameters["temperature_K"], parameters["theta_einstein_K"], path)
        path.init_path_params(s02=parameters["s02"], e0=parameters["e0_eV"],
                              deltar=parameters["deltar_fraction"] * path.reff, sigma2=s2)
        sigma.append(float(s2))
    chi = ff2chi(paths, k=K).chi
    if not np.all(np.isfinite(chi)):
        raise ValueError("Nonfinite Larch reference curve")
    return chi, sigma


def relative_rms(actual, reference):
    # The EXAFS accuracy contract is k >= 2; near-edge extrapolation is retained
    # in fixtures for implementation parity, but is not a physical XANES model.
    mask = K >= 2
    denominator = np.linalg.norm(reference[mask])
    if denominator == 0:
        raise ValueError("Zero reference norm")
    return float(np.linalg.norm((actual - reference)[mask]) / denominator)


def generate_material(crystal, work):
    structure, checks, site_specs = validate(crystal)
    material = {
        "schema_version": 1, "id": crystal.id, "formula": crystal.formula,
        "absorber": crystal.absorber, "edge": crystal.edge,
        "edge_energy_eV": xraydb.xray_edge(crystal.absorber, crystal.edge).energy,
        "citation": asdict(crystal.citation),
        "structure": {k: v for k, v in asdict(crystal).items()
                      if k in ("space_group", "setting", "lattice_A_deg", "positions", "temperature_K", "notes")},
        "checks": rounded(checks, 10), "sites": [],
    }
    raw_by_site = {}
    candidates = []
    protected = set()
    for site in site_specs:
        folder = work / crystal.id / site["id"]
        folder.mkdir(parents=True)
        inp, atom_count = make_input(crystal, structure, site)
        (folder / "feff.inp").write_text(inp, encoding="ascii", newline="\n")
        log = []
        here = Path.cwd()
        try:
            feff6l(folder=str(folder), verbose=False, message_writer=log.append)
        finally:
            os.chdir(here)  # Larch's runner does not restore cwd on exceptions.
        if not any("Feff done." in line for line in log):
            raise RuntimeError(f"{crystal.id}/{site['id']}: FEFF6L did not complete\n{''.join(log)[-3000:]}")
        raw_paths = {}
        for file in sorted(folder.glob("feff[0-9][0-9][0-9][0-9].dat")):
            path = feffpath(str(file), label=file.stem)
            if path.reff <= 6.0:
                raw_paths[file.stem] = path
        if not raw_paths:
            raise RuntimeError(f"{crystal.id}/{site['id']}: no paths inside RMAX")
        raw_by_site[site["id"]] = raw_paths
        min_reff = min(p.reff for p in raw_paths.values() if p.nleg == 2)
        ranked = []
        for pid, path in raw_paths.items():
            data = serialize_path(path, pid)
            chi, _ = evaluate([path], PARAMETERS[0])
            score = float(np.linalg.norm((K * K * chi)[K >= 2]))
            ranked.append((score, pid, data))
            if path.nleg == 2 and path.reff <= min_reff + .02:
                protected.add((site["id"], pid))
        ranked.sort(key=lambda x: (-x[0], x[1]))
        kept = ranked[:MAX_PATHS]
        if not all(pid in {r[1] for r in kept} for sid, pid in protected if sid == site["id"]):
            raise ValueError(f"{crystal.id}: path cap would remove a first-shell path")
        material["sites"].append({
            "id": site["id"], "wyckoff": site["wyckoff"], "multiplicity": site["multiplicity"],
            "weight": site["weight"], "absorber_fractional": rounded(structure[site["index"]].frac_coords, 10),
            "cluster_atoms": atom_count, "input_sha256": sha256(inp.encode()),
            "available_paths": len(raw_paths), "paths": [r[2] for r in kept],
        })
        candidates += [(score * site["weight"], site["id"], pid) for score, pid, _ in kept
                       if (site["id"], pid) not in protected]
    # Keep complete arrays on FEFF's grid. If needed, drop weak whole paths,
    # recording the effect on all three parameter sets below.
    candidates.sort()
    while gzip_size(encode(material)) > MAX_GZIP - 1800:
        if not candidates:
            raise ValueError(f"{crystal.id}: protected paths exceed the size budget")
        _, sid, pid = candidates.pop(0)
        site = next(s for s in material["sites"] if s["id"] == sid)
        site["paths"] = [p for p in site["paths"] if p["id"] != pid]
    for site in material["sites"]:
        site["paths"].sort(key=lambda p: (p["reff"], p["nleg"], p["id"]))

    cases = []
    diagnostics = []
    for parameters in PARAMETERS:
        original_chi = np.zeros_like(K)
        stored_chi = np.zeros_like(K)
        all_chi = np.zeros_like(K)
        sigma_records = []
        for site in material["sites"]:
            all_paths = raw_by_site[site["id"]]
            raw = [all_paths[p["id"]] for p in site["paths"]]
            stored = [rounded_path(p, d) for p, d in zip(raw, site["paths"])]
            raw_curve, raw_sigma = evaluate(raw, parameters)
            stored_curve, stored_sigma = evaluate(stored, parameters)
            full_curve, _ = evaluate(list(all_paths.values()), parameters)
            original_chi += site["weight"] * raw_curve
            stored_chi += site["weight"] * stored_curve
            all_chi += site["weight"] * full_curve
            sigma_records.append({"site": site["id"], "path_ids": [p["id"] for p in site["paths"]],
                                  "sigma2_A2": raw_sigma, "rounded_sigma2_A2": stored_sigma})
        quantization = relative_rms(stored_chi, original_chi)
        if quantization >= .001:
            raise ValueError(f"{crystal.id}/{parameters['id']}: quantization RMS {quantization:g} exceeds 0.1%")
        diagnostics.append({"case": parameters["id"], "rounding_relative_rms": quantization,
                            "omission_relative_rms": relative_rms(original_chi, all_chi)})
        cases.append(rounded({"parameters": parameters, "chi": original_chi,
                              "chi_rounded": stored_chi, "path_parameters": sigma_records}, 12))
    material["accuracy"] = rounded(diagnostics, 8)
    data = encode(material)
    if gzip_size(data) > MAX_GZIP:
        raise ValueError(f"{crystal.id}: final JSON exceeds gzip budget")
    einstein = []
    if crystal.id in ("cu", "fe-bcc"):
        site = material["sites"][0]
        for p in site["paths"][:3]:
            original = raw_by_site[site["id"]][p["id"]]
            einstein.append(rounded({
                "path_id": p["id"], "reff_A": original.reff,
                "temperatures_K": [10, 77, 300, 600], "theta_einstein_K": 250,
                "sigma2_A2": [sigma2_eins(t, 250, original) for t in (10, 77, 300, 600)],
            }, 12))
    return data, cases, einstein


def generate(work):
    if set(c.id for c in CRYSTALS) & DROPPED.keys():
        raise ValueError("A structure is both admitted and dropped")
    if len(set(c.id for c in CRYSTALS)) != len(CRYSTALS):
        raise ValueError("Duplicate structure id")
    executable = find_exe("feff6l")
    if executable is None:
        raise RuntimeError("Larch FEFF6L executable not found")
    versions = {p: version(p) for p in ("xraylarch", "xraydb", "pymatgen", "numpy", "scipy", "spglib")}
    fixtures = {
        "schema_version": 1, "versions": versions, "k_A_inv": rounded(K, 12),
        "calls": [
            "path = larch.xafs.feffpath(filename, label=filename_stem)",
            "path.init_path_params(s02=s02, e0=e0_eV, deltar=deltar_fraction*path.reff, sigma2=sigma2_A2)",
            "sigma2_A2 = larch.xafs.sigma2_eins(300, 250, path)  # case c only",
            "site_chi = larch.xafs.ff2chi(paths, k=numpy.arange(321)/20.0).chi",
            "chi = sum(site.multiplicity / total_absorbers * site_chi)",
            "Einstein table: larch.xafs.sigma2_eins(T, 250, path), T in (10, 77, 300, 600)",
            "chi_rounded: FeffPathGroup(_feffdat=rounded_FeffDatFile); pha=real_phc+pha_feff; amp=mag_feff*red_fact; same calls",
        ],
        "notes": [
            "chi uses unrounded retained FEFF paths; chi_rounded uses the serialized five-significant-digit paths.",
            "Native Larch cubic splines and its first-point extrapolation are unchanged. k < 2 is implementation parity, not validated XANES physics.",
            "Case c deltar is zero. Einstein reduced mass includes every vertex in Larch's path geometry.",
        ],
        "materials": {}, "einstein": {},
        "omitted_materials": [i for i in FIXTURE_IDS if i in DROPPED],
    }
    manifest = {
        "schema_version": 1, "versions": versions,
        "generator": "scripts/twin/make-feff-library.py",
        "feff_executable_sha256": sha256(Path(executable).read_bytes()),
        "settings": {"cluster_radius_A": 7, "rmax_A": 6, "max_paths_per_site": MAX_PATHS,
                     "max_gzip_bytes": MAX_GZIP, "significant_digits": 5,
                     "criteria": "FEFF6L defaults (no CRITERIA card)",
                     "nleg": "FEFF6L default (no NLEG card)",
                     "potentials": "neutral atom species; one noncentral potential per element",
                     "selection": "descending norm of k^2 chi(k), case a, 2 <= k <= 16; then prune by site-weighted norm for size",
                     "protected": "all single-scattering paths within 0.02 A of each site's shortest path"},
        "files": [],
        "dropped": [{"id": key, "formula": d[0], "absorber": d[1], "edge": d[2], "reason": d[3]}
                    for key, d in DROPPED.items()],
    }
    outputs = {}
    index = []
    for crystal in CRYSTALS:
        print(f"Generating {crystal.id}...", flush=True)
        data, cases, einstein = generate_material(crystal, work)
        material = json.loads(data)
        outputs[f"feff/{crystal.id}.json"] = data
        count = sum(len(s["paths"]) for s in material["sites"])
        index.append({k: material[k] for k in ("id", "formula", "absorber", "edge", "edge_energy_eV")} | {"number_of_paths": count})
        record = {"id": crystal.id, "sha256": sha256(data), "bytes": len(data), "gzip_bytes": gzip_size(data),
                  "number_of_paths": count, "available_paths": sum(s["available_paths"] for s in material["sites"])}
        manifest["files"].append(record)
        if crystal.id in FIXTURE_IDS:
            fixtures["materials"][crystal.id] = {"data_sha256": record["sha256"], "cases": cases}
        if einstein:
            fixtures["einstein"][crystal.id] = einstein
        print(f"  {count}/{record['available_paths']} paths; {record['gzip_bytes']} bytes gzip", flush=True)
    outputs["feff/index.json"] = encode(index)
    outputs["feff/manifest.json"] = encode(manifest)
    outputs["feff-fixtures.json"] = encode(fixtures)
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="regenerate and compare without changing committed outputs")
    args = parser.parse_args()
    scratch = ROOT / "test-results/feff-build"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="run-", dir=scratch) as temporary:
        outputs = generate(Path(temporary))
    # No writes until every admitted structure and reference calculation succeeds.
    expected_files = {Path(name).name for name in outputs if name.startswith("feff/")}
    existing_files = {p.name for p in (OUTPUT / "feff").glob("*.json")}
    stale = existing_files - expected_files
    if stale:
        raise RuntimeError(f"Unexpected stale FEFF JSON files (review before removing): {sorted(stale)}")
    for name, data in outputs.items():
        path = OUTPUT / name
        if args.check:
            if not path.is_file() or path.read_bytes() != data:
                raise RuntimeError(f"Non-deterministic or stale output: {name}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    print(f"{'Verified' if args.check else 'Wrote'} {len(outputs)} files. {len(DROPPED)} structures explicitly dropped.")
    for key, d in DROPPED.items():
        print(f"DROPPED {key}: {d[3]}")


if __name__ == "__main__":
    main()
