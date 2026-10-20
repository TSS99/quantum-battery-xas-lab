#!/usr/bin/env python
"""Independent reference values for src/lib/twin/{sample,damage}.ts.

Run from the repository root with the pinned reference environment:

  C:\\Users\\Tilock\\astra-runner\\pyenv\\Scripts\\python.exe scripts/twin/reference_sample.py

Everything here is recomputed from xraydb and SciPy. Nothing is read back from
src/data/xray/elements.json or src/data/twin/optics.json, so the fixtures are an independent
check of the TypeScript model and of the table interpolation it runs on:

* mu/rho of a compound: mass-fraction sum of xraydb.mu_elam over photo, coherent and
  incoherent, with xraydb.atomic_mass for the weights. This is the definition
  src/lib/xraydata.ts implements on its compressed knot table.
* Edge jump mu_a: the tabulated photoabsorption above the edge minus a log-log straight line
  through the absorber's photoabsorption at 0.70 E0 and 0.98 E0, continued upward. The
  TypeScript side extrapolates the knot pair immediately below the edge instead, which spans
  a similar energy range (for example 5010 to 7112 eV at the Fe K edge), so the two jumps
  agree to better than 0.35 % over the fixture energies. Both endpoints are kept strictly
  below the edge because xraydb.mu_elam returns the above-edge branch at E0*(1-1e-9) for some
  elements, Cu among them.
* Thickness spread: the analytic Gaussian average <exp(-mu x)> = exp(-mu xbar + mu^2 sigma^2/2)
  of dossier 5.2 item 2, which the TypeScript Gauss-Hermite quadrature has to reproduce.
* Particle size: the Poisson sum <exp(-mu t N)> = sum_N P(N; n) exp(-mu t N) over the grain
  count in a column (dossier 5.2 item 5) rather than its closed form, so the closed form the
  TypeScript side uses is checked rather than repeated.
* Fluorescence: the depth integral of dossier 6.1 evaluated by scipy.integrate.quad, so the
  Booth and Bridges closed form the TypeScript side uses is checked rather than repeated.
* Fluorescence yield, mean line energy and line probability from xraydb.fluor_yield, taken at
  E0+100 as in dossier 6.1 and held fixed across the scan (xraydb returns zero below the
  edge, while the line itself does not depend on the incident energy).
* Dose: the thin and thick formulas of dossier 11.1, with the tabulated photoabsorption
  standing in for mu_en/rho. The water check block carries the NIST values the dossier quotes.

The output contains no timestamps or random values. Ten cases cover four materials (2 mM Fe
in water, a NiO pellet thick and thin, a Cu foil clean and with pinholes, a LiMn2O4 pellet)
at 45/45 and at grazing exit, each at five energies around the absorber edge.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import xraydb
from scipy import integrate
from scipy.stats import poisson

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "twin" / "sample-fixtures.json"

J_PER_eV = 1.602176634e-19  # CODATA 2018 elementary charge, exact in the 2019 SI

# Energy span of the log-log line that continues the below-edge photoabsorption upward.
BELOW_CHORD = (0.70, 0.98)

# Offset at which the fluorescence yield and line energy are read, as in dossier 6.1.
YIELD_OFFSET_eV = 100.0

# Fixed detector factors, so the fixtures exercise the prefactor without an SDD model.
SOLID_ANGLE_FRACTION = 0.01
DETECTOR_EFFICIENCY = 0.85

# NIST mu_en/rho for liquid water, https://physics.nist.gov/PhysRefData/XrayMassCoef/ComTab/water.html
NIST_WATER_MU_EN = {5000.0: 41.88, 8000.0: 9.915, 10000.0: 4.944, 20000.0: 0.5503}

WINDOWS = {
    # Kapton HN polyimide, C22H10N2O5 at 1.42 g/cm^3 (DuPont datasheet density).
    "kapton50": {"formula": "C22H10N2O5", "density": 1.42, "thickness_um": 50.0},
    "be250": {"formula": "Be", "density": 1.85, "thickness_um": 250.0},
}

MATERIALS = {
    # 2 mM Fe in water: 1 L of solution holds 1000 g of water, 55.508 mol, plus 0.002 mol Fe.
    "fe-solution": {
        "formula": "H111.017O55.508Fe0.002",
        "composition": {"H": 111.017, "O": 55.508, "Fe": 0.002},
        "density": 1.0,
        "absorber": "Fe",
        "edge": "K",
    },
    "nio": {
        "formula": "NiO",
        "composition": {"Ni": 1.0, "O": 1.0},
        "density": 6.67,
        "absorber": "Ni",
        "edge": "K",
    },
    "cu": {
        "formula": "Cu",
        "composition": {"Cu": 1.0},
        "density": 8.96,
        "absorber": "Cu",
        "edge": "K",
    },
    "limn2o4": {
        "formula": "LiMn2O4",
        "composition": {"Li": 1.0, "Mn": 2.0, "O": 4.0},
        "density": 4.28,
        "absorber": "Mn",
        "edge": "K",
    },
}

ENVIRONMENTS = {
    "ambient": {"kind": "ambient", "temperature_K": 300.0, "windows": []},
    "liquid-cell": {"kind": "liquid-cell", "temperature_K": 300.0,
                    "windows": [WINDOWS["kapton50"], WINDOWS["kapton50"]]},
    "cryostat": {"kind": "cryostat", "temperature_K": 80.0,
                 "windows": [WINDOWS["be250"], WINDOWS["be250"]]},
}


def _sample(thickness_um, *, pinhole=0.0, spread=0.0, particle=0.0, incidence=45.0):
    return {
        "thickness_um": thickness_um,
        "pinholeFraction": pinhole,
        "thicknessSpread": spread,
        "particle_um": particle,
        "incidence_deg": incidence,
    }


CASES = [
    # id, material, environment, sample, exit angle
    ("fe-solution-45-45", "fe-solution", "liquid-cell", _sample(1000.0), 45.0),
    ("fe-solution-grazing", "fe-solution", "liquid-cell", _sample(1000.0), 10.0),
    ("nio-pellet-thick-45-45", "nio", "ambient", _sample(500.0), 45.0),
    ("nio-pellet-thin-45-45", "nio", "ambient", _sample(2.0), 45.0),
    ("nio-pellet-thick-grazing", "nio", "ambient", _sample(500.0), 10.0),
    ("cu-foil-clean", "cu", "ambient", _sample(5.0), 45.0),
    ("cu-foil-pinholes-spread", "cu", "ambient", _sample(5.0, pinhole=0.02, spread=0.15), 45.0),
    ("limn2o4-pellet-45-45", "limn2o4", "cryostat", _sample(25.0), 45.0),
    ("limn2o4-pellet-grazing", "limn2o4", "cryostat", _sample(25.0), 10.0),
    ("limn2o4-pellet-grains", "limn2o4", "cryostat", _sample(25.0, particle=20.0, spread=0.10), 45.0),
]

ENERGY_OFFSETS_eV = [-50.0, 50.0, 300.0, 600.0, 1000.0]


# ------------------------------------------------------------------ cross sections

def mass_fractions(composition):
    masses = {sym: count * xraydb.atomic_mass(sym) for sym, count in composition.items()}
    total = sum(masses.values())
    return {sym: value / total for sym, value in masses.items()}


def mu_over_rho(composition, energy_eV):
    """(photo, total) mass attenuation in cm^2/g; total = photo + coherent + incoherent."""
    photo = 0.0
    total = 0.0
    for sym, weight in mass_fractions(composition).items():
        p = float(xraydb.mu_elam(sym, energy_eV, kind="photo"))
        coh = float(xraydb.mu_elam(sym, energy_eV, kind="coh"))
        incoh = float(xraydb.mu_elam(sym, energy_eV, kind="incoh"))
        photo += weight * p
        total += weight * (p + coh + incoh)
    return photo, total


def edge_jump_cm_inv(material, energy_eV):
    """mu_a(E): the chosen edge's jump, zero below the edge, in 1/cm."""
    absorber = material["absorber"]
    e0 = xraydb.xray_edge(absorber, material["edge"]).energy
    if energy_eV < e0:
        return 0.0
    lo, hi = (frac * e0 for frac in BELOW_CHORD)
    y_lo = float(xraydb.mu_elam(absorber, lo, kind="photo"))
    y_hi = float(xraydb.mu_elam(absorber, hi, kind="photo"))
    slope = (math.log(y_hi) - math.log(y_lo)) / (math.log(hi) - math.log(lo))
    below = math.exp(math.log(y_hi) + slope * (math.log(energy_eV) - math.log(hi)))
    above = float(xraydb.mu_elam(absorber, energy_eV, kind="photo"))
    weight = mass_fractions(material["composition"])[absorber]
    return max(0.0, (above - below) * weight * material["density"])


def window_transmission(environment, energy_eV):
    value = 1.0
    for window in environment["windows"]:
        composition = parse_simple(window["formula"])
        _, total = mu_over_rho(composition, energy_eV)
        value *= math.exp(-total * window["density"] * window["thickness_um"] * 1e-4)
    return value


def parse_simple(formula):
    """Element counts of a formula written as repeated Symbol[count], no brackets."""
    out = {}
    i = 0
    while i < len(formula):
        j = i + 1
        if j < len(formula) and formula[j].islower():
            j += 1
        symbol = formula[i:j]
        k = j
        while k < len(formula) and (formula[k].isdigit() or formula[k] == "."):
            k += 1
        out[symbol] = out.get(symbol, 0.0) + (float(formula[j:k]) if k > j else 1.0)
        i = k
    return out


# ------------------------------------------------------------------ transmission

def mean_transmission(mu_total_cm_inv, sample):
    """<exp(-mu x)> over grains, thickness spread and pinholes (dossier 5.2 items 1, 2, 5)."""
    thickness_cm = sample["thickness_um"] * 1e-4
    grain_cm = sample["particle_um"] * 1e-4
    spread = sample["thicknessSpread"]
    pinhole = sample["pinholeFraction"]

    if grain_cm > 0:
        # Poisson number of grains per column, mean n, each of optical depth mu t.
        n = thickness_cm / grain_cm
        mu_t = mu_total_cm_inv * grain_cm
        counts = np.arange(0, int(n + 12 * math.sqrt(n) + 80) + 1)
        grain_average = float(np.sum(poisson.pmf(counts, n) * np.exp(-mu_t * counts)))
        optical_depth = -math.log(grain_average)
    else:
        optical_depth = mu_total_cm_inv * thickness_cm

    # Analytic Gaussian thickness average of exp(-D u), u of mean 1 and relative sigma.
    averaged = math.exp(-optical_depth + 0.5 * (optical_depth * spread) ** 2)
    return (1.0 - pinhole) * averaged + pinhole


def transmission_case(material, environment, sample, energy_eV):
    photo, total = mu_over_rho(material["composition"], energy_eV)
    mu_total = total * material["density"]
    sample_transmission = mean_transmission(mu_total, sample)
    windows = window_transmission(environment, energy_eV)
    return {
        "muTotal_cm_inv": mu_total,
        "muPhoto_cm_inv": photo * material["density"],
        "muAbsorber_cm_inv": edge_jump_cm_inv(material, energy_eV),
        "muX": mu_total * sample["thickness_um"] * 1e-4,
        "sampleTransmission": sample_transmission,
        "windowTransmission": windows,
        "transmission": sample_transmission * windows,
        "apparentMuX": -math.log(sample_transmission),
    }


# ------------------------------------------------------------------ fluorescence

def fluorescence_case(material, environment, sample, exit_deg, energy_eV):
    absorber = material["absorber"]
    edge = material["edge"]
    e0 = xraydb.xray_edge(absorber, edge).energy
    yield_, line_eV, probability = xraydb.fluor_yield(absorber, edge, "Ka", e0 + YIELD_OFFSET_eV)

    mu_a = edge_jump_cm_inv(material, energy_eV)
    mu_in = mu_over_rho(material["composition"], energy_eV)[1] * material["density"]
    mu_out = mu_over_rho(material["composition"], line_eV)[1] * material["density"]

    phi = math.radians(sample["incidence_deg"])
    psi = math.radians(exit_deg)
    thickness_cm = sample["thickness_um"] * 1e-4
    prefactor = (SOLID_ANGLE_FRACTION * DETECTOR_EFFICIENCY * yield_ * probability
                 * window_transmission(environment, line_eV))
    incident = window_transmission(environment, energy_eV)

    # Depth integral of dossier 6.1 by quadrature, not by its closed form.
    def integrand(z):
        return (mu_a / math.sin(phi)) * math.exp(-mu_in * z / math.sin(phi)) * math.exp(-mu_out * z / math.sin(psi))

    depth_integral = integrate.quad(integrand, 0.0, thickness_cm, epsabs=0.0, epsrel=1e-12)[0]

    g = math.sin(phi) / math.sin(psi)
    alpha = mu_in + g * mu_out
    return {
        "lineEnergy_eV": float(line_eV),
        "fluorescenceYield": float(yield_),
        "lineFraction": float(probability),
        "prefactor": prefactor,
        "muAbsorber_cm_inv": mu_a,
        "muTotalIn_cm_inv": mu_in,
        "muTotalOut_cm_inv": mu_out,
        "geometryRatio": g,
        "alpha_cm_inv": alpha,
        "depthIntegralExponent": (mu_in / math.sin(phi) + mu_out / math.sin(psi)) * thickness_cm,
        "ratio": prefactor * depth_integral * incident,
        "thinLimit": prefactor * mu_a * thickness_cm / math.sin(phi) * incident,
        "thickLimit": prefactor * mu_a / alpha * incident,
        "dampingFactor": 1.0 - mu_a / alpha,
        "windowTransmissionIn": incident,
        "windowTransmissionOut": window_transmission(environment, line_eV),
    }


def fluo_corr_alpha(material, exit_deg, incidence_deg):
    """Larch fluo_corr alpha, density independent (dossier 6.3 step 4).

    None when the +/-10 eV finite difference the algorithm uses does not resolve the edge
    step: for 2 mM Fe in water the tabulated background falls by 0.086 cm^2/g over those
    20 eV while the Fe step only adds 0.039, so the denominator comes out negative and alpha
    is meaningless. That is a limit of the algorithm at high dilution, not of the sample, and
    it is exactly the case where self absorption is negligible anyway.
    """
    absorber = material["absorber"]
    e0 = xraydb.xray_edge(absorber, material["edge"]).energy
    _, line_eV, _ = xraydb.fluor_yield(absorber, material["edge"], "Ka", e0 + YIELD_OFFSET_eV)
    composition = material["composition"]
    g = math.sin(math.radians(incidence_deg)) / math.sin(math.radians(exit_deg))
    at_line = mu_over_rho(composition, line_eV)[1]
    below = mu_over_rho(composition, e0 - 10.0)[1]
    above = mu_over_rho(composition, e0 + 10.0)[1]
    if above <= below:
        return None
    return (g * at_line + below) / (above - below)


# ------------------------------------------------------------------ electron yield

def electron_yield(material, sample, energy_eV, escape_depth_nm):
    """Y = mu_a lambda / (sin phi + mu_T lambda), dossier 7."""
    mu_a = edge_jump_cm_inv(material, energy_eV)
    mu_t = mu_over_rho(material["composition"], energy_eV)[1] * material["density"]
    phi = math.sin(math.radians(sample["incidence_deg"]))
    lam_cm = escape_depth_nm * 1e-7
    return {
        "escapeDepth_nm": escape_depth_nm,
        "yield": mu_a * lam_cm / (phi + mu_t * lam_cm),
        "linearYield": mu_a * lam_cm / phi,
        "saturation": phi / (phi + mu_t * lam_cm),
        "attenuationDepth_nm": phi / mu_t * 1e7,
    }


# ------------------------------------------------------------------ dose

def dose_rate(composition, density, thickness_um, flux, energy_eV, beam_um, deposited=1.0):
    """Surface and volume-averaged dose rate, dossier 11.1."""
    photo, _ = mu_over_rho(composition, energy_eV)
    thickness_cm = thickness_um * 1e-4
    area_cm2 = (beam_um[0] * 1e-4) * (beam_um[1] * 1e-4)
    power_W = flux * energy_eV * J_PER_eV
    optical_depth = photo * density * thickness_cm
    absorbed_W = power_W * (1.0 - math.exp(-optical_depth)) * deposited
    mass_g = density * thickness_cm * area_cm2
    return {
        "area_cm2": area_cm2,
        "fluxDensity_per_s_mm2": flux / (area_cm2 * 100.0),
        "muEnOverRho_cm2_g": photo,
        "photoOpticalDepth": optical_depth,
        "surfaceRate_Gy_per_s": power_W * photo * 1e3 / area_cm2 * deposited,
        "meanRate_Gy_per_s": absorbed_W * 1e3 / mass_g,
        "absorbedPower_W": absorbed_W,
    }


WATER = {"H": 2.0, "O": 1.0}

# The beam and flux combinations of the dossier 11.1 table, which quotes 33 and 16 Gy/s for
# the first row at 7112 and 10000 eV.
DOSE_BEAMS = [
    {"id": "1e11-5x1mm", "flux": 1e11, "beam_um": [5000.0, 1000.0]},
    {"id": "1e12-500x500um", "flux": 1e12, "beam_um": [500.0, 500.0]},
    {"id": "1e13-100x100um", "flux": 1e13, "beam_um": [100.0, 100.0]},
    {"id": "1e12-5x5um", "flux": 1e12, "beam_um": [5.0, 5.0]},
]


def dose_checks():
    rows = []
    for beam in DOSE_BEAMS:
        for energy_eV in (7112.0, 10000.0):
            rows.append({
                "id": f"water-{beam['id']}-{int(energy_eV)}eV",
                "formula": "H2O",
                "density": 1.0,
                "thickness_um": 1000.0,
                "energy_eV": energy_eV,
                **beam,
                **dose_rate(WATER, 1.0, 1000.0, beam["flux"], energy_eV, beam["beam_um"]),
            })
    return rows


def water_mu_en_check():
    return [{"energy_eV": energy_eV, "nist_cm2_g": nist,
             "xraydb_cm2_g": mu_over_rho(WATER, energy_eV)[0]}
            for energy_eV, nist in sorted(NIST_WATER_MU_EN.items())]


# ------------------------------------------------------------------ assembly

def build_cases():
    out = []
    for case_id, material_id, environment_id, sample, exit_deg in CASES:
        material = MATERIALS[material_id]
        environment = ENVIRONMENTS[environment_id]
        e0 = xraydb.xray_edge(material["absorber"], material["edge"]).energy
        points = []
        for offset in ENERGY_OFFSETS_eV:
            energy_eV = e0 + offset
            points.append({
                "offset_eV": offset,
                "energy_eV": energy_eV,
                "transmission": transmission_case(material, environment, sample, energy_eV),
                "fluorescence": fluorescence_case(material, environment, sample, exit_deg, energy_eV),
                "electronYield": electron_yield(material, sample, energy_eV, 100.0),
            })
        out.append({
            "id": case_id,
            "material": {k: v for k, v in material.items() if k != "composition"},
            "composition": material["composition"],
            "environment": environment,
            "sample": sample,
            "exit_deg": exit_deg,
            "edgeEnergy_eV": e0,
            "fluoCorrAlpha": fluo_corr_alpha(material, exit_deg, sample["incidence_deg"]),
            "dose": dose_rate(material["composition"], material["density"], sample["thickness_um"],
                              1e11, e0 + 50.0, [500.0, 500.0]),
            "points": points,
        })
    return out


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "format": "xaslab-twin-sample-fixtures/1",
        "generator": "scripts/twin/reference_sample.py",
        "xraydbVersion": xraydb.__version__,
        "constants": {
            "J_per_eV": J_PER_eV,
            "belowEdgeChord": list(BELOW_CHORD),
            "yieldOffset_eV": YIELD_OFFSET_eV,
            "solidAngleFraction": SOLID_ANGLE_FRACTION,
            "detectorEfficiency": DETECTOR_EFFICIENCY,
        },
        "calls": {
            "muOverRho": "mass-fraction sum of xraydb.mu_elam(sym, E, kind='photo'|'coh'|'incoh') with xraydb.atomic_mass weights",
            "edgeJump": "xraydb.mu_elam(absorber, E, kind='photo') minus a log-log line through 0.70*E0 and 0.98*E0, times the absorber mass fraction and the density",
            "fluorYield": "xraydb.fluor_yield(absorber, edge, 'Ka', E0 + 100) -> (yield, mean line energy, probability)",
            "thicknessSpread": "analytic exp(-D + (D*spread)^2/2)",
            "particleSize": "sum over N of scipy.stats.poisson.pmf(N, x/t) * exp(-mu*t*N)",
            "depthIntegral": "scipy.integrate.quad of (mu_a/sin(phi)) exp(-mu_in z/sin(phi)) exp(-mu_out z/sin(psi)) from 0 to d",
            "dose": "Phi E (mu_photo/rho) / A for the surface rate and Phi E (1-exp(-mu x)) / (rho x A) for the volume mean, dossier 11.1",
        },
        "notes": [
            "The fluorescence prefactor is (Omega/4pi) * epsilon * omega * p_line * T_windows(E_f) and the incident beam carries T_windows(E) as well, so both appear in every ratio.",
            "The edge jump is the sharp tabulated step: no fine structure, so the TypeScript side must be called with sharpEdge to compare.",
            "Below the edge the jump is zero, so the fluorescence ratio and the electron yield are zero there while the transmission is not.",
            "mu at the emission-line energy is tabulated, which assumes the line sits below the edge.",
            "The thickness spread uses the analytic Gaussian average, which the Gauss-Hermite quadrature of the TypeScript side has to reproduce; it is only a sensible description while the spread stays well below 1.",
            "The particle-size average is the random uncorrelated worst case of Lu and Stern; packed grains fluctuate less.",
            "Dose uses photoabsorption as a proxy for mu_en/rho and assumes all absorbed energy stays in the illuminated volume, an upper bound.",
            "Materials are illustrative compositions and handbook densities, not certified standards.",
            "fluoCorrAlpha is null for the 2 mM Fe solution: the +/-10 eV finite difference of the Larch algorithm does not resolve a step that small against the falling water background.",
        ],
        "waterMuEnCheck": water_mu_en_check(),
        "doseChecks": dose_checks(),
        "cases": build_cases(),
    }
    OUT.write_text(json.dumps(fixtures, ensure_ascii=False, sort_keys=True,
                              separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, "
          f"{len(fixtures['cases'])} cases)")


if __name__ == "__main__":
    main()
