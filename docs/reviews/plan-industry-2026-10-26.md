# Review of the industry plan, 2026-10-26

Written by GPT (gpt-5.6-sol through the Codex CLI, read only) on the first draft of the education and industry plan. The second draft took its corrections.

## A. Eight adoption gaps

1. **Facility-calibrated feasibility model** [R&D, liaison]. Task: replace generic flux/time claims with versioned, facility-supplied profiles covering optics, detector geometry, overheads, flux decay and operating limits. Acceptance: blinded measured scans from ≥3 beamline classes; ≥90% of observed acquisition times fall inside the stated 90% prediction interval; the tool abstains outside its validated domain.

2. **Raw-channel ingestion and measurement QC** [liaison, QA]. Task: ingest energy/encoder, I0/It/Iref/fluorescence channels, dwell time, timestamps, ring current and detector metadata; add saturation, pinhole, glitches, energy drift, scan-to-scan reproducibility and normalization diagnostics. Acceptance: five public beamline datasets import without manual column surgery; expert-labelled defects are detected; raw values and metadata survive export unchanged.

3. **Validation of quantitative XANES claims** [QA]. Task: define each intended use—screening, estimating phase fraction, or reporting a specification—and validate with matrix-matched blind mixtures, replicates, days and instruments. Acceptance: predefined bias, precision, selectivity and reportable-range criteria are met; DL/QL are confirmed near their limits, consistent with [ICH Q2(R2)](https://database.ich.org/sites/default/files/ICH_Q2%28R2%29_Guideline_2023_1130_ErrorCorrection_2025.pdf).

4. **Reference-standard governance** [R&D, QA]. Task: record provenance, preparation, matrix, temperature, mode, resolution, energy calibration, normalization, licence and allowed use for every standard; warn on incompatible conditions. Acceptance: LCF cannot enter “quantitative” mode unless required metadata and compatibility checks pass; altered or unlicensed files are rejected or clearly quarantined.

5. **Operando time-axis integrity** [R&D, liaison]. Task: preserve scan start/mid/end time, trigger, electrochemical state, cycle, temperature and gas conditions; model sequential-scan time smearing and missing/repeated scans. Acceptance: synchronized electrochemistry/XAS fixtures reconstruct correctly, and the report distinguishes measured time resolution from plot sampling.

6. **EXAFS model-adequacy workflow** [liaison, instructor]. Task: expose independent-points count, parameter correlations, S0²–coordination-number coupling, path provenance, multi-start stability and sensitivity to k/R ranges and windows. Acceptance: deliberately underdetermined fits are blocked; blind materials recover defensible ranges rather than merely matching Larch output.

7. **Real beamline and sample-environment handoff** [R&D, liaison]. Task: add facility-editable constraints for windows, cryostats, reactors, pouch cells, hazardous samples, available detectors, edge accessibility, proposal lead time and setup overhead. Acceptance: two liaison scientists can turn reports into executable setups without correcting hidden geometry or safety assumptions.

8. **Controlled deployment and lifecycle package** [QA]. Task: add signed installers/containers, SBOM, dependency pinning, vulnerability/change control, backup/restore, role assumptions, URS–risk–test traceability and IQ/OQ/PQ templates. Acceptance: an independent QA reviewer traces every intended-use requirement to evidence and verifies a release upgrade without invalidating retained records.

## B. Wrong, overclaimed or risky

1. “XAS answers oxidation state, neighbours, amount of each species and works on any element inside real devices” is too broad. Oxidation state and species fraction are model/reference-dependent; accessible edges, attenuation, concentration, vacuum, edge overlap and device windows impose hard exclusions.

2. LCF is not intrinsically quantitative. Normalization, pinholes, over-absorption, dead time and missing standards can bias fractions without being diagnosed by the fit; Larch explicitly warns about these limitations. “[Within 0.5% of Larch](https://xraypy.github.io/xraylarch/xafs_xanes.html)” demonstrates implementation parity, not trueness.

3. LCF coefficient standard errors are not detection limits or full uncertainty. They omit reference mismatch, preprocessing choices, energy alignment and correlated standards. “Cr(VI) detection limit stated” is unsafe without matrix-matched blanks, low-level replicates and confirmed DL/QL.

4. PCA cannot identify chemical species or establish the true number of phases by itself. Define the exact IND statistic and pinned Larch version; the documented Larch PCA outputs do not by themselves validate chemical interpretation.

5. Coordination number is not a direct particle-size measurement. It is correlated with S0², disorder, path degeneracy and structural model. “Pt particle size from coordination number” should be “size-model inference under stated morphology assumptions.”

6. “Uncertainties scaled like Larch” is inadequate. Larch/lmfit standard errors are conditional on the selected model and may fail near bounds; systematic and model-selection uncertainty remain outside them. [Larch documents this boundary problem](https://xraypy.github.io/xraylarch/fitting_parameters.html).

7. A time estimate “within 20% of a simulated acquisition” is circular validation. Beamline flux, overheads, drift, detector geometry and sample variability require measured external benchmarks and prediction intervals.

8. Edge-step-one recipes are not universally optimal. Concentrated absorbers, fluorescence samples, heterogeneous pellets, pinholes and self-absorption require different objectives; BN/cellulose dilution can also alter packing and chemistry.

9. H7’s “packets stop at the first surface” is physically wrong for X-rays; interaction is probabilistic and energy/material/thickness-dependent. Compton energy depends on scattering angle, and fluorescence requires shell-specific line branching, not merely Kα/Kβ colouring.

10. A locally appended log plus WebCrypto signature is not an immutable audit trail, trusted identity, trusted timestamp or electronic signature. FDA-regulated use additionally involves authorized access, authority checks, documentation controls and accountable signatures. [FDA Part 11 guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/part-11-electronic-records-electronic-signatures-scope-and-application) supports risk-based validation; it does not make client-side signing compliant.

11. “Validation package” should be called a **supplier evidence package**. Validation is performed for a defined intended use and configured environment; test counts and GPT review cannot establish fitness for a regulated laboratory.

12. Licensing is oversimplified. XrayDB code is MIT, while specified database/documentation files are CC0 “to the extent possible and unless otherwise stated” ([XrayDB licensing](https://xraypy.github.io/XrayDB/installation.html)). Larch is MIT and redistributes Feff6L/8L by permission, but full FEFF distributions have separate licensing ([Larch](https://xraypy.github.io/xraylarch/), [FEFF notice](https://feff.phys.washington.edu/feff/Docs/feff8/feff82.pdf)). Do not state blanket “FEFF” or “Materials Project CC BY”; MP includes differently licensed subsets such as BY-NC GNoME data, and its XAS is computed FEFF output, not measured reference spectra ([MP XAS methodology](https://docs.materialsproject.org/methodology/materials-methodology/x-ray-absorption-spectra), [MP database notes](https://docs.materialsproject.org/changes/database-versions)).

13. NXxas support will not mean universal NeXus compatibility; beamlines use facility-specific groups and metadata. Athena `.prj` round-trip also needs a declared supported-version and loss model.

14. URL-encoded plans can expose proprietary compositions through browser history, copied links or support records. “Nothing uploaded” and “shareable link” need a threat model and an explicit statement of exactly what the link contains.

15. “Network silence after load” does not prove confidentiality of the hosted first load, build chain or updates. Signed offline artifacts, reproducible builds and dependency review are separate controls.

16. Red should not denote a closed shutter or other safe closed state. Safety colour and interlock semantics must follow the selected facility convention; a cutaway hutch with beam enabled must never imply personnel access.

## C. Priority changes and first three releases

1. Move **B7, raw formats and QC** ahead of LCF/PCA: bad alignment, saturation or normalization makes every later fraction meaningless.

2. Move **measured facility benchmarking and external liaison review** ahead of the feasibility report. Literature and simulation alone cannot support go/no-go or beamtime estimates.

3. Build **C1/C2 provenance and reproduction** concurrently with B1, not afterward; analysis architecture should capture provenance from its first release.

4. Move **C5/C6, signed offline distribution and basic supply-chain evidence** earlier; confidentiality is an entry criterion for proprietary samples.

5. Keep only H1/H2 mobile and clutter fixes early. Move hardware-detail modelling, HDRI, video export, photon fly-through and most of H4–H12 later; they do not validate a single industrial result.

6. Move certificates, SCORM, live MCP and instructor authoring later. Move measured-data teaching cases earlier.

7. Keep the lab-source twin late until one instrument maker supplies benchmark data. A generic model risks misleading purchasing and feasibility decisions.

8. **v1.8 — Data trust foundation:** raw-channel import; XDI plus 2–3 beamline adapters; alignment/merge/QC; provenance; network/data-handling statement; signed offline bundle; minimal H1/H2 fixes.

9. **v1.9 — Calibrated feasibility pilot:** A1–A9 using uncertainty ranges and abstention; measured benchmarks; device-stack/sample-environment constraints; report reviewed through two liaison-led pilot cases.

10. **v2.0 — Defensible XANES series:** LCF/PCA/operando batch; standard-compatibility checks; sensitivity/bootstrap analysis; blind-mixture validation; self-contained report and pinned Larch reproduction script.

## D. Five first-five-minute attention features

1. Drop a real beamline file or operando folder and immediately see channel mapping, metadata, drift, saturation, glitches and scan-quality flags.

2. Enter a pouch-cell/reactor stack and obtain a facility-specific feasibility range for edge step, count rate, time resolution, dose and total beamtime—with explicit unknowns.

3. Run batch LCF with reference-compatibility warnings, residuals, alternative models and sensitivity bands rather than a single authoritative percentage.

4. Produce a one-click offline report containing raw-file hashes, preprocessing history, plots, assumptions and a runnable pinned Larch script.

5. Show an offline signed deployment, network-request proof and exact data-flow diagram before proprietary data are opened.

## E. Education-plan risks

1. Synthetic data generated by the same forward model creates an “inverse crime”: students may learn that fits are cleaner and more identifiable than measured XAS. Include real drift, glitches, pinholes, self-absorption, beam damage and missing-standard cases.

2. A generic beamtime-readiness certificate could be mistaken for facility safety authorization. State prominently that only facility training, search/interlock instruction and local approval authorize access.

3. Client-side hidden faults and answer keys are inspectable; local hashes prove file integrity, not learner identity, independent invigilation or competence.

4. Training currently rewards tool operation more than scientific judgement. Assess rejection of bad data, alternative explanations, parameter correlation and when XAS cannot answer the question.

5. “GPT plus a human” is insufficient item validation. Use multiple XAFS instructors, pilot-item statistics, ambiguity review and version control for numerical tolerances.

6. Operando lessons risk teaching spectra as instantaneous. Students must account for scan duration, state evolution during a scan and synchronization with electrochemistry.

7. Facility-neutral safety and sample-shipping guidance can conflict with local radiation, pressure, gas, chemical and radioactive-material rules.

8. A 3D-heavy curriculum risks excluding low-power devices, keyboard-only users and visually impaired learners; every spatial task needs an equivalent schematic/table workflow.

## F. Verdict

XAS Lab has a credible open educational core and a potentially valuable industrial front door, but the roadmap currently prioritizes visual polish and algorithm parity over measurement integrity, external calibration and fit-for-purpose evidence. Industry will pay attention when it can ingest ugly raw data, identify whether the measurement is trustworthy, make a facility-bounded feasibility estimate, quantify standards with honest limitations and reproduce the result offline. Build those capabilities around measured multi-facility benchmarks and explicit intended uses; describe the QA bundle as supplier evidence, not validation; sharply constrain the oxidation-state, fraction, particle-size and compliance language.