# Quantum XAS, step 4: the cost on a fault tolerant quantum computer

Phase 4 of [PLAN-quantum.md](PLAN-quantum.md). For every problem in the library, the Quantum XAS page now says what the algorithm would need on a fault tolerant machine, which announced machine generations could run it, how long it would take, and what the same answer costs classically, with a readiness report to download.

## How the numbers are made

`scripts/quantum/estimates.py` runs PennyLane's resource estimator with the circuit model of the paper's Table I, which this engine reproduces within 5 percent from 14 orbitals up ([QUANTUM_REPRO.md](QUANTUM_REPRO.md)): sum of Slaters state preparation (10⁴ determinants), a controlled second order Trotter evolution of the compressed double factorized Hamiltonian with L = N fragments, rotations to 10⁻³, η = 0.05 Ha, j_max = 100, a Trotter step of √(η / 1 Ha), α = 1.3384 and 2,500 shots per direction. Logical qubits follow the paper's Eq. 40 and the whole spectrum its Eq. 32. Results are in `src/data/quantum/estimates.json`; every row names its instance hash, and `scripts/quantum/test_estimates.py` recomputes rows and checks they come back the same.

## What they say

| Problem | Orbitals | Logical qubits | Toffolis, longest circuit | Toffolis, whole spectrum | Fits Starling class | Fits Blue Jay class |
| --- | --- | --- | --- | --- | --- | --- |
| Water | 7 | 78 | 1.6×10⁷ | 2.5×10¹⁰ | yes | yes |
| Carbon monoxide | 10 | 84 | 4.8×10⁷ | 7.4×10¹⁰ | yes | yes |
| Li₂MnO₃ clusters | 11 | 86 | 6.5×10⁷ | 9.9×10¹⁰ | yes | yes |
| The papers' full space | 18 | 100 | 3.0×10⁸ | 4.5×10¹¹ | no, the longest circuit is too long | yes |

* **The 11 orbital cathode clusters fit the first announced fault tolerant generation.** IBM's Starling class (200 logical qubits and 10⁸ gates, announced for 2029) holds their 86 qubits and 6.5×10⁷ Toffoli longest circuit. The papers' 18 orbital problem needs the next generation (Blue Jay class, 2,000 logical qubits and 10⁹ gates, announced for 2033).
* **At these small sizes classical computing still wins.** The paper's own classical model costs about 40 minutes at 11 orbitals, and the exact references in the library took minutes on an ordinary PC; the quantum algorithm would take about 5 hours on the active volume layout. The curves cross near 14 orbitals, as the paper found; at 18 orbitals the classical model needs about 32 days and the quantum algorithm under a day.

## What the numbers are not

* Machine generations are vendor targets, not machines that exist. A fit counts Toffoli gates against the announced gate budget and ignores all other gates, so it is optimistic.
* Run time is given at a logical clock of 1 MHz, once one Toffoli after another and once on the paper's active volume layout, scaled from the paper's own 18 orbital figures (8.1×10¹⁰ logical cycles for 4.58×10¹¹ Toffolis).
* The classical curve is the paper's rough model of a restricted active space calculation, which the paper calls optimistic; better classical methods (DMRG, selected CI) would move the crossover.
* "Your machine" on the page takes logical qubits, a gate budget per circuit and a Toffoli rate and applies the same rules.
