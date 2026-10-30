"""Atom clusters around each absorber site of the FEFF library, for the Read the spectrum view.

Run with the reference Python environment and -B, after make-feff-library.py. Each cluster is the ATOMS list of the
site's feff.inp, rebuilt with the library's own code (same structure, neighbour search and frame) and checked
against the input hash stored in src/data/twin/feff/<id>.json, then cut at the 6 angstrom path limit. So the atoms
drawn are the ones FEFF used, in the coordinates of every path geometry.
"""

import importlib.util
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("feff_library", HERE / "make-feff-library.py")
library = importlib.util.module_from_spec(spec)
spec.loader.exec_module(library)

RMAX = 6.0
TARGET = library.OUTPUT / "clusters"


def atoms_of(inp):
    lines = inp.splitlines()
    start, end = lines.index("ATOMS") + 1, lines.index("END")
    atoms = []
    for line in lines[start:end]:
        x, y, z, _, element = line.split()
        xyz = [float(x), float(y), float(z)]
        if math.dist(xyz, (0, 0, 0)) <= RMAX + 1e-6:
            atoms.append([element, *(round(v, 4) + 0 for v in xyz)])
    return atoms


def main():
    TARGET.mkdir(exist_ok=True)
    for crystal in library.CRYSTALS:
        stored_file = library.OUTPUT / "feff" / f"{crystal.id}.json"
        if not stored_file.exists():
            continue
        stored = {s["id"]: s for s in json.loads(stored_file.read_text())["sites"]}
        structure, _, sites = library.validate(crystal)
        out = {"id": crystal.id, "rmax_A": RMAX, "sites": []}
        for site in sites:
            inp, _ = library.make_input(crystal, structure, site)
            if library.sha256(inp.encode()) != stored[site["id"]]["input_sha256"]:
                raise ValueError(f"{crystal.id}/{site['id']}: rebuilt feff.inp does not match the stored hash")
            out["sites"].append({"id": site["id"], "atoms": atoms_of(inp)})
        (TARGET / f"{crystal.id}.json").write_bytes(library.encode(out))
        print(crystal.id, [len(s["atoms"]) for s in out["sites"]])


if __name__ == "__main__":
    main()
