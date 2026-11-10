# Quantum XAS, step 10: Mn L edges with spin orbit coupling

Phase 10, added to [PLAN-quantum.md](PLAN-quantum.md) on 6 November 2026 by the owner's choice from its research tracks. The L edges are where battery groups read manganese: a 2p electron goes into the 3d shell, and the 2p hole splits by spin orbit coupling into 2p₃/₂ and 2p₁/₂, so the edge comes as L₃ and, about 11 eV higher, L₂. No quantum algorithm paper treats L edges yet; the time domain algorithm of the oxygen K edge carries over once the Hamiltonian holds spin orbit coupling, which makes it complex and breaks the spin symmetry. This step builds that.

## The model

* **Spin orbitals** (`scripts/quantum/qxas/spinor.py`). Orbitals from a spin free X2C ROHF, the Mn 2p and 3d shells active (8 orbitals, 16 spin orbitals, which are the qubits), everything else frozen. Spin orbit coupling is the spin dependent remainder of PySCF's one electron X2C Hamiltonian; the screening by the other electrons (the two electron spin orbit terms) is left out. Two electron integrals are the spin free Coulomb ones.
* **Core valence separation** keeps each sector of 2p holes apart. With three 2p orbitals the parity rule of the K edges is not enough (a term can empty two more 2p spin orbitals at once), so each sector's own block of H is used, as RIXS does for its final states.
* **Three oxidation states in crystal fields.** The Mn ion with the six oxygens as point charges of −2: Mn²⁺ (d⁵) in a regular octahedron at 2.222 Å as in MnO; Mn³⁺ (d⁴) in an octahedron elongated as Jahn–Teller makes it, 4 × 1.93 and 2 × 2.27 Å, whose mean is the 2.045 Å sum of Shannon's ionic radii; Mn⁴⁺ (d³) in the octahedron of Li₂MnO₃ (1.904 to 1.919 Å, COD 1008373). cc-pVDZ-DK basis.
* **Orbitals that come back.** An open d shell in a crystal field has several ROHF solutions, and for Mn²⁺ in point charges the lowest even moves an electron into 4s. The builder tries a fixed set of starts and keeps the lowest solution with the right number of 3d electrons, so every run gives the same orbitals (two runs agree to 10⁻⁸ in the stick weights).
* **The spectrum** is Boltzmann weighted at 300 K over the low states (the ground multiplets split by meV), summed over x, y and z, and broadened by a Lorentzian of 0.3 eV.
* **The algorithm.** The same Hadamard tests read G(t) = ⟨m I|e^{−iHt}|m I⟩ for the complex Hamiltonian, here with second order product formula steps that split H into its one and two electron parts, 8 per time point (τ = 3/Ha, 140 points). The page draws shots on that signal and rebuilds the spectrum as for the oxygen K edge. The cost is the oxygen K edge model's at 8 orbitals and this resolution: 80 logical qubits and about 3×10¹¹ Toffolis for the whole spectrum.

## What it shows

| State | L₃ centroid | L₂ above L₃ | L₃ share | Edge without spin orbit coupling | Product formula error |
| --- | --- | --- | --- | --- | --- |
| Mn²⁺, octahedral (MnO) | 652.32 eV | 11.58 eV | 76.5 % | one edge, centroid 655.17 eV | 0.2 % of G(0) |
| Mn³⁺, octahedral, Jahn–Teller | 655.07 eV | 10.80 eV | 68.6 % | one edge, centroid 658.61 eV | 0.7 % |
| Mn⁴⁺ in Li₂MnO₃ | 659.22 eV | 10.42 eV | 61.5 % | one edge, centroid 663.41 eV | 0.8 % |

* **Spin orbit coupling makes the L edge.** Switched off, the same model gives one 2p edge between where L₃ and L₂ would be. Switched on, it splits by 10.4 to 11.6 eV, within 6 % of the 11 eV of the manganese 2p levels (11.2 eV between 2p₃/₂ and 2p₁/₂ in the metal's photoemission). Leaving out the screening is the main error left in that number.
* **The trends across manganese oxides come out.** L₃ moves up and its share of the intensity falls as the valence rises, both as measured (Qiao et al. 2013, [arXiv 1208.6319](https://arxiv.org/abs/1208.6319)); d⁵ keeps the largest L₃ share, as high spin d⁵ does.
* **What the crystal field leaves out.** Absolute energies sit some 10 eV above experiment, as for the oxygen K edge models, and the steps between the oxidation states (2.8 and 4.2 eV) are larger than measured. Point charges give a crystal field without covalency, so the charge on the manganese is not screened by its oxygens. Phase 12 brings the oxygens in.
* **The algorithm reads it.** With 10⁸ shots the rebuilt edge is within 5 % of the exact one and its strongest peak within 0.3 eV; what remains is the product formula, under 1 % of G(0) with spin orbit coupling and up to 3.5 % without.

## Checks

`scripts/quantum/test_ledge.py`: with spin orbit coupling off, the spin orbital Hamiltonian has no spin flips and its lowest level equals PySCF's spin free CI on the same integrals to 10⁻⁸ Ha; L₃ and L₂ split within 7 % of 11 eV, L₃ first and with the larger share; the states come in the measured order of L₃ and of L₃ share, each on orbitals with its own number of 3d electrons; the stored Mn⁴⁺ edge recomputes to 10⁻⁶ of its peak, and its product formula error falls by more than three times when the steps double. `src/lib/quantum/ledge.test.ts` holds the browser code to the Python values and the rebuilt edge to the exact one; `src/cli/quantum-tools.test.ts` covers `quantum_ledge` and `tests/quantum.spec.ts` the page.

## What is not done

* **Covalency and charge transfer.** The oxygens as atoms (with their 2p orbitals in the active space), embedded in the crystal: Phase 12.
* **The two electron spin orbit terms.** A mean field correction (as in X2C atomic mean field) would bring the splitting closer.
* **Gate by gate.** The product formula runs in the determinant basis with dense step propagators, not as the circuit's gates, and the cost reuses the oxygen K edge model.
* **Measured spectra** wait for openly licensed data, as the other edges do.
