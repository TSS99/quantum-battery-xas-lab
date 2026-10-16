# Quantum Battery XAS Lab — implementation specification

## Intent and scientific boundary
A local education and research-prototyping laboratory. Researchers should be able to audit equations, reproduce runs, export numerical data, inspect convergence, and bring their own spectra. This release is not a calibrated materials predictor. No generated data are called experimental, no quantum hardware is implied, and no quantum advantage is claimed.

## Sitemap and screen composition
- `/`: mission control; generous editorial introduction, interactive MnO6 specimen, live lithium/redox controls, compact spectrum and experiment entry cards.
- `/crystal`: large manipulable specimen and control rail; nominal composition and assumptions.
- `/beamline`: animated source/sample/detector, synchronized energy and thickness controls, absorption/transmission charts and count readout.
- `/spectra`: multi-run chart, normalization/derivative controls, CSV/JSON imports, fitting and export tools.
- `/electronic`: interactive orbital/transition diagram and explanations of p character, hybridization and core hole.
- `/quantum`: clickable algorithm stages, Hamiltonian controls, exact/Trotter circuit and traces, transition table, spectral checks.
- `/experiments`: presets, reproducible scenario manifest, share/save/load/reset and run navigation.
- `/validation`: assumptions, formulas, sanity checks, references, scaling and research extension boundaries.

Persistent navigation and shared experiment provider keep x, photon energy, thickness, count level, seed and model shape synchronized. Beginner/expert mode changes explanatory detail, not scientific assumptions. On small screens navigation becomes horizontally scrollable and panels stack.

## Design system
Near-black ink (#080b12), cool slate panels, warm white text, muted blue-gray secondary copy; violet Mn (#a28aff), red O (#ff686b), green Li (#70dfac), amber beam (#f4c777). Fine technical rules, small uppercase instrument labels, large expressive titles and readable body text. Animation communicates rotation, photon flow, state changes and scanning. Reduced-motion stops automatic movement and removes transition offsets. Avoid text over bright glows.

## Component hierarchy
RootLayout → LabProvider → Shell (navigation, mode, context strip) → route module. Shared primitives: Panel, Badge, Range, Metric, Plot, Disclosure, buttons. AtomicScene is lazy loaded and has a usable SVG fallback. Plot uses SVG with axis labels, legends, cursor values and accessible descriptions. QuantumLab uses an exact browser Worker solver by default, including on static GitHub Pages. An optional independent local SciPy reference is available on localhost; missing backend produces an actionable error, never fabricated results. A worker performs fitting without blocking pointer interactions. The Next.js build uses static export and an environment-configured base path.

## Data contracts
LabState: x, energy (eV), thickness (micrometres), photons (expected incident counts), seed, edge (eV), shift (eV per x, illustrative), width (eV), whiteLine (cm^-1), preEdge (cm^-1), oscillation (fraction), expert (boolean). State and imported scenarios are bounded and versioned.

Spectrum: id, name, provenance (`synthetic` or `imported`), energy_eV[], mu_cm_inv[], optional sigma_mu_cm_inv[], optional parameters and source filename. Import requires finite, strictly increasing energy, equal-length arrays and at least five rows. CSV columns explicitly contain units. Imports are user supplied, not independently verified measurements. Negative processed coefficients may be retained in studio but cannot be fed to deterministic attenuation without validation.

QuantumRequest: qubits 2..6, coupling, field, timeMax, samples, trotterSteps, broadening, window, padding. QuantumResponse contains explicit Pauli terms, ground energy/state, transition energies and dipole weights, times, exact and Trotter complex correlation, spectral grid and eigenstate/Fourier spectra, fidelity, gate counts and numerical validation. Energies use a toy eV scale and time eV^-1 (hbar=1), with no mapping to the Mn K edge.

## Physics and numerical conventions
- Charge neutrality: x(+1)+v_Mn+2(-2)=0, hence v_Mn=4-x. Under only Mn3+/Mn4+ compensation, Mn3+ fraction=x. MnO6 describes a shared-oxygen local environment; it is not bulk Li_xMnO2 stoichiometry. Geometry remains independent of x.
- Synthetic mu(E): positive baseline + logistic step + Gaussian pre-edge and white line + bounded damped post-edge modulation. E0(x)=edge-shift*x is a user-controlled illustrative assumption. The pure logistic component alone is monotonic; a full XANES-like spectrum need not be.
- d_cm=d_um*1e-4; T=exp(-mu*d_cm); expected It=I0*T; absorbed=1-T. Independent Poisson detector counts can yield an apparent T>1; zero counts make log attenuation undefined and must be handled explicitly. Photon artwork is qualitative.
- Dipole: Mn K edge starts in 1s; electric-dipole delta-l=+/-1 accesses p character. Weak pre-edge d-like intensity can involve p-d mixing and quadrupole contributions. Simple orbital pictures are not many-body eigenstates.
- Exact toy Hamiltonian uses explicitly enumerated Pauli terms. H is Hermitian and exact evolution uses eigendecomposition with an independent scipy.linalg.expm cross-check. D is explicitly given, not an ab initio core-excitation operator. C(t)=<g|D† exp[-i(H-Eg)t]D|g>. Transition weights are |<n|D|g>|² at En-Eg.
- Positive-frequency Fourier convention uses exp(+i omega t). Report finite-time resolution ~2pi/T separately from zero-padded grid spacing. Apply stated exponential broadening and a stated window. Show signed finite-window reconstruction diagnostics while preventing an absorption display from silently implying negative physical intensity. Eigenstate Lorentzians provide a positive reference. Account explicitly for any clipping.
- Trotter circuits apply the same stated Pauli terms as the numerical product formula; resource counts exclude ground-state preparation and measurement. Report first-order product-formula limitations and convergence rather than promising monotonic pointwise fidelity.

## Research tools and limitations
Export raw spectra, transform views, scenario JSON, quantum full response and SVG plots. Preserve units, provenance and parameters. Studio normalization is an explicitly simple endpoint-window operation, not a substitute for Larch normalization or EXAFS fitting. Illustrative fitting estimates a synthetic model shift/scale/background with residuals and a stated objective; it does not infer chemical valence or structure. Optional uncertainties must be visible and respected where used.

Real Mn-O work requires a specified structure/charge/spin, basis/relativistic treatment, core-hole and multiplet treatment, active-space convergence, fermion-to-qubit mapping, experimental energy calibration and comparison. PySCF, Qiskit and hardware execution are optional future integrations, not implemented research claims. Dense exact diagonalization scales O(4^n) memory and O(8^n) time; cap this interface at six qubits.

## Acceptance checklist
- [ ] Connected landing/crystal/beamline/quantum vertical slice, with working navigation.
- [ ] Responsive 3D, camera controls, labels, fallback and reduced motion.
- [ ] Correct state-linked chemistry, units, attenuation and synthetic disclosure.
- [ ] Exact 2..6 qubit service, product formula, correlation, spectra, circuit/resources.
- [ ] Studio snapshots, validated imports, transforms, fit, uncertainty and exports.
- [ ] Guided flow, orbital explorer, scenario persistence and validation page.
- [ ] Physics/import unit tests, backend invariants and UI interaction/provenance tests.
- [ ] Production build, browser verification, screenshots and complete README.

## Source references
Newville, Fundamentals of XAFS: https://docs.xrayabsorption.org/tutorials/XAFS_Fundamentals.pdf
Larch processing documentation: https://xraypy.github.io/xraylarch/xafs_preedge.html
SciPy matrix exponential: https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.expm.html
Next.js setup: https://nextjs.org/docs/app/getting-started/installation

## Delivery milestones
1. Implement and test independent science engines and shared state.
2. Deliver connected core screens and visibly labeled numerical outputs.
3. Add researcher workflows and educational context.
4. Verify production build, browser behavior and mobile layout; record actual outcomes.
