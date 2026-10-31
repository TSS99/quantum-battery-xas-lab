"""Near edge spectra of the FEFF library, computed with FEFF10 (full multiple scattering, self consistent potentials).

Run with the reference Python environment and -B, in two steps around a FEFF10 run:

    python -B scripts/twin/make-xanes-library.py inputs <work>    # one feff.inp per material and absorber site
    bash scripts/twin/run-feff10.sh <work>                        # FEFF10 on each folder (Linux or WSL)
    python -B scripts/twin/make-xanes-library.py collect <work>   # xmu.dat -> src/data/twin/xanes/<id>.json

Each input uses the structure, site list and 7 angstrom neighbour list of make-feff-library.py, so the atoms are the
ones the EXAFS paths come from. The cards are one recipe for every material: Hedin-Lundqvist exchange, an RPA
screened core hole, SCF potentials within 4.5 angstrom, FMS within 6 angstrom, dipole and quadrupole transitions
(the weak 1s to 3d pre-edge of a centrosymmetric site is quadrupole) and a grid from 35 eV below the edge. Spectra of a material's inequivalent
sites are averaged with the library's site weights on FEFF's absolute energy axis, then broadened by the Si(111)
Darwin width at the edge (xraydb), the resolution of the twin's default monochromator. FEFF already includes the
core hole lifetime. No FEFF executable or FEFF output file is redistributed, only the averaged, normalized spectrum.
"""

import argparse
import importlib.util
import json
from pathlib import Path

import numpy as np
import xraydb

from edge_e0 import edge_e0

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("feff_library", HERE / "make-feff-library.py")
library = importlib.util.module_from_spec(spec)
spec.loader.exec_module(library)

TARGET = library.OUTPUT / "xanes"
CARDS = [
    "EDGE {edge}",
    "S02 1.0",
    "CONTROL 1 1 1 1 1 1",
    "PRINT 0 0 0 0 0 0",
    "EXCHANGE 0 0.0 0.0 0",
    "SCF 4.5 0 30 0.2 1",
    "COREHOLE RPA",
    "FMS 6.0 0",
    "MULTIPOLE 2 0",
    "XANES 4.6 0.05 0.25",
    "EGRID",
    "e_grid -35 25 0.25",
    "k_grid last 4.6 0.05",
]
# Stored range and grid around E0 (edge_e0.py), eV.
FROM_eV, TO_eV, STEP_eV = -30.0, 75.0, 0.25
MIN_TO_eV = 65.0


def stoichiometry(formula):
    from pymatgen.core import Composition
    return {str(el): amount for el, amount in Composition(formula).reduced_composition.items()}


def make_input(crystal, structure, site):
    """FEFF10 input with the EXAFS library's atoms: one potential per element, stoichiometry from the formula."""
    exafs_input, _ = library.make_input(crystal, structure, site)
    lines = exafs_input.splitlines()
    atoms = lines[lines.index("ATOMS"):]
    amounts = stoichiometry(crystal.formula)
    elements = sorted(amounts, key=xraydb.atomic_number)
    potentials = [f"0 {xraydb.atomic_number(crystal.absorber)} {crystal.absorber} -1 -1 0.01"]
    potentials += [f"{i + 1} {xraydb.atomic_number(e)} {e} -1 -1 {amounts[e]:g}" for i, e in enumerate(elements)]
    return "\n".join([f"TITLE XAS Lab {crystal.id} {site['id']}", *(c.format(edge=crystal.edge) for c in CARDS),
                      "POTENTIALS", *potentials, *atoms]) + "\n"


def stored_materials():
    for crystal in library.CRYSTALS:
        stored = library.OUTPUT / "feff" / f"{crystal.id}.json"
        if stored.exists():
            yield crystal, json.loads(stored.read_text())


def write_inputs(work):
    count = 0
    for crystal, stored in stored_materials():
        structure, _, sites = library.validate(crystal)
        hashes = {s["id"]: s["input_sha256"] for s in stored["sites"]}
        for site in sites:
            exafs_input, _ = library.make_input(crystal, structure, site)
            if library.sha256(exafs_input.encode()) != hashes[site["id"]]:
                raise ValueError(f"{crystal.id}/{site['id']}: atoms differ from the stored EXAFS input")
            folder = work / crystal.id / site["id"]
            folder.mkdir(parents=True, exist_ok=True)
            (folder / "feff.inp").write_text(make_input(crystal, structure, site), encoding="ascii", newline="\n")
            count += 1
    print(f"{count} inputs in {work}")


def read_xmu(file):
    data = np.loadtxt(file, comments="#")
    return data[:, 0], data[:, 3], data[:, 4]  # absolute photon energy, mu, mu0


def darwin_fwhm(edge_eV):
    return float(xraydb.darwin_width(edge_eV, "Si", (1, 1, 1)).energy_fwhm)


def collect(work, feff_commit):
    TARGET.mkdir(exist_ok=True)
    index = []
    for crystal, stored in stored_materials():
        grid, total = None, None
        for site in stored["sites"]:
            file = work / crystal.id / site["id"] / "xmu.dat"
            if not file.exists():
                raise FileNotFoundError(f"{file}: run FEFF10 first")
            energy, mu, mu0 = read_xmu(file)
            # Normalize like a post-edge line: mu0, FEFF's atomic background, is fitted with a straight line from 10 eV
            # above its rise, so the slow fall of the atomic cross section is divided out and the step is 1.
            above = energy > energy[np.argmax(mu0 >= 0.5 * mu0.max())] + 10
            slope, intercept = np.polyfit(energy[above], mu0[above], 1)
            if grid is None:
                grid = np.arange(energy[0], energy[-1], 0.05)
                total = np.zeros_like(grid)
            total += site["weight"] * np.interp(grid, energy, mu / (intercept + slope * energy))
        fwhm = darwin_fwhm(stored["edge_energy_eV"])
        sigma = fwhm / 2.3548 / 0.05
        kernel = np.exp(-0.5 * (np.arange(-int(4 * sigma) - 1, int(4 * sigma) + 2) / sigma) ** 2)
        broadened = np.convolve(np.pad(total, len(kernel) // 2, mode="edge"), kernel / kernel.sum(), mode="valid")
        e0 = edge_e0(grid, broadened)
        # The rule is applied again to the stored grid until it gives 0 there, so the app (which reads only the stored
        # grid) finds E0 where the file puts it; a broad edge such as Pb L3 can tip between two rises otherwise.
        for _ in range(4):
            rel = grid - e0
            # The app hands over to the path sum by 64 eV (k = 4.1 per angstrom); keep up to 75 eV where FEFF reached it.
            if rel[0] > FROM_eV or rel[-1] < MIN_TO_eV:
                raise ValueError(f"{crystal.id}: FEFF10 range {rel[0]:.1f} to {rel[-1]:.1f} eV misses {FROM_eV} to {MIN_TO_eV}")
            out_grid = np.arange(FROM_eV, min(TO_eV, rel[-1]) + 1e-9, STEP_eV)
            mu_out = np.interp(out_grid, rel, broadened)
            again = edge_e0(out_grid, mu_out)
            if abs(again) < 0.05:
                break
            e0 += again
        else:
            raise ValueError(f"{crystal.id}: E0 does not settle on the stored grid")
        record = {
            "schema_version": 1, "id": crystal.id, "formula": crystal.formula, "absorber": crystal.absorber, "edge": crystal.edge,
            "method": {"code": "FEFF10", "commit": feff_commit, "cards": [c.format(edge=crystal.edge) for c in CARDS],
                       "broadening": f"Gaussian, FWHM {fwhm:.3f} eV (Si(111) Darwin width at the edge, xraydb)"},
            "sites": [{"id": s["id"], "weight": s["weight"]} for s in stored["sites"]],
            "feff_e0_eV": round(e0, 2),
            "energy": {"from_eV": FROM_eV, "step_eV": STEP_eV},
            "mu": [round(float(v), 4) for v in mu_out],
        }
        (TARGET / f"{crystal.id}.json").write_bytes(library.encode(record))
        index.append(crystal.id)
        print(crystal.id, f"E0 {e0:.1f} eV, peak {mu_out.max():.2f}")
    print(len(index), "materials")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("step", choices=("inputs", "collect"))
    parser.add_argument("work", type=Path)
    parser.add_argument("--feff-commit", default="")
    args = parser.parse_args()
    if args.step == "inputs":
        write_inputs(args.work)
    else:
        collect(args.work, args.feff_commit)


if __name__ == "__main__":
    main()
