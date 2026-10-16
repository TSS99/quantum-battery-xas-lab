"""Small effective spin model, independently checked with scipy.linalg.expm.

This module matches src/lib/quantum.ts. It does not model Mn core-level XAS.
Energies: toy eV. Times: eV^-1. hbar=1. q0 is the most significant bit.
"""
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator
from scipy.linalg import eigh, expm


class QuantumRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    qubits: int = Field(default=2, ge=2, le=6, strict=True)
    coupling: float = Field(default=0.35, ge=-1, le=1, allow_inf_nan=False)
    field: float = Field(default=0.7, ge=0, le=2, allow_inf_nan=False)
    timeMax: float = Field(default=40, ge=5, le=120, allow_inf_nan=False)
    samples: int = Field(default=256, ge=64, le=512, strict=True)
    trotterSteps: int = Field(default=24, ge=1, le=128, strict=True)
    broadening: float = Field(default=0.12, ge=0.02, le=1, allow_inf_nan=False)
    window: Literal["cosine", "none"] = "cosine"
    padding: int = Field(default=4, ge=1, le=8, strict=True)

    @field_validator("samples")
    @classmethod
    def sample_power(cls, v):
        if v not in (64, 128, 256, 512):
            raise ValueError("samples must be 64, 128, 256 or 512")
        return v

    @field_validator("padding")
    @classmethod
    def padding_power(cls, v):
        if v not in (1, 2, 4, 8):
            raise ValueError("padding must be 1, 2, 4 or 8")
        return v


def pauli_terms(p: QuantumRequest):
    def label(indices, symbol):
        return "".join(symbol if i in indices else "I" for i in range(p.qubits))
    return ([{"label": label([i], "Z"), "coefficient": p.field * (1 + 0.13 * i)} for i in range(p.qubits)]
            + [{"label": label([i, i + 1], "X"), "coefficient": p.coupling} for i in range(p.qubits - 1)]
            + [{"label": label([i], "X"), "coefficient": 0.17} for i in range(p.qubits)])


def pauli_matrix(label):
    operators = {"I": np.eye(2), "X": np.array([[0., 1.], [1., 0.]]), "Z": np.diag([1., -1.])}
    result = np.array([[1.]])
    for symbol in label:
        result = np.kron(result, operators[symbol])
    return result


def hamiltonian(p):
    return sum(term["coefficient"] * pauli_matrix(term["label"]) for term in pauli_terms(p))


def evolve_trotter(initial, terms, time, steps, energy_reference=0):
    """Chronological terms repeat within each step; rightmost matrix acts first."""
    result = np.asarray(initial, dtype=complex).copy()
    compiled = []
    for term in terms:
        label = term["label"]
        flip = sum((1 << (len(label) - q - 1)) for q, symbol in enumerate(label) if symbol == "X")
        zmask = sum((1 << (len(label) - q - 1)) for q, symbol in enumerate(label) if symbol == "Z")
        source = np.arange(len(result)) ^ flip
        signs = np.array([(-1.) ** (int(j) & zmask).bit_count() for j in source])
        angle = term["coefficient"] * time / steps
        compiled.append((source, signs, np.cos(angle), np.sin(angle)))
    for _ in range(steps):
        for source, signs, cosine, sine in compiled:
            result = cosine * result - 1j * sine * signs * result[source]
    return result * np.exp(1j * energy_reference * time)


def reconstruct_spectrum(correlation, p):
    dt = p.timeMax / (p.samples - 1)
    times = np.arange(p.samples) * dt
    window = 0.5 * (1 + np.cos(np.pi * times / p.timeMax)) if p.window == "cosine" else np.ones(p.samples)
    window = window * np.exp(-p.broadening * times)
    window[[0, -1]] *= 0.5  # Trapezoidal endpoint weights.
    n = p.samples * p.padding
    transformed = np.fft.ifft(correlation * window, n=n) * n  # Positive exponential sign.
    signed = transformed.real[:n // 2 + 1] * dt / np.pi
    spacing = 2 * np.pi / (n * dt)
    energies = np.arange(len(signed)) * spacing
    clipped = np.maximum(0, signed)
    return {
        "energy": energies, "signed": signed, "clipped": clipped, "spacing": spacing,
        "nyquist": np.pi / dt, "minimum": float(np.min(signed)),
        "negativeBins": int(np.count_nonzero(signed < -1e-12)),
        "clippedArea": float(np.trapezoid(clipped - signed, dx=spacing)),
    }


def build_circuit(terms, p):
    circuit = []
    for index, term in enumerate(terms):
        qubits = [q for q, s in enumerate(term["label"]) if s != "I"]
        angle = 2 * term["coefficient"] * p.timeMax / p.trotterSteps
        if len(qubits) == 1:
            circuit.append({"gate": "Rz" if term["label"][qubits[0]] == "Z" else "Rx", "qubits": qubits, "angle": angle, "termIndex": index})
        else:
            circuit.extend([
                {"gate": "CX", "qubits": qubits, "termIndex": index},
                {"gate": "Rx", "qubits": [qubits[0]], "angle": angle, "termIndex": index},
                {"gate": "CX", "qubits": qubits, "termIndex": index},
            ])
    return circuit


def simulate(p: QuantumRequest):
    h = hamiltonian(p)
    values, vectors = eigh(h)
    eg = values[0]
    ground = vectors[:, 0]
    initial = pauli_matrix("X" + "I" * (p.qubits - 1)) @ ground
    amplitudes = vectors.T @ initial
    weights = abs(amplitudes) ** 2
    gaps = values - eg
    times = np.linspace(0, p.timeMax, p.samples)
    exact_states = (np.exp(-1j * np.outer(times, gaps)) * amplitudes) @ vectors.T
    correlation = exact_states @ initial
    terms = pauli_terms(p)
    trotter = np.array([evolve_trotter(initial, terms, t, p.trotterSteps, eg) for t in times])
    trotter_correlation = trotter @ initial
    fidelity = np.clip(abs(np.einsum("ij,ij->i", exact_states.conj(), trotter)) ** 2, 0, 1)
    reference_propagator = expm(-1j * (h - eg * np.eye(len(h))) * p.timeMax)
    diagonal_propagator = (vectors * np.exp(-1j * gaps * p.timeMax)) @ vectors.T
    fft = reconstruct_spectrum(correlation, p)
    transitions = [{"energy": float(max(0, e)), "weight": float(w), "kind": "elastic" if e < 1e-9 else "inelastic"} for e, w in zip(gaps, weights) if w > 1e-12]
    reference = np.sum(weights * p.broadening / (np.pi * ((fft["energy"][:, None] - gaps) ** 2 + p.broadening ** 2)), axis=1)
    trotter_fft = reconstruct_spectrum(trotter_correlation, p)
    def area(values):
        return float(np.trapezoid(values, dx=fft["spacing"]))
    l1_trotter = area(abs(trotter_fft["signed"] - fft["signed"])) / max(1e-15, area(abs(fft["signed"])))
    l1_reference = area(abs(fft["signed"] - reference)) / max(1e-15, area(reference))
    rmse_reference = float(np.sqrt(np.mean((fft["signed"] - reference) ** 2)))
    circuit = build_circuit(terms, p)
    caveats = [
        "Exactly solved effective spin model with D = X0; not an ab initio MnO6 core-level XAS calculation.",
        "Toy energies are eV and times are eV^-1 with hbar = 1 (multiply time by 0.6582119569 for fs). No mapping to the Mn K edge.",
        "q0 is the most significant bit. Terms and circuit gates are applied in displayed chronological order. The ground-energy reference contributes only a global phase.",
        "The X0 excitation is unitary in this toy model. A physical many-body dipole operator and its state preparation are generally not unitary.",
        "The zero-energy elastic weight |<g|X0|g>|² is retained and labeled; it is not an absorption excitation. The dipole expectation is not subtracted.",
        "First-order Trotter fidelity is evaluated on D|g>, not averaged over inputs; pointwise convergence need not be monotonic.",
        "Circuit resources count the displayed unoptimized serial decomposition, including zero-angle gates; preparation, excitation, measurement and routing are excluded.",
        "Positive-sign FFT uses exponential damping and the stated window. Signed finite-window values and the area removed by clipping are reported separately.",
        "Zero padding refines the grid, not resolution. Cosine taper broadens peaks beyond the lifetime-only Lorentzian reference.",
        "Spectral L1 errors integrate absolute differences on the returned nonnegative energy grid. Fourier/reference mismatch includes window and sampling effects. Trotter and exact spectra use the same window and damping.",
        "Classical numerical simulation only: no quantum hardware execution or quantum advantage is claimed.",
    ]
    if any(t["energy"] > fft["nyquist"] for t in transitions):
        caveats.append("ALIASING WARNING: a nonzero-weight transition exceeds Nyquist. Increase samples or reduce timeMax.")
    ground_degeneracy = int(np.count_nonzero(abs(values - eg) < 1e-9))
    if ground_degeneracy > 1:
        caveats.append("DEGENERATE GROUND SPACE: one normalized eigenvector from the eigensolver is used, not an incoherent ground-space average. Another solver may select a different ground vector.")
    return {
        "engine": "SciPy exact diagonalization + independent scipy.linalg.expm check + Pauli product formula",
        "provenance": "exact-toy", "params": p.model_dump(), "terms": terms,
        "groundEnergy": float(eg), "groundState": [{"re": float(v), "im": 0.0} for v in ground],
        "eigenvalues": values.tolist(), "transitions": transitions, "times": times.tolist(),
        "correlationReal": correlation.real.tolist(), "correlationImag": correlation.imag.tolist(),
        "trotterReal": trotter_correlation.real.tolist(), "trotterImag": trotter_correlation.imag.tolist(),
        "fidelity": fidelity.tolist(), "finalFidelity": float(fidelity[-1]),
        "spectralEnergy": fft["energy"].tolist(), "spectrumReference": reference.tolist(),
        "spectrumFourierSigned": fft["signed"].tolist(), "spectrumFourierClipped": fft["clipped"].tolist(),
        "spectrumTrotterSigned": trotter_fft["signed"].tolist(), "spectrumTrotterClipped": trotter_fft["clipped"].tolist(),
        "circuit": circuit,
        "resources": {"gatesPerStep": len(circuit), "depth": len(circuit) * p.trotterSteps,
                      "entanglingGates": sum(g["gate"] == "CX" for g in circuit) * p.trotterSteps,
                      "steps": p.trotterSteps,
                      "convention": "Serial unoptimized CX–Rx–CX decomposition of XX; no preparation, excitation, measurement or routing."},
        "validation": {
            "hermiticityError": float(np.max(abs(h - h.T.conj()))),
            "normError": float(max(np.max(abs(np.sum(abs(exact_states) ** 2, axis=1) - 1)), np.max(abs(np.sum(abs(trotter) ** 2, axis=1) - 1)))),
            "unitarityError": float(np.max(abs(diagonal_propagator.conj().T @ diagonal_propagator - np.eye(len(h))))),
            "groundResidual": float(np.max(abs(h @ ground - eg * ground))),
            "correlationAtZeroError": float(abs(correlation[0] - 1)),
            "transitionWeightError": float(abs(np.sum(weights) - 1)),
            "fftMinimum": fft["minimum"], "negativeBins": fft["negativeBins"], "clippedArea": fft["clippedArea"],
            "resolution": float(2 * np.pi / p.timeMax), "paddedGridSpacing": float(fft["spacing"]),
            "nyquist": float(fft["nyquist"]), "expmError": float(np.max(abs(diagonal_propagator - reference_propagator))),
            "spectralL1TrotterVsExact": l1_trotter, "spectralL1FourierVsReference": l1_reference,
            "spectralRmseFourierVsReference": rmse_reference,
            "groundGap": float(values[1] - eg), "groundDegeneracy": ground_degeneracy,
            "trotterFftMinimum": trotter_fft["minimum"], "trotterNegativeBins": trotter_fft["negativeBins"],
            "trotterClippedArea": trotter_fft["clippedArea"],
        }, "caveats": caveats,
    }
