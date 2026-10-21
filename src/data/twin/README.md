# Beamline twin generated tables

`optics.json` contains compact, browser-loadable optics, source, emission-line and gas data. `fixtures.json`, `beam-fixtures.json` and `sample-fixtures.json` are test-only reference output evaluated directly with the Python libraries. The exact numerical call patterns and package version are recorded in each file's `calls` field.

## Contents

- **Silicon monochromators:** Si(111), Si(311) and Si(220), with the base reflection and every diamond-allowed order from 1 through 5. The generator marks forbidden orders separately. Each row contains the Bragg angle, energy FWHM, single-crystal angular FWHM and double-crystal rocking-curve FWHM from `xraydb.darwin_width` on a log-spaced fundamental-energy grid ending at 40 keV.
- **Double-crystal detune:** throughput for a parallel \((+,-)\) pair at offsets \(\delta=f\,\Delta\theta_{\mathrm{rock},1}\), for \(f=0,0.1,\ldots,0.9,1.2,1.5\). At each order, the table integrates the autocorrelation
  \[
  A_n(\delta)=\int I_n(\theta)I_n(\theta-\delta)\,d\theta
  \]
  of a Darwin-Prins reflectivity curve reconstructed with the same scattering factors and dynamical-diffraction equations as `xraydb.darwin_width`. The curve spans \(\pm400\) intrinsic widths at 400,001 points, following dossier script `s02b_detune.py`, and the autocorrelation is evaluated by FFT. This range retains the \(1/x^2\) tails that XrayDB's returned `intensity` and `dtheta` arrays truncate. Throughput is \(A_n(\delta)/A_n(0)\). The separate acceptance value is \(A_n(0)/A_1(0)\) at the same fundamental energy. At 7,112 eV, a half-rocking-FWHM Si(111) detune leaves \(1.43\times10^{-3}\) of the Si(333) throughput, rather than the falsely optimistic value produced by a truncated curve. This is an ideal parallel-crystal calculation; it does not include source divergence, crystal strain, thermal gradients or surface damage.
- **Mirrors:** s-polarized, zero-roughness reflectivity for Si, Rh, Pt and Ni at the stated bulk densities, from 2 to 60 keV and 1.0 to 6.0 mrad in 0.25 mrad steps. The loader interpolates reflectivity bilinearly in angle and \(\ln E\). Energy knots are refined around coating absorption edges and sharp cutoff structure, so the energy axis is stored with eight significant digits: the refinement is spaced \(10^{-4}\) in relative energy and four digits would collapse it into duplicate knots.

  The measured accuracy below holds **on the stored angles only**. The total-reflection cutoff energy scales as \(1/\theta\), so it moves by 4 to 25 % from one 0.25 mrad row to the next; linear interpolation in angle across that shift is badly wrong near the cutoff. Measured half way between two rows, the error reaches 1.1 to 2.6 times the true reflectivity depending on the coating, and its 99th percentile over 2 to 60 keV is 22 to 44 %. Keep mirror angles on the stored 0.25 mrad grid, or compute \(R\) from the optical constants \(\delta\) and \(\beta\) instead of interpolating this table in angle.
- **Emission lines:** XrayDB K, L1, L2, L3 and M1-M5 vacancy lines for elements Li through Cf. A line is retained when its intensity is at least 0.01 of the strongest line from the same initial level. Intensities remain relative within that initial level and must not be compared as absolute yields between levels.
- **Bending-magnet source:** \(G_1(y)=y\int_y^\infty K_{5/3}(x)\,dx\), evaluated by SciPy quadrature from \(10^{-4}\) to 30. The loader interpolates \(\ln G_1\) against \(\ln y\) and uses documented asymptotic forms outside the stored interval.
- **Ion-chamber gases:** N2, He, Ar, Kr and dry air. Each row supplies the formula for `src/lib/xraydata.ts`, XrayDB's mean ion-pair energy \(W\), molar mass and ideal-gas density at 295 K and 1 atm:
  \[
  \rho=\frac{PM}{RT}.
  \]
  Gas density scales with pressure and inverse temperature; the stored values are not valid unchanged at other conditions.

The compact numerical records use arrays rather than repeated object keys, and four significant digits everywhere except the mirror energy axis, which needs eight. `src/lib/twin/tables.ts` gives them named TypeScript return types.

## Fixtures and measured accuracy

`fixtures.json` contains 12 off-grid Darwin-width cases, six full-tail detune cases, 46 off-grid mirror-energy cases (20 across the coating cutoffs and 26 straddling the 13 coating absorption edges between 2 and 60 keV), eight ion-chamber cases including pure gases and mixtures, ten independent \(G_1\) values, filtered Fe/Cu/Pt emission lines, and Be-window and Si-sensor attenuation at six energies. Ion-chamber references use `with_compton=False, both_carriers=False`, which is the twin's one-charge-per-ion-pair convention. The same cases are also recorded with `both_carriers=True` to expose XrayDB's factor-of-two convention; that variant is not used by the twin.

The generator validates the rounded table it has just written, on the stored angle rows, at 1,600 energies independent of its compression candidates plus 2,001 energies across \(\pm1\,\%\) of every coating edge. Error is relative for \(R\geq0.02\); below that it is absolute error divided by 0.02. The current generated data give:

| Coating | Energy knots | Maximum error | At | 99th percentile |
| --- | ---: | ---: | ---: | ---: |
| Si | 300 | 0.583% | 34,950 eV | 0.300% |
| Rh | 536 | 1.142% | 23,231 eV (K edge) | 0.353% |
| Pt | 788 | 0.563% | 47,172 eV | 0.413% |
| Ni | 302 | 1.996% | 8,332 eV (K edge) | 0.363% |

Away from the coating edges (more than 0.2% in energy from one) the error stays at or below 0.61% for all four coatings. The two values above 1% sit inside a window a few eV wide at the Rh and Ni K edges, where the tabulated optical constants step discontinuously: linear interpolation across a step cannot do better than about half the step, whatever the knot spacing, and for Rh and Ni the K edge lands on an angle row where the reflectivity curve is steep (worst at 2.5 mrad and 5.75 mrad respectively). For Ni the window where the error exceeds 1% is 4 eV wide; for Rh it is 0.4 eV wide.

The Vitest suite independently requires Darwin values within 2%, full-tail detune throughput within 10%, mirror values within 1% or 5% across a rapidly changing cutoff, \(G_1\) within 0.5%, and Be/Si attenuation within 1%. `optics.json` is 134,184 bytes with gzip level 9, below the 150 KiB budget.

### `beam-fixtures.json`: whole-beamline reference

`beam-fixtures.json` checks the models in `src/lib/twin/{source,mono,mirrors,beam}.ts` against values recomputed from XrayDB and SciPy without reading `optics.json`, so it tests the physics chain and the table interpolation together. It holds twelve configurations, three crystals by two generic bending magnets (3 GeV at 1.4 T and 6 GeV at 0.86 T) by mirrors in or out by zero or half-width detune, each at 5, 8.979, 12, 18 and 25 keV, plus five single-crystal resolution rows and seven mirror reflectivity rows.

Per configuration and energy it records the Bragg angle, the Darwin and divergence energy widths, the pass bandwidth, the relative angular acceptance, the detune throughput, the mirror transmission, the source flux and the resulting flux for every allowed order, and the harmonic fraction. The detune throughput and acceptance use the same full-tail Darwin-Prins construction as `make-optics-tables.py`, recomputed here; they reproduce the `fixtures.json` detune rows to ten digits. The Vitest suite requires the Bragg angle to the stored twelve significant digits, bandwidth, resolution, mirror transmission and source flux within 1%, relative acceptance within 2%, and flux and harmonic fraction within 5%.

Two conventions differ from the physics dossier and are deliberate. The flux bandwidth is the Darwin energy FWHM over the photon energy. That is larger than the exact aligned band \(\int R_1R_2\,d\varepsilon/\varepsilon\), because peak reflectivity is below one, by a factor of 1.61 at 5 keV, 1.20 at 9 keV and 1.02 at 25 keV for Si(111) and 1.80 at 5 keV for Si(311); the harmonic fraction is a ratio of two such bands, so most of that bias cancels. The quadrature resolution uses the Darwin FWHM rather than the classic Darwin width, so totals are \(\sqrt{9/8}\) larger than the dossier's section 2.3 table, and the intrinsic term then equals the tabulated `energy_fwhm` exactly. Orders whose energy exceeds the tabulated 60 keV mirror ceiling are reported as omitted rather than estimated.

### `sample-fixtures.json`: sample, environment and dose reference

`sample-fixtures.json` checks `src/lib/twin/{sample,damage}.ts` against values recomputed from XrayDB and SciPy without reading `elements.json` or `optics.json`. It holds ten cases over four materials: 2 mM Fe in water behind two 50 µm Kapton windows, a NiO pellet 500 µm and 2 µm thick, a 5 µm Cu foil clean and with 2 % pinholes and 15 % thickness spread, and a LiMn\(_2\)O\(_4\) pellet in a cryostat behind two 250 µm Be windows, with and without 20 µm grains. Each is evaluated at 45°/45° or at 10° exit, at \(E_0-50\), \(+50\), \(+300\), \(+600\) and \(+1000\) eV, recording \(\mu_T\), \(\mu_a\), the sample and window transmission, the full fluorescence ratio with its thin and thick limits and damping factor, the electron yield, the Larch `fluo_corr` \(\alpha\) and the dose rate.

Four quantities are deliberately computed by a different route than the TypeScript side, so the fixtures test the model rather than repeat it. The thickness spread uses the analytic Gaussian average \(\exp(-\mu\bar x + \mu^2\sigma_x^2/2)\) against the Gauss-Hermite quadrature; the particle-size average is summed over a Poisson grain count against its closed form \(\exp[-n(1-e^{-\mu t})]\); the fluorescence depth integral is evaluated by `scipy.integrate.quad` against the Booth and Bridges closed form; and the edge jump continues the absorber's photoabsorption upward along a log-log line through 0.70 \(E_0\) and 0.98 \(E_0\), where the TypeScript side extrapolates the knot pair immediately below the edge. The last of these is the loosest: the two jumps agree to 0.35 % over the fixture energies, which is why the suite asks for 1 %. Both chord endpoints stay strictly below the edge because `xraydb.mu_elam` returns the above-edge branch at \(E_0(1-10^{-9})\) for several elements, Cu among them.

The fixtures carry the bare tabulated edge, so the TypeScript functions are called with `sharpEdge` rather than the default teaching fine structure. Below the edge \(\mu_a\) is zero, so the fluorescence ratio and electron yield are zero there while the transmission is not. The fluorescence yield, mean line energy and line probability come from `xraydb.fluor_yield(element, edge, 'Ka', E0 + 100)` and are held fixed across the scan, because XrayDB returns zero below the edge while the line itself does not depend on the incident energy; the stored line fraction agrees with the grouping in `optics.json` to 0.08 % and the mean line energy to 0.004 %.

Where a sample is opaque the suite compares optical depth rather than transmission. The 500 µm NiO pellet reaches \(\mu x \approx 86\) above the edge, where a 0.03 % difference in \(\mu\) moves \(e^{-\mu x}\) by 2 %; a ratio test on a transmission of \(10^{-38}\) measures the exponential, not the model.

`fluoCorrAlpha` is `null` for the two solution cases. The \(\pm10\) eV finite difference of the Larch algorithm cannot resolve a step that small: over those 20 eV the water background falls by 0.086 cm\(^2\)/g while 2 mM of Fe adds only 0.039, so the denominator turns negative. `selfAbsorptionAlpha` throws there rather than returning a meaningless number, and the suite asserts that it does. For the concentrated cases it reproduces the dossier's section 6.2 values: 0.377 for Cu metal and 0.390 for NiO.

The dose rows reproduce the dossier's section 11.1 table: 32.5 and 15.8 Gy/s for \(10^{11}\) ph/s on 5 × 1 mm\(^2\) of water at 7,112 and 10,000 eV against the quoted 33 and 16, and \(6.5\times10^7\) Gy/s for \(10^{12}\) ph/s on 5 × 5 µm\(^2\). The tabulated photoabsorption standing in for \(\mu_{\mathrm{en}}/\rho\) agrees with the NIST water table to 0.10 % at 5 keV, 0.04 % at 8 keV, 0.01 % at 10 keV and 1.16 % at 20 keV, so the suite requires 1.2 %.

## Sources, licences and citations

- The XrayDB database is version 9.2 and is dedicated to the public domain under CC0 1.0 Universal. The `xraydb` 4.5.8 Python package is MIT licensed and is used only to generate these files.
- Cross sections, scattering factors and emission data ultimately use W. T. Elam, B. D. Ravel and J. R. Sieber, “A new atomic database for X-ray spectroscopic calculations,” *Radiation Physics and Chemistry* 63, 121-128 (2002), <https://doi.org/10.1016/S0969-806X(01)00227-4>.
- The silicon lattice constant is \(a=5.431020511\ \mathring{\mathrm A}\), derived from the CODATA 2018 silicon \(\{220\}\) lattice spacing. See E. Tiesinga et al., “CODATA recommended values of the fundamental physical constants: 2018,” *Reviews of Modern Physics* 93, 025010 (2021), <https://doi.org/10.1103/RevModPhys.93.025010>.
- The universal source function uses SciPy's `special.kv` and `integrate.quad`; NumPy performs the deterministic quadrature over Darwin curves.

These tables reproduce tabulated and ideal-optics calculations. They do not represent a measured beamline, a crystal metrology certificate or a coating-specific roughness and density characterization.

## Regenerating

From the repository root, use the pinned environment supplied for this project:

```powershell
& 'C:\Users\Tilock\astra-runner\pyenv\Scripts\python.exe' scripts/twin/make-optics-tables.py
& 'C:\Users\Tilock\astra-runner\pyenv\Scripts\python.exe' scripts/twin/reference_beam.py
& 'C:\Users\Tilock\astra-runner\pyenv\Scripts\python.exe' scripts/twin/reference_sample.py
```

The first script prints the uncompressed and gzip sizes plus the measured mirror errors; the other two print the file size and the case count. Neither contains timestamps or randomness. Two consecutive runs with the same XrayDB, SciPy and NumPy versions must produce byte-identical files.

## FEFF scattering paths

`feff/index.json` lists eleven structure models, their absorber edges, XrayDB edge energies in eV and retained path counts. Each `feff/<id>.json` contains the cited crystal, admission checks and paths for every inequivalent absorber orbit. `feff/manifest.json` records file hashes, byte counts, package versions, the FEFF executable hash, calculation settings and the twenty-four explicitly dropped targets. These are calculated EXAFS paths, not measured reference spectra.

The generator uses Larch's `feff6l` and `feffpath` reader. It builds periodic clusters of radius \(7\ \mathring{\mathrm A}\), with the central absorber at the origin, `RMAX 6.0`, `HOLE 1 1.0` for K edges and `HOLE 4 1.0` for L₃ edges. There is no `CRITERIA` or `NLEG` override. Each element has one noncentral potential; oxidation states, magnetic ordering and site-dependent ionic potentials are not assigned. The FEFF input is deterministic and its hash is recorded for each site.

The seven FEFF columns `k`, `real_phc`, `mag_feff`, `pha_feff`, `red_fact`, `lam` and `rep` remain on the native nonuniform grid, currently forty-nine points from \(0\) to \(20\ \mathring{\mathrm A}^{-1}\). Path values are rounded to five significant digits. `reff`, `lam` and geometry coordinates are in \(\mathring{\mathrm A}\), `k` and `rep` in \(\mathring{\mathrm A}^{-1}\), phases in radians, `mag_feff` in \(\mathring{\mathrm A}\), and `red_fact` is dimensionless. Geometry includes the absorber once, followed by the scattering vertices; closing the final leg back to the absorber gives total length \(2r_{\mathrm{eff}}\). `degen` is FEFF's path degeneracy within one absorber environment. The additional site weight is its crystallographic multiplicity divided by the total absorber multiplicity.

### Structure sources and admission checks

Inputs are hand-entered from publications and their deposited supplementary data. No ICSD rows are used. The exact cell parameters, fractional coordinates, origin settings and Wyckoff positions are in `scripts/twin/structures.py` and repeated in each material JSON. Published density and nearest-neighbour values are stored independently of the calculated checks, each with its own citation and locator. Published crystallographic densities are transcription checks, not independent measurements of sample porosity or stoichiometry.

| Model | Space group and cell convention | Primary cell and position source |
| --- | --- | --- |
| Cu | \(Fm\overline3m\), 225 | Straumanis and Yu, *Acta Cryst.* A25, 676-682 (1969), [DOI](https://doi.org/10.1107/S0567739469001549) |
| Fe, bcc | \(Im\overline3m\), 229 | von Batchelder and Raeuchle, *Acta Cryst.* 7, 464 (1954), [DOI](https://doi.org/10.1107/S0365110X54001466) |
| Ni | \(Fm\overline3m\), 225 | von Batchelder and Raeuchle (1954), [DOI](https://doi.org/10.1107/S0365110X54001466) |
| Pt, L₃ | \(Fm\overline3m\), 225 | Arblaster, *Platinum Metals Rev.* 41, 12-21 (1997), [DOI](https://doi.org/10.1595/003214097X4111221), selected room-temperature values |
| LiMn₂O₄ | \(Fd\overline3m\), 227, origin choice 2 | Akimoto et al., *Chem. Mater.* 12, 3246-3248 (2000), [DOI](https://doi.org/10.1021/cm0003673), [supplement](https://acs.figshare.com/articles/journal_contribution/3592047) |
| LiCoO₂ | \(R\overline3m\), 166, hexagonal axes | Akimoto, Gotoh and Oosawa, *J. Solid State Chem.* 141, 298-302 (1998), [DOI](https://doi.org/10.1006/jssc.1998.7966) |
| LiFePO₄ | \(Pnma\), 62 | Streltsov et al., *Acta Cryst.* B49, 147-153 (1993), [DOI](https://doi.org/10.1107/S0108768192004701), [deposited CIF](https://www.crystallography.net/cod/2100916.cif) |
| NiO | \(Fm\overline3m\), 225, cubic average | *Nanomaterials* 13, 2290 (2023), [DOI](https://doi.org/10.3390/nano13162290) |
| Fe₃O₄ | \(Fd\overline3m\), 227, origin choice 2 | Fleet, *Acta Cryst.* B37, 917-920 (1981), [DOI](https://doi.org/10.1107/S0567740881004597), [deposited CIF](https://www.crystallography.net/cod/9007644.cif) |
| ZnO | \(P6_3mc\), 186 | Kisi and Elcombe, *Acta Cryst.* C45, 1867-1870 (1989), [DOI](https://doi.org/10.1107/S0108270189004269) |
| CeO₂, L₃ | \(Fm\overline3m\), 225 | Sabari Arul et al., *RSC Adv.* 5, 70558-70565 (2015), [DOI](https://doi.org/10.1039/C5RA09790H), Table 1 |

Additional check sources are [NIST elemental densities](https://doi.org/10.18434/T4D01F), [Cu distances](https://doi.org/10.1103/PhysRevB.85.125405), [Fe distances](https://doi.org/10.1016/S0039-6028(00)00092-3), [Ni distances](https://doi.org/10.1021/acs.inorgchem.8b01230), [LiCoO₂ density](https://doi.org/10.1016/j.jascer.2017.03.001) and [distances](https://doi.org/10.1016/j.jpowsour.2012.11.127), [LiFePO₄ distances](https://doi.org/10.1103/PhysRevB.77.064414), [NiO distances](https://doi.org/10.1039/D3DT03280A), [ZnO distances](https://doi.org/10.1039/C7RA10748J), and [CeO₂ density](https://doi.org/10.1016/j.jallcom.2004.12.115) and [distances](https://doi.org/10.1021/acsaem.0c01145). The remaining checks use the corresponding structure paper.

Admission requires the exact formula ratio, density within \(2\%\) of the cited value and the nearest absorber-neighbour distance within \(0.02\ \mathring{\mathrm A}\), including the neighbour's element. Space-group identity and absorber partitions must remain stable at symmetry tolerances \(10^{-4}\), \(10^{-3}\) and \(10^{-2}\ \mathring{\mathrm A}\). Wyckoff multiplicities are checked; letters are compared when spglib has retained the input origin. Failure raises an error before any output files are written. An excluded model must be moved explicitly to the dropped ledger, with a reason.

All eleven retained structures pass. Densities below are in \(\mathrm{g\,cm^{-3}}\), and nearest-neighbour distances are in \(\mathring{\mathrm A}\). For magnetite, the distance pairs are tetrahedral Fe then octahedral Fe.

| ID | Literature / calculated density | Density error (%) | Literature / calculated nearest distance | Retained / available paths | Gzip bytes |
| --- | ---: | ---: | --- | ---: | ---: |
| `cu` | 8.9314 / 8.935212 | 0.04268 | 2.556 / 2.55613 | 22 / 22 | 10,159 |
| `fe-bcc` | 7.874 / 7.874220 | 0.00280 | 2.480 / 2.48246 | 41 / 41 | 17,364 |
| `ni` | 8.902 / 8.909731 | 0.08685 | 2.490 / 2.49170 | 28 / 28 | 12,587 |
| `pt` | 21.452 / 21.452433 | 0.00202 | 2.7744 / 2.77440 | 17 / 17 | 8,173 |
| `limn2o4` | 4.28 / 4.280352 | 0.00822 | 1.9592 / 1.95926 | 77 / 77 | 31,278 |
| `licoo2` | 5.05 / 5.051483 | 0.02936 | 1.920 / 1.92132 | 80 / 105 | 32,304 |
| `lifepo4` | 3.596 / 3.596515 | 0.01432 | 2.064 / 2.06385 | 80 / 194 | 31,462 |
| `nio` | 6.808 / 6.807606 | 0.00579 | 2.090 / 2.08850 | 80 / 80 | 32,121 |
| `fe3o4` | 5.200 / 5.200305 | 0.00587 | 1.888 / 1.88862; 2.058 / 2.05822 | 94 / 157 | 37,943 |
| `zno` | 5.67 / 5.675816 | 0.10258 | 1.970 / 1.97497 | 68 / 68 | 27,027 |
| `ceo2` | 7.215 / 7.215970 | 0.01344 | 2.340 / 2.34303 | 32 / 32 | 14,612 |

The first Cu, bcc Fe and Ni paths have \((r_{\mathrm{eff}},N)=(2.5561,12)\), \((2.4825,8)\) and \((2.4917,12)\), respectively. Magnetite has two separate calculations with weights \(1/3\) and \(2/3\). The path cap applies per site; the byte cap applies to the whole material file.

### Retention limits

Only paths with \(r_{\mathrm{eff}}\leq6\ \mathring{\mathrm A}\) are eligible. The strongest eighty per site are selected by the norm of \(k^2\chi(k)\) for fixture case (a) over \(2\leq k\leq16\ \mathring{\mathrm A}^{-1}\). Weak paths can then be removed by their site-weighted norm to meet the file budget of 40,000 gzip bytes. Single-scattering paths within \(0.02\ \mathring{\mathrm A}\) of each site's shortest path are protected. Arrays are never thinned or interpolated for storage.

This pruning is consequential. Relative unweighted \(L^2\) differences against **all FEFF output paths within the same radius and default criteria**, over the same \(k\) interval, reach \(22.92\%\) for LiCoO₂, \(30.61\%\) for LiFePO₄ and \(23.91\%\) for Fe₃O₄ across the three fixture cases. The other eight models retain every eligible output path. Per-case errors are in each JSON's `accuracy` array. This comparison is not a convergence study against larger clusters or stricter FEFF criteria. Downstream consumers must not present the compact library as a converged full-path calculation.

All cells are static, ordered models. NiO omits its small magnetic rhombohedral distortion. LiMn₂O₄ and Fe₃O₄ use their average cubic structures without low-temperature charge ordering. LiCoO₂ has full site occupancy. CeO₂ uses the published refined fluorite cell as an infinite stoichiometric crystal, without nanoparticle surfaces or oxygen vacancies.

### Larch fixtures

`feff-fixtures.json` is test-only and is not imported by runtime code. It contains all ten requested materials, each with \(k=0,0.05,\ldots,16\ \mathring{\mathrm A}^{-1}\) and:

`exafs-engine-fixture.json` is the additional one-path Larch check for nonzero imaginary energy shift and third and fourth cumulants. `scripts/twin/check_exafs.py` reconstructs the stored, rounded first Cu path in Larch, records the exact call and versions, and writes this fixture without rerunning FEFF.

| Case | \(S_0^2\) | \(E_0\) (eV) | \(\Delta R\) | \(\sigma^2\) (\(\mathring{\mathrm A}^2\)) |
| --- | ---: | ---: | --- | --- |
| a | 0.9 | 0 | 0 | 0.003 |
| b | 0.8 | +3 | \(0.01r_{\mathrm{eff}}\) | 0.006 |
| c | 1.0 | -2 | 0 | `sigma2_eins(300, 250, path)` |

Every curve is a multiplicity-weighted average of `larch.xafs.ff2chi` site results. The fixture records exact calls, versions, material-file hashes, ordered path IDs and per-path disorder. `chi` uses the original retained FEFF output; `chi_rounded` passes the serialized values back through Larch, reconstructing `pha = real_phc + pha_feff` and `amp = mag_feff * red_fact`. This separates storage quantization from the TypeScript interpolation check. The largest measured rounding difference is \(0.000813\%\) over \(2\leq k\leq16\ \mathring{\mathrm A}^{-1}\), below the \(0.1\%\) generator limit. The stored low-\(k\) values preserve Larch's numerical behavior; they are not a validated XANES model.

The Einstein section also records the first three Cu and Fe paths at \(T=10,77,300,600\ \mathrm K\), with \(\theta_E=250\ \mathrm K\). Larch's implementation includes every path vertex in the reduced-mass calculation, including repeated visits. Case (c) records both original and rounded-geometry results.

Regenerate and verify with the supplied environment, without installing packages:

```powershell
& 'C:\Users\Tilock\astra-runner\pyenv\Scripts\python.exe' -B scripts/twin/make-feff-library.py
& 'C:\Users\Tilock\astra-runner\pyenv\Scripts\python.exe' -B scripts/twin/make-feff-library.py --check
& 'C:\Users\Tilock\astra-runner\pyenv\Scripts\python.exe' -B scripts/twin/check_exafs.py
& 'C:\Users\Tilock\astra-runner\pyenv\Scripts\python.exe' -B -m unittest discover -s scripts/twin -p test_feff_library.py
npx tsc --noEmit
npx vitest run
```

`--check` recomputes all FEFF runs and fixtures in a fresh worktree-local temporary directory and compares every output byte. The recorded environment is xraylarch 2026.3.1, XrayDB 4.5.8, pymatgen 2026.9.24, NumPy 2.4.6, SciPy 1.17.1 and spglib 2.8.0. Reproducibility is checked in this environment with the recorded FEFF executable; it is not promised across different FEFF or numerical-library builds. No FEFF binary or source-paper PDF is redistributed.

### FEFF and Larch references

- J. J. Rehr and R. C. Albers, “Theoretical approaches to x-ray absorption fine structure,” *Rev. Mod. Phys.* 72, 621-654 (2000), [DOI](https://doi.org/10.1103/RevModPhys.72.621).
- S. I. Zabinsky et al., “Multiple-scattering calculations of x-ray-absorption spectra,” *Phys. Rev. B* 52, 2995-3009 (1995), [DOI](https://doi.org/10.1103/PhysRevB.52.2995).
- M. Newville, “Larch: An Analysis Package for XAFS and Related Spectroscopies,” *J. Phys.: Conf. Ser.* 430, 012007 (2013), [DOI](https://doi.org/10.1088/1742-6596/430/1/012007).
