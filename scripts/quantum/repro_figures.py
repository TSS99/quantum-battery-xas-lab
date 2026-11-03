#!/usr/bin/env python
"""Figures for docs/QUANTUM_REPRO.md from the results in src/data/quantum/repro/.

  python scripts/quantum/repro_figures.py

Colours are the Okabe and Ito set (safe for colour vision deficiency); every series also differs by line style and is
named in the legend, so colour is never the only cue.
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "src" / "data" / "quantum" / "repro"
OUT = ROOT / "docs" / "quantum"
INK, MUTED, GRID = "#1f2328", "#6e7781", "#d8dee4"
BLUE, VERMILLION, GREEN, PURPLE = "#0072B2", "#D55E00", "#009E73", "#CC79A7"
HARTREE_EV = 27.211386245988


def style(ax, xlabel, ylabel):
    ax.set_xlabel(xlabel, color=INK)
    ax.set_ylabel(ylabel, color=INK)
    ax.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(MUTED)
    ax.tick_params(colors=MUTED)


def spectra(name: str, series: list[tuple[str, str, str, str]], title: str, file: str, xlim=None):
    d = json.loads((DATA / name).read_text())
    w = np.array(d["grid_Ha"])
    fig, ax = plt.subplots(figsize=(7.2, 4.6), dpi=150)
    for key, label, colour, line in series:
        ax.plot(w, d["spectra"][key], line, color=colour, linewidth=2 if line == "-" else 1.6, label=label)
    style(ax, "Energy above the ground state, w (Ha)", "Absorption (arb. units)")
    if xlim:
        ax.set_xlim(*xlim)
    ax.set_title(title, color=INK, fontsize=11, loc="left")
    ax.legend(frameon=False, fontsize=8.5, loc="upper left", bbox_to_anchor=(0, -0.16))
    fig.tight_layout()
    fig.savefig(OUT / file)
    plt.close(fig)


def fig8():
    d = json.loads((DATA / "n2-fig8.json").read_text())
    w = np.array(d["grid_Ha"])
    fig, axes = plt.subplots(2, 1, figsize=(7.2, 7.4), dpi=150, sharex=True)
    panels = (
        ("References", [("all_states", "Exact, every state", INK, "-"),
                        ("lowest_states", "Exact, 250 lowest states (paper)", MUTED, "-."),
                        ("all_states_same_times", "Perfect quantum computer, 50 times", GREEN, ":")]),
        ("The quantum algorithm, 10,000 shots", [
            ("all_states", "Exact, every state", INK, "-"),
            ("quantum_exact_with_shots", "Exact factorization, 53 fragments", BLUE, "--"),
            ("quantum_cdf_with_shots", "Compressed, L = N, 10 fragments", VERMILLION, ":")]),
    )
    for ax, (title, series) in zip(axes, panels):
        for key, label, colour, line in series:
            ax.plot(w, d["spectra"][key], line, color=colour, linewidth=2 if line == "-" else 1.6, label=label)
        style(ax, "", "Absorption (arb. units)")
        ax.set_title(title, color=INK, fontsize=10, loc="left")
        ax.legend(frameon=False, fontsize=8.5, loc="center right", bbox_to_anchor=(1.0, 0.62))
        ax.set_xlim(0, 3)
    axes[1].set_xlabel("Energy above the ground state, w (Ha)", color=INK)
    fig.suptitle("N2 in CAS(14e,10o), Fig. 8 of 2506.15784 (21 qubits)", x=0.02, ha="left", color=INK, fontsize=11)
    fig.tight_layout()
    fig.savefig(OUT / "n2-fig8.png")
    plt.close(fig)


def resources():
    d = json.loads((DATA / "resources.json").read_text())
    rows = d["rows"]
    n = [r["orbitals"] for r in rows]
    fig, ax = plt.subplots(figsize=(7.2, 3.8), dpi=150)
    for key, label, colour, marker in (("toffoli_total", "Whole spectrum", BLUE, "o"),
                                       ("toffoli_longest", "Longest circuit", VERMILLION, "s")):
        ax.plot(n, [r[key] for r in rows], "-", color=colour, marker=marker, linewidth=2, markersize=6,
                label=f"{label}, this reproduction")
        ax.plot(n, [r[key + "_paper"] for r in rows], "--", color=colour, marker=marker, markerfacecolor="white",
                linewidth=1.4, markersize=6, label=f"{label}, paper Table I")
    ax.set_yscale("log")
    style(ax, "Active space, N spatial orbitals of Li4Mn2O", "Toffoli gates")
    ax.set_title("Fault tolerant cost: PennyLane estimator against 2506.15784 Table I", color=INK, fontsize=11, loc="left")
    ax.legend(frameon=False, fontsize=8.5)
    fig.tight_layout()
    fig.savefig(OUT / "resources.png")
    plt.close(fig)


def limno():
    d = json.loads((DATA / "limno-k.json").read_text())
    w = np.array(d["grid_Ha"]) * HARTREE_EV
    scale = max(d["spectra"]["all_states"])
    fig, ax = plt.subplots(figsize=(7.2, 4.6), dpi=150)
    for key, label, colour, line in (
            ("all_states", "Exact, every core excited state", INK, "-"),
            ("quantum_exact_jmax50", "Quantum algorithm, exact factorization, j_max = 50, 5,000 shots", BLUE, "--"),
            ("quantum_cdf_jmax50", "Quantum algorithm, compressed factorization (L = N), j_max = 50", VERMILLION, ":"),
            ("quantum_exact_jmax10", "Quantum algorithm, exact factorization, j_max = 10", PURPLE, "-.")):
        ax.plot(w, np.array(d["spectra"][key]) / scale, line, color=colour, linewidth=2 if line == "-" else 1.6,
                label=label)
    style(ax, "Photon energy, E - E_I (eV)", "Absorption (exact peak = 1)")
    ax.set_xlim(545, 590)
    ax.set_title("Oxygen K edge of Li4Mn2O, CAS(14e,11o), 23 qubits", color=INK, fontsize=11, loc="left")
    ax.legend(frameon=False, fontsize=8.5, loc="upper left", bbox_to_anchor=(0, -0.16))
    fig.tight_layout()
    fig.savefig(OUT / "limno-k.png")
    plt.close(fig)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if (DATA / "n2-demo.json").exists():
        spectra("n2-demo.json", [
            ("all_states", "Exact, every state", INK, "-"),
            ("quantum_exact_with_shots", "Quantum algorithm, exact factorization, 100,000 shots", BLUE, "--"),
            ("quantum_cdf_with_shots", "Quantum algorithm, compressed factorization (10), 100,000 shots", VERMILLION, ":"),
        ], "N2 in CAS(4e,5o), the PennyLane demo's case (11 qubits)", "n2-demo.png", (0, 2.5))
    if (DATA / "n2-fig8.json").exists():
        fig8()
    if (DATA / "resources.json").exists():
        resources()
    if (DATA / "limno-k.json").exists():
        limno()


if __name__ == "__main__":
    main()
