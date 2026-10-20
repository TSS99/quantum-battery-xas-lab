"""Audited, hand-entered crystal models for the FEFF6L library.

Lengths are angstroms; coordinates are fractional in the stated conventional cell.
Nothing is downloaded at generation time. Sources are journal articles or their
deposited data, never ICSD rows. A failed check aborts generation, not validation.
"""

from dataclasses import asdict, dataclass
from math import isfinite

from pymatgen.core import Composition, Lattice, Structure
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer


@dataclass(frozen=True)
class Source:
    reference: str
    doi: str
    locator: str
    url: str = ""


@dataclass(frozen=True)
class Position:
    label: str
    element: str
    wyckoff: str
    fractional: tuple[float, float, float]


@dataclass(frozen=True)
class Nearest:
    site: str
    element: str
    distance_A: float
    source: Source


@dataclass(frozen=True)
class Crystal:
    id: str
    formula: str
    absorber: str
    edge: str
    space_group: int
    setting: str
    lattice_A_deg: tuple[float, float, float, float, float, float]
    positions: tuple[Position, ...]
    citation: Source
    density_g_cm3: float
    density_source: Source
    nearest: tuple[Nearest, ...]
    temperature_K: float
    notes: str = ""


NIST_DENSITY = Source(
    "Hubbell and Seltzer, NIST Standard Reference Database 126 (1995)",
    "10.18434/T4D01F", "Table 1: nominal elemental densities",
    "https://physics.nist.gov/PhysRefData/XrayMassCoef/tab1.html",
)
CU = Source(
    "Straumanis and Yu, Acta Cryst. A25, 676-682 (1969)",
    "10.1107/S0567739469001549", "Abstract: pure Cu, 25 degrees C",
)
FE_NI = Source(
    "von Batchelder and Raeuchle, Acta Cryst. 7, 464 (1954)",
    "10.1107/S0365110X54001466", "Final lattice parameters at 25 degrees C; cubic symmetries",
)
CU_NN = Source(
    "Meyerheim et al., Phys. Rev. B 85, 125405 (2012)",
    "10.1103/PhysRevB.85.125405", "Table I: Cu crystal at room temperature",
)
FE_NN = Source(
    "Extended X-ray absorption fine structure investigation of the structure of iron overlayers on Cu(111), Surface Science 454-456, 719-722 (2000)",
    "10.1016/S0039-6028(00)00092-3", "Abstract: bulk bcc iron distance",
)
NI_NN = Source(
    "Local Geometry and Electronic Properties of Nickel Nanoparticles Prepared via Thermal Decomposition of Ni-MOF-74, Inorg. Chem. (2018)",
    "10.1021/acs.inorgchem.8b01230", "EXAFS discussion: first coordination shell of fcc Ni",
)
PT = Source(
    "Arblaster, Platinum Metals Rev. 41, 12-21 (1997)",
    "10.1595/003214097X4111221", "Tables I and II: selected 293.15 K values; density is crystallographic",
)
LMO = Source(
    "Akimoto et al., Chem. Mater. 12, 3246-3248 (2000)",
    "10.1021/cm0003673", "Publisher supplement, pp. 1-3: cell, density, coordinates and Mn-O distances",
    "https://acs.figshare.com/articles/journal_contribution/3592047",
)
LFP = Source(
    "Streltsov et al., Acta Cryst. B49, 147-153 (1993)",
    "10.1107/S0108768192004701", "IUCr-deposited as0589.cif; abstract density 3.596",
    "https://www.crystallography.net/cod/2100916.cif",
)
LFP_NN = Source(
    "Li et al., Phys. Rev. B 77, 064414 (2008)",
    "10.1103/PhysRevB.77.064414", "Structural description: shortest Fe-O distance 2.064 A",
    "https://www.physics.rutgers.edu/~croft/papers/165-PRB-LiFePO4-2008.pdf",
)
NIO = Source(
    "High-Power-Density Thermoelectrochemical Cell Based on Ni/NiO Nanostructured Microsphere Electrodes with Alkaline Electrolyte, Nanomaterials 13, 2290 (2023)",
    "10.3390/nano13162290", "Rietveld refinement: rocksalt NiO cell and crystallographic density",
)
NIO_NN = Source(
    "Resolving a structural issue in cerium-nickel-based oxide: a single compound or two-phase system?, Dalton Trans. (2024)",
    "10.1039/D3DT03280A", "NiO reference: six O at 2.09 A",
)
MAGNETITE = Source(
    "Fleet, Acta Cryst. B37, 917-920 (1981)",
    "10.1107/S0567740881004597", "Cubic magnetite, origin choice 2; Table 2 bond lengths",
    "https://www.crystallography.net/cod/9007644.cif",
)
ZNO = Source(
    "Kisi and Elcombe, Acta Cryst. C45, 1867-1870 (1989)",
    "10.1107/S0108270189004269", "Abstract: ZnO at 295 K; coordinates and crystallographic density",
)
ZNO_NN = Source(
    "Structural investigations of (Mn, Dy) co-doped ZnO nanocrystals using X-ray absorption studies, RSC Adv. (2017)",
    "10.1039/C7RA10748J", "EXAFS reference model: first Zn-O shell at 1.97 A",
)
LCO = Source(
    "Akimoto, Gotoh and Oosawa, J. Solid State Chem. 141, 298-302 (1998)",
    "10.1006/jssc.1998.7966", "Abstract and Table 2: hexagonal setting, Li 3a, Co 3b, O 6c",
)
LCO_DENSITY = Source(
    "Elastic properties of lithium cobalt oxide (LiCoO2), J. Asian Ceram. Soc. 5, 113-117 (2017)",
    "10.1016/j.jascer.2017.03.001", "Section 3: theoretical density 5.05, distinct from the porous specimen density 4.79",
)
LCO_NN = Source(
    "Maugeri et al., J. Power Sources 229, 272-276 (2013)",
    "10.1016/j.jpowsour.2012.11.127", "Results and discussion: nearest O neighbours at approximately 1.92 A",
)
CERIA = Source(
    "Sabari Arul et al., RSC Adv. 5, 70558-70565 (2015)",
    "10.1039/C5RA09790H", "Table 1: refined fluorite lattice and fully occupied Ce 4a, O 8c positions",
    "https://pubs.rsc.org/en/content/getauthorversionpdf/C5RA09790H",
)
CERIA_DENSITY = Source(
    "Kobayashi and Fujiwara, J. Alloys Compd. 408-412, 1157-1160 (2006)",
    "10.1016/j.jallcom.2004.12.115", "Results and discussion: reference cerium dioxide density 7.215",
)
CERIA_NN = Source(
    "ACS Appl. Energy Mater. 3, 8509-8518 (2020)",
    "10.1021/acsaem.0c01145", "Table 2: bulk CeO2 reference Ce-O distance 2.34(1) A",
    "https://cris.unibo.it/retrieve/e1dcb336-49ea-7715-e053-1705fe0a6cc9/acsaem.0c01145.pdf",
)


def cubic(a):
    return (a, a, a, 90, 90, 90)


CRYSTALS = (
    Crystal("cu", "Cu", "Cu", "K", 225, "Fm-3m", cubic(3.61491),
            (Position("Cu1", "Cu", "4a", (0, 0, 0)),), CU,
            8.9314, CU, (Nearest("Cu1", "Cu", 2.556, CU_NN),), 298.15),
    Crystal("fe-bcc", "Fe", "Fe", "K", 229, "Im-3m", cubic(2.8665),
            (Position("Fe1", "Fe", "2a", (0, 0, 0)),), FE_NI,
            7.874, NIST_DENSITY, (Nearest("Fe1", "Fe", 2.48, FE_NN),), 298.15),
    Crystal("ni", "Ni", "Ni", "K", 225, "Fm-3m", cubic(3.5238),
            (Position("Ni1", "Ni", "4a", (0, 0, 0)),), FE_NI,
            8.902, NIST_DENSITY, (Nearest("Ni1", "Ni", 2.49, NI_NN),), 298.15),
    Crystal("pt", "Pt", "Pt", "L3", 225, "Fm-3m", cubic(3.9236),
            (Position("Pt1", "Pt", "4a", (0, 0, 0)),), PT,
            21.452, PT, (Nearest("Pt1", "Pt", 2.7744, PT),), 293.15),
    Crystal("limn2o4", "LiMn2O4", "Mn", "K", 227, "Fd-3m:2", cubic(8.2483), (
        Position("Li1", "Li", "8a", (.125, .125, .125)),
        Position("Mn1", "Mn", "16d", (.5, .5, .5)),
        Position("O1", "O", "32e", (.26320, .26320, .26320)),
    ), LMO, 4.28, LMO, (Nearest("Mn1", "O", 1.9592, LMO),), 297,
        "Average cubic spinel at 297 K; not a charge-ordered low-temperature model."),
    Crystal("licoo2", "LiCoO2", "Co", "K", 166, "R-3m:H",
            (2.8161, 2.8161, 14.0536, 90, 90, 120), (
        Position("Li1", "Li", "3a", (0, 0, 0)),
        Position("Co1", "Co", "3b", (0, 0, .5)),
        Position("O1", "O", "6c", (0, 0, .23951)),
    ), LCO, 5.05, LCO_DENSITY, (Nearest("Co1", "O", 1.92, LCO_NN),), 298,
        "Fully occupied layered model; no Li/Co antisite mixing."),
    Crystal("lifepo4", "LiFePO4", "Fe", "K", 62, "Pnma",
            (10.332, 6.010, 4.692, 90, 90, 90), (
        Position("Li1", "Li", "4a", (0, 0, 0)),
        Position("Fe1", "Fe", "4c", (.28222, .25, .97472)),
        Position("P1", "P", "4c", (.09486, .25, .41820)),
        Position("O1", "O", "4c", (.09678, .25, .7428)),
        Position("O2", "O", "4c", (.45710, .25, .2060)),
        Position("O3", "O", "8d", (.16558, .04646, .2848)),
    ), LFP, 3.596, LFP, (Nearest("Fe1", "O", 2.064, LFP_NN),), 298),
    Crystal("nio", "NiO", "Ni", "K", 225, "Fm-3m", cubic(4.177), (
        Position("Ni1", "Ni", "4a", (0, 0, 0)),
        Position("O1", "O", "4b", (.5, .5, .5)),
    ), NIO, 6.808, NIO, (Nearest("Ni1", "O", 2.09, NIO_NN),), 298,
        "Average cubic rocksalt model; the small antiferromagnetic rhombohedral distortion is omitted."),
    Crystal("fe3o4", "Fe3O4", "Fe", "K", 227, "Fd-3m:2", cubic(8.3941), (
        Position("FeA", "Fe", "8a", (.125, .125, .125)),
        Position("FeB", "Fe", "16d", (.5, .5, .5)),
        Position("O1", "O", "32e", (.2549, .2549, .2549)),
    ), MAGNETITE, 5.200, MAGNETITE, (
        Nearest("FeA", "O", 1.888, MAGNETITE),
        Nearest("FeB", "O", 2.058, MAGNETITE),
    ), 298, "Average cubic magnetite; tetrahedral and octahedral Fe weights 1/3 and 2/3. No charge ordering."),
    Crystal("zno", "ZnO", "Zn", "K", 186, "P6_3mc",
            (3.2501, 3.2501, 5.2071, 90, 90, 120), (
        Position("Zn1", "Zn", "2b", (1 / 3, 2 / 3, 0)),
        Position("O1", "O", "2b", (1 / 3, 2 / 3, .3817)),
    ), ZNO, 5.67, ZNO, (Nearest("Zn1", "O", 1.97, ZNO_NN),), 295),
    Crystal("ceo2", "CeO2", "Ce", "L3", 225, "Fm-3m", cubic(5.411), (
        Position("Ce1", "Ce", "4a", (0, 0, 0)),
        Position("O1", "O", "8c", (.25, .25, .25)),
    ), CERIA, 7.215, CERIA_DENSITY, (Nearest("Ce1", "O", 2.34, CERIA_NN),), 298,
        "Periodic stoichiometric fluorite using the published refined cell; no nanoparticle surface or oxygen vacancies."),
)

# Explicit scope ledger. Add a source-verified entry above before removing it here.
DROPPED = {
    "co-hcp": ("Co", "Co", "K", "No verified primary-source cell, density and nearest-neighbour reference bundle."),
    "zn-hcp": ("Zn", "Zn", "K", "No verified primary-source cell and nearest-neighbour reference bundle."),
    "ti-hcp": ("Ti", "Ti", "K", "Cell located, but primary-source nearest-neighbour check not verified."),
    "v-bcc": ("V", "V", "K", "No verified primary-source cell and nearest-neighbour reference bundle."),
    "cr-bcc": ("Cr", "Cr", "K", "No verified primary-source cell and nearest-neighbour reference bundle."),
    "pd": ("Pd", "Pd", "K", "Complete primary-source structure and check values not yet transcribed."),
    "ag": ("Ag", "Ag", "K", "Cell and density located; independent published nearest-neighbour value not verified."),
    "au": ("Au", "Au", "L3", "Cell and density located; independent published nearest-neighbour value not verified."),
    "linio2": ("LiNiO2", "Ni", "K", "Ideal ordered coordinates and check values not verified; no antisite-disordered substitution."),
    "li2mno3": ("Li2MnO3", "Mn", "K", "Complete monoclinic coordinates and site-specific checks not verified."),
    "mno": ("MnO", "Mn", "K", "No verified primary-source cell, density and nearest-neighbour reference bundle."),
    "mn3o4": ("Mn3O4", "Mn", "K", "Tetragonal oxygen positions and both absorber-site checks not verified."),
    "beta-mno2": ("MnO2", "Mn", "K", "Primary-source oxygen coordinate and check values not verified."),
    "coo": ("CoO", "Co", "K", "No verified primary-source cell, density and nearest-neighbour reference bundle."),
    "co3o4": ("Co3O4", "Co", "K", "Primary-source oxygen coordinate and both absorber-site checks not verified."),
    "cuo": ("CuO", "Cu", "K", "Complete monoclinic coordinates and check values not verified."),
    "cu2o": ("Cu2O", "Cu", "K", "No verified primary-source cell, density and nearest-neighbour reference bundle."),
    "alpha-fe2o3": ("Fe2O3", "Fe", "K", "Primary-source internal coordinates and check values not verified."),
    "tio2-rutile": ("TiO2", "Ti", "K", "Primary-source oxygen coordinate and check values not verified."),
    "tio2-anatase": ("TiO2", "Ti", "K", "Primary-source origin convention, oxygen coordinate and check values not verified."),
    "v2o5": ("V2O5", "V", "K", "Complete orthorhombic coordinates and check values not verified."),
    "srtio3": ("SrTiO3", "Ti", "K", "No verified primary-source cell, density and nearest-neighbour reference bundle."),
    "fes2": ("FeS2", "Fe", "K", "Primary-source pyrite sulfur coordinate and check values not verified."),
    "li2s": ("Li2S", "S", "K", "No verified primary-source cell, density and nearest-neighbour reference bundle."),
}


def validate(crystal: Crystal):
    """Return (expanded conventional cell, check record, inequivalent absorbers).

    Check against stored literature numbers, never a value generated from this
    cell. Do not use assert: checks must still run with Python's -O option.
    """
    def require(condition, message):
        if not condition:
            raise ValueError(f"{crystal.id}: {message}")

    require(all(isfinite(x) and x > 0 for x in crystal.lattice_A_deg), "invalid lattice")
    require(isfinite(crystal.density_g_cm3) and crystal.density_g_cm3 > 0, "invalid reference density")
    require(crystal.edge in ("K", "L3"), "unsupported edge")
    require(len({p.label for p in crystal.positions}) == len(crystal.positions), "duplicate position labels")
    for p in crystal.positions:
        require(all(isfinite(x) and 0 <= x < 1 for x in p.fractional), "invalid fractional position")
    lattice = Lattice.from_parameters(*crystal.lattice_A_deg)
    structure = Structure.from_spacegroup(
        crystal.setting, lattice,
        [p.element for p in crystal.positions],
        [p.fractional for p in crystal.positions],
        site_properties={"orbit": [p.label for p in crystal.positions]},
    )
    require(structure.is_ordered, "disordered occupations are unsupported")
    require(structure.composition.fractional_composition.almost_equals(
        Composition(crystal.formula).fractional_composition, rtol=0, atol=1e-10
    ), f"composition {structure.composition} does not match {crystal.formula}")
    density = float(structure.density)
    density_error = abs(density / crystal.density_g_cm3 - 1)
    require(density_error <= .02, f"density differs by {100 * density_error:.3f}%")
    symmetry = []
    partitions = []
    for symprec in (1e-4, 1e-3, 1e-2):
        analyzer = SpacegroupAnalyzer(structure, symprec=symprec, angle_tolerance=.1)
        dataset = analyzer.get_symmetry_dataset()
        require(dataset is not None, "symmetry analysis failed")
        require(dataset.number == crystal.space_group, f"space group {dataset.number}, expected {crystal.space_group}")
        partitions.append(tuple(int(x) for x in dataset.equivalent_atoms))
        symmetry.append({"symprec_A": symprec, "space_group": int(dataset.number),
                         "standard_origin_shift": [float(x) for x in dataset.origin_shift]})
    require(all(p == partitions[0] for p in partitions), "symmetry site partition changes with tolerance")
    for p in crystal.positions:
        indices = [i for i, s in enumerate(structure) if s.properties["orbit"] == p.label]
        require(len(indices) == int(p.wyckoff[:-1]), f"wrong multiplicity for {p.label}")
        require(len({partitions[0][i] for i in indices}) == 1, f"split orbit {p.label}")
        # spglib standardizes the origin (including swapping 8a/8b and 16c/16d
        # in spinels). Only compare letters when it retained the input origin.
        if all(abs(x) < 1e-8 for x in dataset.origin_shift):
            require(all(dataset.wyckoffs[i] == p.wyckoff[-1] for i in indices), f"wrong Wyckoff letter for {p.label}")
    absorbers = [p for p in crystal.positions if p.element == crystal.absorber]
    require(bool(absorbers), "no absorber")
    require({n.site for n in crystal.nearest} == {p.label for p in absorbers}, "missing/extra nearest-neighbour checks")
    require(len(crystal.nearest) == len(absorbers), "duplicate nearest-neighbour checks")
    sites = []
    nearest_checks = []
    total = sum(1 for s in structure if s.specie.symbol == crystal.absorber)
    orbit_representatives = []
    for position in absorbers:
        indices = [i for i, s in enumerate(structure) if s.properties["orbit"] == position.label]
        index = min(indices, key=lambda i: tuple(structure[i].frac_coords))
        orbit_representatives.append(partitions[0][index])
        ref = next(n for n in crystal.nearest if n.site == position.label)
        require(isfinite(ref.distance_A) and ref.distance_A > 0, "invalid nearest-neighbour reference")
        neighbours = structure.get_neighbors(structure[index], 7)
        require(bool(neighbours), f"no neighbours of {position.label}")
        nearest = min(neighbours, key=lambda n: n.nn_distance)
        distance = float(nearest.nn_distance)
        error = abs(distance - ref.distance_A)
        require(nearest.specie.symbol == ref.element, f"wrong nearest element at {position.label}")
        require(error <= .02, f"{position.label} nearest distance {distance:.6f}, expected {ref.distance_A}")
        nearest_checks.append({
            **asdict(ref), "computed_A": distance, "absolute_error_A": error,
            "tolerance_A": .02, "passed": True,
        })
        sites.append({"id": position.label, "index": index, "multiplicity": len(indices),
                      "weight": len(indices) / total, "wyckoff": position.wyckoff})
    require(len(set(orbit_representatives)) == len(orbit_representatives), "absorber sites are symmetry-equivalent")
    checks = {
        "passed": True,
        "composition": {"expected": crystal.formula, "cell": structure.composition.get_el_amt_dict(), "passed": True},
        "density": {"literature_g_cm3": crystal.density_g_cm3, "computed_g_cm3": density,
                    "relative_error": density_error, "tolerance": .02,
                    "source": asdict(crystal.density_source), "passed": True},
        "nearest": nearest_checks, "symmetry": symmetry,
    }
    return structure, checks, sites


if __name__ == "__main__":
    for crystal in CRYSTALS:
        _, checks, sites = validate(crystal)
        print(crystal.id, checks["density"]["computed_g_cm3"],
              [(n["site"], n["computed_A"]) for n in checks["nearest"]], sites)
