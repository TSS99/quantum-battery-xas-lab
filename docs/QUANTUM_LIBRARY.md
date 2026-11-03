# Quantum XAS, step 2: the problem library

Phase 2 of [PLAN-quantum.md](PLAN-quantum.md). A library of oxygen K edge problems, each built from a written recipe, stored with its integrals and (where exact classical methods can still reach) its exact spectrum, and checked by tests. These are the problems the browser emulator (step 3) and the cost estimator (step 4) will run.

## How a problem is made

`scripts/quantum/qxas/builder.py` turns a recipe into an instance file.

1. **Atoms.** For a solid, the absorbing oxygen and its first shell are cut from a refined crystal structure (COD), and named atoms are removed for delithiated variants. For a molecule, the recipe holds the geometry.
2. **Orbitals.** Restricted open shell Hartree Fock in cc-pVDZ (STO-3G for the browser sized molecules), with PySCF's second order solver; converged orbitals are cached, so a rebuild takes seconds.
3. **Active space.** AVAS projects onto the atomic orbitals the recipe names (for the Mn clusters, Mn 3d and O 1s), and the composition of every active orbital is stored.
4. **Core hole.** The active orbital with the most O 1s character is the core; core valence separation drops every integral with an odd number of core indices.
5. **Reference.** When the determinant space has at most 250,000 determinants, the exact initial state energy and the exact stick spectrum of every state the dipole reaches (Lanczos, 300 steps) are stored too.

Each file's hash is a hash of its own stored numbers (rounded to 12 significant digits), so a file can be checked without rebuilding it. `scripts/quantum/library.py` builds them all and writes `src/data/quantum/instances/index.json`.

## The library

| Problem | Active space | Qubits | Determinants | Exact edge |
| --- | --- | --- | --- | --- |
| Water, oxygen K edge, minimal basis (`h2o-o-k-sto3g`) | CAS(10e,7o) | 15 | 441 | 542.2 eV |
| Carbon monoxide, oxygen K edge, minimal basis (`co-o-k-sto3g`) | CAS(14e,10o) | 21 | 14,400 | 540.0 eV |
| Li4Mn2O from Li2MnO3, O2 site, oxygen K edge (`li2mno3-o2-k`) | CAS(14e,11o) | 23 | 108,900 | 560.5 eV |
| Li4Mn2O from Li2MnO3, O1 site, oxygen K edge (`li2mno3-o1-k`) | CAS(14e,11o) | 23 | 108,900 | 560.5 eV |
| Li3Mn2O, O2 site with one lithium removed (`li3mn2o-o2-k`) | CAS(13e,11o) | 23 | 152,460 | 557.4 eV |
| Li2Mn2O, O2 site with two lithium removed (`li2mn2o-o2-k`) | CAS(14e,11o) | 23 | 108,900 | 559.4 eV |
| Li4Mn2O, O2 site, the paper's full active space (`li2mno3-o2-k-18`) | CAS(24e,18o) | 37 | 344,622,096 | none (quantum target) |

* **Delithiation moves the edge in the direction expected.** Removing one lithium (and its electron) puts the first feature 3.1 eV lower, at 557.4 eV: the cluster is oxidized, and the empty states the core electron can reach move down. Removing a second lithium gives 559.4 eV. The two oxygen sites of Li₂MnO₃ give the same edge.
* **The paper's 18 orbital space comes out with 24 electrons here, not 22.** AVAS at the library's threshold of 0.5 picks the same 18 orbitals (Mn 3d, Li 2s, O 2p, O 1s) but counts two more electrons; the paper tuned its threshold by hand until it got 22. The quantum cost depends on the number of orbitals, which agrees. This problem has about 3.4×10⁸ determinants, far past exact classical methods, so it carries no reference.

Choices the papers leave open are written into each recipe: the Li₂MnO₃ clusters are neutral (for the O2 site with 2S = 0 that is what gives the paper's CAS(14e,11o)), and delithiation removes lithium from the lithium layers first, nearest first, which leaves the cluster one electron short per lithium.

## Checks

`scripts/quantum/test_library.py`, run with the engine tests on every deploy:

* every file matches its hash, has consistent shapes and keeps the eightfold integral symmetry;
* the index lists every file, and every recipe has a file;
* water rebuilds from its recipe to the stored integrals (within 10⁻⁶, set by the SCF threshold), and its stored spectrum equals a fresh Lanczos measure;
* every Li₂MnO₃ cluster has ten active orbitals of mostly Mn 3d character and one of O 1s.

Rebuilding a Mn cluster takes minutes, so that check runs only locally (`QXAS_SLOW=1`); its integrals agree to 2×10⁻⁵ Ha, the precision PySCF's SCF stops at for that cluster.

## Limits

* The clusters are bare (no embedding) and use ground state orbitals, so absolute edge energies sit 6 to 30 eV above experiment. They are for testing the algorithm and comparing related structures with each other, not for absolute positions yet.
* The measured gas phase spectra we would like to compare against (the McMaster database) have no stated licence, so none are included until permission is granted.
