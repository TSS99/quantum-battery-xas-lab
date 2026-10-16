import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from scipy.linalg import eigh, expm

from science.app import app
from science.quantum import QuantumRequest, build_circuit, evolve_trotter, hamiltonian, pauli_matrix, pauli_terms, reconstruct_spectrum, simulate


@pytest.mark.parametrize("qubits", [2, 3, 4, 5, 6])
def test_hermitian_unitary_and_dipole_sum_rule(qubits):
    p = QuantumRequest(qubits=qubits, samples=64, trotterSteps=4, timeMax=5)
    r = simulate(p)
    for key in ["hermiticityError", "unitarityError", "normError", "groundResidual", "correlationAtZeroError", "transitionWeightError", "expmError"]:
        assert r["validation"][key] < 1e-10, (qubits, key)
    assert min(r["spectrumReference"]) >= 0
    assert r["resources"]["entanglingGates"] == 2 * (qubits - 1) * p.trotterSteps
    h = hamiltonian(p)
    values, vectors = eigh(h)
    d = pauli_matrix("X" + "I" * (qubits - 1))
    initial = d @ vectors[:, 0]
    for index in [0, 7, 31, 63]:
        t = r["times"][index]
        expected = np.vdot(initial, expm(-1j * (h - values[0] * np.eye(len(h))) * t) @ initial)
        np.testing.assert_allclose(complex(r["correlationReal"][index], r["correlationImag"][index]), expected, atol=1e-10)
        transition_sum = sum(item["weight"] * np.exp(-1j * item["energy"] * t) for item in r["transitions"])
        np.testing.assert_allclose(expected, transition_sum, atol=1e-10)


def test_trotter_convergence_and_unitarity():
    p = QuantumRequest()
    h = hamiltonian(p)
    values, vectors = eigh(h)
    initial = pauli_matrix("XI") @ vectors[:, 0]
    exact = expm(-1j * h * 2) @ initial
    errors = [1 - abs(np.vdot(exact, evolve_trotter(initial, pauli_terms(p), 2, steps))) ** 2 for steps in [1, 8, 64]]
    assert errors[2] < errors[1] < errors[0]
    for steps in [1, 7, 64]:
        u = np.column_stack([evolve_trotter(np.eye(4)[:, j], pauli_terms(p), 2, steps) for j in range(4)])
        np.testing.assert_allclose(u.conj().T @ u, np.eye(4), atol=1e-12)


def test_fft_sign_peak_padding_and_resolution():
    p = QuantumRequest(timeMax=120, samples=512, broadening=0.02, padding=8)
    t = np.linspace(0, p.timeMax, p.samples)
    response = reconstruct_spectrum(np.exp(-1j * 1.4 * t), p)
    peak = response["energy"][np.argmax(response["signed"])]
    assert abs(peak - 1.4) < response["spacing"]
    reference = p.broadening / (np.pi * ((response["energy"] - 1.4) ** 2 + p.broadening ** 2))
    assert abs(response["energy"][np.argmax(reference)] - peak) < response["spacing"]
    low_padding = reconstruct_spectrum(np.exp(-1j * 1.4 * t), p.model_copy(update={"padding": 1}))
    assert response["spacing"] == pytest.approx(low_padding["spacing"] / 8)


def test_fft_negative_values_are_preserved_and_clipping_accounted():
    p = QuantumRequest(timeMax=5, samples=64, broadening=0.02, window="none", padding=8)
    t = np.linspace(0, p.timeMax, p.samples)
    result = reconstruct_spectrum(np.exp(-1j * 1.4 * t), p)
    assert result["minimum"] < 0
    assert result["negativeBins"] > 0
    assert result["clippedArea"] > 0
    assert np.min(result["clipped"]) == 0


def test_circuit_matches_product_formula():
    p = QuantumRequest(trotterSteps=1, timeMax=5)
    gates = build_circuit(pauli_terms(p), p)
    u = np.eye(4, dtype=complex)
    for gate in gates:
        if gate["gate"] == "CX":
            ctrl, target = gate["qubits"]
            g = np.zeros((4, 4))
            for column in range(4):
                row = column ^ (1 << (1 - target)) if column & (1 << (1 - ctrl)) else column
                g[row, column] = 1
        else:
            q = gate["qubits"][0]
            symbol = "X" if gate["gate"] == "Rx" else "Z"
            label = "".join(symbol if i == q else "I" for i in range(2))
            g = expm(-0.5j * gate["angle"] * pauli_matrix(label))
        u = g @ u
    expected = np.column_stack([evolve_trotter(np.eye(4)[:, j], pauli_terms(p), 5, 1) for j in range(4)])
    np.testing.assert_allclose(u, expected, atol=1e-12)


def test_api_rejects_unbounded_or_invalid_inputs():
    client = TestClient(app)
    assert client.get("/health").json()["provenance"] == "exact-toy"
    for payload in [{"qubits": 7}, {"samples": 65}, {"padding": 3}, {"broadening": -1}, {"window": "magic"}]:
        assert client.post("/simulate", json=payload).status_code == 422
    response = client.post("/simulate", json={"qubits": 2, "samples": 64, "timeMax": 5, "trotterSteps": 2})
    assert response.status_code == 200
    assert response.json()["validation"]["expmError"] < 1e-10
    with pytest.raises(ValidationError):
        QuantumRequest(coupling=float("nan"))
