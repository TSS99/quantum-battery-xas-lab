"""The fault tolerant cost of the algorithm, with PennyLane's estimator (Table I of 2506.15784).

The circuit model is the one of the PennyLane demo `tutorial_resource_estimation_spectroscopy` (Apache 2.0): load a
sum of 1e4 Slater determinants with QROM, then a Hadamard test around a controlled second order Trotter evolution of a
compressed double factorized Hamiltonian with L = N fragments, rotations to 1e-3 synthesized with a semi adder (phase
gradient), basis rotations as Givens networks, and controlled RZ by the double phase trick (two CNOTs and an RZ).
Settings are the paper's: eta = 0.05 Ha, ||H||_w = 2 Ha so tau = pi/4, j_max = 100, a Trotter step of
sqrt(eta / Y3) with Y3 = 1 Ha, alpha = 1.3384 and a shot budget S = 2500. The longest circuit evolves for the demo's
(2 j_max + 1) tau.

The whole spectrum follows the paper's Eqs. 31 and 32: S_j = S exp(-alpha tau eta j) / A for j = 1..2 j_max, three
dipole directions, real and imaginary parts, so N_Trot = 6 S (tau / Delta) sum_j j exp(-alpha tau eta j) / A Trotter
steps at the per step cost from the estimator, plus a state preparation per circuit. Logical qubits follow the
paper's Eq. 40, 2N + 5 log2(D) - 3.

`cost` adds what that means, all of it a model:
* Machine generations are the vendor's announced targets (IBM, June 2025), not machines that exist. A problem "fits"
  when its logical qubits and its longest circuit's Toffoli gates are within the announced qubits and gates; other
  gates are not counted, so the fit is optimistic.
* Run time is given two ways: one Toffoli after another at a logical clock of 1 MHz, and the paper's active volume
  layout, scaled from its own 18 orbital numbers (8.1e10 logical cycles for 4.58e11 Toffolis, at 1 MHz).
* The classical cost is the paper's rough model of a restricted active space calculation (113 hours per state at 23
  orbitals on a large supercomputer, 1000 states, growing as e^N), which the paper itself calls optimistic.
"""

from __future__ import annotations

import numpy as np
import pennylane.estimator as qre

ETA, JMAX, H_NORM, Y3, ALPHA, SHOTS = 0.05, 100, 2.0, 1.0, 1.3384, 2500
TAU = np.pi / (2 * H_NORM)
DELTA = np.sqrt(ETA / Y3)
CLOCK_HZ = 1e6
ACTIVE_VOLUME_CYCLES_PER_TOFFOLI = 8.1e10 / 4.58e11  # the paper's 18 orbital numbers
MACHINES = [
    {"id": "starling", "name": "IBM Starling class", "year": 2029, "logical_qubits": 200, "gates": 1e8,
     "source": "IBM roadmap, June 2025"},
    {"id": "blue-jay", "name": "IBM Blue Jay class", "year": 2033, "logical_qubits": 2000, "gates": 1e9,
     "source": "IBM roadmap, June 2025"},
]


def config() -> qre.ResourceConfig:
    cfg = qre.ResourceConfig()

    def rotation(precision):
        bits = int(np.ceil(np.log2(1 / precision)))
        return [qre.GateCount(qre.resource_rep(qre.SemiAdder, {"max_register_size": bits + 1}))]

    def basis_rotation(dim):
        pairs = dim * (dim - 1) / 2
        ops = [(qre.RZ, dim, None), (qre.RX, pairs, None), (qre.RY, pairs, None), (qre.Hadamard, 4 * pairs, None),
               (qre.S, pairs, None), (qre.Adjoint, pairs, {"base_cmpr_op": qre.resource_rep(qre.S)}),
               (qre.CNOT, 2 * pairs + dim, None)]
        return [qre.GateCount(qre.resource_rep(op, params or {}), count) for op, count, params in ops]

    def controlled_rz(precision):
        return [qre.GateCount(qre.resource_rep(qre.CNOT), 2),
                qre.GateCount(qre.resource_rep(qre.RZ, {"precision": precision}), 1)]

    for gate in (qre.RX, qre.RY, qre.RZ):
        cfg.set_decomp(gate, rotation)
    cfg.set_decomp(qre.BasisRotation, basis_rotation)
    cfg.set_decomp(qre.CRZ, controlled_rz)
    cfg.set_single_qubit_rot_precision(1e-3)
    return cfg


def circuit(hamiltonian, steps: int, prepare: bool = True, num_slaters: float = 1e4):
    if prepare:
        qubits = int(np.ceil(np.log2(num_slaters)))
        qre.QROMStatePreparation(num_state_qubits=qubits)
        qre.QROM(num_bitstrings=2 ** qubits, size_bitstring=qubits, select_swap_depth=1)
    qre.Hadamard()
    if steps:
        qre.Controlled(qre.TrotterCDF(hamiltonian, steps, order=2), num_ctrl_wires=1, num_zero_ctrl=0)
    qre.Hadamard()


def classical_hours(orbitals: int) -> float:
    """The paper's rough restricted active space model (Sec. V D of 2506.15784), optimistic by its own account."""
    return 113.0 * np.exp(orbitals - 23) * 1000


def cost(orbitals: int, eta: float = ETA) -> dict:
    """`eta` is the resolution, the Lorentzian half width in Ha. A finer one evolves longer, j_max growing as 1/eta so
    that t_max eta stays the paper's, with the paper's Trotter step sqrt(eta / Y3)."""
    cfg = config()
    ham = qre.CDFHamiltonian(num_orbitals=orbitals, num_fragments=orbitals)
    jmax = round(JMAX * ETA / eta)
    delta = DELTA * np.sqrt(eta / ETA)
    longest_steps = int(np.ceil(2 * jmax + 1) * TAU / delta)
    big = qre.estimate(circuit, config=cfg)(hamiltonian=ham, steps=longest_steps)
    one = qre.estimate(circuit, config=cfg)(hamiltonian=ham, steps=1, prepare=False).gate_counts["Toffoli"]
    prep = qre.estimate(circuit, config=cfg)(hamiltonian=ham, steps=0).gate_counts["Toffoli"]
    j = np.arange(1, 2 * jmax + 1)
    kernel = np.exp(-ALPHA * TAU * eta * j)
    n_trot = 6 * SHOTS * TAU / delta * np.sum(j * kernel) / kernel.sum()
    total = float(n_trot * one + 6 * SHOTS * prep)
    longest = float(big.gate_counts["Toffoli"])
    qubits = int(np.ceil(2 * orbitals + 5 * np.log2(1e4) - 3))
    # An oriented EELS spectrum (Kunitsa et al. 2025, qxas/eels.py) needs six correlation functions instead of three;
    # the three off-diagonal ones prepare both states (a linear combination of the two preparations), so it takes
    # twice the circuits, half of them with one more state preparation.
    eels_total = 2 * total + 6 * SHOTS * prep
    return {
        "orbitals": orbitals, "logical_qubits": qubits, "logical_qubits_estimator": int(big.total_wires),
        "toffoli_longest_circuit": longest, "toffoli_whole_spectrum": total, "circuits": 6 * SHOTS,
        "seconds_sequential_1MHz": total / CLOCK_HZ,
        "seconds_active_volume_1MHz": total * ACTIVE_VOLUME_CYCLES_PER_TOFFOLI / CLOCK_HZ,
        "fits": {m["id"]: bool(qubits <= m["logical_qubits"] and longest <= m["gates"]) for m in MACHINES},
        "classical_hours_paper_model": classical_hours(orbitals),
        "toffoli_state_preparation": float(prep),
        "eels": {"toffoli_longest_circuit": longest + float(prep), "toffoli_whole_spectrum": float(eels_total),
                 "circuits": 12 * SHOTS, "seconds_active_volume_1MHz": eels_total * ACTIVE_VOLUME_CYCLES_PER_TOFFOLI / CLOCK_HZ},
    }


# RIXS (Loaiza et al., arXiv 2602.20270; qxas/rixs.py): each sample is a phase estimation of the qubitized walk of a
# tensor hypercontracted Hamiltonian (rank 3N, 13 bit coefficients and rotations) on a state made by K_A rounds of
# amplitude amplification around a block encoding that calls the walk 2 K_G times (Eqs. 32 to 38). The paper takes
# K_A = 13 from its success probability, sqrt(P_R) about 0.06; the page computes P_R for each problem instead.
RIXS_KA, RIXS_SAMPLES, RIXS_RESOLUTION_HA, RIXS_BITS = 13, 2000, 0.2 / 27.211386245988, 13


def rixs_cost(orbitals: int, one_norm: float, k_a: int = RIXS_KA) -> dict:
    """Logical qubits and Toffolis of one RIXS sample (Eqs. 37 and 38): [(2 K_A + 1) 2 K_G + 2^n_w] T_W, with the
    Green's function degree K_G of the paper's fit and n_w phase bits for a resolution of 0.2 eV."""
    from .rixs import green_degree

    ham = qre.THCHamiltonian(num_orbitals=orbitals, tensor_rank=3 * orbitals, one_norm=one_norm)
    walk = qre.estimate(lambda: qre.QubitizeTHC(ham, coeff_precision=RIXS_BITS, rotation_precision=RIXS_BITS))()
    k_g = green_degree(one_norm)
    n_omega = int(np.ceil(np.log2(np.ceil(np.pi * one_norm / (np.sqrt(2) * RIXS_RESOLUTION_HA)))))
    n_dipole = 3 * int(np.ceil(np.log2(orbitals))) + 2 * RIXS_BITS + 2
    walk_toffoli = float(walk.gate_counts["Toffoli"])
    per_sample = ((2 * k_a + 1) * 2 * k_g + 2 ** n_omega) * walk_toffoli
    return {"one_norm_Ha": one_norm, "green_degree": k_g, "phase_bits": n_omega, "toffoli_walk": walk_toffoli,
            # 2N + max(n_w, n_D + 4) + n_W, where the estimator's walk wires hold the 2N system qubits and n_W
            "logical_qubits": max(n_omega, n_dipole + 4) + int(walk.total_wires),
            "amplification_rounds": k_a, "toffoli_per_sample": per_sample, "samples": RIXS_SAMPLES,
            "toffoli_spectrum": per_sample * RIXS_SAMPLES, "seconds_sequential_1MHz": per_sample * RIXS_SAMPLES / CLOCK_HZ}


def settings() -> dict:
    """The settings every estimate states."""
    return {"eta_Ha": ETA, "jmax": JMAX, "h_norm_Ha": H_NORM, "tau_per_Ha": TAU, "trotter_step_per_Ha": DELTA,
            "alpha": ALPHA, "shots": SHOTS, "rotation_precision": 1e-3, "slater_determinants": 1e4, "fragments": "L = N",
            "clock_Hz": CLOCK_HZ, "active_volume_cycles_per_toffoli": ACTIVE_VOLUME_CYCLES_PER_TOFFOLI}
