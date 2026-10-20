#!/usr/bin/env python
"""Generate compact beamline-twin optics tables and independent golden fixtures.

Run from the repository root with the pinned reference environment:

  C:\\Users\\Tilock\\astra-runner\\pyenv\\Scripts\\python.exe scripts/twin/make-optics-tables.py

The output contains no timestamps or random values.  Table values are rounded to four
significant digits; fixture values retain twelve significant digits.  The silicon
lattice constant is 5.431020511 angstrom (CODATA 2018 silicon {220} lattice spacing,
converted to the cubic lattice constant).  xraydb is always called with that value.
"""

from __future__ import annotations

import gzip
import json
import math
from pathlib import Path

import numpy as np
import scipy.constants as constants
from scipy import integrate, special
import xraydb
from xraydb.xray import PLANCK_HC, R0


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "src" / "data" / "twin"
OPTICS_OUT = OUT_DIR / "optics.json"
FIXTURES_OUT = OUT_DIR / "fixtures.json"

SI_LATTICE_A = 5.431020511  # angstrom, CODATA 2018 silicon lattice parameter
HC_EV_ANGSTROM = constants.h * constants.c / constants.e * 1e10
CRYSTALS = {"Si111": (1, 1, 1), "Si311": (3, 1, 1), "Si220": (2, 2, 0)}
DETUNE_FRACTIONS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.2, 1.5]
DETUNE_SPAN = 400.0
DETUNE_POINTS = 400_001
MIRRORS = {"Si": 2.33, "Rh": 12.41, "Pt": 21.45, "Ni": 8.90}
MIRROR_ANGLES_MRAD = [1.0 + 0.25 * i for i in range(21)]
# The edge refinement below is spaced 1e-4 in relative energy.  Four significant digits
# would collapse those knots into duplicates and silently undo the refinement, so the
# mirror energy axis keeps eight.  Reflectivity values stay at four.
MIRROR_ENERGY_DIGITS = 8
INITIAL_LEVELS = ("K", "L1", "L2", "L3", "M1", "M2", "M3", "M4", "M5")
GAS_FORMULAS = {
    "N2": "N2",
    "He": "He",
    "Ar": "Ar",
    "Kr": "Kr",
    # Dry-air mole fractions: N2 0.78084, O2 0.20946, Ar 0.00934, CO2 0.00036.
    "air": "N1.56168O0.41964Ar0.00934C0.00036",
}


def sig(value: float, digits: int = 4) -> float:
    """Round a finite scalar to a deterministic number of significant digits."""
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"non-finite generated value: {value}")
    if value == 0:
        return 0.0
    return float(f"{value:.{digits}g}")


def log_grid(low: float, high: float, count: int) -> list[float]:
    return np.geomspace(low, high, count).tolist()


def allowed(hkl: tuple[int, int, int]) -> bool:
    """Diamond-structure reflection rule used for silicon."""
    if all(v % 2 for v in hkl):
        return True
    return all(v % 2 == 0 for v in hkl) and sum(hkl) % 4 == 0


def darwin(energy_eV: float, hkl: tuple[int, int, int]):
    return xraydb.darwin_width(energy_eV, crystal="Si", hkl=hkl, a=SI_LATTICE_A,
                               polarization="s")


def extended_darwin_curve(energy_eV: float, hkl: tuple[int, int, int]):
    """Return the full-tail Darwin-Prins curve used by dossier script s02b_detune.py.

    xraydb.darwin_width uses the same dynamical-diffraction equations, but its returned
    dtheta/intensity arrays truncate the 1/x^2 tails.  That truncation is harmless for
    widths and incorrect for harmonic rejection after a large second-crystal detune.
    """
    h, k, l = hkl
    equivalent_reflections = 8.0 if all(value % 2 == 0 for value in hkl) else 4.0 * math.sqrt(2.0)
    d_angstrom = SI_LATTICE_A / math.sqrt(h * h + k * k + l * l)
    wavelength_angstrom = PLANCK_HC / energy_eV
    theta = math.asin(wavelength_angstrom / (2.0 * d_angstrom))
    q = 0.5 / d_angstrom
    f1 = float(xraydb.f1_chantler("Si", energy_eV))
    f2 = float(xraydb.f2_chantler("Si", energy_eV))
    scale = 2.0 * d_angstrom**2 * R0 / SI_LATTICE_A**3
    g0 = 8.0 * scale * (float(xraydb.f0("Si", 0)[0]) + f1 - 1j * f2)
    g = equivalent_reflections * scale * (float(xraydb.f0("Si", q)[0]) + f1 - 1j * f2)
    width = abs(2.0 * g / math.pi)
    refraction_offset = g0.real / math.pi
    zeta = refraction_offset + np.linspace(-DETUNE_SPAN, DETUNE_SPAN, DETUNE_POINTS) * width
    xc = (math.pi * zeta - g0) / g
    root = np.sqrt(1.0 - xc**2 + 0j)
    amplitude = xc - 1j * root
    amplitude = np.where(np.abs(amplitude) > 1.0, xc + 1j * root, amplitude)
    intensity = np.abs(amplitude) ** 2
    dtheta = zeta * math.tan(theta)
    return dtheta, intensity


def extended_correlation(energy_eV: float, hkl: tuple[int, int, int]):
    """Positive-lag autocorrelation of an extended Darwin curve, evaluated by FFT."""
    dtheta, intensity = extended_darwin_curve(energy_eV, hkl)
    step = float(dtheta[1] - dtheta[0])
    count = len(intensity)
    fft_count = 1 << int(math.ceil(math.log2(2 * count)))
    transform = np.fft.rfft(intensity, fft_count)
    correlation = np.fft.irfft(transform * np.conj(transform), fft_count)[:count] * step
    lags = np.arange(count, dtype=float) * step
    return lags, correlation


def correlation_at(lags: np.ndarray, correlation: np.ndarray, offset_rad: float) -> float:
    if offset_rad > lags[-1]:
        raise RuntimeError(f"detune offset {offset_rad:g} rad exceeds extended curve {lags[-1]:g} rad")
    return float(np.interp(offset_rad, lags, correlation))


def build_crystals():
    crystals = []
    for name, base_hkl in CRYSTALS.items():
        d_angstrom = SI_LATTICE_A / math.sqrt(sum(v * v for v in base_hkl))
        minimum_eV = HC_EV_ANGSTROM / (2 * d_angstrom * math.sin(math.radians(80)))
        energies = log_grid(minimum_eV * (1 + 1e-9), 40_000.0, 81)
        detune_energies = log_grid(minimum_eV * (1 + 1e-9), 40_000.0, 31)
        allowed_orders = []
        forbidden_orders = []
        order_tables = []
        detune_tables = []
        correlation_cache = {}

        def correlation(energy_eV: float, hkl: tuple[int, int, int]):
            key = (energy_eV, hkl)
            if key not in correlation_cache:
                correlation_cache[key] = extended_correlation(energy_eV, hkl)
            return correlation_cache[key]

        for order in range(1, 6):
            hkl = tuple(order * v for v in base_hkl)
            if not allowed(hkl):
                forbidden_orders.append(order)
                continue
            allowed_orders.append(order)
            rows = []
            for energy in energies:
                value = darwin(order * energy, hkl)
                rows.append([sig(energy), sig(value.theta), sig(value.energy_fwhm),
                             sig(value.theta_fwhm), sig(value.rocking_theta_fwhm)])
            order_tables.append([order, rows])

            detune_rows = []
            for energy in detune_energies:
                fundamental = darwin(energy, base_hkl)
                fundamental_lags, fundamental_correlation = correlation(energy, base_hkl)
                if order == 1:
                    order_lags, order_correlation = fundamental_lags, fundamental_correlation
                else:
                    order_lags, order_correlation = correlation(order * energy, hkl)
                zero_fundamental = float(fundamental_correlation[0])
                zero_order = float(order_correlation[0])
                throughput = [correlation_at(order_lags, order_correlation,
                                             f * fundamental.rocking_theta_fwhm) / zero_order
                              for f in DETUNE_FRACTIONS]
                detune_rows.append([sig(energy), sig(zero_order / zero_fundamental),
                                    *[sig(v) for v in throughput]])
            detune_tables.append([order, detune_rows])

        crystals.append([name, list(base_hkl), sig(d_angstrom), allowed_orders, forbidden_orders,
                         order_tables, detune_tables])
    return crystals


def mirror_values(coating: str, density: float, energies: np.ndarray,
                  angles_mrad: list[float] | np.ndarray = MIRROR_ANGLES_MRAD) -> np.ndarray:
    angles = np.asarray(angles_mrad, dtype=float) * 1e-3
    values = xraydb.mirror_reflectivity(coating, angles, energies, density=density,
                                       roughness=0.0, polarization="s", output="intensity")
    return np.asarray(values, dtype=float)


def mirror_candidates(coating: str) -> np.ndarray:
    base = list(np.geomspace(2_000.0, 60_000.0, 8001))
    # Bracket absorption-edge structure explicitly.  Closely spaced points allow a
    # continuous interpolant to represent the sharp tabulated changes without duplicate x.
    for edge in xraydb.xray_edges(coating).values():
        energy = float(edge.energy)
        if 2_000 < energy < 60_000:
            for delta in np.linspace(-0.003, 0.003, 61):
                base.append(energy * (1 + delta))
    return np.asarray(sorted(set(base)), dtype=float)


def compress_mirror_grid(coating: str, density: float):
    """Select a shared energy grid using error of linear R versus ln(E)."""
    energies = mirror_candidates(coating)
    actual = mirror_values(coating, density, energies)
    selected = {0, len(energies) - 1}
    # Seed a coarse log grid, plus every point deliberately added around an edge.
    selected.update(range(0, len(energies), 200))
    for edge in xraydb.xray_edges(coating).values():
        near = np.where(np.abs(energies / float(edge.energy) - 1) < 0.0031)[0]
        selected.update(int(i) for i in near)

    log_e = np.log(energies)
    # The validation below measures the rounded, stored table directly, so this selection
    # tolerance no longer needs a margin for storage rounding.  0.006 on the candidate grid
    # keeps the measured error under the 1% requirement away from the coating edges.
    tolerance = 0.006
    while True:
        knots = np.asarray(sorted(selected), dtype=int)
        worst_error = -1.0
        worst_index = -1
        for left, right in zip(knots[:-1], knots[1:]):
            if right <= left + 1:
                continue
            t = (log_e[left + 1:right] - log_e[left]) / (log_e[right] - log_e[left])
            estimate = actual[:, left, None] + (actual[:, right] - actual[:, left])[:, None] * t
            truth = actual[:, left + 1:right]
            # Relative accuracy is meaningful while R >= 0.02.  Below that, enforce an
            # absolute error equivalent to 0.4% of R=0.02.
            error = np.abs(estimate - truth) / np.maximum(truth, 0.02)
            flat = int(np.argmax(error))
            value = float(error.flat[flat])
            if value > worst_error:
                _, local = np.unravel_index(flat, error.shape)
                worst_error = value
                worst_index = left + 1 + int(local)
        if worst_error <= tolerance:
            break
        selected.add(worst_index)
        if len(selected) > 1200:
            raise RuntimeError(f"mirror grid for {coating} did not converge: {worst_error:g}")

    indices = np.asarray(sorted(selected), dtype=int)
    # Round here, so the validation below measures the table that actually ships.
    stored_energies = np.asarray([sig(v, MIRROR_ENERGY_DIGITS) for v in energies[indices]])
    stored = np.asarray([[sig(v) for v in row] for row in actual[:, indices]])
    if np.any(np.diff(stored_energies) <= 0):
        raise RuntimeError(f"mirror energy knots for {coating} are not strictly increasing "
                           f"after rounding to {MIRROR_ENERGY_DIGITS} significant digits")

    # Independent energies are offset from the compression candidates, and dense around
    # every coating edge, where the refined knots are.  The requested 0.25 mrad angle rows
    # are validated directly; angle interpolation is a separate bilinear approximation in
    # the TypeScript loader and is not covered by these numbers.
    validation_e = list(np.geomspace(2_000.37, 59_987.0, 1600))
    for edge in xraydb.xray_edges(coating).values():
        energy = float(edge.energy)
        if 2_000 < energy < 60_000:
            validation_e.extend(energy * (1 + np.linspace(-0.01, 0.01, 2001) + 5.3e-7))
    validation_e = np.asarray(sorted(set(validation_e)), dtype=float)
    truth = mirror_values(coating, density, validation_e)
    interpolated_rows = []
    for row in stored:
        interpolated_rows.append(np.interp(np.log(validation_e), np.log(stored_energies), row))
    estimate = np.asarray(interpolated_rows)
    relative = np.abs(estimate - truth) / np.maximum(truth, 0.02)
    _, worst_column = np.unravel_index(int(np.argmax(relative)), relative.shape)
    max_error = float(np.max(relative))
    p99_error = float(np.percentile(relative, 99))
    return stored_energies, stored, max_error, p99_error, float(validation_e[worst_column])


def build_mirrors():
    tables = []
    accuracy = {}
    for coating, density in MIRRORS.items():
        energies, values, maximum, p99, worst_energy = compress_mirror_grid(coating, density)
        tables.append([coating, density, [float(v) for v in energies],
                       [[sig(angle), [float(v) for v in row]]
                        for angle, row in zip(MIRROR_ANGLES_MRAD, values)]])
        accuracy[coating] = {"maxRelativeOrScaledAbsoluteError": sig(maximum, 6),
                             "p99RelativeOrScaledAbsoluteError": sig(p99, 6),
                             "worstEnergy_eV": sig(worst_energy, 8),
                             "energyKnots": len(energies)}
    return tables, accuracy


def build_lines():
    elements = []
    selected_by_symbol = {}
    for atomic_number in range(3, 99):
        symbol = xraydb.atomic_symbol(atomic_number)
        rows = []
        for level in INITIAL_LEVELS:
            group = xraydb.xray_lines(symbol, initial_level=level)
            if not group:
                continue
            strongest = max(float(line.intensity) for line in group.values())
            for name, line in sorted(group.items()):
                if float(line.intensity) + 1e-15 >= 0.01 * strongest:
                    rows.append([name, sig(line.energy), sig(line.intensity),
                                 line.initial_level, line.final_level])
        rows.sort(key=lambda row: (INITIAL_LEVELS.index(row[3]), row[1], row[0]))
        elements.append([symbol, atomic_number, rows])
        selected_by_symbol[symbol] = rows
    return elements, selected_by_symbol


def g1_value(y: float) -> float:
    integral, _ = integrate.quad(lambda x: special.kv(5.0 / 3.0, x), y, np.inf,
                                 epsabs=1e-300, epsrel=1e-9, limit=400)
    return y * integral


def build_g1():
    # Log spacing resolves the y^(1/3) low-energy regime; near the exponential
    # tail, nearly uniform y spacing keeps interpolation of ln(G1) accurate.
    ys = np.concatenate((np.geomspace(1e-4, 1.0, 71)[:-1],
                         np.linspace(1.0, 5.0, 21)[:-1],
                         np.linspace(5.0, 30.0, 64)))
    values = [g1_value(float(y)) for y in ys]
    return [[sig(v) for v in ys], [sig(v) for v in values]]


def molecular_mass(formula: str) -> float:
    return sum(float(count) * float(xraydb.atomic_mass(symbol))
               for symbol, count in xraydb.chemparse(formula).items())


def build_gases():
    pressure_pa = constants.atm
    temperature_k = 295.0
    rows = []
    for name, formula in GAS_FORMULAS.items():
        molar_mass_g_mol = molecular_mass(formula)
        density_g_cm3 = (pressure_pa * (molar_mass_g_mol / 1000) /
                         (constants.R * temperature_k) / 1000)
        rows.append([name, formula, sig(density_g_cm3), sig(xraydb.ionization_potential(name)),
                     sig(molar_mass_g_mol)])
    return rows


def darwin_fixtures():
    cases = [
        ("Si111", 1, 2473.1), ("Si111", 3, 5179.3), ("Si111", 4, 12117.0),
        ("Si111", 5, 33791.0), ("Si311", 1, 4317.7), ("Si311", 3, 8063.0),
        ("Si311", 4, 17641.0), ("Si311", 5, 36517.0), ("Si220", 1, 3691.3),
        ("Si220", 2, 7421.0), ("Si220", 3, 15917.0), ("Si220", 5, 28753.0),
    ]
    rows = []
    for crystal, order, energy in cases:
        base = CRYSTALS[crystal]
        hkl = tuple(order * v for v in base)
        value = darwin(order * energy, hkl)
        rows.append({"crystal": crystal, "order": order, "energy_eV": energy,
                     "theta_B_rad": sig(value.theta, 12),
                     "energy_fwhm_eV": sig(value.energy_fwhm, 12),
                     "theta_fwhm_rad": sig(value.theta_fwhm, 12),
                     "rocking_theta_fwhm_rad": sig(value.rocking_theta_fwhm, 12)})
    return rows


def cutoff_energy(coating: str, density: float, angle_mrad: float, target: float) -> float:
    energies = np.geomspace(2_000.0, 60_000.0, 8001)
    values = mirror_values(coating, density, energies, [angle_mrad])[0]
    index = int(np.argmin(np.abs(values - target)))
    return float(energies[index] * 1.000137)


def mirror_fixture_row(coating: str, density: float, angle_mrad: float, energy_eV: float) -> dict:
    reflectivity = float(mirror_values(coating, density, np.asarray([energy_eV]), [angle_mrad])[0, 0])
    around = mirror_values(coating, density, np.asarray([0.98 * energy_eV, 1.02 * energy_eV]), [angle_mrad])[0]
    positive = np.maximum(around, 1e-300)
    rapid = float(max(positive) / min(positive)) > 2.0
    return {"coating": coating, "angle_mrad": angle_mrad,
            "energy_eV": sig(energy_eV, 12), "reflectivity": sig(reflectivity, 12),
            "rapidWithin2Percent": bool(rapid)}


def mirror_fixtures():
    rows = []
    # Energies are deliberately off the stored grid. Angles are stored 0.25 mrad rows;
    # the requested one-percent validation is for interpolation along ln(E).
    angles = [1.0, 2.25, 3.5, 4.75, 5.5]
    targets = [0.85, 0.65, 0.45, 0.25, 0.08]
    for coating, density in MIRRORS.items():
        for angle, target in zip(angles, targets):
            energy = cutoff_energy(coating, density, angle, target)
            rows.append(mirror_fixture_row(coating, density, angle, energy))
    # The reflectivity step at a coating absorption edge is where an energy grid is most
    # easily too coarse, so each edge is pinned just below and just above, at the steepest
    # stored angle that still reflects (R >= 0.2) there.
    for coating, density in MIRRORS.items():
        for edge in sorted(float(item.energy) for item in xraydb.xray_edges(coating).values()):
            if not 2_000 < edge < 60_000:
                continue
            at_edge = mirror_values(coating, density, np.asarray([edge]))[:, 0]
            usable = [angle for angle, value in zip(MIRROR_ANGLES_MRAD, at_edge) if value >= 0.2]
            angle = max(usable) if usable else MIRROR_ANGLES_MRAD[0]
            for offset in (-5.5e-4, 5.5e-4):
                rows.append(mirror_fixture_row(coating, density, angle, edge * (1 + offset)))
    return rows


def detune_fixtures():
    cases = [
        ("Si111", 1, 7_112.0, 0.5),
        ("Si111", 3, 7_112.0, 0.5),
        ("Si111", 5, 8_979.0, 0.7),
        ("Si311", 3, 8_979.0, 0.5),
        ("Si220", 2, 11_564.0, 0.5),
        ("Si220", 5, 15_127.0, 0.9),
    ]
    rows = []
    cache = {}
    for crystal, order, energy, fraction in cases:
        base_hkl = CRYSTALS[crystal]
        order_hkl = tuple(order * value for value in base_hkl)
        fundamental_width = darwin(energy, base_hkl)
        fundamental_key = (energy, base_hkl)
        if fundamental_key not in cache:
            cache[fundamental_key] = extended_correlation(*fundamental_key)
        fundamental_lags, fundamental_correlation = cache[fundamental_key]
        order_key = (order * energy, order_hkl)
        if order_key not in cache:
            cache[order_key] = extended_correlation(*order_key)
        order_lags, order_correlation = cache[order_key]
        offset = fraction * fundamental_width.rocking_theta_fwhm
        rows.append({
            "crystal": crystal,
            "order": order,
            "energy_eV": energy,
            "detuneFraction": fraction,
            "throughput": sig(correlation_at(order_lags, order_correlation, offset) /
                              float(order_correlation[0]), 12),
            "acceptanceRelativeToFundamental": sig(float(order_correlation[0]) /
                                                    float(fundamental_correlation[0]), 12),
        })
    return rows


def ion_chamber_fixtures():
    cases = [
        ("N2", "N2", 5_000.0, 10.0), ("N2-long", "N2", 12_000.0, 30.0),
        ("He", "He", 8_000.0, 10.0), ("Ar", "Ar", 18_000.0, 30.0),
        ("Ar-high", "Ar", 30_000.0, 10.0),
        ("N2-He", {"N2": 0.8, "He": 0.2}, 10_000.0, 30.0),
        ("N2-Ar", {"N2": 0.9, "Ar": 0.1}, 15_000.0, 10.0),
        ("He-Kr", {"He": 0.95, "Kr": 0.05}, 25_000.0, 30.0),
    ]

    def values(gas, energy, length, both_carriers):
        result = xraydb.ionchamber_fluxes(gas=gas, volts=1.0, length=length, energy=energy,
                                         sensitivity=1e-6, sensitivity_units="A/V",
                                         with_compton=False, both_carriers=both_carriers)
        return {"incident_Hz": sig(result.incident, 12),
                "transmitted_Hz": sig(result.transmitted, 12),
                "photo_Hz": sig(result.photo, 12),
                "incoherent_Hz": sig(result.incoherent, 12)}

    rows = []
    for name, gas, energy, length in cases:
        rows.append({"name": name, "gas": gas, "energy_eV": energy, "length_cm": length,
                     "with_compton": False,
                     "oneCarrier": values(gas, energy, length, False),
                     "twoCarrier": values(gas, energy, length, True)})
    return rows


def detector_fixtures():
    energies = [2_371.0, 5_137.0, 8_333.0, 12_271.0, 23_713.0, 47_117.0]
    rows = []
    for energy in energies:
        mu_be = float(xraydb.material_mu("Be", energy, density=1.848, kind="total"))
        mu_si = float(xraydb.material_mu("Si", energy, density=2.329, kind="total"))
        rows.append({"energy_eV": energy,
                     "be12_5umTransmission": sig(math.exp(-mu_be * 12.5e-4), 12),
                     "si450umAbsorption": sig(1 - math.exp(-mu_si * 450e-4), 12)})
    return rows


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True,
                               separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    crystals = build_crystals()
    mirrors, mirror_accuracy = build_mirrors()
    lines, selected_lines = build_lines()
    g1 = build_g1()
    gases = build_gases()

    optics = {
        "format": "xaslab-twin-optics/1",
        "generator": "scripts/twin/make-optics-tables.py",
        "xraydbVersion": xraydb.__version__,
        "xraydbDatabase": xraydb.get_xraydb().get_version().split(",")[0].split(":")[1].strip(),
        "calls": {
            "databaseVersion": "xraydb.get_xraydb().get_version()",
            "symbols": "xraydb.atomic_symbol(atomic_number) for atomic_number=3..98",
            "darwin": "xraydb.darwin_width(order*fundamental_energy_eV, crystal='Si', hkl=order*base_hkl, a=5.431020511, polarization='s')",
            "detuneCurve": "extended Darwin-Prins curve from xraydb.f0('Si', q), xraydb.f1_chantler('Si', energy_eV), xraydb.f2_chantler('Si', energy_eV), and xraydb.xray.R0; zeta spans +/-400 intrinsic widths with 400001 points",
            "detune": "FFT autocorrelation integral of the extended single-crystal reflectivity; delta=f*fundamental xraydb.darwin_width(...).rocking_theta_fwhm",
            "mirror": "xraydb.mirror_reflectivity(coating, angle_rad, energy_eV, density=density_g_cm3, roughness=0, polarization='s', output='intensity')",
            "mirrorGridEdges": "xraydb.xray_edges(coating) to add dense interpolation knots around tabulated absorption edges",
            "lines": "xraydb.xray_lines(symbol, initial_level=level) for K, L1-L3 and M1-M5",
            "g1": "y*scipy.integrate.quad(lambda x: scipy.special.kv(5/3,x), y, numpy.inf, epsrel=1e-9)",
            "gasW": "xraydb.ionization_potential(gas)",
            "gasMass": "sum(xraydb.chemparse(formula)[element]*xraydb.atomic_mass(element))",
        },
        "notes": [
            "Crystal row: [name, base_hkl, d_angstrom, allowed_orders, forbidden_orders, order_tables, detune_tables].",
            "Darwin row: [fundamental_energy_eV, theta_B_rad, energy_fwhm_eV, theta_fwhm_rad, rocking_theta_fwhm_rad].",
            "Detune row: [fundamental_energy_eV, zero_offset_acceptance_relative_to_fundamental, throughput_at_each_detune_fraction].",
            "Double-crystal throughput is the autocorrelation integral of an extended-range single-crystal Darwin-Prins intensity curve. The +/-400-width range retains the 1/x^2 tails that xraydb's returned dtheta/intensity arrays truncate. Each order is normalized to its own zero-offset integral. The acceptance column compares that integral with order 1 at the same fundamental energy.",
            "Mirror interpolation is linear in reflectivity along angle and ln(energy). Accuracy uses relative error for R >= 0.02 and absolute error scaled to R=0.02 below it.",
            "mirrorAccuracy is measured on the stored 0.25 mrad angle rows only. The total-reflection cutoff energy scales as 1/angle, so it moves by 4 to 25 percent between neighbouring rows: linear interpolation between them is wrong by tens of percent near the cutoff. Use the stored angles, or compute reflectivity from the optical constants.",
            "Emission intensity is relative within the initial vacancy level. Lines below 0.01 of that level's strongest line are omitted.",
            "Gas density uses rho=P*M/(R*T) at P=101325 Pa and T=295 K. Formula is the input for src/lib/xraydata.ts cross sections.",
        ],
        "detuneFractions": DETUNE_FRACTIONS,
        "crystals": crystals,
        "mirrors": mirrors,
        "mirrorAccuracy": mirror_accuracy,
        "emissionLines": lines,
        "g1": g1,
        "gases": gases,
    }
    fixtures = {
        "format": "xaslab-twin-optics-fixtures/1",
        "generator": "scripts/twin/make-optics-tables.py",
        "xraydbVersion": xraydb.__version__,
        "calls": {
            "darwin": optics["calls"]["darwin"],
            "detune": optics["calls"]["detuneCurve"] + "; " + optics["calls"]["detune"],
            "mirror": optics["calls"]["mirror"],
            "ionChamber": "xraydb.ionchamber_fluxes(gas=gas, volts=1, length=length_cm, energy=energy_eV, sensitivity=1e-6, sensitivity_units='A/V', with_compton=False, both_carriers=False) [twin: one charge per ion pair]",
            "ionChamberTwoCarrier": "same call with both_carriers=True, recorded only to expose xraydb's factor-of-two convention",
            "g1": optics["calls"]["g1"],
            "lines": optics["calls"]["lines"] + "; same 0.01 per-level filter and four-significant-digit storage as optics.json",
            "beryllium": "exp(-xraydb.material_mu('Be', energy_eV, density=1.848, kind='total')*12.5e-4)",
            "silicon": "1-exp(-xraydb.material_mu('Si', energy_eV, density=2.329, kind='total')*450e-4)",
        },
        "darwin": darwin_fixtures(),
        "detune": detune_fixtures(),
        "mirrors": mirror_fixtures(),
        "ionChamberConvention": {
            "twinUses": "oneCarrier",
            "withCompton": False,
            "reason": "One elementary charge flows in the external circuit per electron-ion pair; the xraydb two-carrier option doubles charge per pair.",
        },
        "ionChambers": ion_chamber_fixtures(),
        "g1": [{"y": sig(y, 12), "value": sig(g1_value(y), 12)}
               for y in (1.7e-4, 7.3e-4, 0.0037, 0.019, 0.083, 0.41, 1.7, 5.3, 13.0, 27.0)],
        "emissionLines": {symbol: selected_lines[symbol] for symbol in ("Fe", "Cu", "Pt")},
        "detector": detector_fixtures(),
    }
    write_json(OPTICS_OUT, optics)
    write_json(FIXTURES_OUT, fixtures)

    compressed = len(gzip.compress(OPTICS_OUT.read_bytes(), compresslevel=9, mtime=0))
    print(f"wrote {OPTICS_OUT.relative_to(ROOT)} ({OPTICS_OUT.stat().st_size} bytes, "
          f"{compressed} bytes gzip)")
    print(f"wrote {FIXTURES_OUT.relative_to(ROOT)} ({FIXTURES_OUT.stat().st_size} bytes)")
    for coating, result in mirror_accuracy.items():
        print(f"{coating}: {result['energyKnots']} energy knots, validation max "
              f"{100*result['maxRelativeOrScaledAbsoluteError']:.3f}% at "
              f"{result['worstEnergy_eV']:.1f} eV, p99 "
              f"{100*result['p99RelativeOrScaledAbsoluteError']:.3f}%")
    if compressed > 150 * 1024:
        raise SystemExit(f"optics.json exceeds the 150 KiB gzip budget: {compressed} bytes")


if __name__ == "__main__":
    main()
