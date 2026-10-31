"""Measured near edge references for the computed library spectra, from the xraylarch examples (MIT License).

Run with the reference Python environment and -B. Reads the raw files in scripts/twin/measured-raw (downloaded from
https://github.com/xraypy/xraylarch/tree/master/examples/xafsdata), normalizes each with Larch's pre_edge (flattened
post edge, Larch defaults) and stores normalized mu from 30 eV below to 75 eV above E0 (edge_e0.py, the rule the computed spectra use), on the grid of
make-xanes-library.py, in src/data/twin/measured/xanes-references.json.
"""

import json
from pathlib import Path

import numpy as np
from larch import Group
from larch.io import read_ascii
from larch.xafs import pre_edge

from edge_e0 import edge_e0

HERE = Path(__file__).resolve().parent
RAW = HERE / "measured-raw"
OUT = HERE.parents[1] / "src/data/twin/measured/xanes-references.json"
URL = "https://github.com/xraypy/xraylarch/blob/master/examples/xafsdata/"
FROM_eV, TO_eV, STEP_eV = -30.0, 75.0, 0.25

# id in the FEFF library, file, how to get mu, what it is.
REFERENCES = [
    ("cu", "cu_metal_rt.xdi", ("i0", "itrans"), "Cu foil, Cu K edge, APS 13-ID, 2001"),
    ("ni", "ni_metal_rt.xdi", "mutrans", "Ni foil, Ni K edge, APS 13-ID-C"),
    ("pt", "pt_metal_rt.xdi", ("i0", "itrans"), "Pt foil, Pt L3 edge, APS 13-ID-C"),
    ("fe2o3", "fe2o3_rt1.xmu", None, "Fe2O3 powder, Fe K edge, APS 20-BM, 2001"),
    ("feo", "feo_rt1.xdi", "mutrans", "FeO powder, Fe K edge, APS 20-BM, 2001"),
]


def mu_of(group, how):
    if how is None:  # fe2o3_rt1.xmu: energy and mu are its first two columns
        return group.data[0], group.data[1]
    if isinstance(how, tuple):
        return group.energy, np.log(getattr(group, how[0]) / getattr(group, how[1]))
    return group.energy, getattr(group, how)


def main():
    out = []
    for id_, name, how, what in REFERENCES:
        group = read_ascii(str(RAW / name))
        energy, mu = mu_of(group, how)
        g = Group(energy=np.asarray(energy, float), mu=np.asarray(mu, float))
        pre_edge(g)
        flat = g.flat
        e0 = edge_e0(np.asarray(energy, float), flat)
        grid = np.arange(FROM_eV, TO_eV + STEP_eV / 2, STEP_eV)
        # Settle E0 on the stored grid itself, as make-xanes-library.py does.
        for _ in range(4):
            again = edge_e0(grid, np.interp(grid, energy - e0, flat))
            if abs(again) < 0.05:
                break
            e0 += again
        out.append({"id": id_, "description": what, "source": URL + name, "e0_eV": round(e0, 2), "larch_e0_eV": round(float(g.e0), 2),
                    "mu": [round(float(v), 4) for v in np.interp(grid, energy - e0, flat)]})
        print(id_, f"E0 {e0:.1f} (Larch {g.e0:.1f})")
    OUT.write_text(json.dumps({"description": "Measured normalized mu (Larch pre_edge, flattened) around E0 (scripts/twin/edge_e0.py), "
                               "xraylarch examples, MIT License, Copyright (c) 2010-2026 Matthew Newville and the Larch authors.",
                               "license": "MIT", "energy": {"from_eV": FROM_eV, "step_eV": STEP_eV}, "references": out},
                              separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
