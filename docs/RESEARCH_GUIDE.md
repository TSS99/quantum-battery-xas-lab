# Research and industrial use guide

Quantum Battery XAS Lab is useful for teaching experimental reasoning, inspecting user-supplied spectra, and verifying small quantum algorithms. Its generated spectra are synthetic. Its quantum calculation is exact only for the displayed small effective Hamiltonian. Neither result establishes a cathode material's structure, oxidation state, lifetime, manufacturing quality, or performance.

This guide separates useful workflows from future integrations. Consult the README for the recorded integration and test results; source inspection is not evidence of a passed browser test.

## Implemented foundation and research roadmap

| Capability | Implementation boundary |
| --- | --- |
| Synthetic attenuation and reproducible counts | Implemented numerical engine: explicit cm^-1 / micrometre conversion, deterministic expectation, seeded Poisson monitors and undefined-count handling. |
| Imported spectra and metadata | Implemented numerical contract: explicit units, increasing energies, optional positive pointwise sigma, sample/source/notes, and calibration metadata. An import does not certify measured origin. |
| Processing and illustrative fits | Implemented numerical engine: endpoint normalization, unequal-grid derivative, operational edge estimates, weighted shift/scale/background fit and residuals. This is not calibrated chemical inference. |
| Exact effective Hamiltonian | Implemented browser solver: 2-6 qubits, displayed Pauli terms, D=X0, exact eigensystem, product formula, correlation, FFT and numerical diagnostics. |
| Reproducible export | Versioned scenario and spectrum serializers preserve parameters, units and provenance. Save the code revision separately with research records. |
| Experimental calibration correction | Calibration reference and offset metadata are retained; raw energies are not automatically shifted by that metadata. Applying a correction requires an explicit processing operation. |
| Material-specific core XAS | Roadmap only: core-excited many-body states, validated electronic integrals, active-space convergence and comparison against licensed, calibrated measurements. |
| Production research pipeline | Roadmap only: full XDI/Larch/FEFF adapters, synchronized electrochemistry, parameter uncertainty propagation, team audit trail and validated review thresholds. |

The table describes source-level capabilities reviewed during implementation. UI integration and execution evidence are recorded by the main implementation in the README.

## Practical workflows

| Workflow | What to do | What the result supports |
| --- | --- | --- |
| Beamtime onboarding | Change thickness, photon count and energy; compare expected incident and transmitted counts. | Understanding attenuation and statistical tradeoffs. It does not select a real sample thickness without composition, density and instrument information. |
| Compare cathode runs | Import consistently processed spectra, retain their provenance, overlay them and inspect derivatives. | Finding differences to investigate. A shifted edge alone does not uniquely establish a valence change. |
| Reproducible methods discussion | Save scenario parameters, raw curves, processing settings and the code revision together. | Sharing a reproducible numerical example and reviewing assumptions. |
| Algorithm validation | Fix the displayed Hamiltonian and dipole operator; vary time window, sampling and Trotter steps. | Quantifying algorithmic error against a small exact reference. It does not measure quantum advantage. |
| R&D handoff | Export arrays with units and a record of calibration, normalization and uncertainty. | Passing an auditable numerical record to an established XAS or electronic-structure workflow. |

These are proposed practical uses based on the application's scope, not claims of industrial validation or endorsements.

## A defensible spectrum record

Preserve the original file before processing. Record a stable sample identifier; filename and source; acquisition date when known; material description; measurement mode; incident and transmitted count conventions; thickness and its uncertainty if converting to absolute absorption; energy units; and any energy calibration reference and offset. For battery studies, include the independently measured state of charge, cycle number, electrochemical protocol and temperature when available. Do not fill missing metadata with plausible values.

The XAFS Data Interchange format provides a community model for retaining spectrum arrays together with their experimental metadata. This application's simple CSV/JSON imports are not a claim of complete XDI compatibility. [XDI documentation](https://docs.xrayabsorption.org/xaslib/xdi.html).

Three frequently used y quantities must remain distinct:

1. `mu_cm_inv`: an absolute linear absorption coefficient, in cm^-1.
2. `mu_d = ln(I0/It)`: dimensionless optical depth, requiring thickness to obtain an absolute coefficient.
3. Normalized absorption: dimensionless and dependent on the normalization method.

An importer requiring `mu_cm_inv` must not silently accept either of the other quantities under that name. For a uniform transmission sample, convert thickness from micrometres to centimetres using `d_cm = d_um * 1e-4`, then calculate `mu_cm_inv = ln(I0/It) / d_cm`. Substrate contributions and other experimental corrections are separate. The transmission law and its measurement assumptions are described in [Newville, Fundamentals of XAFS](https://docs.xrayabsorption.org/tutorials/XAFS_Fundamentals.pdf).

Use `imported` or `user-supplied experimental` as provenance, with verification status separate. A filename or a user's declaration does not independently establish calibration or data quality. Synthetic exports must retain a synthetic label after re-import.

## Comparing spectra without hiding processing decisions

Apply a common stated processing method to spectra that will be compared. Retain raw and processed arrays separately. Record the chosen energy window, edge estimator, baseline method, normalization factors and uncertainty treatment. A maximum-derivative edge estimate can move with noise and spectral shape; a half-height estimate answers a different operational question. Neither is an absolute universal material constant.

The studio's simple endpoint normalization and synthetic-model overlays are exploratory tools. Production analysis commonly includes fitting pre-edge and post-edge backgrounds and estimating an edge step; Larch exposes these decisions explicitly. A 50 eV illustration window may not provide enough pre-edge or post-edge range for a defensible analysis of experimental data. [Larch normalization documentation](https://xraypy.github.io/xraylarch/xafs_preedge.html).

A fitted illustrative shift, scale or baseline is a descriptive fit parameter. It is not a measured lithium content, oxidation state, bond distance or coordination number. Inspect residual structure and bounds, and reject interpretations unsupported by independent standards or a validated forward model. Do not compare fit scores from different masks or incompatible uncertainty conventions.

If pointwise standard deviations are supplied, retain their units and distinguish observed scatter, counting noise and systematic uncertainty. Weighted residuals use `(observed - predicted) / sigma`; zero or nonfinite sigma values must be rejected. A count-noise estimate does not include energy drift, detector nonlinearity, sample inhomogeneity or uncertainty in thickness. Displaying a curve with a shaded band is not, on its own, a statistical confidence statement.

## A reproducible quantum run

Save all Pauli terms and their ordering, the dipole operator, qubit ordering, ground-state convention, numerical precision, sample interval, final time, broadening, window, padding and product-formula order/step count. Include solver version and the exact result against which the approximation was compared.

For the lab's convention, `H` has an effective energy scale in eV, `t` is in eV^-1, and hbar is set to one. The spectrum is on an effective excitation-energy axis; it cannot be relabeled as the Mn K-edge axis. With `|v> = D|g>`, the defining identities are

```text
C(t) = <v| exp[-i(H - Eg I)t] |v>
     = sum_n |<n|D|g>|^2 exp[-i(En - Eg)t]

C(0) = <g|D†D|g> = sum_n transition_weight_n
S_eta(omega) = sum_n weight_n * eta / [pi * ((omega - (En-Eg))^2 + eta^2)]
```

The Lorentzian reference above is nonnegative for positive `eta`; `eta` is the half width at half maximum. A finite-window Fourier reconstruction can have signed truncation artifacts. Preserve the signed diagnostic and disclose any clipping used in an absorption display. Zero padding creates a denser plotting grid; it does not add physical resolving power. Increasing the observed time improves nominal energy resolution, while finite time steps set a sampling limit.

SciPy provides separate Hermitian eigensolver and matrix-exponential routines suitable for an independent numerical cross-check. Agreement checks numerical implementation of a selected Hamiltonian, not realism of that Hamiltonian. [SciPy `eigh`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.eigh.html), [SciPy `expm`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.expm.html).

Circuit depth and entangling counts must identify the decomposition and exclude unimplemented state preparation, measurement, compilation, error correction and hardware execution explicitly. A Pauli evolution operator and a compiled product-formula circuit are different objects; synthesis choices matter. [Qiskit PauliEvolutionGate documentation](https://quantum.cloud.ibm.com/docs/en/api/qiskit/qiskit.circuit.library.PauliEvolutionGate).

With the current `D=X0`, the ground-state expectation of D can be nonzero. The correlation then contains an elastic zero-energy contribution of weight `|<g|D|g>|^2`. This is part of the toy correlation and is not a core absorption excitation. A future connected-response option can use `D - <D>I`, retaining its nonunit norm explicitly.

## Original research and concrete design implications

The following are original research papers, accessed on 2026-10-16. Proposed app features are our interpretation of their relevance, not implementations of the papers' full methods. Reading an abstract supports only its stated scope; the time-domain equations in the 2025 paper were also inspected in full text.

| Paper | What informs this lab | Scope boundary |
| --- | --- | --- |
| [Simulating X-ray absorption spectroscopy of battery materials on a quantum computer](https://arxiv.org/abs/2405.11015), Fomichev et al. (2024) | Connect a dipole-excited state, time evolution and spectra; show the Hamiltonian and excitation mapping explicitly. | Its Mn-O chemical active-space example is not this small spin model. |
| [Fast simulations of X-ray absorption spectroscopy for battery materials on a quantum computer](https://arxiv.org/abs/2506.15784), Fomichev et al. (2025) | Compare spectral error as well as state fidelity; expose broadening, sampling and time truncation. | Specialized Hamiltonian factorization, sampling optimizations and fault-tolerant resource estimates are not implemented. |
| [Simulating X-ray absorption spectra with CASSCF linear response methods](https://arxiv.org/abs/2004.05845), Helmich-Paris (2020) | Treat core-valence separation and active-space choices as explicit scientific approximations to benchmark. | This is not a claim that enabling PySCF alone reproduces the paper's method or its Mn results. |
| [Core-Excited States and X-Ray Absorption Spectra From Multireference Algebraic Diagrammatic Construction Theory](https://arxiv.org/abs/2305.03836), Mazin and Sokolov (2023) | Explain why multireference character and core excitation require a method-specific validation pathway. | The app implements no MR-ADC and makes no transferable accuracy claim. |
| [A benchmark study of core-excited states of organic molecules computed with the generalized active space driven similarity renormalization group](https://arxiv.org/abs/2212.04369), Huang and Evangelista (2022) | Keep active-space sensitivity, absolute energy errors and relative spectral errors distinct. | Organic-molecule benchmarks do not establish Mn cathode accuracy; GAS-DSRG is not implemented. |
| [XAFS spectroscopy. I. Extracting the fine structure from the absorption spectra](https://arxiv.org/abs/physics/0003086), Klementev (2000) | Separate counting uncertainty from background-model uncertainty; retain processing settings and inspect sensitivity. | The simple studio processing does not implement the paper's Bayesian/background methods. |

For near-term research use, the strongest additions are therefore transparent processing records, residual/error views, and convergence controls. They make decisions reviewable without implying that a toy model solves the chemical interpretation problem. Calibration-reference metadata remains a separate requirement informed by XAS processing practice, not an energy-accuracy claim inferred from these papers.

## From the toy system to research calculations

A published quantum-XAS study considers a specified Mn-O battery cluster and a much larger chemical active space than this browser lab. It motivates the educational bridge without validating this toy model or transferring its resource estimates. [Fomichev et al., Simulating X-ray absorption spectroscopy of battery materials on a quantum computer](https://arxiv.org/abs/2405.11015).

Moving toward material-specific work requires a justified structure, charge and spin; embedding or periodic environment; basis and relativistic choices; explicit core excitation and dipole matrix elements; electron correlation and multiplet treatment; active-space convergence; fermion-to-qubit mapping; and experimental calibration. PySCF is a possible source of electronic-structure components, not a one-click guarantee of Mn K-edge accuracy. Core ionization/XPS and neutral core excitation/XAS must not be conflated: PySCF's ADC guide describes its core-valence-separation IP capability as core ionization and XPS. [PySCF ADC documentation](https://pyscf.org/user/adc.html).

Dense exact diagonalization uses matrices with dimension `2^n`; matrix storage scales as `4^n` and a dense eigensolve roughly as `8^n`. The six-qubit limit here is a deliberate verification scale.

## Industry-oriented extension priorities

These are proposed future increments, ordered by value to an auditable workflow rather than visual impact:

1. **Data integrity:** immutable source-file hash, editable sample/acquisition metadata, explicit units, processing history and reproducible export bundles.
2. **Comparison and quality control:** repeat-scan overlays; calibration-reference alignment; residuals; user-defined review thresholds; clear flags for missing data, detector saturation and counting assumptions. Thresholds require domain validation before being used for release decisions.
3. **Battery context:** link spectra to time, voltage, current, cycle and temperature using imported synchronized records, with clock alignment and missing-data handling.
4. **Validated analysis adapters:** versioned Larch/FEFF integrations, benchmark reference datasets with licenses and citations, uncertainty propagation and sensitivity reports.
5. **Computational research:** import an explicit Hamiltonian and dipole operator; compare independent solvers; add convergence sweeps before optional Qiskit or PySCF integration.

Authentication, team access controls, laboratory-system integration, regulated audit trails and manufacturing release qualification require a separate deployment and validation effort. No feature in this demonstration is presented as a qualified quality-control system.
