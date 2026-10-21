# EXAFS fitting

`fitExafs` in `exafs-fit.ts` fits one dataset using explicit FEFF paths from `exafs.ts`.
It has no UI, filesystem access or unseeded randomness. Contracts live in `types.ts`.
Use it from a Worker for interactive work. This is a local nonlinear fit, so a successful
termination does not establish a global optimum or validate the structural model.

## Model and parameter links

A model has shared `s02` and `e0_eV` fields plus a list of shells. Each shell contains
explicit `FeffPath` objects. FEFF degeneracy is retained. `weight` is an additional
fixed multiplier, defaulting to one; supply absorber-site fractions explicitly for
multi-site averages. Do not include the same physical path twice unless the model
intentionally describes distinct populations.

Every adjustable field accepts a number (fixed) or a parameter name. Independent
parameters have `value`, optional finite `min` and `max`, and optional `vary: false`.
The initial value must satisfy its bounds. Equal bounds are rejected; use `vary: false`.
Parameter units follow the field they supply. Names are arbitrary, so the caller must
keep links dimensionally consistent.

A linked parameter uses `expr: { parameter: 'name', scale: 2, offset: 0.01 }`, meaning
the affine expression \(2p+0.01\). Scale and offset default to one and zero. Links
may chain; cycles, missing references, bounds on links and unused free parameters
are rejected. Expression strings are never evaluated. Standard errors of linked
parameters are propagated from the full covariance matrix.

For each shell choose:

- `deltar_A`, in \(\mathring{\mathrm A}\), or `alpha`, dimensionless, with
  \(\Delta R_j=\alpha r_{\mathrm{eff},j}\). Both omitted means zero shift.
- `sigma2_A2`, in \(\mathring{\mathrm A}^2\), or `thetaE_K`, in \(\mathrm K\).
  The Einstein option requires fixed `temperature_K` and calls the existing
  Larch-compatible `sigma2Einstein` for each path. Both omitted means zero disorder.

For example, after loading the Cu path set and supplying `k` and `chi`:

```ts
const cu = await loadPaths('cu');
const result = fitExafs({
  k_A_inv: k, chi,
  parameters: {
    amplitude: { value: 0.9, min: 0.3, max: 1.5 },
    edge: { value: 0, min: -10, max: 10 },
    expansion: { value: 0, min: -0.05, max: 0.05 },
    disorder: { value: 0.004, min: 0, max: 0.03 },
  },
  model: {
    s02: 'amplitude', e0_eV: 'edge',
    shells: [{ id: 'Cu-Cu', paths: [cu.sites[0].paths[0]],
      alpha: 'expansion', sigma2_A2: 'disorder' }],
  },
  options: { space: 'r', kmin_A_inv: 3, kmax_A_inv: 13,
    rmin_A: 1.5, rmax_A: 3.2, kweight: 2, dk_A_inv: 1,
    epsilonK: 0.0005 },
});
```

These are illustrative bounds and a synthetic noise level, not universal material
constraints. Negative amplitude, negative disorder, nonpositive path length and
nonpositive Einstein temperature are outside the implemented physical domain.
Nonfinite trial curves are rejected. Coordination numbers, cumulants, imaginary
energy shifts, multiple datasets and background refinement are outside this API.

## Transform and residuals

The reference is the installed **xraylarch 2026.3.1** source, particularly
`larch/xafs/{feffit,xafsft}.py`, together with the
[Larch fitting documentation](https://xraypy.github.io/xraylarch/xafs_feffit.html).

Input \(k\) must be finite, nonnegative and strictly increasing. Data and array
uncertainties are interpolated linearly onto a grid starting at zero, with default
\(\delta k=0.05\ \mathring{\mathrm A}^{-1}\). Below the first input point the
interpolation holds its endpoint, as Larch does; these points must lie outside the
active fit interval. An \(R\)-space fit requires measured support for the full
Hanning window, including its tails. No sorting, background subtraction or
normalization is performed.

Hanning windows reuse `ftWindow`: the rising taper spans
\(k_{\min}\pm d k/2\), the falling taper spans
\(k_{\max}\pm d k_2/2\), with Larch's grid snapping. Defaults are
\(d k=d k_2=1\ \mathring{\mathrm A}^{-1}\). Overlapping tapers are rejected.

With \(N=2048\) by default, the forward transform is

\[
\chi(R_m)=\frac{\delta k}{\sqrt{\pi}}
  \sum_{n=0}^{N-1} k_n^w\Omega(k_n)\chi(k_n)
  \exp\!\left(-\frac{2\pi i nm}{N}\right),\qquad
R_m=\frac{\pi m}{N\delta k}.
\]

Samples after the input grid are zero padded. There is no additional factor of
\(i\), \(N^{-1}\) or \(N^{-1/2}\). The complex transform has units
\(\mathring{\mathrm A}^{-(w+1)}\); \(\chi(k)\) is dimensionless.
The returned \(R\) coordinate is phase uncorrected, not a bond length.

For `space: 'r'`, residuals interleave real and imaginary parts of the transformed
data minus model, divided by `epsilonR`. Both parts are fitted, not the magnitude.
For `space: 'k'`, residuals are \(k^w(\chi_{\mathrm{data}}-\chi_{\mathrm{model}})/\epsilon_k\)
without a taper. Both spaces use Larch's index slices:
`floor(0.01 + min/step)` through `floor(0.01 + max/step)`, upper index excluded.
Thus requested endpoints describe a range; the exact retained samples depend on
the grid. The returned complex curves cover zero to at least the fit's upper
\(R\) limit, normally \(10\ \mathring{\mathrm A}\).

`epsilonK` is a positive standard uncertainty in dimensionless \(\chi\), either
scalar or on the input grid. For supplied errors Larch uses

\[
\epsilon_R = \frac{\overline{\epsilon_k}}{2}
\sqrt{\frac{\delta k\left(k_{\max}^{2w+1}-k_{\min}^{2w+1}\right)}{\pi(2w+1)}}.
\]

The mean is over the entire interpolated input grid. Consequently, array errors
weight individual points in \(k\) space but collapse to a scalar in \(R\) space.
This matches Larch; it is not full heteroscedastic Fourier covariance whitening.
When errors are omitted, the implementation reproduces `FeffitDataSet.estimate_noise`:
RMS real/imaginary signal at \(15\) to \(30\ \mathring{\mathrm A}\), corrected by
the average window, then converted to \(\epsilon_k\) using Larch's
\(\sqrt{2\pi(2w+1)/(\delta k\,\Delta k^{2w+1})}\) factor, where
\(\Delta k^{2w+1}=k_{\max}^{2w+1}-k_{\min}^{2w+1}\).
That conversion intentionally differs by \(\sqrt{2}\) from the supplied-error
conversion in this Larch release. There is no AUTOBK uncertainty contribution.
Provide errors if the fit overlaps the noise interval or the transform cannot
represent it. In \(k\) fits, truncated Hanning tails also affect the auxiliary
Fourier curves and automatic noise estimate.

## Statistics and uncertainty

The default `independentPoints: 'nyquist'` follows the brief:
\(N_{\mathrm{idp}}=2\Delta k\Delta R/\pi\).
**Larch 2026.3.1 adds one.** Select `independentPoints: 'larch'` for exact agreement
with its statistics and error bars. The selected convention is returned in `settings`.
The \(R\) range is required even in \(k\) space for this information count.
The count is not rounded, and zero padding does not increase it.

Writing \(M\) for the number of real residual entries, \(P\) for free variables,
\(Q=\sum_i r_i^2\) and \(\nu=N_{\mathrm{idp}}-P\):

\[
\chi^2=Q\frac{N_{\mathrm{idp}}}{M},\qquad
\chi^2_\nu=\frac{\chi^2}{\nu},\qquad
\mathcal R=\frac{Q}{\sum_i d_i^2},\qquad
C=(J^\mathsf TJ)^{-1}\frac{Q}{\nu}.
\]

Here \(d_i\) uses the same transform and error weighting as the residual, and
\(J\) is the Jacobian of that weighted residual in physical parameter coordinates.
The R-factor is returned as a ratio, with `null` for zero data norm. Degrees of
freedom must be positive. The covariance multiplier is **not** the reported
reduced chi square: Larch starts with an unscaled covariance and multiplies it by
`raw_redchi * raw_nfree / (Nidp - P)`, which simplifies to \(Q/\nu\).
Compare our `covariance` to Larch's `fit_details.scaled_covar`, not `result.covar`.

The numerical solver is Levenberg-Marquardt with bound projection, a numerical
Jacobian and column scaling. `ml-matrix` solves damped systems and computes the
final covariance by SVD. A normalized singular-value ratio at or below
\(10^{-9}\) is treated as rank deficiency. Standard errors are the square roots
of covariance diagonal entries; correlation matrices follow `variableNames`.
Fixed parameters have zero statistical error. Physical domain boundaries are
checked even when a parameter has no explicit bound. Unconverged, bound-limited or
rank-deficient fits return `null` covariance and unknown variable errors, with an
explicit status. `success` reports optimization convergence only; inspect
`uncertaintyStatus` before displaying error bars.

These are local, residual-scaled statistical errors. They exclude calibration,
background choices, self-absorption, path truncation and FEFF model error. A
standard error does not promise \(90\%\) coverage. In particular, applying the
independent-point scaling to oversampled, unfiltered \(k\) data can make errors
conservative. The seeded regression demonstrates recovery for its specific
setup; it does not calibrate coverage for other data or fitting spaces.

## Reproducing the checks

`scripts/twin/make-fit-fixtures.py` reconstructs the stored Cu first shell and NiO
first two single-scattering shells in Larch. It adds seeded Gaussian noise and
runs `feffit` in both spaces, with scalar, array and estimated errors. The JSON
records source hashes, exact calls, versions, curves, covariance and statistics.
It is synthetic test data and is never imported by runtime code. `--check`
regenerates in memory and requires byte-identical output in the pinned environment.

```powershell
& 'C:\Users\Tilock\astra-runner\pyenv\Scripts\python.exe' -B scripts/twin/make-fit-fixtures.py --check
npx tsc --noEmit
npx vitest run
```

Set `EXAFS_FIT_AUDIT=1` when running the fitting tests to print parity and seeded
coverage diagnostics. The unit tests require agreement within one Larch standard
error and within \(20\%\) for uncertainties. They also check complex transforms,
noise conversion, correlations, bounds, links, Einstein disorder, rank deficiency,
FFT padding and invalid inputs. The \(50\)-seed \(k\)-space test requires all four
Cu parameters within one standard error simultaneously in at least \(45\) draws.
The same \(50\) seeds in \(R\) space are checked for bias, and their actual
one-standard-error coverage is reported without imposing a \(90\%\) target.
