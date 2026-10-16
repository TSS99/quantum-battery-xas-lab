# Scientific boundary and verification checklist

This document defines review criteria. A checkbox is not a passed test: only recorded automated or manual evidence establishes the status of a criterion. See the README for executed commands and results.

## Provenance and chemistry

- [ ] Synthetic beamline curves remain conspicuously labeled synthetic in views, exports and re-imports.
- [ ] Imported curves are labeled user supplied; experimental origin and calibration are not independently asserted.
- [ ] Exact results are described as exact for the displayed toy Hamiltonian; hardware results are never implied.
- [ ] `Li_xMnO2` charge neutrality gives nominal Mn valence `4-x` only under the stated Li+/O2- compensation assumptions.
- [ ] Mn3+ fraction `x` assumes only Mn3+/Mn4+ compensation. Covalency, oxygen redox, defects and disproportionation can invalidate that simple interpretation.
- [ ] MnO6 is a coordination motif with shared oxygen atoms, not the empirical bulk formula or an isolated molecule.
- [ ] Geometry is illustrative and independent of lithium loading unless a separate structural model is explicitly supplied.
- [ ] Mn K-edge dipole excitation accesses p character from 1s. Pre-edge d-like intensity is not mislabeled as a generally dipole-allowed pure 1s-to-3d transition.

## Transmission and synthetic spectra

- [ ] A thickness in micrometres is converted to centimetres before multiplying by `mu_cm_inv`.
- [ ] Deterministic `It = I0 exp(-mu*d)` obeys `0 <= It <= I0` and `mu*d = ln(I0/It)` for positive finite counts.
- [ ] At zero thickness, deterministic transmission is one and absorbed fraction is zero.
- [ ] Noise draws are distinguished from expectation values. Independent detector-count simulations are labeled as such; a realization with apparent `It > I0` is not called negative physical absorption.
- [ ] Zero counts make a logarithmic estimate undefined; no unreported pseudocount or silent clamp is used.
- [ ] Photon artwork is qualitative and does not claim one visible particle per physical photon.
- [ ] A pure logistic edge is monotonic; pre-edge/white-line/oscillatory features are not incorrectly tested as globally monotonic.
- [ ] The illustrative loading-to-edge shift is adjustable and explicitly not an experimentally calibrated relationship.
- [ ] The 6530-6580 eV axis is a near-edge illustration; exact edge location depends on environment and calibration.

## Import, processing and fitting

- [ ] CSV/JSON inputs enforce explicit units, finite values, array length agreement and strictly increasing energies.
- [ ] Dimensionless optical depth or normalized absorption is not accepted silently as an absolute coefficient.
- [ ] Invalid imports generate understandable errors without replacing valid existing runs.
- [ ] Raw arrays remain available after normalization, derivatives, fitting or energy alignment.
- [ ] Optional uncertainties are visible; fit weighting states whether they were used.
- [ ] Numerical derivatives handle nonuniform energy spacing and state their units.
- [ ] Edge estimates identify their operational method and avoid unsupported calibration precision.
- [ ] A fitted synthetic shape is labeled an illustrative overlay. Fit parameters do not become chemical or structural claims.
- [ ] Saving or sharing scenarios preserves parameter bounds, units, seed and model/schema version.
- [ ] Exported transformed data identify transformation, source provenance and fit settings.

## Quantum numerical invariants

For `v=Dg`, use independent identities rather than only round-tripping implementation outputs:

| Check | Evidence to collect |
| --- | --- |
| Hermiticity | Norm of `H-H†` and of each declared Hermitian Pauli term. |
| Ground state | `||Hg-Eg*g||` and `||g||=1`; handle degeneracy explicitly if present. |
| Unitarity | `||U†U-I||` for exact matrix-exponential and product-formula evolution. |
| Correlation reference | Direct `v† expm[-i(H-EgI)t] v` agrees with the eigenstate sum. |
| Sum rule | `C(0) = ||Dg||² = sum transition weights`; zero dipole strength is handled without division by zero. |
| Energy reference | Peaks occur at `En-Eg`, not at unshifted eigenvalues or negative-frequency mirror peaks. |
| Broadening | Lorentzian weights are nonnegative; broadening units and half/full-width convention are stated. |
| Fourier reconstruction | State transform sign, quadrature, window, time step, time extent and padding; inspect signed artifacts and peak errors. |
| Sampling | Warn when relevant transition energies exceed the spectral sampling range; distinguish FFT grid spacing from resolution. |
| Trotter comparison | Evolve the same normalized dipole-excited state with the same H and term order; fidelity stays in [0,1] up to roundoff. |
| Circuit correspondence | Gate order, rotation angles and qubit convention reproduce the numerical product formula. |
| Resources | Counts include exactly the displayed synthesis assumptions and exclusions. |

For a single isolated transition at gap `Delta`, the reference correlation is `w*exp(-i*Delta*t)`, and the broadened spectrum has its maximum at `Delta`. This provides a useful sign and unit test. Test several sampling windows and padding factors; a smoother curve after padding must not be reported as improved resolution. For degenerate or overlapping peaks, peak locations of the sum need not equal every individual transition energy exactly.

Trotter error should be examined over a sequence of step counts and times. Pointwise fidelity need not improve monotonically at every step count because of interference. Dense classical exact evolution is a validation baseline at two to six qubits; runtime or advantage claims require separate measured benchmarks.

## Experimental relevance boundaries

The required core-hole treatment, material structure, electronic correlations and experimental corrections are absent from the toy calculation. The synthetic spectrum does not derive from its Hamiltonian. These are two distinct teaching models connected conceptually through transition amplitudes and spectra. A synchronized slider or matching color palette must not imply a computed chemical mapping between them.

The displayed near-edge oscillation is an illustration, not a fitted EXAFS scattering path. Bond distances and coordination numbers require an appropriate scattering model, data range and uncertainty analysis. This follows the distinction between near-edge interpretation and EXAFS processing explained by [Newville](https://docs.xrayabsorption.org/tutorials/XAFS_Fundamentals.pdf) and the staged processing described in the [Larch XAFS guide](https://xraypy.github.io/xraylarch/xafs.html).

## Source and audit notes

Primary documentation and research consulted on 2026-10-16:

- [XDI data format](https://docs.xrayabsorption.org/xaslib/xdi.html): spectrum metadata and interchange.
- [Larch normalization](https://xraypy.github.io/xraylarch/xafs_preedge.html): edge estimation, background fits and normalization.
- [SciPy Hermitian eigensolver](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.eigh.html) and [matrix exponential](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.expm.html): independent numerical routines.
- [Qiskit PauliEvolutionGate](https://quantum.cloud.ibm.com/docs/en/api/qiskit/qiskit.circuit.library.PauliEvolutionGate): exact operator versus synthesized approximation.
- [Fomichev et al., quantum XAS of battery materials](https://arxiv.org/abs/2405.11015): research motivation and the distinction from a small illustrative Hamiltonian.
- [PySCF ADC](https://pyscf.org/user/adc.html): method-specific capabilities; core ionization is not neutral core excitation.

Implementation-specific findings will be added below after source inspection. The checklist above is intentionally a review target, not a completed certification.

## Implementation review findings

Source review on 2026-10-16 inspected `src/lib/xas.ts`, `src/lib/scenario.ts`, `src/lib/spectra.ts` and `src/lib/quantum.ts`. At that point integration and test execution were in progress. The observations below are source-review findings, not certification of the whole application.

- The attenuation implementation explicitly converts micrometres to centimetres and distinguishes deterministic expectation from independently sampled Poisson monitor counts. Invalid zero-count logarithms return an undefined result rather than a fabricated coefficient.
- Spectrum imports enforce explicit unit-bearing columns, increasing finite energies, finite coefficients and positive optional uncertainty. Synthetic provenance survives a file round trip as declared provenance; the UI must display **Imported synthetic** where appropriate.
- The unequal-grid three-point derivative has the correct interior coefficients. The shift/scale/baseline fit uses supplied uncertainty for its objective and reports residuals with an explicit interpretive caveat.
- Calibration reference and offset are metadata only in the spectrum engine. The UI and exports must not imply that raw energies have been corrected automatically.
- The quantum implementation uses the positive Fourier sign matching `exp[-i(En-Eg)t]`, carries the ground-energy reference, and preserves a signed Fourier diagnostic alongside a positive display.
- The displayed `CX(control,target) -> Rx(control) -> CX(control,target)` realizes the selected XX exponential. This works because conjugating X on the control by CX gives XX.

Follow-up review items communicated to the implementation owners:

1. State that the nonzero `<g|X0|g>` creates an elastic zero-gap contribution; do not interpret it as a core absorption line.
2. Distinguish eigenvector orthogonality from a direct propagator unitarity check in diagnostic labels.
3. Add or clearly scope an exact/Trotter spectral comparison; state fidelity alone does not quantify the application output error.
4. Plot raw uncertainty only with the raw quantity unless its propagation through normalization or differentiation is implemented.
5. Reject or diagnose pathological energy spacings that make numerical derivatives nonfinite.

The research guide contains six original arXiv sources and separates source-level features from material-specific and production workflows that remain future work.
