# X-ray data (Z = 1-98)

`elements.json` holds tabulated X-ray absorption data for every element from H to Cf. `src/lib/xraydata.ts` loads it lazily and builds compound values from it. `test-fixtures.json` holds reference values computed directly with xraydb, for the unit tests only.

## Source, license and citation

- **Data:** XrayDB database 9.2, read through the `xraydb` Python package 4.5.8 (<https://github.com/xraypy/XrayDB>).
- **License:** the XrayDB database files are dedicated to the public domain under **CC0 1.0 Universal**, so redistribution in this MIT repository is allowed. The `xraydb` Python code is MIT licensed; it is not redistributed here (it is only used by the generator).
- **Underlying tables:** photoabsorption and scattering cross sections, edge energies, jump ratios and fluorescence yields come from W. T. Elam, B. D. Ravel and J. R. Sieber, "A new atomic database for X-ray spectroscopic calculations", *Radiat. Phys. Chem.* 63, 121-128 (2002), doi:10.1016/S0969-806X(01)00227-4.
- **Please cite:** Elam, Ravel & Sieber (2002), and XrayDB via <https://zenodo.org/badge/latestdoi/205441660>.

## Contents

For each element, `elements.json` stores:

- the symbol, name and molar mass (g/mol);
- every listed edge as `[label, energy_eV, jumpRatio, fluorescenceYield]`: K, L1-L3, M1-M5, N, O and P where they exist;
- `photo` (photoabsorption) and `total` (photo + coherent + incoherent) mass attenuation coefficients in cm²/g, stored as knots from 100 eV to 100 keV.

Between knots, values are interpolated linearly in ln(E) against ln(μ/ρ). An edge is stored as two knots at the same energy: the first is just below the edge, the second just above. At exactly an edge energy, the value above the edge applies.

The file is 199 KiB (79 KiB gzipped) and is loaded as its own chunk.

## Accuracy

The generator compares every element against xraydb on an independent grid of 2000 log-spaced energies per decade, for both photo and total:

| Region | Max relative error | 99th percentile |
| --- | --- | --- |
| Away from edges | 0.41 % | 0.26 % |
| Within 1 % of an edge | 0.80 % | 0.12 % |

The exact measured numbers are in the `accuracy` field of the `elements.json` header.

## Limitations

These are isolated-atom cross sections. They give the smooth background and the size of each edge jump, nothing more:

- no XANES or EXAFS fine structure;
- no chemical shifts, white lines, pre-edge peaks or other solid-state effects.

`src/lib/xas-general.ts` adds such features only as a clearly labelled parametric model.

The tables are least reliable in the soft X-ray range (below about 1 keV) and close to edges. Edges below 100 eV (for example Li K at 54.7 eV, or the Fe M edges) are listed, but they have no cross sections here.

## Notes on XrayDB 9.2 tables

- **Edge positions:** the tabulated discontinuity sits within about 0.01 eV of the listed edge energy for most edges, and within about 1 eV for heavy-element K edges (e.g. Pt K: 78393.8 vs 78395 eV). The data keep the table position, rounded to 0.01 eV. `edgeStep()` matches each listed edge to its nearest discontinuity.
- **Cm table fix:** the Cm photoabsorption table has one misordered knot (4000.0 eV listed after the 4009.0 eV M5 edge). The generator drops it; without the fix, `xraydb.mu_elam` returns an artifact between 4000 and 4009 eV. For every other element, the generator checks that its evaluation equals `xraydb.mu_elam` exactly.
- **Ramped edges:** a few heavy-element M/N edges near 1 keV (e.g. Re M5, Ra, Ac) are ramps over 1-2 eV in the source table, not clean steps. Their discontinuity-based edge step is therefore smaller than the full jump.
- **Zero steps:** edges with a jump ratio of 1.0 have no step in the table, so `edgeStep()` returns zero for them.

## Regenerating

Use a virtual environment outside the repository:

```
python -m venv <venv>
<venv>/Scripts/python -m pip install xraydb==4.5.8     # bin/python on Linux/macOS
<venv>/Scripts/python scripts/build-xray-data.py
```

The output is deterministic for a given xraydb version: it contains no timestamps and no randomness.
