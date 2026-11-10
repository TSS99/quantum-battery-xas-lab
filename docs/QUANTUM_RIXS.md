# Quantum XAS, step 9: resonant inelastic X-ray scattering

Phase 9, added to [PLAN-quantum.md](PLAN-quantum.md) on 6 November 2026 by the owner's choice from its research tracks. It follows Loaiza, Kunitsa, Fomichev, Motlagh, Dhawan, Jahangiri, Fuglsbjerg, Izmaylov, Wiebe, Abu-Lebdeh, Arrazola and Delgado, *Quantum algorithm for simulating resonant inelastic X-ray scattering in battery materials*, [arXiv 2602.20270](https://arxiv.org/abs/2602.20270) (2026), with the PennyLane demo [Quantum algorithm for simulating resonant inelastic X-ray scattering](https://pennylane.ai/demos/simulating_resonant_inelastic_x_ray_scattering). At the oxygen K edge of lithium rich cathodes, RIXS is how oxygen redox and trapped O₂ are read, which is why the paper and this phase start there.

## What it computes

A photon of energy ω_I and polarization a is absorbed at a core resonance, a photon of polarization b leaves, and the sample is left in a valence state F with the energy loss ω = E_F − E_I. In the Kramers–Heisenberg form of the paper (its Eqs. 6 to 8)

P_ab(ω_I, ω) = Σ_F |⟨F|R_ab|I⟩|² δ(ω − ω_F),  R_ab = m_b G(ω_I) m_a,  G(ω_I) = 1 / (ω_I − (H − E_I) + iΓ),

with the core hole's half width Γ = 0.3 eV, the paper's. With core valence separation m_a|I⟩ has one core hole, G keeps it there, and m_b fills it again.

* **Exact reference** (`scripts/quantum/qxas/rixs.py`). G(ω_I) m_a|I⟩ comes from the Lanczos tridiagonal of m_a|I⟩ among the core-excited states (300 steps), and the spectrum of m_b G m_a|I⟩ from a second Lanczos among the valence states, on its real and imaginary parts. The valence Lanczos runs with the core orbital frozen doubly occupied, a third of the determinants for the clusters.
* **Powders.** A randomly oriented sample needs three invariants of R for each final state, as two-photon absorption does (McClain 1971): |tr R|², Σ|R_ab|² and Σ R_ab R_ba*. Parallel polarizations give their sum over 15, crossed ones (4 Σ|R_ab|² − |tr R|² − Σ R_ab R_ba*) / 30, and parallel plus twice crossed is the isotropic Σ|R_ab|² / 3. Thirteen Lanczos runs per incident energy give every oriented pair and both powders.
* **Final states keep a full core.** CVS keeps the integrals with two core indices, so the whole Hamiltonian couples a full core to doubly core-ionized determinants: the library's initial state, the lowest state projected onto a full core, has a part of norm about 0.03 there. That is nothing for XAS, whose states keep one hole, but RIXS returns to a full core. So its final states are those of P0 H P0, the Hamiltonian among determinants with a full core, and its initial state is the lowest of them; with the whole Hamiltonian instead, every level would shift by about 0.7 meV and the check against a sum over every eigenstate would fail at a few parts in a thousand.
* **As the algorithm reads it.** Phase estimation reads each loss with an error; the paper sizes it for ε = 0.2 eV. The stored maps spread every loss by a normal distribution of that width and count it in 0.2 eV bins, the paper's histogram, so the page draws samples from any row. The elastic line, final states within 50 meV of the initial one, is kept apart: for the Mn pairs it takes in the spin states of the pair that sit a few meV apart.

## The algorithm, block by block

The paper prepares R_ab|I⟩/|R| with a block encoding and samples ω_F from it by phase estimation of the qubitized walk:

* **The Green's function.** Γ G(ω_I) is a Chebyshev polynomial of degree K_G in H/λ, applied by generalized QSP on the walk (its Eqs. 28 and 29). The paper fits K_G = λ (472 + 91 ln λ) for Γ = 0.3 eV. Here λ is the double factorized one-norm of each problem's own integrals, a stand-in for the paper's tensor hypercontraction, and `chebyshev_green` applies that polynomial in the eigenbasis of the core-excited states, which is what the circuit does to them.
* **The block encoding** succeeds with probability P_R = (Γ |R| / (λ_D |m_a I|))² (Eq. 31), with λ_D the one-norm of the dipole matrix, and K_A = ⌊π / (4 arcsin √P_R)⌋ rounds of amplitude amplification lift it (Eq. 32). The paper takes K_A = 13 from √P_R ≈ 0.06; here P_R is computed for every problem, geometry and incident energy.
* **Phase estimation** samples ω_F with probability |⟨F|R|I⟩|²/|R|², the elastic line and losses outside the window included.
* **Cost** (`qxas/resources.py`, `rixs_cost`). A sample is [(2K_A + 1) 2K_G + 2^n_ω] walk calls (Eq. 38), the walk costed by PennyLane's estimator for a tensor hypercontracted Hamiltonian of rank 3N with 13 bit coefficients and rotations, and n_ω phase bits for N(ε) = ⌈πλ/(√2 ε)⌉ walk calls. Logical qubits follow Eq. 37.
* **The paper's Table 1 comes back.** From its own orbitals and one-norms (16 to 30 orbitals of MnO₇H₆), this model gives 3 to 6 % fewer Toffolis than the paper, which counts "up to subdominant factors", and 2 to 4 % fewer logical qubits (`rixs_paper` in `src/data/quantum/estimates.json`).

## What it shows

Each problem at the incident energy where it scatters most (Σ_ab |R_ab|² largest), from the stored maps through the page's own code; strongest inelastic loss for a powder, the elastic line's share of the samples, the block encoding's success probability, and the Toffolis of one sample with that many rounds:

| Problem | Incident | Parallel | Crossed | Elastic line | P_R | K_A | Toffolis per sample |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Water | 544.44 eV (2b2) | 14.8 eV | 14.8 eV | 63 % | 7.3 % | 2 | 5.5×10⁸ |
| CO | 540.10 eV (π*) | 11.4 eV | 11.4 eV | 51 % | 11 % | 2 | 1.3×10⁹ |
| Li₂MnO₃, O2 site | 562.08 eV | 2.2 eV | 2.2 eV | 25 % | 5.6 % | 3 | 1.4×10⁹ |
| Li₂MnO₃, O1 site | 562.42 eV | 2.0 eV | 2.0 eV | 28 % | 6.1 % | 3 | 1.4×10⁹ |
| Li₃Mn₂O, one lithium removed | 557.51 eV | 16.0 eV | 16.0 eV | 63 % | 10 % | 2 | 9.7×10⁸ |
| Li₂Mn₂O, two lithium removed | 561.02 eV | 16.8 eV | 2.2 eV | 24 % | 7.3 % | 2 | 1.0×10⁹ |

* **The molecules follow their selection rules.** With crossed polarizations along different symmetry axes (water: in along y, out along z; CO: in across the bond, out along it) the elastic line is gone, since the final state then has the symmetry of the pair of axes and never that of the ground state.
* **Lithium leaving changes the scattering, not just the edge.** Both sites of the full crystal scatter most into a band near 2 eV, with a second band at 12 to 18 eV about two thirds as strong. With one lithium removed the strongest incident energy moves 4.6 eV down, to the new low oxygen resonance that EELS also shows, and there the 2 eV band falls to 5 % of the peak and the loss is at 16 eV. With two removed the 2 eV band is back at 44 % of a 16.8 eV peak, and with crossed polarizations it is the strongest again.
* **The block encoding succeeds far more often than the paper assumes.** P_R is 5.6 to 11 % for the powders at their strongest incident energy, so 2 or 3 rounds of amplification do, not 13. A sample then costs 4 to 5 times fewer Toffolis than the paper's K_A gives (5.3×10⁹ for the O2 site at K_A = 13). The 18 orbital problem has no exact reference, so its P_R is unknown; at the paper's K_A a sample is 1.5×10¹⁰ Toffolis on 371 logical qubits.
* **The polynomial is good enough here too.** At the paper's degree (45,000 to 81,000 for these one-norms) it moves the spectrum by at most 2.6×10⁻⁴ of its peak (Li₃Mn₂O), and by 8×10⁻⁶ for CO.
* **Samples, not the polynomial, set the accuracy.** With the paper's 2,000 samples the drawn spectrum is 9 to 16 % of the peak away from the exact one on average over 20 seeds and finds the strongest loss in 14 to 20 of them; 10,000 samples bring it to 4 to 7 % and find it every time, 100,000 to 1 to 2 %.
* **The clusters' valence states are dense.** About 30,000 of them lie within 25 eV of the initial state, so at 0.2 eV a spectrum needs 1,000 Lanczos steps: at 150 a powder spectrum still moves by half its peak when the steps double, at 600 it is within 0.2 % of 3,000 steps. Each cluster took 35 to 77 minutes here on 12 to 22 one thread processes.

## Checks

`scripts/quantum/test_rixs.py`: on water, the Krylov reference equals the Kramers–Heisenberg sum over every eigenstate of both sectors to 10⁻⁸ for every geometry; the powder formulas equal the average over orientations, by a quadrature exact for them, to 10⁻⁹, and parallel plus twice crossed is the isotropic sum; crossed polarizations along y and z leave no elastic line; the shift of the polynomial is the trace of H over the whole Fock space, the spectrum fits inside its interval, and at the paper's degree it matches Γ G within 10⁻³ at every core-excited state; the stored data name the current instances and the stored water data recompute. `scripts/quantum/test_estimates.py` reruns the paper's Table 1. `src/lib/quantum/rixs.test.ts` holds the browser code to the Python check values, the powder maps to the oriented ones, the samples to the exact rows, and K_A to the paper's 13 at √P_R = 0.06; `src/cli/quantum-tools.test.ts` covers `quantum_rixs` and `tests/quantum.spec.ts` the page.

## What is not done

* **Gate by gate.** The polynomial is applied in the eigenbasis of the core-excited states, which is what the circuit does when its QSP angles are exact; the walk, the angles and the dipole block encoding are not run as gates.
* **Phase estimation's line shape.** A readout is spread by a normal distribution of the paper's 0.2 eV; the Kaiser window of its Sec. III and the arccos map of the walk's phases are not modelled.
* **The paper's own cluster.** Its MnO₇H₆ model, an O–O dimer on Mn cut from a charged cathode, is not in the library; its coordinates are not in the paper's text. Its Table 1 is reproduced from its one-norms instead.
* **Vibrations and measured spectra.** The models are electronic only, so the vibrational progression of trapped O₂ is missing, and comparing with measured RIXS waits for openly licensed data, as XAS does.
