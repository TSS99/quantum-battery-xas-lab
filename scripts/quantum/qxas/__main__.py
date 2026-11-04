"""The qxas command line: build a problem from a recipe, export its Hamiltonian, and estimate its fault tolerant cost.

  qxas build recipe.json --out folder        # PySCF: SCF, AVAS active space, integrals, exact reference
  qxas fcidump instance.json --out FCIDUMP   # the active space Hamiltonian, core valence separation applied
  qxas estimate --orbitals 11 --eta 0.01     # logical qubits, Toffoli gates, run time, machine fit

A recipe is the JSON of `qxas.builder.Recipe`; the MCP tool quantum_build writes one from a library problem
(`recipe_for`). `structure` names a CIF in scripts/quantum/structures or gives a path of your own.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="qxas", description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="build a problem instance from a recipe JSON")
    build.add_argument("recipe", type=Path)
    build.add_argument("--out", type=Path, default=Path("."))
    dump = commands.add_parser("fcidump", help="write an instance's active space Hamiltonian as FCIDUMP")
    dump.add_argument("instance", type=Path)
    dump.add_argument("--out", type=Path, default=Path("FCIDUMP"))
    estimate = commands.add_parser("estimate", help="fault tolerant cost for a number of active orbitals")
    estimate.add_argument("--orbitals", type=int, required=True)
    estimate.add_argument("--eta", type=float, default=None, help="resolution, Lorentzian half width in Ha (default 0.05)")
    args = parser.parse_args(argv)

    if args.command == "build":
        from .builder import Recipe, content_hash, instance, write
        fields = json.loads(args.recipe.read_text())
        recipe = Recipe(**{k: tuple(v) if isinstance(v, list) else v for k, v in fields.items()})
        data = instance(recipe)
        path = write(data, args.out)
        m, ref = data["meta"], data.get("reference")
        print(f"{recipe.id}: CAS({m['active_electrons']}e,{m['active_orbitals']}o), {m['qubits']} qubits, {m['ci_dimension']} determinants, "
              + (f"edge {ref['edge_eV']:.2f} eV" if ref else "no exact reference") + f", hash {content_hash(data)} -> {path}")
    elif args.command == "fcidump":
        from pyscf.tools import fcidump
        import numpy as np
        i = json.loads(args.instance.read_text())["integrals"]
        fcidump.from_integrals(str(args.out), np.array(i["h1"]), np.array(i["h2"]), i["n_orb"], tuple(i["n_elec"]),
                               nuc=i["e_core"], ms=i["n_elec"][0] - i["n_elec"][1])
        print(f"{args.out}: {i['n_orb']} orbitals, {sum(i['n_elec'])} electrons, O 1s is orbital {i['core'][0] + 1}. The core valence "
              "separation keeps terms that move two core electrons at once, so keep the O 1s doubly occupied for the ground state.")
    else:
        from .resources import ETA, cost
        json.dump(cost(args.orbitals, args.eta or ETA), sys.stdout, indent=1)
        print()


if __name__ == "__main__":
    main()
