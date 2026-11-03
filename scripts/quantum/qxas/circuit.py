"""The time domain circuit as PennyLane gates, as in the demo `tutorial_xas` (Dale and Fomichev, Apache 2.0).

Wire 0 is the auxiliary qubit of the Hadamard test; wires 1..2N are spin orbitals, alpha and beta interleaved. A basis
rotation is `BasisRotation`; one-body fragments are RZ rotations and two-body fragments MultiRZ rotations, each wrapped
in X gates on the system qubit that fire when the auxiliary qubit is 0 (the double phase trick); global phases go on
the auxiliary qubit with `PhaseShift`. This is slow beyond about 16 qubits; emulate.py computes the same thing in the
determinant basis, and the tests hold the two together.
"""

from __future__ import annotations

from itertools import product

import numpy as np
import pennylane as qml
from pyscf.fci.cistring import addrs2str
from pennylane.qchem.convert import _sign_chem_to_phys, _wfdict_to_statevector

from .cdf import Fragments


def statevector(ci: np.ndarray, n_orb: int, n_elec: tuple[int, int]) -> np.ndarray:
    """A PySCF CI matrix as a qubit statevector in PennyLane's ordering and sign convention."""
    rows, cols = np.nonzero(np.abs(ci) > 1e-14)
    strs_a = addrs2str(n_orb, n_elec[0], rows)
    strs_b = addrs2str(n_orb, n_elec[1], cols)
    wf = dict(zip(zip(strs_a, strs_b), ci[rows, cols]))
    return _wfdict_to_statevector(_sign_chem_to_phys(wf, n_orb), n_orb)


def _rotation(u: np.ndarray, n_orb: int):
    qml.BasisRotation(unitary_matrix=qml.math.kron(u, np.eye(2)), wires=range(1, 2 * n_orb + 1))


def _controlled(gate, angle, wires):
    for w in wires[:1]:
        qml.ctrl(qml.X(w), control=0, control_values=0)
    gate(angle, wires=wires)
    for w in wires[:1]:
        qml.ctrl(qml.X(w), control=0, control_values=0)


def _one_body(z0: np.ndarray, step: float, n_orb: int):
    for i, sigma in product(range(n_orb), range(2)):
        _controlled(qml.RZ, -z0[i] * step / 2, [2 * i + sigma + 1])
    qml.PhaseShift(-np.sum(z0) * step, wires=0)


def _two_body(z: np.ndarray, step: float, n_orb: int):
    for sigma, tau in product(range(2), repeat=2):
        for i, k in product(range(n_orb), repeat=2):
            if i != k or sigma != tau:
                _controlled(qml.MultiRZ, z[i, k] / 8.0 * step, [2 * i + sigma + 1, 2 * k + tau + 1])
    qml.PhaseShift(-(np.trace(z) / 4.0 * step - np.sum(z) * step / 2.0), wires=0)


def _first_order(fr: Fragments, step: float, order, n_orb: int):
    bases = [fr.u0] + list(fr.u)
    prior = np.eye(n_orb)
    for index in order:
        _rotation(prior @ bases[index], n_orb)
        if index == 0:
            _one_body(fr.z0, step, n_orb)
        else:
            _two_body(fr.z[index - 1], step, n_orb)
        prior = bases[index].T
    _rotation(prior, n_orb)
    qml.PhaseShift(-fr.e_core * step, wires=0)


def signal(fr: Fragments, psi: np.ndarray, n_orb: int, tau: float, jmax: int) -> np.ndarray:
    """<X> + i<Y> of the auxiliary qubit at t_j = j tau, one fixed order second order step per tau."""
    wires = 2 * n_orb + 1
    dev = qml.device("lightning.qubit", wires=wires)
    order = list(range(fr.count + 1))

    @qml.qnode(dev)
    def start():
        qml.StatePrep(psi, wires=range(1, wires))
        qml.Hadamard(wires=0)
        return qml.state()

    @qml.qnode(dev)
    def step(state):
        qml.StatePrep(state, wires=range(wires))
        _first_order(fr, tau / 2, order, n_orb)
        _first_order(fr, tau / 2, order[::-1], n_orb)
        return qml.state()

    @qml.qnode(dev)
    def read(state):
        qml.StatePrep(state, wires=range(wires))
        return qml.expval(qml.PauliX(0)), qml.expval(qml.PauliY(0))

    state = start()
    out = np.empty(jmax, dtype=complex)
    for j in range(jmax):
        state = step(state)
        x, y = read(state)
        out[j] = x + 1j * y
    return out
