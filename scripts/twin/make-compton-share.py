#!/usr/bin/env python
"""Generate the Compton share of X-ray scattering for every element, for the 3D hutch's photons.

Run from the repository root with the pinned reference environment:

  C:\\Users\\Tilock\\astra-runner\\pyenv\\Scripts\\python.exe scripts/twin/make-compton-share.py

src/lib/xraydata.ts ships photoabsorption and the total only, so the scattering it implies (total minus photo) is
coherent plus incoherent together. This table gives the incoherent (Compton) part's share of it, from the same Elam
tables (xraydb.mu_elam, kind 'coh' and 'incoh', CC0), for H to Cf on a log energy grid from 1 to 100 keV. The share is
smooth in energy (scattering has no edges), so linear interpolation in ln E is accurate; the fixtures hold exact
values at energies off the grid to check that. Shares are rounded to four significant digits, fixtures to twelve.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import xraydb

ROOT = Path(__file__).resolve().parents[2]
TABLE_OUT = ROOT / "src" / "data" / "twin" / "compton-share.json"
FIXTURES_OUT = ROOT / "src" / "data" / "twin" / "compton-fixtures.json"
Z_MAX = 98
GRID = np.geomspace(1000.0, 100_000.0, 61)
FIXTURE_ELEMENTS = ["H", "C", "O", "Si", "Fe", "Cu", "Ag", "Pb", "U"]
FIXTURE_ENERGIES = [2500.0, 7111.0, 8979.0, 17480.0, 33333.0, 61000.0]


def share(symbol: str, energies) -> np.ndarray:
    energies = np.asarray(energies, dtype=float)
    coh = np.asarray(xraydb.mu_elam(symbol, energies, kind="coh"), dtype=float)
    incoh = np.asarray(xraydb.mu_elam(symbol, energies, kind="incoh"), dtype=float)
    return incoh / (coh + incoh)


def sig(value: float, digits: int) -> float:
    return float(f"{value:.{digits}g}")


def main() -> None:
    table = {
        "description": "Incoherent (Compton) share of coherent plus incoherent scattering, mu_incoh / (mu_coh + mu_incoh), "
                       "per element, from xraydb.mu_elam (Elam, Ravel and Sieber 2002; CC0). Interpolate linearly in ln E.",
        "xraydb": xraydb.__version__,
        "energies_eV": [sig(e, 6) for e in GRID],
        "share": {xraydb.atomic_symbol(z): [sig(v, 4) for v in share(xraydb.atomic_symbol(z), GRID)] for z in range(1, Z_MAX + 1)},
    }
    fixtures = {
        "description": "Exact Compton shares from xraydb.mu_elam at energies off the table grid, to test the interpolation.",
        "xraydb": xraydb.__version__,
        "points": [{"symbol": s, "energy_eV": e, "share": sig(float(share(s, [e])[0]), 12)} for s in FIXTURE_ELEMENTS for e in FIXTURE_ENERGIES],
    }
    for path, value in ((TABLE_OUT, table), (FIXTURES_OUT, fixtures)):
        path.write_text(json.dumps(value, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
