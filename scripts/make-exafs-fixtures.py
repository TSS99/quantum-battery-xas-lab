"""Generate AUTOBK and xftf reference fixtures with the installed xraylarch.

Run with the repository's reference environment:
  C:\\Users\\Tilock\\astra-runner\\pyenv\\Scripts\\python.exe scripts/make-exafs-fixtures.py

The input curves are deterministic synthetic spectra.  The reference outputs are
calculated by xraylarch itself; no reference values are typed into the fixture.
"""

from __future__ import annotations

import json
from pathlib import Path

import larch
import numpy as np
from larch import Group
from larch.xafs import autobk, xftf


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "data" / "exafs-larch-fixtures.json"
ETOK = 0.26246842396479836

AUTOBK_PARAMETERS = {
    "rbkg": 1.0,
    "kmin": 0.0,
    "kmax": 14.0,
    "kweight": 1,
    "dk": 0.1,
    "win": "hanning",
    "nfft": 2048,
    "kstep": 0.05,
    "nclamp": 3,
    "clamp_lo": 0,
    "clamp_hi": 1,
}

XFTF_PARAMETERS = {
    "kmin": 2.0,
    "kmax": 14.0,
    "kweight": 2,
    "dk": 1.0,
    "window": "hanning",
    "rmax_out": 10.0,
    "nfft": 2048,
    "kstep": 0.05,
}


def synthetic_input(e0: float, edge_step: float, kind: str) -> tuple[np.ndarray, np.ndarray]:
    """Return a pre-edge plus uniform-k post-edge spectrum in absorption units."""
    pre = np.arange(e0 - 200.0, e0, 5.0)
    k = np.arange(0.0, 16.0 + 0.025, 0.05)
    post = e0 + k * k / ETOK
    energy = np.concatenate((pre, post))

    offset = energy - e0
    baseline = 0.36 + 1.4e-4 * offset
    continuum = np.where(offset >= 0, edge_step * (1.0 - np.exp(-offset / 5.0)), 0.0)
    turn_on = 1.0 - np.exp(-((k / 1.35) ** 4))
    if kind == "single-shell":
        chi = 0.105 * np.sin(2.0 * k * 2.24 + 0.42) * np.exp(-0.014 * k * k) * turn_on / (1.0 + 0.055 * k)
    elif kind == "cu-foil-like":
        first = 0.118 * np.sin(2.0 * k * 2.56 + 0.50) * np.exp(-0.010 * k * k)
        farther = 0.042 * np.sin(2.0 * k * 3.62 - 0.72) * np.exp(-0.018 * k * k)
        chi = (first + farther) * turn_on / (1.0 + 0.05 * k)
    else:
        raise ValueError(f"unknown fixture kind: {kind}")

    mu = baseline + continuum
    mu[len(pre) :] += edge_step * chi
    return energy, mu


def make_case(name: str, kind: str, e0: float, edge_step: float) -> dict[str, object]:
    energy, mu = synthetic_input(e0, edge_step, kind)
    background = Group()
    autobk(
        energy,
        mu,
        group=background,
        ek0=e0,
        edge_step=edge_step,
        **AUTOBK_PARAMETERS,
    )
    transform = Group()
    xftf(background.k, background.chi, group=transform, **XFTF_PARAMETERS)

    return {
        "name": name,
        "description": (
            "Deterministic synthetic single-shell spectrum"
            if kind == "single-shell"
            else "Deterministic Cu-foil-like two-shell spectrum; realistic in shape, not measured data"
        ),
        "reference": {
            "larch_version": getattr(larch, "__version__", "unknown"),
            "autobk_call": f"autobk(energy, mu, group=background, ek0={e0!r}, edge_step={edge_step!r}, rbkg=1.0, kmin=0.0, kmax=14.0, kweight=1, dk=0.1, win='hanning', nfft=2048, kstep=0.05, nclamp=3, clamp_lo=0, clamp_hi=1)",
            "xftf_call": "xftf(background.k, background.chi, group=transform, kmin=2.0, kmax=14.0, kweight=2, dk=1.0, window='hanning', rmax_out=10.0, nfft=2048, kstep=0.05)",
        },
        "input": {
            "energy_eV": energy.tolist(),
            "mu": mu.tolist(),
            "e0_eV": e0,
            "edge_step": edge_step,
        },
        "autobk": {
            "parameters": AUTOBK_PARAMETERS,
            "k": background.k.tolist(),
            "chi": background.chi.tolist(),
            "bkg": background.bkg.tolist(),
            "nknots": int(background.autobk_details.nknots),
        },
        "xftf": {
            "parameters": XFTF_PARAMETERS,
            "r": transform.r.tolist(),
            "kwin": transform.kwin.tolist(),
            "chir_mag": transform.chir_mag.tolist(),
            "chir_re": transform.chir_re.tolist(),
            "chir_im": transform.chir_im.tolist(),
        },
    }


def main() -> None:
    version = getattr(larch, "__version__", "unknown")
    payload = {
        "schema": "xas-lab-larch-exafs-fixture/1",
        "generated_by": "scripts/make-exafs-fixtures.py",
        "larch_version": version,
        "calls": {
            "autobk": "autobk(energy, mu, group=background, ek0=e0, edge_step=edge_step, rbkg=1.0, kmin=0.0, kmax=14.0, kweight=1, dk=0.1, win='hanning', nfft=2048, kstep=0.05, nclamp=3, clamp_lo=0, clamp_hi=1)",
            "xftf": "xftf(background.k, background.chi, group=transform, kmin=2.0, kmax=14.0, kweight=2, dk=1.0, window='hanning', rmax_out=10.0, nfft=2048, kstep=0.05)",
        },
        "normalization": "xraylarch 2026.3.1 xftf_fast: (kstep / sqrt(pi)) * numpy.fft.fft(cchi)",
        "cases": [
            make_case("single-shell", "single-shell", 7112.0, 1.0),
            make_case("cu-foil-like", "cu-foil-like", 8979.0, 1.25),
        ],
    }
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} with xraylarch {version}")


if __name__ == "__main__":
    main()
