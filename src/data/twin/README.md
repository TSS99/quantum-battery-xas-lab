# Beamline twin generated tables

`optics.json` contains compact, browser-loadable optics, source, emission-line and gas data. `fixtures.json` is test-only reference output evaluated directly with the Python libraries. The exact numerical call patterns and package version are recorded in each file's `calls` field.

## Contents

- **Silicon monochromators:** Si(111), Si(311) and Si(220), with the base reflection and every diamond-allowed order from 1 through 5. The generator marks forbidden orders separately. Each row contains the Bragg angle, energy FWHM, single-crystal angular FWHM and double-crystal rocking-curve FWHM from `xraydb.darwin_width` on a log-spaced fundamental-energy grid ending at 40 keV.
- **Double-crystal detune:** throughput for a parallel \((+,-)\) pair at offsets \(\delta=f\,\Delta\theta_{\mathrm{rock},1}\), for \(f=0,0.1,\ldots,0.9,1.2,1.5\). At each order, the table integrates the autocorrelation
  \[
  A_n(\delta)=\int I_n(\theta)I_n(\theta-\delta)\,d\theta
  \]
  of a Darwin-Prins reflectivity curve reconstructed with the same scattering factors and dynamical-diffraction equations as `xraydb.darwin_width`. The curve spans \(\pm400\) intrinsic widths at 400,001 points, following dossier script `s02b_detune.py`, and the autocorrelation is evaluated by FFT. This range retains the \(1/x^2\) tails that XrayDB's returned `intensity` and `dtheta` arrays truncate. Throughput is \(A_n(\delta)/A_n(0)\). The separate acceptance value is \(A_n(0)/A_1(0)\) at the same fundamental energy. At 7,112 eV, a half-rocking-FWHM Si(111) detune leaves \(1.43\times10^{-3}\) of the Si(333) throughput, rather than the falsely optimistic value produced by a truncated curve. This is an ideal parallel-crystal calculation; it does not include source divergence, crystal strain, thermal gradients or surface damage.
- **Mirrors:** s-polarized, zero-roughness reflectivity for Si, Rh, Pt and Ni at the stated bulk densities, from 2 to 60 keV and 1.0 to 6.0 mrad in 0.25 mrad steps. The loader interpolates reflectivity bilinearly in angle and \(\ln E\). Energy knots are refined around coating absorption edges and sharp cutoff structure.
- **Emission lines:** XrayDB K, L1, L2, L3 and M1-M5 vacancy lines for elements Li through Cf. A line is retained when its intensity is at least 0.01 of the strongest line from the same initial level. Intensities remain relative within that initial level and must not be compared as absolute yields between levels.
- **Bending-magnet source:** \(G_1(y)=y\int_y^\infty K_{5/3}(x)\,dx\), evaluated by SciPy quadrature from \(10^{-4}\) to 30. The loader interpolates \(\ln G_1\) against \(\ln y\) and uses documented asymptotic forms outside the stored interval.
- **Ion-chamber gases:** N2, He, Ar, Kr and dry air. Each row supplies the formula for `src/lib/xraydata.ts`, XrayDB's mean ion-pair energy \(W\), molar mass and ideal-gas density at 295 K and 1 atm:
  \[
  \rho=\frac{PM}{RT}.
  \]
  Gas density scales with pressure and inverse temperature; the stored values are not valid unchanged at other conditions.

The compact numerical records use arrays rather than repeated object keys and four significant digits. `src/lib/twin/tables.ts` gives them named TypeScript return types.

## Fixtures and measured accuracy

`fixtures.json` contains 12 off-grid Darwin-width cases, six full-tail detune cases, 20 off-grid mirror-energy cases near the coating cutoffs, eight ion-chamber cases including pure gases and mixtures, ten independent \(G_1\) values, filtered Fe/Cu/Pt emission lines, and Be-window and Si-sensor attenuation at six energies. Ion-chamber references use `with_compton=False, both_carriers=False`, which is the twin's one-charge-per-ion-pair convention. The same cases are also recorded with `both_carriers=True` to expose XrayDB's factor-of-two convention; that variant is not used by the twin.

The generator validates mirror interpolation at 1,600 energies that are independent of its compression candidates. Error is relative for \(R\geq0.02\); below that it is absolute error divided by 0.02. The current generated data give:

| Coating | Energy knots | Maximum error | 99th percentile |
| --- | ---: | ---: | ---: |
| Si | 367 | 0.397% | 0.225% |
| Rh | 580 | 0.391% | 0.208% |
| Pt | 829 | 0.399% | 0.262% |
| Ni | 350 | 0.395% | 0.199% |

The Vitest suite independently requires Darwin values within 2%, full-tail detune throughput within 10%, mirror values within 1% or 5% across a rapidly changing cutoff, \(G_1\) within 0.5%, and Be/Si attenuation within 1%. `optics.json` is 136,320 bytes with gzip level 9, below the 150 KiB budget.

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
```

The script prints the uncompressed and gzip sizes plus the measured mirror errors. It contains no timestamps or randomness. Two consecutive runs with the same XrayDB, SciPy and NumPy versions must produce byte-identical files.
