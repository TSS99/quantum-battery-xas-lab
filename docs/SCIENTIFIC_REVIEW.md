# Scientific boundary and verification checklist

This document defines review criteria. A checkbox is not a passed test: only recorded automated or manual evidence establishes the status of a criterion. See the README for executed commands and results.

**Status on 2026-10-28.** A ticked box names the passing test that holds it (CI runs every unit test before each deploy; the `tests/*.spec.ts` browser tests run locally). An open box has no automated evidence: it is a wording rule, held only by review of the copy, or it is partly covered as noted.

## Provenance and chemistry

- [x] Synthetic beamline curves remain conspicuously labeled synthetic in views, exports and re-imports. Evidence: `src/lib/spectra.test.ts` "retains a synthetic declaration on import without claiming measured provenance" (exports and re-imports); views carry `SYNTHETIC_DISCLOSURE` (`src/lib/xas.ts`), not tested.
- [x] Imported curves are labeled user supplied; experimental origin and calibration are not independently asserted. Evidence: `src/lib/measured-data.test.ts` "marks user files as user supplied and keeps the hash of a single file".
- [ ] Exact results are described as exact for the displayed toy Hamiltonian; hardware results are never implied. Wording rule; no automated check.
- [x] `Li_xMnO2` charge neutrality gives nominal Mn valence `4-x` only under the stated Li+/O2- compensation assumptions. Evidence: `src/lib/xas.test.ts` "balances Li_xMnO2 and bounds the two-valence mixture".
- [ ] Mn3+ fraction `x` assumes only Mn3+/Mn4+ compensation. Covalency, oxygen redox, defects and disproportionation can invalidate that simple interpretation.
- [ ] MnO6 is a coordination motif with shared oxygen atoms, not the empirical bulk formula or an isolated molecule.
- [ ] Geometry is illustrative and independent of lithium loading unless a separate structural model is explicitly supplied.
- [ ] Mn K-edge dipole excitation accesses p character from 1s. Pre-edge d-like intensity is not mislabeled as a generally dipole-allowed pure 1s-to-3d transition.

## Transmission and synthetic spectra

- [x] A thickness in micrometres is converted to centimetres before multiplying by `mu_cm_inv`. Evidence: `src/lib/xas.test.ts` "converts um to cm and obeys Beer–Lambert with exact optical depth recovery".
- [x] Deterministic `It = I0 exp(-mu*d)` obeys `0 <= It <= I0` and `mu*d = ln(I0/It)` for positive finite counts. Evidence: the same test.
- [ ] At zero thickness, deterministic transmission is one and absorbed fraction is zero. Partly: `src/lib/xas.test.ts` checks zero thickness stays within `0 <= It <= I0` and that zero attenuation transmits everything, but not the exact value at zero thickness.
- [x] Noise draws are distinguished from expectation values. Evidence: `src/lib/xas.test.ts` "reproduces counts, preserves noisy ratios above one and makes zero-count logs undefined". Independent detector-count simulations are labeled as such; a realization with apparent `It > I0` is not called negative physical absorption.
- [x] Zero counts make a logarithmic estimate undefined; no unreported pseudocount or silent clamp is used. Evidence: the same test.
- [x] Photon artwork is qualitative and does not claim one visible particle per physical photon. The 3D hutch legend states the false colour, the slowing, the photons per dot, the boosts and the exaggerated widths and rocking angle; checked by reading the page on 2026-10-28, no automated check.
- [x] A pure logistic edge is monotonic (evidence: `src/lib/xas.test.ts` "makes only the feature-free edge monotonic and all full-model coefficients positive"); pre-edge/white-line/oscillatory features are not incorrectly tested as globally monotonic.
- [ ] The illustrative loading-to-edge shift is adjustable and explicitly not an experimentally calibrated relationship.
- [ ] The 6530-6580 eV axis is a near-edge illustration; exact edge location depends on environment and calibration.

## Import, processing and fitting

- [x] CSV/JSON inputs enforce explicit units, finite values, array length agreement and strictly increasing energies. Evidence: `src/lib/spectra.test.ts` "validates increasing energies, finite data, positive uncertainties, lengths and calibration".
- [x] Dimensionless optical depth or normalized absorption is not accepted silently as an absolute coefficient. Evidence: `src/lib/spectra.test.ts` "accepts only explicit absolute coefficient headers and rejects nonnumeric or incomplete rows".
- [x] Invalid imports generate understandable errors without replacing valid existing runs. Evidence: `tests/ui.spec.ts` "spectra validates imports without losing valid runs and exports provenance".
- [x] Raw arrays remain available after normalization, derivatives, fitting or energy alignment. Evidence: `src/lib/spectra.test.ts` "uses the unequal-grid derivative and preserves raw arrays through normalization"; `src/lib/comparison.test.ts` "aligns one energy shift without changing raw arrays".
- [ ] Optional uncertainties are visible; fit weighting states whether they were used. Partly: `src/lib/spectra.test.ts` "downweights a high-uncertainty outlier rather than silently treating sigma as decoration" checks the weighting; what the page shows is not tested.
- [x] Numerical derivatives handle nonuniform energy spacing and state their units. Evidence: `src/lib/spectra.test.ts` "uses the unequal-grid derivative and preserves raw arrays through normalization" and "fails clearly when pathological energy spacing overflows the derivative".
- [x] Edge estimates identify their operational method and avoid unsupported calibration precision. Evidence: `src/lib/spectra.test.ts` "locates the logistic midpoint by two independently defined methods".
- [ ] A fitted synthetic shape is labeled an illustrative overlay. Fit parameters do not become chemical or structural claims.
- [x] Saving or sharing scenarios preserves parameter bounds, units, seed and model/schema version. Evidence: `src/lib/scenario.test.ts` "roundtrips all controls through JSON and URL without losing seed" and "rejects malformed, unknown and out-of-range controls instead of changing experiments".
- [x] Exported transformed data identify transformation, source provenance and fit settings. Evidence: `src/lib/measured-data.test.ts` "writes a record with the files, mapping, shifts, parameters and arrays"; `tests/ui.spec.ts` "spectra validates imports without losing valid runs and exports provenance".

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

## The beamline twin against a measured spectrum

Added 2026-10-28. The twin's checks were against other codes (xraydb, Larch, SciPy). `src/lib/twin/measured-check.test.ts` now compares it with a measured Cu foil (APS 13-ID, 2001, from the xraylarch examples, MIT): k^2 chi(k) correlation 0.75 over k = 3 to 15 (0.89 with a 5 eV E0 shift), amplitude 1.08 times the measured, first shell 2.27 against 2.24 angstrom, normalized mu RMS 0.007 below the edge and 0.048 over the EXAFS. The near edge does not match (RMS 0.28): it is a teaching model, and the Methods page says so. The same comparison found two faults, both fixed: auto gain set amplifier gains at one energy, so the reference chamber clipped before the edge, and the undulator and tender profiles clipped It and Iref with their preset gains.

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
