# Master implementation prompt: Quantum Battery XAS Lab

Build a complete, responsive, local-first interactive web laboratory that connects idealized lithium insertion in Mn cathodes, local MnO6 coordination, X-ray absorption/transmission, electronic transitions, and small exact quantum dynamics. Use the selected model in the development environment; do not claim to change model settings. Preserve existing work, inspect the repository first, then implement and verify the application. Follow `design_spec.md` and use `docs/RESEARCH_GUIDE.md` for primary research and explicit interpretation boundaries.

## Product intent

Make the application useful for beginners and for researchers reviewing numerical methods and user-supplied spectra. Aim for a refined instrument aesthetic: near-black backgrounds, restrained luminous gradients, violet manganese, red oxygen, green lithium and amber X-ray beam; readable type, fine rules, purposeful animation and responsive layouts. Every visible control must work. Respect keyboard interaction, reduced motion and lower-powered devices. Graphics should explain the displayed calculations, with a usable fallback if WebGL is unavailable.

## Architecture and delivery order

Use TypeScript, React and Next.js App Router, Tailwind/CSS, Motion, Three.js/react-three-fiber and SVG plots. Share bounded experiment state across routes. Compute beamline values locally; run quantum numerics and fitting in browser Web Workers. GitHub Pages is static: all eight screens must work without a Python server, an API key, a paid API or external computation. Keep SciPy/FastAPI solely as an optional independent local reference. Use exact package versions from the lockfile.

1. Inspect existing source, design specification, numerical contracts, tests and documentation. Record the actual implementation boundaries.
2. Deliver a runnable vertical slice: navigation, interactive MnO6, lithium slider, live beamline, exact toy quantum worker, circuit and plots.
3. Complete spectra, orbital exploration, experiment manifests and validation/research screens. Add loading/error states, presets, import/export and reset behavior.
4. Verify physical/numerical invariants, UI interactions, responsiveness and the base-path static export. Fix failures before reporting success. Include exact commands and observed results.

## Eight modules

1. **Mission control `/`:** animated, manipulable atomic motif, concise project narrative, live sample context and Start Tour entry; lead into the other seven modules.
2. **Battery and crystal `/crystal/`:** Mn center and six coordinating oxygen atoms, labels/bonds/rotation/zoom/reset, x from zero to one and nominal oxidation `4-x`. Show idealized Mn3+ fraction x. Explain shared oxygen and keep geometry independent of x.
3. **XAS beamline `/beamline/`:** source/sample/detector animation, 6530–6580 eV cursor/scan, thickness and photon-count controls, expected transmission, optional seeded Poisson sampling, simultaneous coefficient/transmittance plots and editable synthetic-model parameters.
4. **Spectra studio `/spectra/`:** snapshot current synthetic scans, overlay multiple curves, validated CSV/JSON import, raw/normalized/derivative views, operational edge estimates, raw uncertainty, illustrative weighted shift/scale/background fits, residuals and CSV/JSON/SVG export. Preserve provenance and calibration metadata.
5. **Electronic structure `/electronic/`:** clickable orbital/transition views, 1s core to unoccupied p character, core-hole and hybridization context; distinguish one-particle diagrams from many-body states and pure dipole selection rules from mixing.
6. **Quantum dynamics `/quantum/`:** clickable workflow H and ground state → D|g> → time evolution → correlation → broadened spectrum; show actual 2–6 qubit values, Pauli terms, first-order Trotter circuit, exact/Trotter fidelity and spectral comparison, resources, transitions, sampling diagnostics and full numerical export.
7. **Experiments `/experiments/`:** guided presets, bounded editable settings, deterministic seeds, reset, versioned JSON save/load and shareable URL; produce an auditable run manifest with software/model version, units, numerical parameters, source/provenance/calibration records and caveats.
8. **Methods and validation `/validation/`:** inspect assumptions, formulas, numerical sanity checks, references, computational scaling and realistic research-extension requirements. Cite the arXiv papers in the research guide without claiming their chemical methods are implemented.

## Non-negotiable science

- Maintain explicit labels: synthetic educational, exact toy, imported/user supplied, and optional independent SciPy reference. No fabricated measured datasets, calibration, hardware runs or advantage claims.
- For idealized Li_xMnO2 with Li+ and O2-, charge neutrality gives Mn `4-x`. Mn3+/Mn4+ fractions require that compensation assumption; real local charge, oxygen redox, disorder and covalency are separate. MnO6 denotes coordination, not the empirical formula or an isolated molecule.
- Synthetic absorption consists of a positive background, logistic edge, pre-edge/white-line features and illustrative bounded oscillation. Its loading-to-edge shift is editable and has no quantitative experimental prediction. Exact Mn edge positions depend on environment and calibration.
- Use `d_cm = d_um * 1e-4`, `T = exp(-mu_cm_inv * d_cm)`, `It_expected = I0*T`, `mu*d = ln(I0/It)` and absorbed fraction `1-T`. Deterministic It cannot exceed I0. Independent Poisson observations may give apparent T greater than one; zero counts make logarithmic estimates undefined. Photon artwork is qualitative.
- Mn K-edge electric-dipole selection is 1s to p character, delta-l plus or minus one. Weak d-like pre-edge intensity may involve p–d mixing or quadrupole contributions; a pure 1s→3d transition is not generally electric-dipole allowed.
- Show the explicit Hamiltonian and `D=X0` mapping. Use `C(t)=<g|D† exp[-i(H-Eg)t]D|g>` and eigenstate weights `|<n|D|g>|²` at `En-Eg`. Set hbar=1; toy energies are eV and times eV^-1. Never map those energies to the Mn K edge.
- Apply the positive-sign Fourier convention, stated quadrature/window/broadening/padding and report physical resolution separately from padded grid spacing. Keep signed truncation artifacts available; disclose clipping in absorption-like display. Compare against positive Lorentzian eigenstate transitions and state whether elastic zero-energy weight is retained.
- Resource counts must match the displayed circuit and explicitly exclude preparation, measurement, routing and hardware execution. Dense diagonalization is a small classical validation baseline, with O(4^n) matrix storage and roughly O(8^n) work.
- Import unit-bearing headers; validate finite values, increasing energy, equal lengths and positive optional sigma. Keep original data, source and declared provenance. Calibration metadata does not silently correct the energy axis. Normalize/derive uncertainty only when the propagation method is implemented.
- Illustrative fits are descriptive synthetic overlays, not chemical, structural or valence estimators. Show bounds, residuals, weighting assumptions and missing uncertainty. Never label a fit industrially qualified.

## Research and industry usefulness

Prioritize inspectable arrays and provenance, reproducible manifests, calibration status, raw uncertainty, residuals and exact/approximate convergence. Explain potential beamtime training, research-method validation and data handoff uses. Draw concrete motivations from arXiv:2405.11015 and 2506.15784 for time-domain quantum XAS and spectral errors; 2004.05845, 2305.03836 and 2212.04369 for method-specific core-excitation/active-space boundaries; physics/0003086 for background and uncertainty sensitivity. Link sources, distinguish interpretation from implemented methods, and do not imply industry validation.

Keep PySCF, material-specific Mn-O integrals, multiplets, explicit core-hole treatment, fermion mappings, real hardware, Larch/FEFF/XDI adapters and regulated quality systems clearly identified as future integrations unless actually implemented and tested.

## Acceptance and handoff

Run `npm run typecheck`, `npm test`, `python -m pytest science`, UI tests and a static `npm run build` with `NEXT_PUBLIC_BASE_PATH=/quantum-battery-xas-lab`. Ensure `out/` contains all routes and browser workers resolve under that path. Document install/local start, optional SciPy usage, exact verified commands, limits and research references in README. Write a GitHub Pages workflow using configure-pages, upload-pages-artifact and deploy-pages. The destination is `https://tss99.github.io/quantum-battery-xas-lab/`; the project name has no `99`.

Do not initialize Git, create repositories, push or change GitHub settings. Another operator publishes the verified directory. Do not describe the intended live URL as a confirmed deployment. Finish with a short truthful report of completed features, verification results and remaining approximations.
