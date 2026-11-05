# Quantum XAS, step 8: electron energy loss from the same problems

Phase 8, added to [PLAN-quantum.md](PLAN-quantum.md) on 4 November 2026 by the owner's choice from its research tracks. It follows Kunitsa, Dhawan, Fomichev, Arrazola, Zhang and Stetina, *Quantum Simulation of Electron Energy Loss Spectroscopy for Battery Materials*, [arXiv 2508.15935](https://arxiv.org/abs/2508.15935) (2025), which takes the time domain algorithm of the XAS papers to core loss EELS and runs it on the oxygen K edge of Li₂MnO₃.

## What changes from XAS

A fast electron that loses energy E passing the sample transfers a momentum q. For small collection angles (the dipole limit) the dynamic structure factor is

S(q, ω) = Σ_ab q_a q_b I_ab(ω),  I_ab(ω) = Σ_F ⟨I|m_a|F⟩⟨F|m_b|I⟩ δ(ω − ω_F),

the oxygen K edge as X-rays see it, but along q. A polycrystalline sample averages the directions and gives |q|²/3 times the XAS spectrum. An oriented one, a single crystal grain or a molecule in a known frame, needs the cross terms I_ab too.

* **Exact reference.** With a real Hamiltonian and real states I_ab = I_ba, and I_ab = (I_{a+b} − I_aa − I_bb) / 2 from the spectral measure of (m_a + m_b)|I⟩. Six Lanczos runs per problem give S(q, ω) for every direction (`scripts/quantum/qxas/eels.py`).
* **On the quantum computer.** The cross correlation G_ab(t) = ⟨m_a I|e^{−iHt}|m_b I⟩ is measured by a Hadamard test that prepares both dipole states (a linear combination of the two preparations), as in the paper. The emulator runs it as a Hadamard test whose two branches start from different states, `HadamardTest.signal(..., bra=...)`. With the three XAS tests, that is six correlation functions for an oriented spectrum.
* **Cost.** Twice the circuits of XAS, half of them with one more state preparation. At 18 orbitals the whole spectrum is 9.0×10¹¹ Toffoli gates (4.5×10¹¹ for XAS); at 4 T gates per Toffoli that is 11 % above the paper's Table 1 (3.25×10¹² T gates), which uses its own settings. `qxas/resources.py` adds an `eels` entry to every cost row.

## What it shows

Directions are in each problem's own frame. Strongest loss along q, exact, and its height relative to the orientation average (100,000 shots per correlation function; `quantum_eels` over MCP):

| Problem | q along x | q along y | q along z | q along (1, 1, 1) |
| --- | --- | --- | --- | --- |
| CO (bond along z) | π* 540.00 eV, 1.49 | π* 540.00 eV, 1.49 | σ* 556.30 eV, 1.78 | 540.00 eV, 1.00 |
| Water (yz plane, z the bisector) | nothing below 569 eV | 2b2 544.37 eV, 2.53 | 4a1 542.24 eV, 1.57 | 544.22 eV, 1.00 |
| Li₂MnO₃, O2 site (crystal frame) | 562.32 eV, 1.14 | 562.47 eV, 1.42 | 562.89 eV, 0.46 | 563.74 eV, 1.95 |
| Li₂MnO₃, O1 site (crystal frame) | 563.07 eV, 0.82 | 563.50 eV, 1.21 | 562.51 eV, 1.05 | 563.92 eV, 1.91 |
| Li₃Mn₂O, O2 site, one lithium removed | 557.55 eV, 1.21 | 557.98 eV, 0.11 | 557.55 eV, 1.68 | 561.38 eV, 0.31 |
| Li₂Mn₂O, O2 site, two lithium removed | 561.54 eV, 1.02 | 560.83 eV, 0.94 | 561.12 eV, 1.08 | 561.26 eV, 1.83 |

* **The molecules follow their selection rules.** CO's π* needs q across the bond and its σ* along it; water's 4a1 needs q along the bisector and its 2b2 along the H–H direction, and out of the plane there is almost nothing.
* **The cathode clusters are strongly anisotropic, and the cross terms carry it.** Along (1, 1, 1) the O2 site's peak is nearly twice the orientation average and 1.3 eV higher (563.74 against 562.47 eV); along z it is under half. The O1 site and Li₂Mn₂O also peak near twice the average along (1, 1, 1). Li₃Mn₂O goes the other way: its lowest peak, at 557.55 eV, lies in the xz plane, nearly vanishes along y, and along (1, 1, 1) falls to a third of the average, where the strongest loss moves 3.8 eV up to 561.38 eV. Leaving the off-diagonal tests out makes the rebuilt spectrum along (1, 1, 1) clearly worse (`src/lib/quantum/eels.test.ts`), so for an oriented grain of Li₂MnO₃ the extra circuits are not optional.
* **The algorithm reproduces the exact spectra** within 2 to 4 % of the peak for the molecules (exact factorization, four Trotter steps per time point) and within 3 to 14 % for the clusters (compressed factorization, one step), as for their XAS. The O1 site is the worst at 7 to 14 %, and its XAS is already 10 % off; ten million shots per function move these by 1.4 points at most, so the gap is the factorization and the time step, not shot noise.

## Checks

`scripts/quantum/test_eels.py`: the off-diagonal test equals the exact cross correlation on a turned water molecule to 10⁻³; S(q, ω) turns with the sample and averages to the XAS spectrum to 10⁻⁶; CO's π* needs q across the bond; the emulated signals rebuild into the exact oriented spectrum; the stored water data recompute. `src/lib/quantum/eels.test.ts` holds the browser code to the Python values, and `src/cli/quantum-tools.test.ts` covers `quantum_eels`.

## What is not done

* **Beyond the dipole limit.** At large collection angles, |q| above about 1/r_c of the O 1s orbital, e^{iq·r} lets transitions XAS cannot see appear. That needs the e^{iq·r} integrals over the active orbitals, which the instance files do not keep; the paper does not compute it either.
* **Collection angle and beam energy.** The page shows S(q, ω) per |q|²; turning a microscope's settings into q and the double differential cross section is left out.
