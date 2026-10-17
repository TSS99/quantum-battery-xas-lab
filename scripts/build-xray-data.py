#!/usr/bin/env python
"""Build the browser X-ray data layer from XrayDB.

Writes (relative to the project root):
  src/data/xray/elements.json       Z = 1-98: symbol, name, molar mass, absorption edges
                                    (energy, jump ratio, fluorescence yield) and mass
                                    attenuation coefficients mu/rho (photo, total) as knots
                                    on 100 eV - 100 keV that keep every edge discontinuity.
  src/data/xray/test-fixtures.json  reference values computed directly with xraydb, used
                                    by src/lib/xraydata.test.ts and xas-general.test.ts.

Data: XrayDB (https://github.com/xraypy/XrayDB). The database is dedicated to the public
domain (CC0 1.0); the xraydb Python code is MIT and is not redistributed. Cross sections,
edges, jump ratios and fluorescence yields: Elam, Ravel & Sieber (2002).

Usage, from the project root, with a virtual environment outside the repository:
  python -m venv <venv>
  <venv>/Scripts/python -m pip install xraydb==4.5.8      (bin/python on Linux/macOS)
  <venv>/Scripts/python scripts/build-xray-data.py
The output is deterministic for a given xraydb version (no timestamps, no randomness).

Method: each segment between two edges is sampled densely on a log grid with xraydb's
own Elam spline (mu_elam). Knots are then chosen greedily until straight lines in
ln(E)-ln(mu/rho) reproduce every dense sample of both photo and total within KNOT_TOL.
Edges are stored as two knots at the same energy (first = just below, second = just
above). The result is validated on an independent, finer grid; the measured error is
written into the JSON header.
"""

import bisect
import json
import math
import sys
from pathlib import Path

import numpy as np
import xraydb
from xraydb.utils import elam_spline

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / 'src' / 'data' / 'xray'
E_MIN, E_MAX = 100.0, 100_000.0
Z_MAX = 98
DENSE_PER_DECADE = 400      # sampling used to choose knots
CHECK_PER_DECADE = 2000     # independent validation grid
KNOT_TOL = 0.003            # max |ln(interpolated / xraydb)| on the dense grid
SIDE = 1e-9                 # relative offset for "just below / just above" an edge
MU_DIGITS = 4               # significant digits stored for mu/rho
E_DIGITS = 5                # significant digits stored for non-edge knot energies
NEAR_EDGE = 0.01            # "near an edge" = within 1 % of an edge energy (reported apart)

DB = xraydb.get_xraydb()


def num(value, digits):
    """Compact JSON number with `digits` significant digits (1.234e-5, 1e5, 7112.01)."""
    text = format(float(value), f'.{digits}g')
    if 'e' in text:
        mantissa, exponent = text.split('e')
        text = f'{mantissa}e{int(exponent)}'
    return text


_TABLES = {}
DROPPED_KNOTS = {}


def photo_table(symbol):
    """Elam photoabsorption table (ln E, ln mu, spline) with misordered knots removed.

    XrayDB 9.2 has one knot out of order (Cm, 4000.0 eV listed after the 4009.0 eV M5
    edge), which makes xraydb.mu_elam return an artifact between 4000 and 4009 eV. All
    other elements are left untouched; check_photo() proves they match mu_elam exactly.
    """
    if symbol not in _TABLES:
        row = DB.get_cache('photoabsorption', column='element', value=symbol)[0]
        log_e = json.loads(row.log_energy)
        log_mu = json.loads(row.log_photoabsorption)
        spline = json.loads(row.log_photoabsorption_spline)
        keep = [0]
        for i in range(1, len(log_e)):
            if log_e[i] >= log_e[keep[-1]]:
                keep.append(i)
            else:
                DROPPED_KNOTS.setdefault(symbol, []).append(round(math.exp(log_e[i]), 4))
        _TABLES[symbol] = tuple(np.array([seq[i] for i in keep]) for seq in (log_e, log_mu, spline))
    return _TABLES[symbol]


def photo_mu(symbol, energies):
    log_e, log_mu, spline = photo_table(symbol)
    return np.exp(elam_spline(log_e, log_mu, spline, np.log(np.asarray(energies, dtype=float))))


def check_photo(symbol):
    """Our photo evaluation must equal xraydb.mu_elam wherever the table was not repaired."""
    grid = np.geomspace(E_MIN, E_MAX, 700)
    ours, theirs = photo_mu(symbol, grid), np.asarray(xraydb.mu_elam(symbol, grid, kind='photo'))
    if symbol not in DROPPED_KNOTS and np.max(np.abs(ours / theirs - 1)) > 1e-12:
        sys.exit(f'{symbol}: photoabsorption evaluation differs from xraydb.mu_elam')


def cross_sections(symbol, energies):
    """mu/rho in cm^2/g: (photo, total). total = photo + coherent + incoherent (xraydb)."""
    energies = np.asarray(energies, dtype=float)
    photo = photo_mu(symbol, energies)
    coh = np.asarray(xraydb.mu_elam(symbol, energies, kind='coh'), dtype=float)
    incoh = np.asarray(xraydb.mu_elam(symbol, energies, kind='incoh'), dtype=float)
    return photo, photo + coh + incoh


def table_edges(symbol):
    """Energies where the Elam photoabsorption table has a real discontinuity in range."""
    log_e, log_mu, _ = photo_table(symbol)
    edges = []
    for i in range(len(log_e) - 1):
        if abs(log_e[i + 1] - log_e[i]) < 1e-12 and abs(log_mu[i + 1] - log_mu[i]) > 1e-9:
            energy = math.exp(log_e[i])
            if E_MIN < energy < E_MAX and (not edges or energy > edges[-1] * (1 + 1e-9)):
                edges.append(energy)   # a triple knot (Fr, 3000 eV) is one edge
    return edges


def table_knots(symbol, lo, hi):
    """Table knots inside (lo, hi), so short ramps are sampled. A doubled knot without a jump
    (a spline breakpoint, e.g. 1000.0 eV) is sampled on both sides, never exactly on it."""
    log_e = list(photo_table(symbol)[0])
    out = []
    for x in sorted(set(log_e)):
        e = math.exp(x)
        out += [e] if log_e.count(x) == 1 else [e * (1 - 1e-7), e * (1 + 1e-7)]
    return [e for e in out if lo * (1 + 1e-6) < e < hi * (1 - 1e-6)]


def select_knots(x, ys, tol):
    """Greedy insertion: add the worst dense sample until linear interpolation fits all ys."""
    keep = [0, len(x) - 1]
    while True:
        keep.sort()
        worst, worst_index = 0.0, -1
        for a, b in zip(keep[:-1], keep[1:]):
            if b - a < 2:
                continue
            t = (x[a + 1:b] - x[a]) / (x[b] - x[a])
            for y in ys:
                err = np.abs(y[a] + t * (y[b] - y[a]) - y[a + 1:b])
                j = int(np.argmax(err))
                if err[j] > worst:
                    worst, worst_index = float(err[j]), a + 1 + j
        if worst <= tol:
            return keep
        keep.append(worst_index)


def build_element(z):
    symbol = xraydb.atomic_symbol(z)
    edges_tab = table_edges(symbol)
    bounds = [E_MIN] + edges_tab + [E_MAX]
    energy_text, photo_out, total_out = [], [], []
    knot_e, knot_photo, knot_total = [], [], []   # unrounded-energy copies for validation

    for s, (a, b) in enumerate(zip(bounds[:-1], bounds[1:])):
        a_is_edge, b_is_edge = s > 0, s < len(bounds) - 2
        lo = a * (1 + SIDE) if a_is_edge else a
        hi = b * (1 - SIDE) if b_is_edge else b
        n = max(4, math.ceil(DENSE_PER_DECADE * math.log10(b / a)) + 1)
        dense = np.unique(np.concatenate([np.geomspace(lo, hi, n), table_knots(symbol, lo, hi)]))
        photo, total = cross_sections(symbol, dense)
        keep = select_knots(np.log(dense), [np.log(photo), np.log(total)], KNOT_TOL)

        seg_e, seg_text = [], []
        for k in keep:
            if k == 0:
                e, text = (a, num(round(a, 2), 8)) if a_is_edge else (E_MIN, num(E_MIN, 6))
            elif k == len(dense) - 1:
                e, text = (b, num(round(b, 2), 8)) if b_is_edge else (E_MAX, num(E_MAX, 6))
            else:
                # Add digits until the rounding error is below a quarter of the gap to either
                # dense neighbour, so rounded knots can never merge or change order.
                gap = 0.25 * min(dense[k] - dense[k - 1], dense[k + 1] - dense[k])
                digits = E_DIGITS
                while abs(float(num(dense[k], digits)) - dense[k]) >= gap:
                    digits += 1
                text = num(dense[k], digits)
                e = float(text)
            seg_e.append(e)
            seg_text.append(text)
        # Interior knots are re-evaluated at their rounded energies; ends stay just inside edges.
        inner = [float(t) for t in seg_text[1:-1]]
        p_in, t_in = cross_sections(symbol, inner) if inner else (np.array([]), np.array([]))
        seg_p = [photo[0], *p_in, photo[-1]]
        seg_t = [total[0], *t_in, total[-1]]
        for e, text, p, t in zip(seg_e, seg_text, seg_p, seg_t):
            energy_text.append(text)
            photo_out.append(num(p, MU_DIGITS))
            total_out.append(num(t, MU_DIGITS))
            knot_e.append(float(text))
            knot_photo.append(float(num(p, MU_DIGITS)))
            knot_total.append(float(num(t, MU_DIGITS)))

    # Stored energies must be non-decreasing, with equal pairs only at edges.
    for i in range(len(knot_e) - 1):
        if knot_e[i + 1] < knot_e[i] or (knot_e[i + 1] == knot_e[i] and not any(abs(knot_e[i] - round(e, 2)) < 1e-9 for e in edges_tab)):
            sys.exit(f'{symbol}: knot energies not increasing at {knot_e[i]}')

    edges = []
    for label, edge in xraydb.xray_edges(symbol).items():
        edges.append(f'["{label}",{num(edge.energy, 7)},{num(edge.jump_ratio, 6)},{num(edge.fyield, 5)}]')
    name = xraydb.atomic_name(z)
    record = (
        f'{{"Z":{z},"symbol":"{symbol}","name":"{name[:1].upper() + name[1:]}",'
        f'"mass":{num(xraydb.atomic_mass(z), 8)},"edges":[{",".join(edges)}],'
        f'"energy":[{",".join(energy_text)}],"photo":[{",".join(photo_out)}],"total":[{",".join(total_out)}]}}'
    )
    return record, (symbol, edges_tab, knot_e, knot_photo, knot_total)


def interpolate(knot_e, knot_v, energy):
    """Same rule as src/lib/xraydata.ts: last knot with E_i <= E, linear in ln-ln."""
    i = bisect.bisect_right(knot_e, energy) - 1
    if i >= len(knot_e) - 1:
        return knot_v[-1]
    t = math.log(energy / knot_e[i]) / math.log(knot_e[i + 1] / knot_e[i])
    return math.exp(math.log(knot_v[i]) + t * (math.log(knot_v[i + 1]) - math.log(knot_v[i])))


def validate(symbol, edges_tab, knot_e, knot_photo, knot_total):
    """Relative error against xraydb on an independent grid: (away, near) maxima and all errors."""
    grid = np.geomspace(E_MIN * 1.0001, E_MAX * 0.9999, CHECK_PER_DECADE * 3)
    edge_list = [*edges_tab, *[round(e, 2) for e in edges_tab]]
    grid = np.array([e for e in grid if all(abs(e / x - 1) > 1e-5 for x in edge_list)])
    photo, total = cross_sections(symbol, grid)
    away, near, worst = [], [], (0.0, 0.0)
    for e, p, t in zip(grid, photo, total):
        err = max(abs(interpolate(knot_e, knot_photo, e) / p - 1), abs(interpolate(knot_e, knot_total, e) / t - 1))
        is_near = any(abs(e / x - 1) < NEAR_EDGE for x in edges_tab)
        (near if is_near else away).append(err)
        if not is_near and err > worst[1]:
            worst = (float(e), err)
    return away, near, worst


def fixtures():
    """Reference values straight from xraydb (not from the compressed tables)."""
    out = {'xraydbVersion': xraydb.__version__}
    out['edges'] = []
    for symbol, label in [('Fe', 'K'), ('Cu', 'K'), ('Mn', 'K'), ('O', 'K'), ('Ti', 'K'), ('Ni', 'K'), ('Co', 'K'),
                          ('Zn', 'K'), ('Si', 'K'), ('N', 'K'), ('C', 'K'), ('Pt', 'L3'), ('Pt', 'L2'), ('Pb', 'L3')]:
        edge = xraydb.xray_edge(symbol, label)
        out['edges'].append({'element': symbol, 'edge': label, 'energy_eV': edge.energy,
                             'jumpRatio': edge.jump_ratio, 'fluorescenceYield': edge.fyield})
    out['elementMu'] = []
    for symbol, energy in [('H', 1000), ('H', 10000), ('Li', 150), ('C', 300), ('O', 500), ('O', 600), ('Si', 1800),
                           ('Si', 1900), ('Fe', 7000), ('Fe', 7200), ('Fe', 20000), ('Cu', 8000), ('Cu', 9500),
                           ('Pt', 11000), ('Pt', 12000), ('Pb', 15000), ('U', 30000), ('Cf', 50000)]:
        out['elementMu'].append({'element': symbol, 'energy_eV': energy,
                                 'photo': float(xraydb.mu_elam(symbol, energy, kind='photo')),
                                 'total': float(xraydb.mu_elam(symbol, energy, kind='total'))})
    out['compoundMu'] = []
    for formula, xdb_formula, density, energy in [
        ('Fe2O3', 'Fe2O3', 5.26, 7000), ('Fe2O3', 'Fe2O3', 5.26, 7200), ('Fe2O3', 'Fe2O3', 5.26, 7600),
        ('H2O', 'H2O', 0.997, 600), ('H2O', 'H2O', 0.997, 10000), ('SiO2', 'SiO2', 2.65, 1900),
        ('CuSO4·5H2O', 'CuSO4(H2O)5', 2.286, 9000), ('LiNi0.5Mn1.5O4', 'LiNi0.5Mn1.5O4', 4.45, 8400),
        ('LiFePO4', 'LiFePO4', 3.60, 7150), ('TiO2', 'TiO2', 3.89, 5000), ('Pt', 'Pt', 21.45, 11600),
    ]:
        out['compoundMu'].append({'formula': formula, 'density': density, 'energy_eV': energy,
                                  'photo_cm_inv': float(xraydb.material_mu(xdb_formula, energy, density=density, kind='photo')),
                                  'total_cm_inv': float(xraydb.material_mu(xdb_formula, energy, density=density, kind='total'))})
    out['molarMass'] = []
    for formula, xdb_formula in [('Fe2O3', 'Fe2O3'), ('CuSO4·5H2O', 'CuSO4(H2O)5'), ('LiNi0.5Mn1.5O4', 'LiNi0.5Mn1.5O4'),
                                 ('Ca3(PO4)2', 'Ca3(PO4)2'), ('C6H10O5', 'C6H10O5')]:
        mass = sum(n * xraydb.atomic_mass(el) for el, n in xraydb.chemparse(xdb_formula).items())
        out['molarMass'].append({'formula': formula, 'molarMass': mass})

    # Transmission sanity: edge step d*Δmu = 1 at the tabulated discontinuity.
    out['thickness'] = []
    for formula, xdb_formula, density, absorber, label in [('Fe2O3', 'Fe2O3', 5.26, 'Fe', 'K'), ('Cu', 'Cu', 8.96, 'Cu', 'K')]:
        comp = xraydb.chemparse(xdb_formula)
        masses = {el: n * xraydb.atomic_mass(el) for el, n in comp.items()}
        fractions = {el: m / sum(masses.values()) for el, m in masses.items()}
        listed = xraydb.xray_edge(absorber, label).energy
        jump = min(table_edges(absorber), key=lambda e: abs(e - listed))
        below = float(xraydb.mu_elam(absorber, jump * (1 - SIDE), kind='photo'))
        above = float(xraydb.mu_elam(absorber, jump * (1 + SIDE), kind='photo'))
        delta_mu_rho = fractions[absorber] * (above - below)
        mu_rho_above = sum(w * float(xraydb.mu_elam(el, jump * (1 + SIDE), kind='total')) for el, w in fractions.items())
        thickness_cm = 1 / (delta_mu_rho * density)
        area = math.pi * 0.65 ** 2
        reference = xraydb.transmission_sample(xdb_formula, listed + 50, absorp_total=2.6, area=area)
        out['thickness'].append({
            'formula': formula, 'density': density, 'absorber': absorber, 'edge': label,
            'tableEdge_eV': jump, 'deltaMuOverRho': delta_mu_rho, 'muOverRhoAbove': mu_rho_above,
            'thickness_um': thickness_cm * 1e4, 'totalAbsorptionAbove': mu_rho_above / delta_mu_rho,
            'pelletArea_cm2': area, 'sampleMass_mg': area / delta_mu_rho * 1000,
            # Independent xraydb estimate (polynomial pre-edge extrapolation at E0 + 50 eV).
            'xraydbStepPerTotalAt50eV': reference.absorbance_steps[absorber] / 2.6,
        })
    return out


def main():
    records, away_all, near_all, worst = [], [], [], ('', 0.0)
    for z in range(1, Z_MAX + 1):
        check_photo(xraydb.atomic_symbol(z))
        record, check = build_element(z)
        away, near, at = validate(*check)
        records.append(record)
        away_all += away
        near_all += near
        if away and max(away) > worst[1]:
            worst = (check[0], max(away))
        print(f'{z:3d} {check[0]:2s} knots={len(check[2]):4d} max_err_away={max(away) * 100:.3f}% (at {at[0]:.1f} eV) '
              f'max_err_near={(max(near) * 100 if near else 0):.3f}%', flush=True)
    print('table knots dropped (misordered in XrayDB):', DROPPED_KNOTS)

    away_all, near_all = np.array(away_all), np.array(near_all)
    stats = {
        'tolerance': f'knots fitted to {KNOT_TOL * 100:.1f}% (ln) on {DENSE_PER_DECADE} samples/decade; mu/rho stored to {MU_DIGITS} significant digits',
        'validationGrid': f'{CHECK_PER_DECADE} log-spaced energies per decade, 100 eV - 100 keV, every element, photo and total',
        'awayFromEdges': {'maxRelativeError': round(float(away_all.max()), 5),
                          'p99RelativeError': round(float(np.percentile(away_all, 99)), 5),
                          'worstElement': worst[0]},
        'within1PercentOfEdges': {'maxRelativeError': round(float(near_all.max()), 5),
                                  'p99RelativeError': round(float(np.percentile(near_all, 99)), 5)},
    }
    header = {
        'format': 'quantum-battery-xas-lab/xray-elements v1',
        'source': f'XrayDB database {DB.get_version().split(",")[0].split(":")[1].strip()} via the xraydb Python package {xraydb.__version__} (https://github.com/xraypy/XrayDB)',
        'license': 'XrayDB database: CC0 1.0 Universal public-domain dedication. The xraydb Python code (MIT) is not redistributed here.',
        'citations': [
            'W. T. Elam, B. D. Ravel and J. R. Sieber, "A new atomic database for X-ray spectroscopic calculations", Radiat. Phys. Chem. 63, 121-128 (2002). doi:10.1016/S0969-806X(01)00227-4',
            'M. Newville et al., XrayDB: X-ray reference data in SQLite, https://zenodo.org/badge/latestdoi/205441660',
        ],
        'generator': 'scripts/build-xray-data.py',
        'units': {'energy': 'eV', 'mass': 'g/mol', 'photo': 'cm^2/g (photoabsorption)', 'total': 'cm^2/g (photo + coherent + incoherent)'},
        'energyRange_eV': [E_MIN, E_MAX],
        'interpolation': 'linear in ln(E) vs ln(mu/rho) between knots; an edge is two knots at the same energy (first = just below, second = just above); at exactly an edge energy the value above applies',
        'edgeColumns': ['label', 'energy_eV', 'jumpRatio', 'fluorescenceYield'],
        'limitations': 'Isolated-atom cross sections. No XANES/EXAFS fine structure, chemical shifts, white lines or solid-state effects. Least reliable in the soft X-ray range (below about 1 keV) and close to edges. Edges below 100 eV are listed but have no tabulated cross sections here.',
        'accuracy': stats,
    }
    head = json.dumps(header, ensure_ascii=False, indent=1)[:-2]  # drop the closing "\n}"
    text = head + ',\n "elements": [\n' + ',\n'.join(records) + '\n ]\n}\n'
    json.loads(text)  # must be valid JSON
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / 'elements.json').write_text(text, encoding='utf-8', newline='\n')
    (OUT_DIR / 'test-fixtures.json').write_text(json.dumps(fixtures(), ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps(stats, indent=1))
    print(f'elements.json: {len(text.encode("utf-8")) / 1024:.1f} KiB')


if __name__ == '__main__':
    main()
