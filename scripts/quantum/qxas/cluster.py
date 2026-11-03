"""Clusters cut from a crystal around one absorbing atom, for the oxygen K edge.

Fomichev et al. (2405.11015) cut O-centred clusters from Li2MnO3 (Materials Project mp-1173926); the largest,
Li4Mn2O, is the oxygen with its first shell of two Mn and four Li. The structure here is the refined C2/m one of
Strobel and Lambert-Andron (1988), COD 1008373 (public domain), in scripts/quantum/structures/.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import numpy as np
from pymatgen.io.cif import CifParser


def first_shells(cif: Path, centre: str = "O", cutoff: float = 2.4) -> list[dict]:
    """Every symmetry-distinct `centre` site with its first shell: label, neighbour counts, distances, coordinates."""
    parser = CifParser(str(cif))
    structure = parser.parse_structures(primitive=False)[0]
    seen, shells = set(), []
    for site in structure:
        label = site.label
        if site.specie.symbol != centre or label in seen:
            continue
        seen.add(label)
        neighbours = sorted(structure.get_neighbors(site, cutoff), key=lambda n: n.nn_distance)
        atoms = [(centre, np.zeros(3))] + [(n.specie.symbol, n.coords - site.coords) for n in neighbours]
        shells.append({"label": label,
                       "multiplicity": sum(1 for s in structure if s.label == label),
                       "counts": dict(Counter(n.specie.symbol for n in neighbours)),
                       "distances_A": [round(float(n.nn_distance), 4) for n in neighbours],
                       "atoms": [(symbol, [round(float(x), 6) for x in xyz]) for symbol, xyz in atoms]})
    return shells
