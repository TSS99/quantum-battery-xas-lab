#!/usr/bin/env python
"""Example beamline files and xraylarch reference values for the Measured data workflow.

Writes two JSON files:

  src/data/xas-reduction/examples.json
      Synthetic beamline files, stored as text: three repeated Fe K-edge transmission scans
      in XDI 1.0 (I0, It and a reference foil channel Iref, each scan with its own small
      monochromator offset) and one Cu K-edge fluorescence scan as generic tab-separated
      ASCII with four detector channels, one of them dead. The Spectra studio loads them
      with "Load example scans"; the unit tests read them too.

  src/data/xas-reduction/larch-reference.json
      What xraylarch computes from those files: read_xdi labels and metadata, mu(E) from
      the detector columns, find_e0 of the reference foils and samples, the calibration
      shift to the tabulated edge (xraydb), merge_groups (cubic and linear) and pre_edge
      with several parameter sets. src/lib/xas-reduction.test.ts, src/lib/measured-data.test.ts and
      src/lib/beamline-files.test.ts compare the TypeScript code with these numbers.

THE FILES ARE SYNTHETIC. They are built from smooth model absorption curves (arctan edge,
pre-edge and white-line peaks, damped sine EXAFS, E^-3 matrix background) and Poisson
counting noise from a fixed seed. They look like beamline output but are not measurements
and carry no information about Fe2O3, Cu(II) or any real sample.

Usage, from the project root, with a Python that has xraylarch and xraydb installed:
  <venv>/Scripts/python -I scripts/make-xas-reduction-fixtures.py
Deterministic for given library versions (fixed seed, no timestamps). Every reference
number in larch-reference.json is computed by Larch or xraydb; none is typed by hand.
"""

import json
import shutil
import sys
from pathlib import Path

import numpy as np
import scipy
import xraydb
import larch
from larch import Group
from larch.io import read_xdi, read_ascii, merge_groups
from larch.xafs import pre_edge, find_e0

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / 'src' / 'data' / 'xas-reduction'
TMP = ROOT / '.xas-fixture-tmp'      # Larch readers need files on disk; removed at the end
SEED = 20261019
ETOK = 0.2624682843                  # 2 m_e / hbar^2 in 1/(eV A^2), as in Larch
SI111_D = 5.431020511 / np.sqrt(3)   # Si(111) spacing from the CODATA Si lattice constant, A

rng = np.random.default_rng(SEED)


def gauss(e, center, sigma):
    return np.exp(-0.5 * ((e - center) / sigma) ** 2)


def arctan_step(e, center, width):
    return 0.5 + np.arctan((e - center) / width) / np.pi


def exafs(e, e0, shells):
    """Damped sine chi(E) above e0 with a smooth onset; amplitude/k, phase, sigma^2."""
    k = np.sqrt(np.clip(e - e0, 0, None) * ETOK)
    keff = np.sqrt(k ** 2 + 1.0)
    chi = sum(a / keff * np.sin(2 * keff * r + p) * np.exp(-2 * s2 * keff ** 2) for a, r, p, s2 in shells)
    return chi * (1 - np.exp(-np.clip(e - e0, 0, None) / 12.0))


def fe_grid():
    pre = np.arange(6912.0, 7090.0, 10.0)
    xanes = np.arange(7092.0, 7142.0, 0.4)
    k = np.arange(2.85, 13.0001, 0.05)
    return np.concatenate([pre, xanes, 7112.0 + k ** 2 / ETOK])


def cu_grid():
    return np.concatenate([np.arange(8879.0, 8960.0, 4.0), np.arange(8960.0, 9010.0, 0.35), np.arange(9011.5, 9180.0, 1.5)])


def fe_sample_mud(e):
    """Optical depth of an Fe(III) oxide pellet: matrix background plus an edge jump of 1."""
    shape = arctan_step(e, 7123.0, 1.6) + 0.06 * gauss(e, 7114.6, 0.9) + 0.42 * gauss(e, 7131.5, 3.2)
    chi = exafs(e, 7123.0, [(0.55, 1.95, 0.3, 0.0055), (0.30, 2.97, -0.5, 0.0080), (0.20, 3.37, 1.0, 0.0090)])
    decay = (e / 7123.0) ** -2.6
    return 0.35 + 0.90 * (e / 7112.0) ** -3 + 1.0 * decay * (shape + arctan_step(e, 7123.0, 1.6) * chi)


def fe_foil_mud(e):
    """Optical depth of an Fe foil: edge step 1.6 (about 6 um by xraydb), first inflection near 7112 eV."""
    shape = arctan_step(e, 7112.0, 1.1) + 0.10 * gauss(e, 7117.0, 2.0) + 0.18 * gauss(e, 7131.0, 6.0)
    chi = exafs(e, 7112.0, [(0.70, 2.48, 0.6, 0.0050), (0.45, 2.87, -0.2, 0.0060)])
    return 0.25 + 0.40 * (e / 7112.0) ** -3 + 1.6 * (e / 7112.0) ** -2.6 * (shape + arctan_step(e, 7112.0, 1.1) * chi)


def cu_sample_shape(e):
    """Normalized absorption of a dilute aqueous Cu(II) solution (fluorescence)."""
    shape = arctan_step(e, 8986.5, 1.8) + 0.03 * gauss(e, 8977.6, 0.9) + 0.55 * gauss(e, 8996.5, 3.5)
    return shape + arctan_step(e, 8986.5, 1.8) * exafs(e, 8986.5, [(0.45, 1.96, 0.2, 0.0065)])


def cu_foil_mud(e):
    shape = arctan_step(e, 8979.0, 1.2) + 0.12 * gauss(e, 8983.0, 2.2) + 0.20 * gauss(e, 8993.0, 5.0)
    return 0.30 + 0.35 * (e / 8979.0) ** -3 + 1.5 * (e / 8979.0) ** -2.6 * (shape + arctan_step(e, 8979.0, 1.2) * exafs(e, 8979.0, [(0.75, 2.55, 0.4, 0.0050)]))


def counts(expected):
    return rng.poisson(expected).astype(float)


FE_SCANS = [  # (file name, mono offset in eV = true energy minus recorded energy, start time)
    ('fe2o3_bn_scan1.xdi', 0.35, '2026-10-19T09:00:00'),
    ('fe2o3_bn_scan2.xdi', -0.42, '2026-10-19T09:24:00'),
    ('fe2o3_bn_scan3.xdi', 0.12, '2026-10-19T09:48:00'),
]
CU_FILE, CU_OFFSET = 'cu_aq_fluo_001.dat', -0.6


def fe_file(offset, start_time):
    nominal = fe_grid()
    recorded = np.round(nominal + rng.normal(0, 0.004, nominal.size), 3)   # encoder readback
    true = recorded + offset
    t = np.linspace(0, 1, true.size)
    flux = 1.2e6 * (1 - 0.12 * (true - 7112.0) / 700.0) * (1 - 0.03 * t)  # slow ring decay
    i0 = counts(flux)
    it = counts(flux * 3.0 * np.exp(-fe_sample_mud(true)))
    iref = counts(flux * 3.0 * np.exp(-fe_sample_mud(true)) * 1.2 * np.exp(-fe_foil_mud(true)))
    header = [
        '# XDI/1.0 XASLab-synthetic/1.0',
        '# Column.1: energy eV',
        '# Column.2: i0',
        '# Column.3: itrans',
        '# Column.4: irefer',
        '# Element.symbol: Fe',
        '# Element.edge: K',
        '# Mono.name: Si(111)',
        f'# Mono.d_spacing: {SI111_D:.6f}',
        '# Beamline.name: Synthetic example (no beamline)',
        '# Sample.name: Fe2O3 in BN pellet, synthetic',
        '# Sample.reference: Fe foil between It and Iref',
        f'# Scan.start_time: {start_time}',
        '# ///',
        '# Synthetic transmission scan written by scripts/make-xas-reduction-fixtures.py.',
        '# Not a measurement: model absorption curves plus Poisson counting noise.',
        '#----',
        '# energy i0 itrans irefer',
    ]
    rows = [f'{e:.3f} {a:.0f} {b:.0f} {c:.0f}' for e, a, b, c in zip(recorded, i0, it, iref)]
    return '\n'.join(header + rows) + '\n'


def cu_file():
    recorded = np.round(cu_grid() + rng.normal(0, 0.004, cu_grid().size), 3)
    true = recorded + CU_OFFSET
    flux = 8.0e5 * (1 - 0.1 * (true - 8979.0) / 300.0)
    i0 = counts(flux)
    i1 = counts(flux * 2.5 * np.exp(-1.1 - 0.4 * (true / 8979.0) ** -3))     # water and cell windows
    i2 = counts(flux * 2.5 * np.exp(-1.1 - 0.4 * (true / 8979.0) ** -3) * 1.1 * np.exp(-cu_foil_mud(true)))
    signal = 0.35 + cu_sample_shape(true)                                     # scatter background + Cu
    sdd = [counts(flux * eff * signal) for eff in (2.6e-3, 2.4e-3)] + [counts(np.full(true.size, 3.0))] + [counts(flux * 2.5e-3 * signal)]
    header = [
        '; Synthetic fluorescence scan written by scripts/make-xas-reduction-fixtures.py.',
        '; Not a measurement: model absorption curve plus Poisson counting noise.',
        '; Sample: dilute Cu(II) in water, synthetic. Reference: Cu foil between I1 and I2.',
        '; Detector: 4-element silicon drift detector; SDD3 is dead in this example.',
        '; Energy in eV',
        ';Energy\tI0\tI1\tI2\tSDD1\tSDD2\tSDD3\tSDD4',
    ]
    rows = ['\t'.join([f'{recorded[i]:.3f}'] + [f'{c[i]:.0f}' for c in (i0, i1, i2, *sdd)]) for i in range(true.size)]
    return '\n'.join(header + rows) + '\n'


def arr(values):
    return [float(f'{v:.12g}') for v in np.asarray(values, dtype=float)]


def run_pre_edge(energy, mu, **kws):
    out = Group()
    pre_edge(energy, mu, group=out, **kws)
    d = out.pre_edge_details
    return {
        'params': kws,
        'call': 'pre_edge(energy, mu, group=out' + ''.join(f', {k}={v!r}' for k, v in kws.items()) + ')',
        'e0': float(out.e0), 'edge_step': float(out.edge_step),
        'pre1': float(d.pre1), 'pre2': float(d.pre2), 'norm1': float(d.norm1), 'norm2': float(d.norm2),
        'nnorm': int(d.nnorm), 'nvict': int(d.nvict),
        'pre_edge': arr(out.pre_edge), 'post_edge': arr(out.post_edge), 'norm': arr(out.norm), 'flat': arr(out.flat),
    }


def main():
    files = [{'name': name, 'text': fe_file(offset, start)} for name, offset, start in FE_SCANS]
    files.append({'name': CU_FILE, 'text': cu_file()})

    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir()
    try:
        for f in files:
            (TMP / f['name']).write_text(f['text'], encoding='utf-8', newline='\n')

        fe_edge = xraydb.xray_edge('Fe', 'K').energy
        cu_edge = xraydb.xray_edge('Cu', 'K').energy
        scans, groups = [], []
        for name, offset, _ in FE_SCANS:
            g = read_xdi(str(TMP / name))
            energy = np.asarray(g.energy, dtype=float)
            mu = np.log(g.i0 / g.itrans)
            mu_ref = np.log(g.itrans / g.irefer)
            e0_ref = find_e0(energy, mu_ref)
            shift = fe_edge - e0_ref
            scans.append({
                'file': name, 'monoOffset_eV': offset,
                'xdi': {'array_labels': list(g.array_labels), 'array_units': list(g.array_units),
                        'element': g.attrs['element'], 'mono_d_spacing': float(g.attrs['mono']['d_spacing']), 'npts': int(g.npts)},
                'mu': arr(mu), 'mu_ref': arr(mu_ref),
                'e0_ref': float(e0_ref), 'e0_sample': float(find_e0(energy, mu)), 'shift_eV': float(shift),
            })
            groups.append(Group(energy=energy + shift, mu=mu))

        merged = merge_groups(groups)
        merged_linear = merge_groups(groups, kind='linear')
        menergy, mmu = np.asarray(merged.energy), np.asarray(merged.mu)

        cu = read_ascii(str(TMP / CU_FILE))
        cu_energy = cu.data[0]
        cu_mu = (cu.data[4] + cu.data[5] + cu.data[7]) / cu.data[1]
        cu_ref = np.log(cu.data[2] / cu.data[3])
        cu_e0_ref = find_e0(cu_energy, cu_ref)
        cu_shift = cu_edge - cu_e0_ref

        reference = {
            'description': 'xraylarch reference values for the synthetic example files in examples.json. '
                           'Generated by scripts/make-xas-reduction-fixtures.py; do not edit by hand.',
            'versions': {'xraylarch': larch.__version__, 'xraydb': xraydb.__version__, 'numpy': np.__version__,
                         'scipy': scipy.__version__, 'python': sys.version.split()[0]},
            'calls': [
                'g = larch.io.read_xdi(path)',
                'mu = numpy.log(g.i0 / g.itrans); mu_ref = numpy.log(g.itrans / g.irefer)',
                'e0_ref = larch.xafs.find_e0(g.energy, mu_ref); e0_sample = larch.xafs.find_e0(g.energy, mu)',
                "shift = xraydb.xray_edge('Fe', 'K').energy - e0_ref",
                'merged = larch.io.merge_groups([Group(energy=g.energy + shift, mu=mu) for each scan])',
                "merged_linear = larch.io.merge_groups(same groups, kind='linear')",
                'larch.xafs.pre_edge(energy, mu, group=out, **params) for each case below',
                "cu = larch.io.read_ascii(path); cu_mu = (SDD1 + SDD2 + SDD4) / I0; cu_ref = numpy.log(I1 / I2)",
            ],
            'tabulatedEdges_eV': {'Fe K': fe_edge, 'Cu K': cu_edge},
            'feScans': scans,
            'merge': {
                'call': 'merge_groups(groups)', 'energy': arr(menergy), 'mu': arr(mmu), 'mu_std': arr(merged.mu_std),
                'linear': {'call': "merge_groups(groups, kind='linear')", 'energy': arr(merged_linear.energy),
                           'mu': arr(merged_linear.mu), 'mu_std': arr(merged_linear.mu_std)},
                'e0': float(find_e0(menergy, mmu)),
            },
            'cu': {
                'file': CU_FILE, 'monoOffset_eV': CU_OFFSET, 'read_ascii_labels': list(cu.array_labels),
                'npts': int(cu_energy.size), 'mu': arr(cu_mu), 'mu_ref': arr(cu_ref),
                'e0_ref': float(cu_e0_ref), 'e0_sample': float(find_e0(cu_energy, cu_mu)), 'shift_eV': float(cu_shift),
            },
            'preEdge': {
                'merged-defaults': run_pre_edge(menergy, mmu),
                'merged-custom': run_pre_edge(menergy, mmu, e0=7123.5, pre1=-160.0, pre2=-40.0, norm1=60.0, norm2=600.0, nnorm=3, nvict=2),
                'merged-step': run_pre_edge(menergy, mmu, step=0.9, nnorm=1),
                'merged-constant-pre': run_pre_edge(menergy, mmu, pre1=-60.0, pre2=-45.0, nvict=1),
                # Post-edge ranges just above 300 eV and below 30 eV, where the default nnorm changes.
                'merged-norm2-340': run_pre_edge(menergy, mmu, norm2=340.0),
                'merged-norm2-40': run_pre_edge(menergy, mmu, norm2=40.0),
                'ref-scan1-defaults': run_pre_edge(np.asarray(read_xdi(str(TMP / FE_SCANS[0][0])).energy, dtype=float), np.array(scans[0]['mu_ref'])),
                'cu-calibrated-defaults': run_pre_edge(cu_energy + cu_shift, cu_mu),
            },
        }
        reference['preEdge']['ref-scan1-defaults']['note'] = 'Input: scan 1 energy and mu_ref (both as stored above).'
        reference['preEdge']['cu-calibrated-defaults']['note'] = 'Input: Cu energy + shift_eV, cu mu.'
    finally:
        shutil.rmtree(TMP, ignore_errors=True)

    examples = {
        'description': 'Synthetic beamline files for trying the Measured data workflow. Not measurements: model '
                       'absorption curves plus Poisson counting noise. Generated by scripts/make-xas-reduction-fixtures.py.',
        'versions': reference['versions'],
        'generator': {'seed': SEED, 'monoOffsets_eV': {**{n: o for n, o, _ in FE_SCANS}, CU_FILE: CU_OFFSET}},
        'files': files,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / 'examples.json').write_text(json.dumps(examples, indent=1) + '\n', encoding='utf-8', newline='\n')
    (OUT_DIR / 'larch-reference.json').write_text(json.dumps(reference, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    print('wrote', OUT_DIR / 'examples.json', 'and', OUT_DIR / 'larch-reference.json')
    print('shifts', [round(s['shift_eV'], 3) for s in scans], 'cu', round(cu_shift, 3), 'merged npts', menergy.size)


if __name__ == '__main__':
    main()
