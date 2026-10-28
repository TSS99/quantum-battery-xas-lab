"""Crystal models for the FEFF6L library built from Crystallography Open Database CIFs.

The CIFs are stored in scripts/twin/cod/ (COD data are public domain), so nothing is downloaded at generation time;
`python scripts/twin/structures_cod.py --fetch` downloads them once. Unlike the hand-entered entries in structures.py,
the reference density and the first-shell distance here come from the same deposited coordinates (the X-ray density
of the cell and the nearest absorber-neighbour distance), so validate() checks the transcription and the symmetry,
not the structure against an independent number. Each entry says so in its notes and cites the deposited paper.
"""

import json
import sys
import urllib.request
from pathlib import Path

from pymatgen.io.cif import CifParser
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

from structures import Crystal, Nearest, Position, Source

COD_DIR = Path(__file__).resolve().parent / "cod"

# id, COD entry, absorber, edge, the material's usual name
ENTRIES = (
    ("ti", 9008517, "Ti", "K", "alpha titanium (hcp)"),
    ("cr", 9008531, "Cr", "K", "chromium (bcc)"),
    ("mn", 9011108, "Mn", "K", "alpha manganese"),
    ("co", 9010967, "Co", "K", "cobalt (hcp)"),
    ("zn", 9012435, "Zn", "K", "zinc (hcp)"),
    ("mo", 4001308, "Mo", "K", "molybdenum (bcc)"),
    ("pd", 9009820, "Pd", "K", "palladium (fcc)"),
    ("au", 9013035, "Au", "L3", "gold (fcc)"),
    ("w", 9006486, "W", "L3", "tungsten (bcc)"),
    ("cu2o", 9007497, "Cu", "K", "cuprite"),
    ("cuo", 9014580, "Cu", "K", "tenorite"),
    ("mno", 9006658, "Mn", "K", "manganosite"),
    ("mn2o3", 2105791, "Mn", "K", "bixbyite"),
    ("mno2", 1514117, "Mn", "K", "pyrolusite"),
    ("feo", 9009766, "Fe", "K", "wustite"),
    ("fe2o3", 9000139, "Fe", "K", "hematite"),
    ("co3o4", 9005896, "Co", "K", "cobalt spinel"),
    ("coo", 1533087, "Co", "K", "cobalt(II) oxide"),
    ("tio2-anatase", 7206075, "Ti", "K", "anatase"),
    ("tio2-rutile", 4102355, "Ti", "K", "rutile"),
    ("cr2o3", 9008084, "Cr", "K", "eskolaite"),
    ("k2cro4", 9007570, "Cr", "K", "potassium chromate"),
    ("pbo", 9012700, "Pb", "L3", "litharge"),
    ("zns", 9000107, "S", "K", "sphalerite"),
    ("na2so4", 9004092, "S", "K", "thenardite"),
    ("nacl", 7132177, "Cl", "K", "halite"),
    ("kcl", 1011127, "K", "K", "sylvite"),
    ("caco3", 1547350, "Ca", "K", "calcite"),
)


def fetch():
    COD_DIR.mkdir(exist_ok=True)
    for _, cod, *_ in ENTRIES:
        path = COD_DIR / f"{cod}.cif"
        if not path.exists():
            with urllib.request.urlopen(f"https://www.crystallography.net/cod/{cod}.cif", timeout=60) as r:
                path.write_bytes(r.read())
            print("fetched", path.name)


def _cif_field(text, key):
    for line in text.splitlines():
        if line.lower().startswith(key):
            value = line[len(key):].strip().strip("'\"")
            if value and value not in ("?", "."):
                return value
    return ""


def _authors(text):
    lines, out, inside = text.splitlines(), [], False
    for line in lines:
        s = line.strip()
        if s.lower() == "_publ_author_name":
            inside = True
            continue
        if inside:
            if not s or s.startswith("_") or s.lower().startswith("loop_"):
                break
            out.append(s.strip("'\""))
    return out


def citation(cod, text):
    authors = _authors(text)
    names = (authors[0] + (" et al." if len(authors) > 2 else f" and {authors[1]}" if len(authors) == 2 else "")) if authors else "COD entry"
    journal = _cif_field(text, "_journal_name_full") or _cif_field(text, "_journal_name_abbrev") or _cif_field(text, "_journal_coden_astm")
    volume, page, year = _cif_field(text, "_journal_volume"), _cif_field(text, "_journal_page_first"), _cif_field(text, "_journal_year")
    reference = f"{names}, {journal} {volume}, {page} ({year})".replace(" ,", ",")
    doi = _cif_field(text, "_journal_paper_doi") or _cif_field(text, "_journal_doi")
    return Source(reference, doi, f"COD {cod}", f"https://www.crystallography.net/cod/{cod}.html")


def _snap(x):
    """A fractional coordinate in [0, 1): exactly k/24 when it is one (so 1/3 stays 1/3), else to 1e-7."""
    x %= 1.0
    k = round(x * 24)
    return (k % 24) / 24 if abs(x * 24 - k) < 2e-4 else round(x, 7) % 1.0


def build(id_, cod, absorber, edge, name):
    text = (COD_DIR / f"{cod}.cif").read_text(encoding="utf-8", errors="replace")
    deposited = CifParser.from_str(text).parse_structures(primitive=False)[0]
    analyzer = SpacegroupAnalyzer(deposited, symprec=1e-3)
    refined = analyzer.get_refined_structure()
    dataset = SpacegroupAnalyzer(refined, symprec=1e-3).get_symmetry_dataset()
    source = citation(cod, text)
    positions, seen, counts = [], {}, {}
    for i, site in enumerate(refined):
        orbit = int(dataset.equivalent_atoms[i])
        counts[orbit] = counts.get(orbit, 0) + 1
        if orbit not in seen:
            seen[orbit] = (site.specie.symbol, dataset.wyckoffs[i], [_snap(float(x)) for x in site.frac_coords])
    for n, (orbit, (element, letter, xyz)) in enumerate(sorted(seen.items())):
        positions.append(Position(f"{element}{n + 1}", element, f"{counts[orbit]}{letter}", tuple(xyz)))
    structure = refined
    nearest = []
    for p in positions:
        if p.element != absorber:
            continue
        index = next(i for i, s in enumerate(structure) if s.specie.symbol == absorber and int(dataset.equivalent_atoms[i]) == next(o for o, v in seen.items() if v[2] == list(p.fractional)))
        n0 = min(structure.get_neighbors(structure[index], 7), key=lambda nb: nb.nn_distance)
        nearest.append(Nearest(p.label, n0.specie.symbol, round(float(n0.nn_distance), 4), source))
    lattice = refined.lattice
    # The setting symbol that rebuilds this cell: spglib's choice, then the plain symbol, origin choices and hexagonal axes.
    intl = dataset.international
    settings = [f"{intl}:{dataset.choice}"] if dataset.choice else []
    settings += [intl, f"{intl}:2", f"{intl}:1"] + ([f"{intl}:H"] if intl.startswith("R") else [])
    from structures import validate
    for setting in dict.fromkeys(settings):
        crystal = _crystal(id_, cod, absorber, edge, name, refined, dataset, setting, positions, source, nearest)
        try:
            validate(crystal)
            return crystal
        except Exception:  # noqa: BLE001
            continue
    raise ValueError(f"{id_}: no setting of {intl} rebuilds the deposited cell")


def _crystal(id_, cod, absorber, edge, name, refined, dataset, setting, positions, source, nearest):
    lattice = refined.lattice
    return Crystal(
        id_, refined.composition.reduced_formula, absorber, edge, int(dataset.number), setting,
        tuple(round(float(x), 6) for x in (*lattice.abc, *lattice.angles)), tuple(positions), source,
        round(float(refined.density), 4), Source(f"X-ray density of the deposited cell; {source.reference}", source.doi, source.locator, source.url),
        tuple(nearest), 295.0,
        f"{name.capitalize()}, built from the deposited CIF (COD {cod}). The density and first-shell checks use the same "
        "coordinates, so they check the transcription and symmetry, not the structure against an independent value.",
    )


def _with_absorber(crystal, id_, absorber, edge):
    """A library structure probed at another element's edge; the nearest-neighbour reference comes from its own cell."""
    from dataclasses import replace
    from structures import validate
    structure, _, _ = validate(crystal)
    nearest = []
    for p in crystal.positions:
        if p.element != absorber:
            continue
        index = next(i for i, s in enumerate(structure) if s.properties["orbit"] == p.label)
        n0 = min(structure.get_neighbors(structure[index], 7), key=lambda nb: nb.nn_distance)
        nearest.append(Nearest(p.label, n0.specie.symbol, round(float(n0.nn_distance), 4), crystal.citation))
    return replace(crystal, id=id_, absorber=absorber, edge=edge, nearest=tuple(nearest),
                   notes=(crystal.notes + " " if crystal.notes else "") + f"Probed at the {absorber} {edge} edge; its first-shell reference is from the same coordinates.")


def cod_crystals():
    from structures import CRYSTALS
    lifepo4 = next(c for c in CRYSTALS if c.id == "lifepo4")
    return tuple(build(*entry) for entry in ENTRIES) + (_with_absorber(lifepo4, "lifepo4-p", "P", "K"),)


if __name__ == "__main__":
    if "--fetch" in sys.argv:
        fetch()
    from structures import validate
    for crystal in cod_crystals():
        try:
            _, checks, sites = validate(crystal)
            print(crystal.id, crystal.formula, crystal.setting, checks["density"]["computed_g_cm3"],
                  [(n["site"], n["element"], n["computed_A"]) for n in checks["nearest"]], len(sites), "sites")
        except Exception as e:  # noqa: BLE001
            print(crystal.id, "FAILED", e)
