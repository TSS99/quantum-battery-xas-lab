#!/usr/bin/env python
"""Independent reference values for src/lib/twin/{source,mono,mirrors,beam}.ts.

Run from the repository root with the pinned reference environment:

  C:\\Users\\Tilock\\astra-runner\\pyenv\\Scripts\\python.exe scripts/twin/reference_beam.py

Everything here is recomputed from xraydb, SciPy and the closed-form beamline expressions.
Nothing is read back from src/data/twin/optics.json, so the fixtures are an independent check
of the TypeScript model and of the table interpolation it runs on:

* Bragg angle from a = 5.431020511 angstrom and hc = 12398.419843320026 eV*angstrom.
* Darwin widths from xraydb.darwin_width at the energy of each order.
* Mirror reflectivity from xraydb.mirror_reflectivity at the bulk coating densities.
* Bending-magnet flux from G1(y) by SciPy quadrature, with the X-ray Data Booklet prefactors.
* Detune throughput and relative angular acceptance from a Darwin-Prins reflectivity curve
  rebuilt from xraydb scattering factors over +/-400 intrinsic widths, the same full-tail
  construction the optics table uses (dossier script s02b_detune.py) but recomputed here.

The output contains no timestamps or random values.  Twelve configurations (three crystals x
{3 GeV and 6 GeV bending magnet} x {mirrors in and out} x {detune 0 and 0.5}) are each
evaluated at five energies from 5 to 25 keV.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from scipy import integrate, special
import xraydb
from xraydb import f0, f1_chantler, f2_chantler
from xraydb.xray import R0


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "twin" / "beam-fixtures.json"

SI_LATTICE_A = 5.431020511          # CODATA 2018 silicon lattice parameter
HC_EV_ANGSTROM = 12398.419843320026  # CODATA; xraydb PLANCK_HC agrees to 1 part in 1e16
CRITICAL_ENERGY_keV = 0.665          # eps_c[keV] = 0.665 E[GeV]^2 B[T], XDB 2.1
BENDING_MAGNET_FLUX = 2.457e13       # ph/s/mrad/(0.1 % BW) per GeV per A, XDB 2.1
SOURCE_BANDWIDTH = 1e-3

CRYSTAL_HKL = {"Si111": (1, 1, 1), "Si311": (3, 1, 1), "Si220": (2, 2, 0)}
MIRROR_DENSITY = {"Si": 2.33, "Rh": 12.41, "Pt": 21.45, "Ni": 8.90}
# Photon-energy range the optics mirror table covers; the twin drops orders above it.
MIRROR_ENERGY_RANGE_eV = (2000.0, 60000.0)

DETUNE_SPAN = 400.0
DETUNE_POINTS = 400_001

ENERGIES_eV = [5000.0, 8979.0, 12000.0, 18000.0, 25000.0]

RINGS = {
    "bm3": {"kind": "bending-magnet", "ring_GeV": 3.0, "current_mA": 300.0,
            "field_T": 1.4, "hAccept_mrad": 1.5, "vDiv_urad": 25.0},
    "bm6": {"kind": "bending-magnet", "ring_GeV": 6.0, "current_mA": 200.0,
            "field_T": 0.86, "hAccept_mrad": 1.0, "vDiv_urad": 15.0},
}

# Illustrative generic optics, not a real beamline: a rhodium collimating mirror and a
# platinum focusing mirror, both at 3.0 mrad, which is on the stored 0.25 mrad angle grid.
MIRRORS = [
    {"id": "M1", "role": "collimating", "coating": "Rh", "angle_mrad": 3.0},
    {"id": "M2", "role": "focusing", "coating": "Pt", "angle_mrad": 3.0},
]

VARIANTS = [
    ("bm3", True, 0.0),
    ("bm3", False, 0.5),
    ("bm6", True, 0.5),
    ("bm6", False, 0.0),
]


def allowed_orders(hkl: tuple[int, int, int]) -> list[int]:
    """Diamond-structure allowed orders 1 to 5: all odd, or all even with h+k+l = 4m."""
    orders = []
    for order in range(1, 6):
        h, k, l = (order * index for index in hkl)
        all_odd = h % 2 and k % 2 and l % 2
        all_even = h % 2 == 0 and k % 2 == 0 and l % 2 == 0
        if all_odd or (all_even and (h + k + l) % 4 == 0):
            orders.append(order)
    return orders


def d_spacing(hkl: tuple[int, int, int]) -> float:
    h, k, l = hkl
    return SI_LATTICE_A / math.sqrt(h * h + k * k + l * l)


def bragg_angle(hkl: tuple[int, int, int], energy_eV: float) -> float:
    return math.asin(HC_EV_ANGSTROM / (2 * d_spacing(hkl) * energy_eV))


def g1(y: float) -> float:
    """G1(y) = y * integral_y^inf K_{5/3}(x) dx."""
    value, _ = integrate.quad(lambda x: special.kv(5 / 3, x), y, np.inf, epsrel=1e-10)
    return y * value


def bending_magnet_flux(ring: dict, energy_eV: float) -> float:
    """ph/s per 0.1 % bandwidth through the horizontal acceptance, all vertical angles."""
    critical_eV = 1000 * CRITICAL_ENERGY_keV * ring["ring_GeV"] ** 2 * ring["field_T"]
    return (BENDING_MAGNET_FLUX * ring["ring_GeV"] * ring["current_mA"] / 1000
            * g1(energy_eV / critical_eV) * ring["hAccept_mrad"])


def darwin_curve(energy_eV: float, hkl: tuple[int, int, int]):
    """Darwin-Prins reflectivity over +/-DETUNE_SPAN intrinsic widths, in angle offset (rad).

    Same dynamical-diffraction expressions as xraydb.darwin_width (Als-Nielsen and McMorrow
    section 6.4), but on a grid wide enough to keep the 1/x^2 tails that carry the harmonic
    rejection.
    """
    h, k, l = hkl
    equivalent = 8.0 if (h % 2 == 0 and k % 2 == 0 and l % 2 == 0) else 4 * math.sqrt(2)
    spacing = d_spacing(hkl)
    theta = math.asin(HC_EV_ANGSTROM / (2 * spacing * energy_eV))
    q = 0.5 / spacing
    f1 = f1_chantler("Si", energy_eV)
    f2 = f2_chantler("Si", energy_eV)
    gscale = 2 * spacing ** 2 * R0 / SI_LATTICE_A ** 3
    g0 = 8 * gscale * (f0("Si", 0)[0] + f1 - 1j * f2)
    g = equivalent * gscale * (f0("Si", q)[0] + f1 - 1j * f2)
    width = abs(2 * g / np.pi)
    zeta = g0.real / np.pi + np.linspace(-DETUNE_SPAN, DETUNE_SPAN, DETUNE_POINTS) * width
    xc = (np.pi * zeta - g0) / g
    r = xc - 1j * np.sqrt(1 - xc ** 2 + 0j)
    r = np.where(abs(r) > 1, xc + 1j * np.sqrt(1 - xc ** 2 + 0j), r)
    return zeta * np.tan(theta), np.abs(r) ** 2


def autocorrelation(offsets: np.ndarray, reflectivity: np.ndarray):
    """A(delta) = integral R(theta) R(theta - delta) dtheta, by FFT, on the same angle units."""
    step = offsets[1] - offsets[0]
    count = len(reflectivity)
    padded = 1 << int(math.ceil(math.log2(2 * count)))
    spectrum = np.fft.rfft(reflectivity, padded)
    correlation = np.fft.irfft(spectrum * np.conj(spectrum), padded) * step
    correlation = np.concatenate([correlation[-(count - 1):], correlation[:count]])
    lags = np.arange(-(count - 1), count) * step
    return lags, correlation


_DETUNE_CACHE: dict[tuple, dict[int, tuple[float, float]]] = {}


def detune_and_acceptance(crystal: str, fundamental_eV: float, orders: list[int],
                          detune: float) -> dict[int, tuple[float, float]]:
    """{order: (throughput at the detune, A_order(0)/A_1(0))} for one monochromator setting."""
    key = (crystal, fundamental_eV, tuple(orders), detune)
    if key in _DETUNE_CACHE:
        return _DETUNE_CACHE[key]
    hkl = CRYSTAL_HKL[crystal]
    rocking_fwhm = xraydb.darwin_width(fundamental_eV, crystal="Si", hkl=hkl,
                                       a=SI_LATTICE_A, polarization="s").rocking_theta_fwhm
    offset = detune * rocking_fwhm
    result: dict[int, tuple[float, float]] = {}
    peak_fundamental = None
    for order in orders:
        order_hkl = tuple(order * index for index in hkl)
        angles, reflectivity = darwin_curve(order * fundamental_eV, order_hkl)
        lags, correlation = autocorrelation(angles, reflectivity)
        peak = correlation.max()
        if order == 1:
            peak_fundamental = peak
        throughput = float(np.interp(offset, lags, correlation) / peak)
        result[order] = (throughput, float(peak / peak_fundamental))
    _DETUNE_CACHE[key] = result
    return result


def mirror_transmission(mirrors: list[dict], inserted: bool, energy_eV: float) -> float:
    if not inserted:
        return 1.0
    transmission = 1.0
    for mirror in mirrors:
        transmission *= float(xraydb.mirror_reflectivity(
            mirror["coating"], mirror["angle_mrad"] * 1e-3, energy_eV,
            density=MIRROR_DENSITY[mirror["coating"]], roughness=0.0, polarization="s",
            output="intensity"))
    return transmission


def sig(value: float, digits: int = 12) -> float:
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"non-finite generated value: {value}")
    if value == 0:
        return 0.0
    return float(f"{value:.{digits}g}")


def point(crystal: str, ring: dict, inserted: bool, detune: float,
          fundamental_eV: float) -> dict:
    hkl = CRYSTAL_HKL[crystal]
    theta = bragg_angle(hkl, fundamental_eV)
    cot = 1 / math.tan(theta)
    divergence = ring["vDiv_urad"] * 1e-6

    in_range = [order for order in allowed_orders(hkl)
                if order * fundamental_eV <= MIRROR_ENERGY_RANGE_eV[1]]
    omitted = [order for order in allowed_orders(hkl) if order not in in_range]
    factors = detune_and_acceptance(crystal, fundamental_eV, in_range, detune)

    orders = []
    for order in in_range:
        order_eV = order * fundamental_eV
        widths = xraydb.darwin_width(order_eV, crystal="Si",
                                     hkl=tuple(order * index for index in hkl),
                                     a=SI_LATTICE_A, polarization="s")
        bandwidth = widths.energy_fwhm / order_eV
        throughput, acceptance = factors[order]
        source_flux = bending_magnet_flux(ring, order_eV)
        mirrors = mirror_transmission(MIRRORS, inserted, order_eV)
        orders.append({
            "order": order,
            "energy_eV": sig(order_eV),
            "bandwidth": sig(bandwidth),
            "intrinsicDeltaE_eV": sig(order_eV * cot * widths.theta_fwhm),
            "deltaE_eV": sig(order_eV * cot * math.hypot(widths.theta_fwhm, divergence)),
            "darwinTheta_fwhm_rad": sig(widths.theta_fwhm),
            "acceptance": sig(acceptance),
            "detuneFactor": sig(throughput),
            "mirrorTransmission": sig(mirrors),
            "sourceFlux": sig(source_flux),
            "flux": sig(source_flux * bandwidth / SOURCE_BANDWIDTH * acceptance * throughput
                        * mirrors),
        })

    fundamental = orders[0]
    harmonic_flux = sum(entry["flux"] for entry in orders[1:])
    total = fundamental["flux"] + harmonic_flux
    return {
        "energy_eV": sig(fundamental_eV),
        "thetaB_rad": sig(theta),
        "bandwidth": fundamental["bandwidth"],
        "deltaE_eV": fundamental["deltaE_eV"],
        "flux": fundamental["flux"],
        "harmonicFlux": sig(harmonic_flux),
        "harmonicFraction": sig(harmonic_flux / total),
        "mirrorTransmission": fundamental["mirrorTransmission"],
        "omittedOrders": omitted,
        "orders": orders,
    }


def configurations() -> list[dict]:
    configs = []
    for crystal in CRYSTAL_HKL:
        for ring_key, inserted, detune in VARIANTS:
            ring = RINGS[ring_key]
            name = (f"{crystal} {ring_key} mirrors-{'in' if inserted else 'out'} "
                    f"detune-{detune:g}")
            configs.append({
                "name": name,
                "crystal": crystal,
                "detune": detune,
                "mirrorsInserted": inserted,
                "source": dict(ring),
                "mirrors": [dict(mirror, inserted=inserted) for mirror in MIRRORS],
                "points": [point(crystal, ring, inserted, detune, energy_eV)
                           for energy_eV in ENERGIES_eV],
            })
    return configs


def resolution_checks() -> list[dict]:
    """Single-crystal resolution rows named in the task brief, straight from xraydb."""
    rows = []
    for crystal, energy_eV in [("Si111", 8979.0), ("Si311", 8979.0), ("Si220", 8979.0),
                               ("Si111", 7112.0), ("Si111", 11564.0)]:
        hkl = CRYSTAL_HKL[crystal]
        widths = xraydb.darwin_width(energy_eV, crystal="Si", hkl=hkl, a=SI_LATTICE_A,
                                     polarization="s")
        rows.append({
            "crystal": crystal,
            "energy_eV": sig(energy_eV),
            "thetaB_rad": sig(bragg_angle(hkl, energy_eV)),
            "energy_fwhm_eV": sig(widths.energy_fwhm),
            "relativeBandwidth": sig(widths.energy_fwhm / energy_eV),
            "theta_fwhm_rad": sig(widths.theta_fwhm),
        })
    return rows


def mirror_checks() -> list[dict]:
    """Reflectivity rows the mirror tests name, on the stored 0.25 mrad angle grid."""
    rows = []
    for coating, angle_mrad, energy_eV in [("Rh", 3.0, 20000.0), ("Rh", 3.0, 27000.0),
                                           ("Rh", 3.0, 5000.0), ("Si", 3.0, 7112.0),
                                           ("Si", 3.0, 21336.0), ("Pt", 3.0, 12000.0),
                                           ("Ni", 4.0, 7112.0)]:
        rows.append({
            "coating": coating,
            "angle_mrad": angle_mrad,
            "energy_eV": sig(energy_eV),
            "reflectivity": sig(mirror_transmission(
                [{"coating": coating, "angle_mrad": angle_mrad}], True, energy_eV)),
        })
    return rows


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "format": "xaslab-twin-beam-fixtures/1",
        "generator": "scripts/twin/reference_beam.py",
        "xraydbVersion": xraydb.__version__,
        "constants": {
            "siLattice_A": SI_LATTICE_A,
            "hc_eV_angstrom": HC_EV_ANGSTROM,
            "criticalEnergyPrefactor_keV": CRITICAL_ENERGY_keV,
            "bendingMagnetFluxPrefactor": BENDING_MAGNET_FLUX,
            "sourceBandwidth": SOURCE_BANDWIDTH,
            "mirrorEnergyRange_eV": list(MIRROR_ENERGY_RANGE_eV),
        },
        "calls": {
            "darwin": "xraydb.darwin_width(order*fundamental_energy_eV, crystal='Si', hkl=order*base_hkl, a=5.431020511, polarization='s')",
            "mirror": "xraydb.mirror_reflectivity(coating, angle_mrad*1e-3, energy_eV, density=bulk, roughness=0, polarization='s', output='intensity')",
            "g1": "y*scipy.integrate.quad(lambda x: scipy.special.kv(5/3,x), y, numpy.inf, epsrel=1e-10)",
            "source": "2.457e13*ring_GeV*current_A*G1(E/eps_c)*hAccept_mrad, eps_c[keV]=0.665*ring_GeV^2*field_T (X-ray Data Booklet section 2.1)",
            "detune": "Darwin-Prins curve from xraydb.f0('Si', q), f1_chantler, f2_chantler and xraydb.xray.R0 over +/-400 intrinsic widths at 400001 points; FFT autocorrelation; delta = detune*xraydb.darwin_width(fundamental).rocking_theta_fwhm",
            "flux": "sourceFlux(nE)*bandwidth_n/1e-3*acceptance_n*detuneFactor_n*mirrorTransmission(nE)",
        },
        "notes": [
            "Bending-magnet flux is integrated over all vertical angles; there is no vertical aperture, window or slope-error loss.",
            "bandwidth is the xraydb Darwin energy FWHM over the photon energy, the same definition the TypeScript model uses for the flux band.",
            "Orders whose energy exceeds the tabulated mirror range are listed in omittedOrders and left out of the harmonic sum.",
            "Mirrors are an illustrative generic pair, not a real beamline.",
        ],
        "resolution": resolution_checks(),
        "mirrors": mirror_checks(),
        "configurations": configurations(),
    }
    OUT.write_text(json.dumps(fixtures, ensure_ascii=False, sort_keys=True,
                              separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, "
          f"{len(fixtures['configurations'])} configurations)")


if __name__ == "__main__":
    main()
