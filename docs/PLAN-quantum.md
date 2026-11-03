# Quantum XAS on the Beamline Twin, product plan

Draft of 3 November 2026. Written after reading the Xanadu and PennyLane papers and demos listed at the end, and after going through this repository as it stands at v2.0.0.

**Decisions, 3 November 2026.** The owner chose to build it inside this site, next to the twin; to keep the plan and the engine public (MIT); and to start with the oxygen K edge of lithium rich Mn oxides. Until a compute budget is set, emulation runs on the development PC (24 cores, CPU only, Linux under WSL), which covers the papers' 21 and 23 qubit checks, and there are no paid runs on quantum hardware.

**Status.** Phase 1, reproducing the papers, is done (v2.1.0, 3 November 2026); the results are in [QUANTUM_REPRO.md](QUANTUM_REPRO.md). Phase 2, the problem library, is done (v2.2.0); see [QUANTUM_LIBRARY.md](QUANTUM_LIBRARY.md).

## 1. In short

Quantum computers could compute X ray absorption spectra that classical methods cannot, for the strongly correlated transition metal oxides used in battery cathodes. Xanadu's 2025 paper brought the cost for a model cathode cluster down to about 100 logical qubits and 3×10⁸ Toffoli gates per circuit. That is roughly the size of the first fault tolerant machines that vendors promise for 2029. No such machine exists today, so the product has to be useful now and grow stronger when the hardware arrives.

The plan turns the Beamline Twin into one platform with five parts.

* **Build.** From a crystal structure to a quantum ready problem, meaning the cluster around the absorbing atom, an active space, the Hamiltonian with the core hole treated by core valence separation, the dipole operator and the initial state. Every problem is versioned and hashed.
* **Compute.** The time domain algorithm of Fomichev et al. It is emulated exactly for small problems in the browser and in Python, runs on today's quantum hardware only as a tiny demo, and on fault tolerant machines when they exist.
* **Estimate.** Logical qubits, Toffoli gates, shots and runtime for any problem on any hardware profile, next to the classical cost of the same answer.
* **Measure.** The Beamline Twin, extended to soft X rays, turns any computed spectrum into what a real beamline would record.
* **Compare.** Fit computed candidates to measured spectra and rank the hypotheses, with full provenance.

## 2. What the papers show

| Work | What it does | Numbers that matter |
| --- | --- | --- |
| Fomichev, Hejazi et al., arXiv 2405.11015, May 2024 (Xanadu with Volkswagen) | Proposes XAS as an early application of fault tolerant quantum computers. It gives three algorithms, time domain Hadamard tests, a frequency domain method and QPE sampling. XAS suits early machines because the core hole is local (small clusters suffice), experiments only resolve about 1 eV, and the ground states of small clusters can be prepared classically. | Clusters cut from Li₂MnO₃ during delithiation, oxygen K edge. Active space CAS(22e,18o) chosen with AVAS in PySCF, `cc-pVDZ` basis. First estimate with qubitized QPE was about 900 logical qubits and 10⁸ Toffolis per sample. |
| Fomichev, Casares et al., arXiv 2506.15784, June 2025, revised August 2025 (Xanadu with Volkswagen) | Optimized time domain algorithm. Compressed double factorization with a randomized second order Trotter formula. Trotter steps set by the error in the eigenvalues rather than in the whole time evolution. Evolution times sampled from the decaying Lorentzian kernel. Double phase trick, BLISS symmetry shifts, combined rotations and a double measurement. | For Li₄Mn₂O, CAS(22e,18o), 100 logical qubits, 3.11×10⁸ Toffolis in the longest circuit and 4.58×10¹¹ for the whole spectrum, five orders of magnitude below the unoptimized 2.6×10¹⁶. On an active volume layout with 350 logical qubits this is about 8.1×10¹⁰ logical cycles, under a day at 1 MHz. Their rough classical estimate (restricted active space) is about 32 to 100 days, so the quantum route is about 30 times faster here, and the gap grows because classical cost scales as 2ᴺ and quantum as about N³. Verified on a simulator against full CI for N₂, CAS(14e,10o), 21 qubits. A Li Mn O CAS(14e,11o) core excited run on 23 qubits converged in evolution time. |
| Kunitsa, Dhawan, Fomichev et al., arXiv 2508.15935, August 2025 | The same machinery for electron energy loss spectra (the dynamic structure factor), oxygen K edge of Li₂MnO₃. | 18 orbitals, about 100 logical qubits, about 3×10⁸ T gates deep, about 10⁴ shots. |
| Loaiza, Kunitsa, Fomichev et al., arXiv 2602.20270, February 2026 | Resonant inelastic X ray scattering (RIXS) with a block encoded dipole, a quantum signal processing propagator and QPE sampling. The model is an O₂ dimer bonded to Mn, from lithium rich cathodes. | 20 orbitals need 414 logical qubits and 2.0×10¹⁰ Toffolis. |
| PennyLane demo `tutorial_xas` (Dale and Fomichev, August 2025, updated April 2026) | The time domain algorithm end to end in PennyLane, on N₂ in STO-3G with 5 orbitals and 4 electrons (10 + 1 qubits), with the CASCI ground state from PySCF, dipole from `qml.qchem.dipole_moment`, compressed double factorization from `qml.qchem.factorize(compressed=True)`, second order Trotter, Hadamard test, Lorentzian reconstruction, check against CASCI. | Working code to build on (Apache 2.0). |
| PennyLane demo `tutorial_resource_estimation_spectroscopy` (January 2026) | Resource estimates for XAS with `pennylane.estimator` (`CDFHamiltonian`, `TrotterCDF`, `estimate`) for active spaces of 11 to 28 orbitals. | Our estimator can call this directly. |

Context. Xanadu won a $2.03 million ARPA E grant in March 2026 for three years of XAS and reaction rate algorithms, with the University of Chicago supplying structures and embedding models. IBM's roadmap puts Starling (200 logical qubits, 10⁸ gates) in 2029 and Blue Jay (2000 logical qubits, 10⁹ gates) in 2033.

What follows for us.

* The algorithm is solid enough to build on. The open problems are embedding, Trotter error for systems too big to simulate, state preparation, L edges (which need spin orbit coupling) and comparison with experiment.
* Nobody offers a product that takes a non specialist from a material to a computed spectrum, to the instrument, to measured data and to a decision.
* Xanadu leads the algorithms and is a likely partner (PennyLane is open source), not someone to fight on algorithms. Our edge is everything around the algorithm, meaning problem building, the instrument, measured data, interpretation and decisions.

## 3. The platform today

What we keep and reuse.

* The twin's physics engine (`src/lib/twin`), with the source, mirrors, monochromator, ion chambers, the fluorescence detector with dead time, electron yield, detector noise and the beam damage dose. It already turns a sample's absorption into realistic scans.
* Spectrum tools, namely Larch compatible normalization and background removal, Fourier transforms, the first shell fit, energy calibration from data, XDI import and export.
* Data, namely FEFF10 near edges and FEFF6L paths for 46 materials, COD crystal structures with their checks (`scripts/twin/cod`, `structures.py`), measured near edges of Cu, Ni, Pt, Fe₂O₃ and FeO, and a measured Cu foil.
* Interfaces, namely the static site (offline capable), the desktop app on every platform, the CLI and MCP server, training scenarios and classroom links, and sessions with hashed provenance.
* In git history, removed in v2.0.0 and easy to restore, are the old 1 to 6 qubit quantum dynamics demo (exact versus Trotter correlation function, Fourier spectrum, validation checks against SciPy), the paper's active space chooser for Li₄Mn₂O, FEFF cluster extraction (`make-clusters.py`) and the 3D cluster viewer from Read the spectrum.

What is missing.

* Real chemistry. There are no electronic Hamiltonians, active spaces, core hole treatment or dipole operators. The old quantum demo used a toy spin model.
* Soft X rays. The twin's beamlines start at 2 keV (tender) and 4.5 keV (hard). The papers' target, the oxygen K edge near 530 eV, and the Mn L edges near 640 eV need a soft X ray beamline with a grating monochromator, vacuum, and electron or fluorescence yield detection.
* Python compute. The site is static, and quantum chemistry needs PySCF and PennyLane in Python. The Python CI job left with the old backend.
* Classical baselines beyond FEFF. CASCI, selected CI or DMRG, and TDDFT with core valence separation are needed for honest comparison.

## 4. Pain points worth solving

### Battery makers and materials companies

1. **Oxygen redox and voltage fade are still argued over.** Sharp RIXS and oxygen K edge features in lithium rich cathodes are read as trapped molecular O₂ (Nature Materials 2024). Similar features also appear in NMC811 and LiCoO₂ and may be made by the beam itself. A wrong reading sends years of R&D the wrong way. *What we build.* Spectra of each candidate species (O₂ trapped in a void, peroxide like O₂²⁻, holes shared between Mn and O) as virtual references that can never be isolated in a bottle. The twin's dose model then checks whether the beam could create the signal.
2. **No reference compounds for unstable states.** Fingerprinting an oxidation state needs a standard, and intermediate states, mixed valence and defect sites have none. *What we build.* Computed references with a stated uncertainty.
3. **Beamtime is scarce and slow.** Proposals are reviewed twice a year for a few shifts, and teams often arrive unsure whether a feature is measurable at all. *What we build.* Simulate the measurement of each hypothesis on the twin before applying (resolution, noise, self absorption, dose), so the proposal asks a question the beamline can answer.
4. **Quantum budgets without numbers.** R&D leaders (Volkswagen researchers are coauthors on both XAS papers) must decide when to invest in quantum computing. *What we build.* A quantum readiness report per material problem, giving qubits, gates and runtime on named hardware generations, and the classical cost it would replace.
5. **Interpretation depends on a few specialists.** Multiplet and charge transfer fits need experts and adjustable parameters whose values are not unique. *What we build.* First principles spectra with no fitted parameters, sensible defaults, explanations and full provenance.
6. **Confidential materials.** Companies cannot upload proprietary structures. *What we build.* Local first operation through the desktop app and on premises compute; nothing leaves the machine unless the user sends it.

### Universities and national labs

1. **The exponential wall.** Multireference methods such as RAS and CASPT2 reach roughly 15 to 20 active orbitals, and DMRG for XAS has reached about 8. The Li₄Mn₂O problem needs 18, and an MnO₆ cluster needs 23 or more. *What we build.* The quantum algorithm route, with polynomial cost, next to the best classical baseline for the same problem.
2. **Quantum algorithm research lacks benchmarks tied to experiment.** Papers stop at toy molecules or resource tables. *What we build.* An open benchmark set of hashed problem instances, each with classical references and, where possible, measured spectra, plus one common score. Trotter, qubitization, signal processing and sampling schemes can then be compared on equal terms.
3. **Reproducibility.** Active space, geometry, basis, core hole treatment and broadening are often unreported. *What we build.* Every spectrum carries a complete, hashed recipe that anyone can rerun.
4. **Theory and experiment drift apart.** Computed spectra are compared by eye, with ad hoc shifts. *What we build.* One workflow from structure to computed spectrum to simulated measurement to a fit against data, with metrics.
5. **Teaching.** Courses on quantum computing for chemistry have no hands on link to a real instrument. *What we build.* The twin's training scenarios and classroom links extended to quantum spectra.
6. **Beamline staff carry the theory load.** They support many users with little theory help. *What we build.* A planning and interpretation service they can point users to.

### When each one is helped

| Help arrives | Pain points |
| --- | --- |
| Now, with no quantum hardware, through classical emulation of the algorithm for small active spaces, the twin and the estimates | Beamtime planning, quantum budgets, confidentiality, reproducibility, theory meeting experiment, teaching, beamline support, benchmarks; first principles spectra for small clusters |
| With fault tolerant hardware (about 100 logical qubits and 10⁸ to 10⁹ gates) | Oxygen redox species and unstable references at realistic cluster sizes, and breaking the exponential wall |

## 5. The product, as a user sees it

1. Pick a material (from the library or your own CIF), an absorbing atom and an edge.
2. The platform builds the problem. It shows the cluster around the absorber in 3D from real coordinates, the embedding, an active space with its orbitals drawn on the atoms, the Hamiltonian, the dipole operator and the initial state. Each step is explained and can be changed.
3. Compute. Small active spaces run at once as exact emulations of the quantum algorithm, so you watch the Hadamard test signal build up and the spectrum appear with its shot noise. Larger ones run on a workstation GPU or as a hosted job. The same circuits can be exported for hardware.
4. Estimate. Qubits, Toffolis, shots and runtime on chosen hardware generations, and the classical cost of the same answer.
5. Measure. Send the computed spectrum to the soft X ray twin to see what a scan would show at a given resolution, dwell and dose.
6. Compare. Load measured data, align and broaden, fit candidates or mixtures, and rank hypotheses with uncertainty.
7. Report. A shareable, hashed report of the spectra, assumptions, estimates and fits.

## 6. Architecture

* **Problem builder** (Python, PySCF and PennyLane `qchem`). CIF, then cluster (restored `make-clusters.py`), then embedding (point charges first), then AVAS active spaces at several sizes, then core valence separated integrals and dipoles, then the initial state (CASCI when small, DMRG with block2 when medium, sum of Slater determinants for loading). The output is an instance file with an FCIDUMP export and a hash.
* **Algorithm engine.**
  * A TypeScript statevector emulator in a Web Worker for about 14 to 16 qubits (7 to 8 orbitals), for instant interactive runs. It shares test instances with the Python engine.
  * A Python engine following `tutorial_xas` on `lightning.qubit` or `lightning.gpu`, for about 25 to 30 qubits on a GPU workstation.
  * Hardware adapters through PennyLane plugins (IBM, IonQ, Amazon Braket, Xanadu) for tiny demos.
* **Resource estimator.** `pennylane.estimator` with `CDFHamiltonian` and `TrotterCDF`, hardware profiles and the paper's runtime model, with regression tests against the paper's Table I.
* **Classical references.** FCI and CASCI (PySCF), selected CI or DMRG (block2) where feasible, TDDFT with core valence separation for context, and the FEFF10 near edges already in the repo.
* **Twin extension.** A soft X ray beamline profile, and computed spectra as sample models with the provenance "computed, quantum algorithm, emulated".
* **Comparison.** Alignment, broadening, linear combination fits and metrics, reusing the existing reduction code.
* **Delivery.** The static site and desktop app for interactive use and small runs, a Python package and CLI for heavy runs, MCP tools for AI agents (on top of the hosted MCP step), and later an optional hosted job runner.

## 7. Build plan

Each phase ends in a release with notes, as now.

| Phase | Weeks | Work | Done when |
| --- | --- | --- | --- |
| 0. Decisions and setup | 1 | Name, public or private engine, compute budget, first target. Pinned Python environment (PennyLane, PySCF, block2) and Python tests back in CI. | The environment rebuilds from its lockfile and CI is green. |
| 1. Reproduce the papers | 2 to 4 | `tutorial_xas` on N₂ (11 qubits) against CASCI; the paper's N₂ CAS(14e,10o) benchmark against full CI (its Fig. 8); the Li Mn O CAS(14e,11o) core excited convergence (Fig. 9); Table I through `pennylane.estimator`. | Peak positions and weights agree with full CI within a stated tolerance, and resource numbers fall within 10 percent of Table I. Written up in `docs/QUANTUM_REPRO.md`. |
| 2. Problem builder and instance library | 5 to 8 | Oxygen K edge clusters of Li₂MnO₃ and delithiated variants, MnO, Mn₂O₃, MnO₂, LiMn₂O₄ and NiO; gas phase benchmarks with published experimental spectra (N₂, CO, H₂O, NH₃) after a license check; each at 2 to 4 active space sizes. | Energies match CASCI or DMRG, hashes are stable, and unit tests cover every builder step. |
| 3. Compute in the platform | 9 to 12 | Browser emulator and Python engine; a Quantum section in the site with the 3D cluster and orbitals, the active space chooser, runs, and the spectrum against its classical reference with uncertainty; Methods page rows for every quantum model and its tests. | Browser and Python agree to 10⁻⁶ on shared instances, browser tests pass, and the page meets its JavaScript budget. |
| 4. Estimates and readiness report | 13 to 14 | Estimator UI and report; hardware profiles (Starling class, active volume at 1 MHz, user defined); a classical crossover chart, labelled rough. | Table I regression passes, and every number in a report reproduces from its hash. |
| 5. Soft X ray twin and the comparison loop | 15 to 18 | Grating monochromator, total electron and fluorescence yield, vacuum and dose for the oxygen K and Mn L edges; computed spectra as twin samples; fitting and hypothesis ranking against measured data. | A simulated measurement of a known spectrum recovers it within noise, synthetic mixtures are recovered, and measured references are reproduced. |
| 6. Agents and SDK | 19 to 20 | MCP tools (`quantum_build`, `quantum_estimate`, `quantum_emulate`, `quantum_compare`) and a Python package. | Tool tests pass and the docs show each tool working. |
| 7. Validation study and pilots | 21 to 26 | Computed against measured on the benchmark set, written up openly; pilots with one battery group, one beamline and one quantum algorithms group. | The report is public and each pilot has given written feedback. |

Research tracks alongside. Hardware demos on tiny instances with error mitigation, always labelled as demos. L edges with spin orbit coupling (X2C, the 2p core in the active space). RIXS and EELS from the same instances. Better embedding, ideally with partners.

## 8. What the platform will never claim

* Quantum advantage before hardware shows it. Until fault tolerant machines exist, spectra are classical emulations of a quantum algorithm (exact for small active spaces) plus resource estimates, and the page says so.
* That its numbers are free of model error. Cluster and embedding errors, the core valence separation (0.1 to 1 eV), the basis set, missing spin orbit coupling (needed for L edges) and vibronic effects are stated on every result.
* Absolute energies without alignment. Every spectrum shows the shift applied and how it was chosen.
* That classical methods lose. Baselines are run in good faith and reported, including when they win.

## 9. Risks

* **Hardware arrives late.** The product still earns its keep through planning, estimates and exact spectra for small clusters.
* **Classical methods improve** (DMRG, selected CI, tensor networks, machine learning). The benchmark set tracks where the line moves, which is useful in itself.
* **Xanadu or a large company builds a similar front end.** Move fast on the user side (instrument, data, interpretation) and partner with PennyLane rather than compete. The instance library and benchmark data become the moat.
* **Data licenses for measured spectra.** Use openly licensed data, or partner data under agreement.
* **Emulation stops near 30 qubits.** Large instances can only be checked through estimates and error extrapolation, and the platform states that.

## 10. Decisions needed from you

1. Where it lives. Inside this site with the twin (recommended), or as a separate product.
2. Public or private. The repository is public and MIT licensed. Keep the plan and engine public (academic credibility and an open benchmark), or keep the engine private (commercial).
3. First target. The oxygen K edge of lithium rich Mn oxides (follows the papers and the battery industry, recommended), Mn L edges (harder, needs spin orbit), or small molecules only.
4. Compute. A GPU workstation or cloud budget for 20 to 30 qubit emulation. Hardware runs cost money and need your accounts.

## Sources

* Fomichev, Hejazi et al. 2024, https://arxiv.org/abs/2405.11015
* Fomichev, Casares et al. 2025, https://arxiv.org/abs/2506.15784
* Kunitsa, Dhawan, Fomichev et al. 2025 (EELS), https://arxiv.org/abs/2508.15935
* Loaiza, Kunitsa, Fomichev et al. 2026 (RIXS), https://arxiv.org/abs/2602.20270
* PennyLane demo, XAS in the time domain, https://pennylane.ai/demos/tutorial_xas
* PennyLane demo, resource estimation for spectroscopy, https://pennylane.ai/demos/tutorial_resource_estimation_spectroscopy
* Xanadu ARPA E award, https://quantumcomputingreport.com/xanadu-awarded-2-0m-arpa-e-grant-for-quantum-battery-research/
* IBM fault tolerant roadmap (Starling, Blue Jay), https://www.allaboutcircuits.com/news/ibm-charts-roadmap-to-first-practical-fault-tolerant-quantum-computer/
* Trapped O₂ and voltage fade, Nature Materials 2024, https://www.nature.com/articles/s41563-024-01833-z.pdf
* The beam damage and NMC811 objections, https://data.isis.stfc.ac.uk/doi/STUDY/136303280/ and https://pubs.rsc.org/en/content/articlehtml/2026/ta/d5ta07689g
* L edge theory, charge transfer multiplets versus restricted active space, https://www.osti.gov/biblio/22308224-restricted-active-space-calculations-edge-ray-absorption-spectra-from-molecular-orbitals-multiplet-states and https://arxiv.org/pdf/1803.01067
