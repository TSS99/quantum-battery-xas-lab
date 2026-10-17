# Quantum Battery XAS Lab

XAS Lab is a browser laboratory for X-ray absorption spectroscopy (XAS) of any material. Enter a chemical formula and density, pick the absorbing element and edge, plan a transmission sample, scan a simulated beamline, compare spectra with your own data, and follow the time-domain quantum workflow used in recent quantum-computing studies of XAS. The lithium manganese oxide battery cathode is kept as one worked example.

**Live:** [tss99.github.io/quantum-battery-xas-lab](https://tss99.github.io/quantum-battery-xas-lab/), deployed by the GitHub Actions workflow on every push to `main`.

**Scientific boundary:** absorption backgrounds and edge jumps come from tabulated isolated-atom cross sections (XrayDB, Elam, Ravel and Sieber 2002, CC0), covering hydrogen to californium from 100 eV to 100 keV. They contain no chemical shifts, XANES or EXAFS fine structure. Near-edge shapes on top of them are adjustable models, not predictions. Quantum results are exact only for the displayed 1 to 6 qubit Hamiltonian. Imported spectra remain user supplied and unverified. The app does not predict material-specific spectra, establish battery performance, run quantum hardware or demonstrate quantum advantage.

## Quick start

Use Node.js 22 LTS and npm. From this project directory:

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The complete browser application, including the quantum solver and spectrum fitting, runs without Python, accounts or API keys. Dependency installation requires a network connection; scientific calculations run on the user's device.

The project uses Next.js App Router with static export, React, TypeScript, Motion, Three.js/react-three-fiber, SVG charts and Web Workers. The lockfile records the JavaScript dependency versions used for installation. The application supports keyboard controls, responsive layouts, reduced motion and a non-WebGL atomic fallback.

## The eight modules

| Route | What to explore |
| --- | --- |
| `/` | Live spectrum demo, three starting paths (student, researcher, industry R&D) and the eight-step research workflow with progress. |
| `/crystal/` | Sample: any formula and density, presets from water to Pt foil, absorber and edge picker, and the LixMnO2 battery example with its MnO6 model. |
| `/beamline/` | Scan the photon energy across the chosen edge, plan thickness, compare absorption and transmission, and add seeded count noise in Research mode. |
| `/spectra/` | Save and overlay curves, import CSV/JSON, normalize, differentiate, estimate edges, score a model against data and export with provenance. |
| `/electronic/` | Core-to-valence transitions, dipole selection, core holes and an active-space size planner based on recent quantum XAS papers. |
| `/quantum/` | Kick, evolve and transform: exact and first-order Trotter dynamics in a browser Worker, a loader for your own Pauli-string Hamiltonian, and circuit details. |
| `/experiments/` | One-click guided experiments with undo, and save or share settings as a link or a file. |
| `/validation/` | Equations, data sources, sanity checks, arXiv references and the claims these models cannot support. |

The Explore/Research switch changes explanatory depth. It does not change the model's validity. Shared parameters are saved in local browser storage when available. Imported/snapshotted runs are held in the current session; export them before refreshing or closing the tab.

## Research and industry workflows

This release supports beamtime training, methods demonstrations, exploratory overlays of user-supplied absolute absorption data, numerical convergence checks and auditable handoff. Export original arrays, units, source records, calibration status, processing choices and a scenario/run manifest together. Preserve the source-code revision with any research record.

Calibration metadata is a declaration, not an independent calibration check. Its offset is recorded but does not silently shift the raw energy axis. An imported SHA-256 hash identifies file bytes when available; it does not certify experimental origin. Pointwise uncertainty is distinct from systematic uncertainty in calibration, thickness, detector response and sample preparation. Synthetic fits describe the selected shape and do not estimate oxidation state or structural parameters.

The [research guide](docs/RESEARCH_GUIDE.md) explains practical workflows, arXiv motivations and future integration priorities. The [scientific review](docs/SCIENTIFIC_REVIEW.md) separates source-review observations from executed test evidence. This is a research-prototyping and education tool, not a qualified manufacturing acceptance or regulated laboratory system.

## Import contract

Import UTF-8 CSV with exact unit-bearing column names:

```csv
energy_eV,mu_cm_inv,sigma_mu_cm_inv
6530,18.0,0.8
6540,18.3,0.8
6550,75.0,1.2
6560,125.0,1.5
6570,129.0,1.5
```

These five rows are a **synthetic format illustration**, not experimental Mn data. `sigma_mu_cm_inv` is optional and, when present, must contain a positive one-standard-deviation uncertainty for every row. There must be 5–20,000 finite rows with strictly increasing, nonnegative energies. The file limit is 5 MB. Unknown/generic headers, missing values, repeated energies and invalid uncertainties are rejected.

JSON accepts unit-bearing arrays and optional metadata; the app's exported versioned JSON is the recommended round-trip format:

```json
{
  "name": "Synthetic format illustration",
  "provenance": "synthetic",
  "energy_eV": [6530, 6540, 6550, 6560, 6570],
  "mu_cm_inv": [18, 18.3, 75, 125, 129],
  "sigma_mu_cm_inv": [0.8, 0.8, 1.2, 1.5, 1.5],
  "sampleId": "example-only",
  "calibration": {
    "status": "uncalibrated",
    "reference": "Illustrative axis",
    "offset_eV": 0
  }
}
```

On import the record is marked imported, with its declared synthetic provenance retained. `mu_cm_inv` means an **absolute linear absorption coefficient** in cm⁻¹. Dimensionless `ln(I0/It)`, normalized absorption and arbitrary fluorescence intensity must not be relabeled as `mu_cm_inv`. Convert a valid transmission optical depth using independently known thickness before importing. This simple format is not a full XDI adapter.

## Model equations and numerical conventions

- Idealized Li_xMnO2 assumes Li⁺, O²⁻ and Mn-only charge compensation: `v_Mn = 4-x`. The nominal Mn³⁺ fraction is x only under a Mn³⁺/Mn⁴⁺ mixture. MnO6 represents a local coordination motif with shared oxygen; changing x does not determine a unique local geometry.
- The positive synthetic absorption curve combines a logistic edge and illustrative pre-edge, white-line and damped oscillation terms. The editable loading-to-edge shift is not an experimentally calibrated prediction. The 6530–6580 eV range is an illustration near the Mn K edge.
- `d_cm = d_um × 10^-4`, `T = exp(-mu*d_cm)`, `It_expected = I0*T`, and `mu*d_cm = ln(I0/It)`. Photon animation is qualitative. Independently sampled Poisson monitors can yield apparent `It > I0`; zero-count log estimates are undefined and are not silently repaired.
- Electric-dipole Mn K-edge excitation accesses p character from 1s (`Δl = ±1`). Hybridization and quadrupole contributions can give weak d-like pre-edge intensity. The orbital diagram is not a many-body eigensystem.
- The toy quantum Hamiltonian contains displayed Z fields, XX couplings and X terms, with `D=X0`; q0 is the most significant bit. Browser dense diagonalization uses `ml-matrix`. `C(t)=⟨g|D† exp[-i(H-Eg)t]D|g⟩`; eigenstate peaks lie at `En-Eg` and carry `|⟨n|D|g⟩|²`. A possible elastic zero-energy component is retained and labeled.
- Quantum energies use a toy eV scale and time uses eV⁻¹ with ℏ=1. Multiply time by approximately 0.658212 to express fs. This energy scale has no mapping to the Mn K edge.
- The positive-sign FFT uses trapezoidal endpoint weights, exponential damping and an optional cosine taper. Broadening is a Lorentzian half width at half maximum. Physical resolution is approximately `2π/T`; zero padding only refines the plotted grid. Signed finite-window artifacts and clipped display diagnostics remain inspectable.
- First-order product-formula evolution is compared on `D|g⟩`. Fidelity need not improve monotonically at every time. Resource counts describe the displayed serial, unoptimized circuit and exclude ground-state preparation, physical excitation, measurement, routing and hardware.

Dense matrix storage scales as O(4ⁿ); a dense eigensolve is roughly O(8ⁿ). The interface caps the system at six qubits. Browser performance depends on the device and numerical settings; no frame-rate or quantum-performance benchmark is claimed.

## Optional independent SciPy reference

Python is **not required by GitHub Pages or by any browser module**. The `science/` package independently checks the same effective model using NumPy/SciPy, including `scipy.linalg.expm`. It is useful for numerical verification, not a material-specific electronic-structure service.

Use Python 3.11 or newer in a virtual environment:

```sh
python -m venv .venv
```

Activate it on Windows PowerShell with `.\.venv\Scripts\Activate.ps1`, or on macOS/Linux with `source .venv/bin/activate`, then run:

```sh
python -m pip install -r science/requirements.txt
python -m pytest science
python -m uvicorn science.app:app --host 127.0.0.1 --port 8000
```

The optional API exposes `GET /health`, `POST /simulate`, and interactive documentation at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). `npm run science` starts the same local service with the active Python interpreter. The hosted application does not connect to localhost or depend on this service. Do not deploy this development service publicly without a separate security and deployment review.

PySCF and Qiskit are not installed or required. Material-specific calculations would need a justified structure/charge/spin, electronic integrals, core-hole/multiplet treatment, active-space and basis convergence, fermion mapping, validated dipole operators and calibrated experimental comparison. Merely adding either library does not supply those assumptions.

## Verification

Run from the project directory:

```sh
npm run typecheck
npm test
python -m pytest science
```

The browser suite uses Microsoft Edge by default when installed:

```sh
npm run test:ui
```

For a machine without Edge:

```sh
npx playwright install chromium
```

Then set `PLAYWRIGHT_CHANNEL=chromium` when running `npm run test:ui`. PowerShell syntax is `$env:PLAYWRIGHT_CHANNEL='chromium'`; POSIX syntax is `PLAYWRIGHT_CHANNEL=chromium npm run test:ui`. The suite starts or reuses the local dev server, tests real controls and provenance, and includes a narrow-screen/reduced-motion project. Set `PLAYWRIGHT_EXTERNAL_SERVER=1` and `PLAYWRIGHT_BASE_URL` to test an already running static preview instead.

Executed results for this delivery will be recorded here after the final verification run. A documented command or source-review checklist alone is not a passed test.

## Search and sharing assets

Titles, descriptions, canonical URLs, Open Graph and Twitter tags and JSON-LD come from `src/data/site-pages.json` through `src/lib/site.ts`. The build also writes `sitemap.xml`, `robots.txt` and a `404.html`. After changing a page title or description, regenerate the share images and icons with `PLAYWRIGHT_CHANNEL=chrome node scripts/make-share-assets.mjs`. To rebuild the X-ray tables, run `scripts/build-xray-data.py` with the `xraydb` package installed (see `src/data/xray/README.md`).

## Static build and GitHub Pages handoff

Build for the specified project URL in PowerShell:

```powershell
$env:NEXT_PUBLIC_BASE_PATH='/quantum-battery-xas-lab'
npm run build
```

Or in a POSIX shell:

```sh
NEXT_PUBLIC_BASE_PATH=/quantum-battery-xas-lab npm run build
```

Next.js exports the site to `out/`. The base path is built into the assets and links; rebuilding is required to change it. `next start` is not the production preview mechanism for a static export. Serve the exported files using a static server mounted at `/quantum-battery-xas-lab/`, or build without a base path for a root-mounted local preview. Do not open the HTML directly through `file://`, because browser routing and Workers require an HTTP origin.

The supplied [deployment workflow](.github/workflows/deploy.yml) assumes this directory is the root of the `quantum-battery-xas-lab` repository. It validates TypeScript and both science test suites, builds with the specified base path, uploads `out/` with `actions/upload-pages-artifact`, and deploys through `actions/deploy-pages`. It triggers on a push to `main` or manual dispatch. The publishing operator must select GitHub Actions as the repository's Pages source and handle any deployment-environment approval. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

This delivery does not initialize Git, create a repository, push changes or alter GitHub settings. Publishing and verification of the live URL are separate operator steps.

## Project map and further work

```text
src/app/             Static routes and application styling
src/components/      Laboratory screens, state, plots and atomic scene
src/lib/             Validated science engines, imports and numerical tests
src/workers/         Quantum simulation and illustrative fitting
science/             Optional independent SciPy model, tests and API
docs/                Research guide and scientific review
tests/               Browser interaction tests
.github/workflows/   Static Pages build and deployment
```

See [design_spec.md](design_spec.md) for architecture and [MASTER_PROMPT.md](MASTER_PROMPT.md) for the reusable implementation brief. Priority extensions are real XDI/Larch/FEFF adapters, calibration corrections as explicit processing steps, propagated systematic uncertainty, synchronized electrochemical data, licensed reference datasets, user-supplied Hamiltonians and independent convergence studies. Authentication, team audit trails, laboratory integrations and production qualification require additional work.

Research motivations include [Fomichev et al. (2024)](https://arxiv.org/abs/2405.11015), [Fomichev et al. (2025)](https://arxiv.org/abs/2506.15784), [Helmich-Paris (2020)](https://arxiv.org/abs/2004.05845), [Mazin and Sokolov (2023)](https://arxiv.org/abs/2305.03836), [Huang and Evangelista (2022)](https://arxiv.org/abs/2212.04369) and [Klementev (2000)](https://arxiv.org/abs/physics/0003086). The research guide explains what each source supports and which methods are not implemented here.
