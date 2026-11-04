// The quantum XAS engine's models for the Methods page, in the twin's format (src/lib/twin/methods.ts): what each
// computes, from which data, what it was checked against, the tolerance, and the tests that hold it, which may be
// Python tests in scripts/quantum. methods.test.ts checks that every named test still exists.
import type { TwinMethod, TwinTestRef } from '../twin/methods';

const py = (file: string, name: string): TwinTestRef => ({ file: `scripts/quantum/${file}.py`, name });
const ts = (name: string): TwinTestRef => ({ file: 'src/lib/quantum/emulate.test.ts', name });

export const QUANTUM_METHODS: readonly TwinMethod[] = [
  {
    quantity: 'Problem and integrals',
    model: 'Restricted open shell Hartree Fock (PySCF), an active space from AVAS, one and two electron integrals and dipoles of the active orbitals',
    data: 'Refined crystal structures (COD), cc-pVDZ or STO-3G basis',
    checked: 'Rebuilding a problem from its recipe; each file against its own hash',
    tolerance: String.raw`$10^{-6}$ Ha (the SCF threshold)`,
    provenance: 'computed',
    tests: [py('test_library', 'test_water_rebuilds_to_the_stored_numbers'), py('test_library', 'test_every_file_matches_its_hash_and_shapes')],
  },
  {
    quantity: 'Core hole',
    model: 'Core valence separation: every integral with an odd number of O 1s indices dropped, the dipole kept only between core and valence',
    data: 'The problem integrals',
    checked: 'The one hole states stay closed under the Hamiltonian; the emulator and the exact reference share it; the edge lands at the oxygen K edge',
    tolerance: String.raw`$10^{-10}$; $10^{-3}$ in the signal`,
    provenance: 'computed',
    tests: [py('test_qxas', 'test_the_hamiltonian_keeps_the_core_hole_and_the_dipole_makes_one'),
      py('test_qxas', 'test_emulator_and_exact_reference_share_the_core_hole_hamiltonian'), py('test_qxas', 'test_the_edge_lands_at_the_oxygen_k_edge')],
  },
  {
    quantity: 'Hamiltonian fragments',
    model: String.raw`$H = E + \sum_k z^0_k N^0_k + \sum_\ell \big(\tfrac12 \sum_{kl} Z^\ell_{kl} N^\ell_k N^\ell_l - \sum_k Z'^\ell_k N^\ell_k\big)$, exact or compressed double factorization`,
    data: 'The problem integrals',
    checked: 'The exact factorization rebuilds the integrals, also with a core hole',
    tolerance: String.raw`$10^{-9}$ Ha`,
    provenance: 'computed',
    tests: [py('test_qxas', 'test_exact_factorization_rebuilds_the_integrals')],
  },
  {
    quantity: 'Time domain circuit',
    model: String.raw`Hadamard test of $e^{-iHt}$ on $m_\rho|I\rangle$ by a second order product formula with the double phase trick, emulated with two determinant vectors`,
    data: 'The fragments',
    checked: 'The PennyLane circuit, gate for gate; the exact evolution as the Trotter step shrinks',
    tolerance: String.raw`$10^{-9}$; error falling as $\Delta^2$`,
    provenance: 'computed',
    tests: [py('test_qxas', 'test_matches_the_pennylane_circuit_gate_for_gate'), py('test_qxas', 'test_trotter_error_falls_as_the_step_squared')],
  },
  {
    quantity: 'Browser emulator',
    model: 'The same circuit in TypeScript, run in a Web Worker on problems up to 500 determinants',
    data: 'The browser packs',
    checked: 'The Python emulator over 100 time steps, both factorizations',
    tolerance: String.raw`$10^{-6}$`,
    provenance: 'computed',
    tests: [ts('reproduces the stored')],
  },
  {
    quantity: 'Exact reference spectra',
    model: String.raw`Lanczos with full reorthogonalization from $m_\rho|I\rangle$: the spectral measure of every state the dipole reaches`,
    data: 'The problem integrals',
    checked: 'Full diagonalization where it is possible',
    tolerance: String.raw`$10^{-9}$`,
    provenance: 'computed',
    tests: [py('test_qxas', 'test_lanczos_measure_equals_the_full_eigen_spectrum')],
  },
  {
    quantity: 'Spectrum from the signal',
    model: String.raw`$-\eta\,\mathrm{Im}\,G(\omega) = \tfrac{\eta\tau}{2\pi}\sum_j e^{-\eta\tau|j|}\tilde G(\tau j)\,e^{ij\tau\omega}$ (Eq. 11 of Fomichev et al. 2025), shots spread as $e^{-\alpha\eta t_j}$`,
    data: 'The measured signal',
    checked: 'A single exponential gives a Lorentzian of half width $\\eta$; the water signal lands on its exact spectrum',
    tolerance: String.raw`$2\%$; $5\%$ of the peak`,
    provenance: 'computed',
    tests: [py('test_qxas', 'test_spectrum_rebuild_gives_the_lorentzian'), ts('turns one exact exponential into a Lorentzian'), ts('puts the water signal on its exact reference at the edge')],
  },
  {
    quantity: 'Fault tolerant cost',
    model: 'PennyLane resource estimator: sum of Slaters state preparation, controlled second order CDF Trotter evolution, rotations to $10^{-3}$',
    data: 'Table I settings of Fomichev et al. 2025',
    checked: 'Table I of Fomichev et al. 2025 at 18 orbitals',
    tolerance: String.raw`$5\%$`,
    provenance: 'computed',
    tests: [py('test_qxas', 'test_table_one_at_eighteen_orbitals')],
  },
];
