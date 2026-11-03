#!/usr/bin/env python
"""The library of oxygen K edge problems (Phase 2 of docs/PLAN-quantum.md).

  python scripts/quantum/library.py            # build every recipe
  python scripts/quantum/library.py h2o-o-k    # build some

Each recipe becomes src/data/quantum/instances/<id>.json (integrals, metadata, and the exact stick spectrum when the
determinant space allows it), and index.json lists them. Choices the papers leave open (site, charge, spin) are
written in each recipe's `why`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qxas.builder import Recipe, instance, write  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "quantum" / "instances"
LI2MNO3 = "cod-1008373-Li2MnO3.cif"
WATER = "O 0 0 0.1173; H 0 0.7572 -0.4692; H 0 -0.7572 -0.4692"  # O-H 0.9572 A, 104.52 degrees (gas phase)
CO = "C 0 0 -0.6446; O 0 0 0.4834"  # 1.128 A

RECIPES = [
    Recipe("h2o-o-k-sto3g", "Water, oxygen K edge, minimal basis",
           "The smallest oxygen K edge: every orbital of STO-3G active, so the reference is full CI. Sized for the "
           "browser emulator.", avas=("O 1s", "O 2s", "O 2p", "H 1s"), core="O 1s", atoms=WATER, basis="sto-3g",
           threshold=0.05, tags=("molecule", "browser")),
    Recipe("co-o-k-sto3g", "Carbon monoxide, oxygen K edge, minimal basis",
           "A pi* resonance like the oxide pre-edge, with every STO-3G orbital active (21 qubits).",
           avas=("C 1s", "C 2s", "C 2p", "O 1s", "O 2s", "O 2p"), core="O 1s", atoms=CO, basis="sto-3g",
           threshold=0.05, tags=("molecule",)),
    Recipe("li2mno3-o2-k", "Li4Mn2O from Li2MnO3, O2 site, oxygen K edge",
           "Fig. 9 of 2506.15784. The paper gives no site, charge or spin; the O2 site is the more common one, and a "
           "neutral cluster with 2S = 0 is what gives the paper's CAS(14e,11o) from AVAS on Mn 3d and O 1s.",
           avas=("Mn 3d", "O 1s"), core="O 1s", structure=LI2MNO3, site="O2", tags=("li2mno3",)),
    Recipe("li2mno3-o1-k", "Li4Mn2O from Li2MnO3, O1 site, oxygen K edge",
           "The other oxygen site (a third of the oxygens), with the same choices as O2.",
           avas=("Mn 3d", "O 1s"), core="O 1s", structure=LI2MNO3, site="O1", tags=("li2mno3",)),
    Recipe("li3mn2o-o2-k", "Li3Mn2O, O2 site with one lithium removed",
           "Delithiation takes lithium from the lithium layers first; this removes the nearest of them (Li3, "
           "2.04 A). The cluster stays neutral, so it loses an electron with the lithium, and 2S = 1.",
           avas=("Mn 3d", "O 1s"), core="O 1s", structure=LI2MNO3, site="O2", remove=("Li3",), spin=1,
           tags=("li2mno3", "delithiated")),
    Recipe("li2mn2o-o2-k", "Li2Mn2O, O2 site with two lithium removed",
           "The two nearest lithium layer atoms removed (Li3 at 2.04 A, Li2 at 2.15 A); neutral, 2S = 0.",
           avas=("Mn 3d", "O 1s"), core="O 1s", structure=LI2MNO3, site="O2", remove=("Li3", "Li2"),
           tags=("li2mno3", "delithiated")),
    Recipe("li2mno3-o2-k-18", "Li4Mn2O, O2 site, the paper's full active space",
           "CAS(22e,18o) of 2405.11015 and 2506.15784: Mn 3d, Li 2s, O 2p and O 1s. Far beyond exact classical "
           "methods (about 10^9 determinants), so no reference: a target for fault tolerant hardware.",
           avas=("Mn 3d", "Li 2s", "O 2p", "O 1s"), core="O 1s", structure=LI2MNO3, site="O2",
           tags=("li2mno3", "quantum-target")),
]


def main() -> None:
    wanted = set(sys.argv[1:])
    for recipe in RECIPES:
        if wanted and recipe.id not in wanted:
            continue
        data = instance(recipe)
        path = write(data, OUT)
        m = data["meta"]
        ref = data.get("reference")
        print(f"{recipe.id}: CAS({m['active_electrons']}e,{m['active_orbitals']}o), {m['qubits']} qubits, "
              f"{m['ci_dimension']} determinants, SCF converged {m['scf_converged']}, "
              + (f"edge {ref['edge_eV']:.1f} eV" if ref else "no reference") + f" -> {path.name}", flush=True)
    index = []
    for path in sorted(OUT.glob("*.json")):
        if path.name == "index.json":
            continue
        d = json.loads(path.read_text())
        index.append({"id": d["recipe"]["id"], "title": d["recipe"]["title"], "tags": d["recipe"]["tags"],
                      "qubits": d["meta"]["qubits"], "active": [d["meta"]["active_electrons"], d["meta"]["active_orbitals"]],
                      "determinants": d["meta"]["ci_dimension"], "reference": "reference" in d,
                      "edge_eV": d.get("reference", {}).get("edge_eV"), "hash": d["hash"],
                      "bytes": path.stat().st_size})
    (OUT / "index.json").write_text(json.dumps({"schema": 1, "instances": index}, indent=1) + "\n")


if __name__ == "__main__":
    main()
