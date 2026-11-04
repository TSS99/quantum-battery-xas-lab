#!/usr/bin/env python
"""Computed against measured (Phase 7 of docs/PLAN-quantum.md): the library's exact spectra next to published
experimental peak energies, each with its source.

  python scripts/quantum/validation.py

Peak energies are facts and can be quoted; measured spectra themselves need a licence, which no Li2MnO3 O K edge
found so far has (docs/QUANTUM_VALIDATION.md). A computed peak is a transition carrying more than 2 percent of the
dipole weight, with transitions closer than 0.1 eV merged (CO's pi* is doubly degenerate). Writes
src/data/quantum/validation.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import library  # noqa: E402
from qxas.builder import HARTREE_EV  # noqa: E402

OUT = library.ROOT / "src" / "data" / "quantum" / "validation.json"
SCHIRMER = {"source": "Schirmer et al., Phys. Rev. A 47, 1136 (1993)", "doi": "10.1103/PhysRevA.47.1136"}
SODHI = {"source": "Sodhi and Brion (1984), electron energy loss, as quoted by Püttner et al., Phys. Rev. A 59, 3415 (1999)",
         "doi": "10.1103/PhysRevA.59.3415"}
MEASURED = [
    {"problem": "h2o-o-k-sto3g", "feature": "first peak, O 1s to 4a1", "peaks": [0], "eV": 534.0, **SCHIRMER},
    {"problem": "h2o-o-k-sto3g", "feature": "spacing from 4a1 to 2b2", "peaks": [0, 1], "eV": 1.89, **SCHIRMER},
    {"problem": "co-o-k-sto3g", "feature": "first peak, O 1s to 2pi*", "peaks": [0], "eV": 534.21, **SODHI},
]


def peaks(problem_id: str, share: float = 0.02, merge_eV: float = 0.1) -> list[float]:
    """Energies (eV) of the transitions carrying more than `share` of the weight, weight averaged within `merge_eV`."""
    ref = json.loads((library.OUT / f"{problem_id}.json").read_text())["reference"]
    total = sum(ref["weights"])
    strong = sorted((c * HARTREE_EV, w) for c, w in zip(ref["centres_Ha"], ref["weights"]) if w > share * total)
    groups: list[list[tuple[float, float]]] = []
    for e, w in strong:
        if groups and e - groups[-1][-1][0] < merge_eV:
            groups[-1].append((e, w))
        else:
            groups.append([(e, w)])
    return [sum(e * w for e, w in g) / sum(w for _, w in g) for g in groups]


def compare() -> list[dict]:
    rows = []
    for m in MEASURED:
        found = peaks(m["problem"])
        computed = found[m["peaks"][0]] if len(m["peaks"]) == 1 else found[m["peaks"][1]] - found[m["peaks"][0]]
        rows.append({**m, "computed_eV": round(computed, 3), "difference_eV": round(computed - m["eV"], 3)})
    return rows


def main() -> None:
    rows = compare()
    OUT.write_text(json.dumps({"schema": 1, "rows": rows}, indent=1, ensure_ascii=False) + "\n")
    for r in rows:
        print(f"{r['problem']}, {r['feature']}: measured {r['eV']} eV, computed {r['computed_eV']} eV, {r['difference_eV']:+.2f} eV")


if __name__ == "__main__":
    main()
