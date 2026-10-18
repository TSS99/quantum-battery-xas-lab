#!/usr/bin/env python
"""Build the xraydb accuracy benchmark for the lab's attenuation code.

Writes src/data/xray/benchmark.json: reference values computed directly with xraydb for
every compound preset in src/data/compound-presets.ts plus a few extra cases (one pure
element per period, a hydrate written with '.', a dilute absorber). src/lib/benchmark.ts
compares the lab's functions with it; src/lib/benchmark.test.ts asserts the agreement and
the Methods & validation page shows it.

For each case:
  - total and photoabsorption mu (1/cm) on a fixed grid across 100 eV - 100 keV and at the
    chosen edge -50, -10, +10 and +50 eV. Energies within EXCLUDE_eV of any edge of any
    element in the formula are skipped: there the lab's stored knots and xraydb's spline
    legitimately differ (edge position rounded to 0.01 eV, listed vs tabulated edge);
  - total mu just below and just above the tabulated edge discontinuity, the edge step and
    the transmission thickness the lab's rule gives with these xraydb values;
  - the listed energy of every edge of every element in the formula.

Usage, from the project root, with the same virtual environment as build-xray-data.py:
  <venv>/Scripts/python scripts/make-benchmark.py
The output is deterministic for a given xraydb version (no timestamps, no randomness).
Every number in the output comes from xraydb; none is typed by hand.
"""

import json
import math
import re
import sys
from pathlib import Path

import xraydb

ROOT = Path(__file__).resolve().parent.parent
PRESETS_TS = ROOT / 'src' / 'data' / 'compound-presets.ts'
OUT = ROOT / 'src' / 'data' / 'xray' / 'benchmark.json'
E_MIN, E_MAX = 100.0, 100_000.0
GRID = [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000]
EDGE_OFFSETS = [-50, -10, 10, 50]
EXCLUDE_eV = 1.0
SIDE = 1e-9                  # relative offset for "just below / just above" the discontinuity
JUMP_MATCH_eV = 2.0          # a listed edge and its table discontinuity differ by at most ~1.2 eV (Pt K)
TARGET_EDGE_STEP = 1.0       # same rule as recommendThickness in src/lib/xraydata.ts
MAX_TOTAL_ABSORPTION = 3.0

# Extra cases: (id, label, formula, density or None for xraydb.atomic_density, absorber, edge).
# Cu (period 4) and Pt (period 6) are already presets.
EXTRA = [
    ('element-h', 'Hydrogen', 'H', None, 'H', 'K'),  # K edge 13.6 eV is below the range: no edge points
    ('element-c', 'Carbon', 'C', None, 'C', 'K'),
    ('element-al', 'Aluminium', 'Al', None, 'Al', 'K'),
    ('element-ag', 'Silver', 'Ag', None, 'Ag', 'K'),
    ('element-u', 'Uranium', 'U', None, 'U', 'L3'),
    # Hydrate written with a '.' (the presets use '·'). Density only scales mu.
    ('hydrate-feso4', 'Iron(II) sulfate heptahydrate', 'FeSO4.7H2O', 1.89, 'Fe', 'K'),
    # Dilute absorber: 0.2 mol % Fe in quartz, where total absorption limits the thickness.
    ('dilute-fe-sio2', 'Fe in quartz, dilute', 'Fe0.002(SiO2)0.998', 2.65, 'Fe', 'K'),
]

DB = xraydb.get_xraydb()
MATERIALS = xraydb.get_materials()


def read_presets():
    """(id, name, formula, density, absorber, edge) for every preset in compound-presets.ts."""
    text = PRESETS_TS.read_text(encoding='utf-8')
    pattern = re.compile(r"id: '([^']+)', name: '([^']+)', formula: '([^']+)', density: ([0-9.eE+-]+),.*?"
                         r"absorber: '([^']+)', edge: '([^']+)'", re.S)
    presets = [(i, n, f, float(d), a, e) for i, n, f, d, a, e in pattern.findall(text)]
    if len(presets) != text.count("id: '") or not presets:
        sys.exit('Could not read every preset from compound-presets.ts')
    return presets


def xraydb_formula(formula):
    """The lab's formula in xraydb syntax: hydrates 'A·nB' / 'A.nH2O' become 'A(B)n'.

    xraydb.material_mu first looks the text up in its materials list, by name or by formula
    ignoring case, so 'CO' (carbon monoxide) would silently become 'Co' (cobalt). Such
    formulas are written with explicit counts ('C1O1'), which xraydb only reads as a formula.
    """
    units = re.split(r'·|\.(?=\d+(?:\.\d+)?H2O$)', formula)
    out = units[0]
    for unit in units[1:]:
        count, body = re.fullmatch(r'(\d+(?:\.\d+)?)?(.+)', unit).groups()
        out += f'({body}){count or ""}'
    clash = out.lower() in MATERIALS or any(
        m.formula.lower() == out.lower() and xraydb.chemparse(m.formula) != xraydb.chemparse(out) for m in MATERIALS.values())
    if clash:
        out = re.sub(r'([A-Z][a-z]?)(?![a-z\d])', r'\g<1>1', out)
    return out


def check_material_mu(formula, energy, density, kind, value):
    """material_mu must equal the mass-fraction sum of mu_elam for this exact formula."""
    comp = xraydb.chemparse(formula)
    masses = {el: n * xraydb.atomic_mass(el) for el, n in comp.items()}
    mixed = density * sum(m * float(xraydb.mu_elam(el, energy, kind=kind)) for el, m in masses.items()) / sum(masses.values())
    if abs(value / mixed - 1) > 1e-12:
        sys.exit(f'material_mu({formula!r}) is not the mixture of its elements at {energy} eV')


def material_mu(formula, energy, density, kind):
    value = float(xraydb.material_mu(formula, energy, density=density, kind=kind))
    check_material_mu(formula, energy, density, kind, value)
    return value


def table_jumps(symbol):
    """Energies where xraydb's Elam photoabsorption table has a discontinuity (doubled knot with a jump)."""
    row = DB.get_cache('photoabsorption', column='element', value=symbol)[0]
    log_e, log_mu = json.loads(row.log_energy), json.loads(row.log_photoabsorption)
    return [math.exp(log_e[i]) for i in range(len(log_e) - 1)
            if abs(log_e[i + 1] - log_e[i]) < 1e-12 and abs(log_mu[i + 1] - log_mu[i]) > 1e-9]


def build_case(case_id, label, source, formula, density, absorber, edge):
    xf = xraydb_formula(formula)
    composition = xraydb.chemparse(xf)
    if density is None:
        density = float(xraydb.atomic_density(formula))
    listed = float(xraydb.xray_edge(absorber, edge).energy)

    # Every listed edge and table discontinuity of every element: no reference point near them.
    avoid = []
    for element in composition:
        avoid += [float(e.energy) for e in xraydb.xray_edges(element).values()] + table_jumps(element)
    energies = [(float(e), 'grid') for e in GRID]
    if E_MIN <= listed <= E_MAX:
        energies += [(listed + d, f'edge{d:+d}') for d in EDGE_OFFSETS if E_MIN <= listed + d <= E_MAX]
    points, skipped = [], []
    for energy, where in sorted(energies):
        if any(abs(energy - e) < EXCLUDE_eV for e in avoid):
            skipped.append(energy)
            continue
        points.append({'energy_eV': energy, 'where': where,
                       'total_cm_inv': material_mu(xf, energy, density, 'total'),
                       'photo_cm_inv': material_mu(xf, energy, density, 'photo')})

    step = None
    jumps = [e for e in table_jumps(absorber) if abs(e - listed) < JUMP_MATCH_eV]
    if E_MIN <= listed <= E_MAX and jumps:
        jump = min(jumps, key=lambda e: abs(e - listed))
        below = material_mu(xf, jump * (1 - SIDE), density, 'total')
        above = material_mu(xf, jump * (1 + SIDE), density, 'total')
        delta = above - below
        # The lab's rule: edge step 1, unless total absorption just above the edge would exceed 3.
        d_step, d_total = TARGET_EDGE_STEP / delta, MAX_TOTAL_ABSORPTION / above
        limited = 'edge-step' if d_step * above <= MAX_TOTAL_ABSORPTION else 'total-absorption'
        step = {'tableEdge_eV': jump, 'muBelow_cm_inv': below, 'muAbove_cm_inv': above, 'deltaMu_cm_inv': delta,
                'thickness_um': (d_step if limited == 'edge-step' else d_total) * 1e4, 'limitedBy': limited}

    return {'id': case_id, 'label': label, 'source': source, 'formula': formula, 'xraydbFormula': xf,
            'composition': composition, 'density': density, 'absorber': absorber, 'edge': edge,
            'edgeEnergy_eV': listed, 'points': points, 'skipped_eV': skipped, 'edgeStep': step}


def main():
    cases = [build_case(i, n, 'preset', f, d, a, e) for i, n, f, d, a, e in read_presets()]
    cases += [build_case(i, n, 'extra', f, d, a, e) for i, n, f, d, a, e in EXTRA]

    edges = {}
    for case in cases:
        for element in case['composition']:
            edges.setdefault(element, {label: float(e.energy) for label, e in xraydb.xray_edges(element).items()})

    out = {
        'format': 'quantum-battery-xas-lab/xraydb-benchmark v1',
        'generator': 'scripts/make-benchmark.py',
        'xraydbVersion': xraydb.__version__,
        'xraydbDatabase': DB.get_version().split(',')[0].split(':')[1].strip(),
        'calls': {
            'composition': 'xraydb.chemparse(xraydbFormula)',
            'density': 'xraydb.atomic_density(symbol) for the pure elements; the preset density otherwise',
            'total_cm_inv': "xraydb.material_mu(xraydbFormula, energy_eV, density=density, kind='total')",
            'photo_cm_inv': "xraydb.material_mu(xraydbFormula, energy_eV, density=density, kind='photo')",
            'edgeEnergy_eV': 'xraydb.xray_edge(absorber, edge).energy',
            'edges': 'xraydb.xray_edges(element)[label].energy',
            'tableEdge_eV': ("discontinuity of xraydb's Elam photoabsorption table nearest the listed edge: "
                             "xraydb.get_xraydb().get_cache('photoabsorption', column='element', value=absorber)"),
            'muBelow_cm_inv': "xraydb.material_mu(xraydbFormula, tableEdge_eV * (1 - 1e-9), density=density, kind='total')",
            'muAbove_cm_inv': "xraydb.material_mu(xraydbFormula, tableEdge_eV * (1 + 1e-9), density=density, kind='total')",
            'deltaMu_cm_inv': 'muAbove_cm_inv - muBelow_cm_inv',
            'thickness_um': '1e4 / deltaMu_cm_inv, or 3e4 / muAbove_cm_inv when that keeps mu_total * d at or below 3 (limitedBy)',
        },
        'notes': [
            'Each material_mu value is checked against the mass-fraction sum of xraydb.mu_elam for the same formula.',
            "xraydb.material_mu matches its materials list by name or by formula ignoring case, so 'CO' would "
            "become cobalt; such formulas are passed with explicit counts ('C1O1').",
            f'Energies within {EXCLUDE_eV:g} eV of a listed edge or table discontinuity of any element in the formula '
            'are skipped (skipped_eV).',
        ],
        'energies': {'grid_eV': GRID, 'edgeOffsets_eV': EDGE_OFFSETS, 'excludedWithin_eV': EXCLUDE_eV},
        'edges': edges,
        'cases': cases,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    points = sum(len(c['points']) for c in cases)
    print(f'{len(cases)} cases, {points} energies, {sum(len(v) for v in edges.values())} edges, '
          f'{sum(c["edgeStep"] is not None for c in cases)} edge steps -> {OUT.relative_to(ROOT)}')
    for case in cases:
        if case['xraydbFormula'] != case['formula']:
            print(f"  {case['formula']} passed to xraydb as {case['xraydbFormula']}")
        if case['skipped_eV']:
            print(f"  {case['id']}: skipped {case['skipped_eV']} eV (near an edge)")


if __name__ == '__main__':
    main()
