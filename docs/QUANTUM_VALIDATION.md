# Quantum XAS, step 7: computed against measured

Phase 7 of [PLAN-quantum.md](PLAN-quantum.md) asks for two things: the library's computed spectra set against measured ones and written up openly, and pilots with a battery group, a beamline and a quantum algorithms group. This page is the open write up so far. What waits on data licences and partners is at the end.

## Against published peak energies

Peak energies are facts and can be quoted with their source; measured spectra themselves need a licence. `scripts/quantum/validation.py` takes the peaks of each problem's exact spectrum (transitions above 2 % of the dipole weight, merged within 0.1 eV) and sets them against published measurements. The rows are in `src/data/quantum/validation.json`, on the Quantum XAS page under each problem, and checked by `scripts/quantum/test_validation.py`.

| Problem | Feature | Measured | This model | Difference | Source |
| --- | --- | --- | --- | --- | --- |
| Water, STO-3G | first peak, O 1s to 4a1 | 534.0 eV | 542.24 eV | +8.24 eV | Schirmer et al., Phys. Rev. A 47, 1136 (1993) |
| Water, STO-3G | spacing from 4a1 to 2b2 | 1.89 eV | 2.14 eV | +0.25 eV | the same |
| CO, STO-3G | first peak, O 1s to 2π* | 534.21 eV | 540.00 eV | +5.79 eV | Sodhi and Brion (1984), as quoted by Püttner et al., Phys. Rev. A 59, 3415 (1999) |

* **Absolute energies are 6 to 8 eV high for the molecules**, and about 30 eV high for the Li₂MnO₃ clusters ([QUANTUM_REPRO.md](QUANTUM_REPRO.md)). The orbitals are those of the ground state, frozen around the core hole, in a small basis; relaxing them around the hole is what lowers a core excitation, and these models leave it out. Every comparison on the page and in the tools therefore fits a shift, as the plan requires.
* **Spacings are much better.** Water's two valence peaks are 2.14 eV apart in the model and 1.89 eV in experiment, a 0.25 eV error, well below the 1.36 eV resolution of the quantum runs so far.
* **These are the exact answers of the models.** The quantum algorithm reproduces them (steps 1 to 3), so the differences above are model error, not algorithm error. Better models (larger basis, relaxed orbitals, bigger active spaces) cost more qubits and gates; step 4 says how many.

## Measured spectra: what is available

| Source | What it holds | Can it be used here? |
| --- | --- | --- |
| Li₂MnO₃ O K edge (Oishi et al., J. Mater. Chem. A 2016, and others) | Spectra in figures | No openly licensed data found |
| Oxford Research Archive, Ramesh 2024, [10.5287/ora-o84me8rd9](https://doi.org/10.5287/ora-o84me8rd9) | Measured and simulated O K edges of LiCoO₂, LiNiO₂ and monoclinic LiMnO₂ | Its terms allow one copy for private, non-commercial study, and no redistribution, unless the author grants more |
| McMaster gas phase core excitation database (Hitchcock) | Measured spectra of small molecules, water and CO among them | Needs the curator's permission; not asked yet |

The tools are ready for any of them: a measured spectrum loads on the page, where it never leaves the browser, or goes to `quantum_compare` as text, and is fitted with a free shift, broadening and background. A LiMnO₂ cluster to compare with the Oxford data can be built with `qxas build` from a recipe like the library's.

## Pilots

Each pilot would get the platform, a hashed problem built for its material or question, and the cost of answering it on fault tolerant hardware, and would give written feedback on what it got wrong.

* **A battery group** with O K edges of a Li rich cathode at several states of charge, to test whether the comparison tells delithiation stages apart as step 5 predicts.
* **A soft X-ray beamline** to check the beamline model (resolution, electron and fluorescence yield, saturation, dose) against its own numbers.
* **A quantum algorithms group** to review the emulator, the factorizations and the cost model, and the resolution finding of step 5.

None has been contacted. That, and the data licences above, are decisions for the owner of the project.
