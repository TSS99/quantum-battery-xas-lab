"""Recipes for spectroscopy problems, and the instance files built from them (Phase 2 of docs/PLAN-quantum.md).

A recipe is plain data: where the atoms come from (a crystal site's first shell, with atoms removed for delithiated
variants, or a molecule), charge and spin with the reason for them, basis, how the active space is picked (AVAS
labels and threshold), and which orbital is the core hole. `build` turns it into a Problem and metadata; `instance`
adds the exact reference spectrum when the determinant space is small enough, and `write` stores it all as one JSON
file whose hash is a hash of its own stored numbers, so anyone can check a file without rebuilding it.

SCF is the slow step for the Mn clusters (minutes), so converged orbitals are cached by the hash of what determines
them (atoms, charge, spin, basis).
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from pyscf import gto, scf
from pyscf.mcscf import avas

from . import exact, problem
from .cluster import first_shells

STRUCTURES = Path(__file__).resolve().parents[1] / "structures"
CACHE = Path.home() / ".cache" / "qxas"
HARTREE_EV = 27.211386245988
DIGITS = 12  # significant digits kept in instance files; the hash is of these rounded numbers


@dataclass(frozen=True)
class Recipe:
    id: str
    title: str
    why: str
    avas: tuple[str, ...]
    core: str
    structure: str = ""
    site: str = ""
    remove: tuple[str, ...] = ()
    atoms: str = ""
    charge: int = 0
    spin: int = 0
    basis: str = "cc-pvdz"
    threshold: float = 0.5
    symmetry: bool = False
    tags: tuple[str, ...] = field(default_factory=tuple)


def geometry(recipe: Recipe) -> list[tuple[str, tuple[float, float, float]]]:
    """The atoms, in Angstrom. For a crystal site: the absorber at the origin and its first shell, minus the atoms
    in `remove`, each named by its crystal site and taken nearest first."""
    if recipe.atoms:
        mol = gto.M(atom=recipe.atoms, unit="Angstrom")
        return [(mol.atom_symbol(i), tuple(np.round(mol.atom_coord(i, unit="Angstrom"), 6))) for i in range(mol.natm)]
    shell = next(s for s in first_shells(STRUCTURES / recipe.structure) if s["label"] == recipe.site)
    keep = list(range(len(shell["atoms"])))
    for label in recipe.remove:
        index = next(i for i in keep if shell["sites"][i] == label and i > 0)
        keep.remove(index)
    return [(shell["atoms"][i][0], tuple(shell["atoms"][i][1])) for i in keep]


def _scf(recipe: Recipe, mol: gto.Mole) -> scf.hf.SCF:
    key = hashlib.sha256(json.dumps([geometry(recipe), recipe.charge, recipe.spin, recipe.basis,
                                     recipe.symmetry]).encode()).hexdigest()[:16]
    CACHE.mkdir(parents=True, exist_ok=True)
    chk = CACHE / f"{key}.chk"  # recipes with the same atoms, charge, spin and basis share their orbitals
    mf = scf.ROHF(mol).newton()
    mf.max_cycle, mf.chkfile = 100, str(chk)
    if chk.exists():
        mf.init_guess = "chkfile"
    mf.kernel()
    return mf


def build(recipe: Recipe) -> tuple[problem.Problem, dict]:
    """The Problem a recipe defines, and what was found on the way."""
    t0 = time.time()
    mol = gto.M(atom=[[s, xyz] for s, xyz in geometry(recipe)], basis=recipe.basis, charge=recipe.charge,
                spin=recipe.spin, symmetry=recipe.symmetry, verbose=0)
    mf = _scf(recipe, mol)
    n_orb, n_elec, mo = avas.avas(mf, list(recipe.avas), threshold=recipe.threshold, canonicalize=True, verbose=0)
    ncore = (mol.nelectron - n_elec) // 2
    act = mo[:, ncore:ncore + n_orb]
    s = mol.intor("int1e_ovlp")
    projected = (s @ act) * act  # Mulliken weight of each AO in each active orbital
    labels = mol.ao_labels()
    composition = []
    for k in range(n_orb):
        w = projected[:, k]
        top = np.argsort(-w)[:3]
        composition.append([[labels[i].strip(), round(float(w[i]), 3)] for i in top])
    core_ao = mol.search_ao_label([recipe.core])
    core_index = int(np.argmax(np.abs((s @ act)[core_ao]).sum(axis=0)))
    prob = problem.from_casci(recipe.id, mol, mf, n_orb, n_elec, mo_coeff=mo, core_mo=[core_index], ncore=ncore,
                              notes={"recipe": asdict(recipe)})
    meta = {"scf_energy_Ha": float(mf.e_tot), "scf_converged": bool(mf.converged), "electrons": int(mol.nelectron),
            "basis_functions": int(mol.nao), "active_orbitals": int(n_orb), "active_electrons": int(n_elec),
            "qubits": 2 * int(n_orb) + 1, "core_index": core_index, "composition": composition,
            "ci_dimension": int(np.prod(prob.ci_shape())), "seconds_build": round(time.time() - t0, 1)}
    return prob, meta


def instance(recipe: Recipe, reference_limit: int = 250_000, lanczos_steps: int = 300) -> dict:
    """Everything an instance file holds: recipe, metadata, integrals, and (when the determinant space is at most
    `reference_limit`) the initial state energy and the exact stick spectrum of every state the dipole reaches."""
    prob, meta = build(recipe)
    out = {"schema": 1, "recipe": asdict(recipe), "meta": meta,
           "integrals": {"n_orb": prob.n_orb, "n_elec": list(prob.n_elec), "e_core": prob.e_core, "core": prob.core,
                         "h1": prob.h1.tolist(), "h2": prob.h2.tolist(), "dipoles": prob.dipoles.tolist()}}
    if meta["ci_dimension"] <= reference_limit:
        t0 = time.time()
        e0, ci0 = prob.ground_state()
        states, norms = prob.dipole_states(ci0)
        centres, weights = exact.krylov_measure(prob, ci0, e0, steps=lanczos_steps)
        keep = weights > 1e-12 * weights.sum()
        edge = float(centres[keep][weights[keep] > 0.02 * weights.max()].min())
        out["reference"] = {"method": f"Lanczos, {lanczos_steps} steps, full reorthogonalization",
                            "initial_energy_Ha": e0, "dipole_norms": norms.tolist(),
                            "centres_Ha": centres[keep].tolist(), "weights": weights[keep].tolist(),
                            "edge_Ha": edge, "edge_eV": edge * HARTREE_EV, "seconds": round(time.time() - t0, 1)}
    return _rounded(out)


def _rounded(value):
    if isinstance(value, float):
        return float(f"{value:.{DIGITS}g}")
    if isinstance(value, dict):
        return {k: _rounded(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_rounded(v) for v in value]
    return value


def content_hash(data: dict) -> str:
    """Hash of an instance's stored numbers and recipe (everything but the hash and the timings)."""
    body = {k: v for k, v in data.items() if k not in ("hash",)}
    body["meta"] = {k: v for k, v in body["meta"].items() if not k.startswith("seconds")}
    if "reference" in body:
        body["reference"] = {k: v for k, v in body["reference"].items() if k != "seconds"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def write(data: dict, folder: Path) -> Path:
    data = dict(data, hash=content_hash(data))
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{data['recipe']['id']}.json"
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    return path


def load(path: Path) -> tuple[problem.Problem, dict]:
    """A Problem from an instance file, after checking the file's hash."""
    data = json.loads(path.read_text())
    if content_hash(data) != data["hash"]:
        raise ValueError(f"{path.name}: the stored numbers do not match the stored hash.")
    i = data["integrals"]
    prob = problem.Problem(data["recipe"]["id"], i["n_orb"], tuple(i["n_elec"]), i["e_core"], np.array(i["h1"]),
                           np.array(i["h2"]), np.array(i["dipoles"]), list(i["core"]), {"recipe": data["recipe"]})
    return prob, data

