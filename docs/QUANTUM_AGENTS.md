# Quantum XAS, step 6: tools for AI agents, and a Python package

Phase 6 of [PLAN-quantum.md](PLAN-quantum.md). The quantum XAS engine is now open to AI agents through six MCP tools, and to scripts through an installable Python package, `qxas`. Both use the same data and code as the [Quantum XAS page](https://tss99.github.io/quantum-battery-xas-lab/quantum/).

## Connecting an agent

The tools join the twin's in the project's MCP server (stdio). For Claude Code, from the project folder:

```bash
claude mcp add xaslab-twin -- npm run --silent --prefix "$PWD" mcp
```

| Tool | What it does |
| --- | --- |
| `quantum_problems` | The library: active space, qubits, determinants, exact edge and fault tolerant cost of each problem |
| `quantum_build` | One problem's recipe and why, its active space Hamiltonian as FCIDUMP, its atoms as XYZ, or the recipe JSON for a new problem |
| `quantum_estimate` | Logical qubits, Toffoli gates, run time, machine fit and classical cost, for a problem, a size or a resolution |
| `quantum_emulate` | The spectrum as the algorithm measures it, shots drawn on the emulated circuits; water's circuits rerun on the spot |
| `quantum_eels` | Electron energy loss of an oriented sample along a direction of q, exact and as the algorithm measures it ([QUANTUM_EELS.md](QUANTUM_EELS.md)) |
| `quantum_compare` | A model soft X-ray scan of a cluster mixture fitted back, or a measured spectrum you pass as text |

The tests are `src/cli/quantum-tools.test.ts`. Every output below is the tool's own, called over stdio.

## The tools at work

**`quantum_problems`** (two of the seven lines)

```
h2o-o-k-sto3g: Water, oxygen K edge, minimal basis. CAS(10e,7o), 15 qubits, 441 determinants; exact edge 542.2 eV; emulated circuits rerun here; 78 logical qubits, 1.55e+7 Toffolis in the longest circuit.
li2mno3-o2-k-18: Li4Mn2O, O2 site, the paper's full active space. CAS(24e,18o), 37 qubits, 344,622,096 determinants; no exact reference (beyond exact methods); cost only; 100 logical qubits, 3.02e+8 Toffolis in the longest circuit.
```

**`quantum_build`** with `{"problem": "li3mn2o-o2-k"}`

```
li3mn2o-o2-k: Li3Mn2O, O2 site with one lithium removed. Delithiation takes lithium from the lithium layers first; this removes the nearest of them (Li3, 2.04 A). The cluster stays neutral, so it loses an electron with the lithium, and 2S = 1.
Recipe: AVAS on Mn 3d, O 1s, core O 1s, basis cc-pvdz, charge 0, 2S 1, from cod-1008373-Li2MnO3.cif site O2 with Li3 removed.
Active space CAS(13e,11o), 23 qubits, 152,460 determinants; O 1s is active orbital 1; SCF energy -2396.494400 Ha.
Instance hash 8f01513dc8c86174. Rebuild with: python scripts/quantum/library.py li3mn2o-o2-k
```

With `"format": "fcidump"` it returns the Hamiltonian for any code that reads FCIDUMP (chemists' notation, unique entries, the core energy last). The core valence separation keeps terms that move two core electrons at once, so the ground state must keep the O 1s doubly occupied; a plain full CI on water's FCIDUMP lands 2.5×10⁻⁵ Ha lower.

```
 &FCI NORB=7,NELEC=10,MS2=0,
  ORBSYM=1,1,1,1,1,1,1,
  ISYM=1,
 &END
4.744505142210000e+0 1 1 1 1
5.817686957800000e-2 2 1 2 1
...
9.189533762929999e+0 0 0 0 0
```

With `"recipe_for": {"id": "li3mn2o-o1-k", "title": "Li3Mn2O, O1 site with one lithium removed", "site": "O1"}` it returns the recipe JSON for that new problem, to build with `qxas build` below.

**`quantum_estimate`** with `{"resolution_eV": 0.27}`

```
The Li2MnO3 clusters at the nearest stored resolution: 11 active orbitals, resolution eta 0.01 Ha (0.27 eV).
Logical qubits 86; Toffoli gates 7.27e+8 in the longest circuit, 1.07e+12 for the whole spectrum (15000 circuits).
Run time at a 1 MHz logical clock: 12 days one Toffoli after another, 52.7 hours on the active volume layout.
IBM Starling class (200 logical qubits, 1.00e+8 gates, announced for 2029): does not fit.
IBM Blue Jay class (2000 logical qubits, 1.00e+9 gates, announced for 2033): fits.
Classical, the paper's rough restricted active space model: 42 min.
```

**`quantum_emulate`** with `{"problem": "h2o-o-k-sto3g", "live": true, "shots": 100000}`

```
h2o-o-k-sto3g, exact factorization, j_max 100, 100,000 shots per direction (300,006 in all). Circuits rerun here in 36.6 s; largest difference from the Python emulator 3.3e-8.
Main peak: exact 544.22 eV, measured 544.22 eV; largest difference from the exact spectrum 2.3 % of its peak.
```

**`quantum_compare`** with `{"sample": "charged"}`, then with `{"sample": "charged", "resolution_eV": 1.36}`

```
Sample charged, electron yield, E/dE 5000, 1 s per point: 232 points in 4 min, surface dose 386 MGy, noise at the top 0.26 %.
Candidates exact. Fit: shift 0.00 eV, extra broadening 1 eV, R 1.3e-5, reduced chi2 1.20.
li2mno3-o2-k: 33.3 ± 0.3 % (sample 33.3 %); alone ranks 1.
li2mno3-o1-k: 16.7 ± 0.2 % (sample 16.7 %); alone ranks 2.
li3mn2o-o2-k: 30.1 ± 0.0 % (sample 30.0 %); alone ranks 4.
li2mn2o-o2-k: 20.0 ± 0.0 % (sample 20.0 %); alone ranks 3.
```

```
Candidates at eta 1.36 eV. Fit: shift 0.55 eV, extra broadening 0 eV, R 1.9e-1, reduced chi2 8398.47.
li3mn2o-o2-k: 13.9 ± 2.8 % (sample 30.0 %); alone ranks 4.
li2mn2o-o2-k: 86.1 ± 2.8 % (sample 20.0 %); alone ranks 3.
```

The second fit is the point of [QUANTUM_MEASURE.md](QUANTUM_MEASURE.md): at the resolution the first fault tolerant machines could afford, the comparison misreads the sample. Pass `"spectrum"` with a measured spectrum's text (energy and signal columns, or XDI) to fit your own data the same way.

## The Python package

Building a new problem needs PySCF, so it is the package's job. In the pinned environment (`scripts/quantum/requirements.txt`; on Windows use WSL, since PySCF has no Windows wheels):

```bash
pip install -e scripts/quantum
qxas build recipe.json --out instances/     # SCF, AVAS active space, integrals, exact reference
qxas fcidump instances/h2o-o-k-sto3g.json   # writes FCIDUMP
qxas estimate --orbitals 11 --eta 0.01      # the fault tolerant cost, as JSON
```

Building the `recipe_for` example above, a site the library does not have, took 15 minutes on a 24 thread PC, most of it the exact reference:

```
li3mn2o-o1-k: CAS(13e,11o), 23 qubits, 152460 determinants, edge 557.25 eV, hash 6445afad87035ecf -> /tmp/qxas-demo/li3mn2o-o1-k.json
```

Its edge sits 0.16 eV below the O2 site's with the same lithium removed. The install is editable so recipes find the library's crystal structures; a recipe's `structure` can also be a path to a CIF of your own. The library itself is importable: `qxas.builder`, `qxas.problem`, `qxas.exact` (references), `qxas.cdf` (factorizations), `qxas.emulate` (the circuit emulator) and `qxas.resources` (the cost model). The tests are `scripts/quantum/test_cli.py`: the FCIDUMP reads back to the stored integrals and gives the stored ground state, an estimate equals the stored rows, and water's recipe file builds water again.

## What is not done

* The MCP server runs on your machine. A hosted link waits on a host sign in.
* The tools read the library; they do not build new problems themselves, since that needs PySCF. `quantum_build` writes the recipe and `qxas build` builds it.
