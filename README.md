# Quantum Battery XAS Lab

XAS Lab is a browser laboratory for X-ray absorption spectroscopy (XAS) of any material. Enter a chemical formula and density, pick the absorbing element and edge, plan a transmission sample, scan a simulated beamline, compare spectra with your own data, and follow the time-domain quantum workflow used in recent quantum-computing studies of XAS. The lithium manganese oxide battery cathode is kept as one worked example.

**Live:** [tss99.github.io/quantum-battery-xas-lab](https://tss99.github.io/quantum-battery-xas-lab/), deployed by the GitHub Actions workflow on every push to `main`.

**Scientific boundary:** absorption backgrounds and edge jumps come from tabulated isolated-atom cross sections (XrayDB, Elam, Ravel and Sieber 2002, CC0), covering hydrogen to californium from 100 eV to 100 keV. They contain no chemical shifts, XANES or EXAFS fine structure. Optional near-edge curves are adjustable models, not predictions. The battery teaching curve is independent of the tabulated background. Quantum results are exact only for the displayed 1 to 6 qubit Hamiltonian. Imported spectra remain user supplied and unverified. The app does not predict material-specific spectra, establish battery performance, run quantum hardware or demonstrate quantum advantage.

## Quick start

Use Node.js 22 LTS and npm. From this project directory:

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The complete browser application, including the quantum solver and spectrum fitting, runs without Python, accounts or API keys. Dependency installation requires a network connection; scientific calculations run on the user's device.

The project uses Next.js App Router with static export, React, TypeScript, Motion, Three.js/react-three-fiber, KaTeX, SVG charts and Web Workers. Equations, symbols, units and formulas are typeset with KaTeX during the static build, and every digit uses KaTeX's Computer Modern font. The beamline and experiment drawings are SVG scenes built from one shared kit (`src/components/scene-kit.tsx`); the beamline's numeric Bragg angle and expected counts follow the live settings. The drawn angle is constrained for legibility, and fluorescence is schematic. The lockfile records the JavaScript dependency versions used for installation. The application supports keyboard controls, responsive layouts, reduced motion and a non-WebGL atomic fallback.

## The eight modules

| Route | What to explore |
| --- | --- |
| `/` | Live spectrum demo, three starting paths (student, researcher, industry R&D) and the eight-step research workflow with progress. |
| `/crystal/` | Sample: any formula and density, presets from water to Pt foil, absorber and edge picker, and the LixMnO2 battery example with its MnO6 model. |
| `/beamline/` | Scan the photon energy across the chosen edge, plan thickness, compare absorption and transmission, and add seeded count noise in Research mode. |
| `/spectra/` | Save and overlay curves, import CSV/JSON, normalize, differentiate, estimate edges, run Larch-compatible AUTOBK and xftf EXAFS reduction, score a model against data and export with provenance. Measured data turns raw beamline files (XDI or column text) into calibrated, merged and normalized spectra. |
| `/electronic/` | Core-to-valence transitions, dipole selection, core holes and an active-space size planner based on recent quantum XAS papers. |
| `/quantum/` | Kick, evolve and transform: exact and first-order Trotter dynamics in a browser Worker, a loader for your own Pauli-string Hamiltonian, and circuit details. |
| `/experiments/` | One-click guided experiments with undo, and save or share settings as a link or a file. |
| `/validation/` | Equations, data sources, sanity checks, arXiv references and the claims these models cannot support. |

The Explore/Research switch changes explanatory depth. It does not change the model's validity. Shared parameters are saved in local browser storage when available. Imported/snapshotted runs are held in the current session; export them before refreshing or closing the tab.

## Beamline twin

`/twin/` is a working X-ray absorption beamline that runs full screen in the browser, laid out like an instrument console. The physics lives in `src/lib/twin/` (pure TypeScript, run in a Web Worker) and every model is listed with its checks and tests on the Methods page.

* **Instrument:** bending magnet or undulator source, mirrors with harmonic rejection, a Si(111), Si(311) or Si(220) monochromator with detune and glitches, three ion chambers with gas, gain and saturation, and a multi-element fluorescence detector with Fano widths, dead time per element and pile-up. Click any part of the drawing for its physics card and live equation.
* **3D hutch:** the beamline as a lit, shaded WebGL model (three.js with ambient occlusion and bloom) that you can turn and zoom, with the same labels, beam and live readings as the diagram, which stays one click away and is used when WebGL 2 is missing. The tileable textures and the hutch panorama used for reflections were made with an image model (GPT image generation) and live in `public/images/twin/`.
  - **Two layers** (`hutch-3d-cache.ts`): the still hutch, with its multisampling, shadows and ambient occlusion, is drawn once into a cached image, redrawn only when something in it changes. Each frame copies that image and draws only what moves (photons, beam, bunches) against its depth.
  - **Frame rate:** 30 frames a second on the display's refresh. On an Intel UHD 770 the Ultra 4K view went from 5.6 to an even 30 frames a second, and the paused picture matches the earlier pipeline at 51.6 dB PSNR.
  - **Photons as in a synchrotron:** they arrive at random (Poisson) in 15 ps Gaussian bunches timed by a 499.654 MHz RF. A bending magnet's beam is uniform across its fan and Gaussian in height, its opening shrinking with energy as (E₁/E)^0.425 (Kim); an undulator's is Gaussian both ways.
* **Eight modes:** transmission, fluorescence, electron yield, XRF spectrum, monochromator, energy calibration, time resolved and beam damage, each with a General and a Physics explanation that can be read aloud.
* **Results:** live channels, μ(E), normalized, derivative, χ(k), |χ(R)|, a first shell EXAFS fit, the XRF spectrum with a draggable counting window and the rocking curve. Acquisitions download as XDI, CSV or JSON; the results can be popped out into a second window.
* **EXAFS:** FEFF6L path sums for the library materials with Einstein disorder at the sample temperature, and a Levenberg-Marquardt fit with Larch-scaled uncertainties, checked against Larch `feffit`.
* **Training:** nine scenarios with hidden truth, a judge, a reveal and a replay: find the edge, calibrate the energy with a Cu foil, a small EXAFS amplitude, a dilute sample, self absorption, planning the beamtime, ion chamber gases, beam damage and a glitch hunt. **Classroom:** an instructor copies a class link (one task and seed for everyone), students download a result file after the reveal, and the instructor loads the files to see the class in a table and as CSV, all in the browser.
* **Sessions and sharing:** save the instrument, settings and every acquisition as a session file and load it back; copy a share link that carries the settings and seed; import your own XDI or named columns as Measured data; download a Larch script per acquisition that repeats the dock's reduction (checked against xraylarch).
* **Calibrate from data:** load your own XDI or columns to fit the energy offset, harmonic fraction and dead time, edit the instrument profile, or test yourself on a seeded mystery instrument.

Keys: 1 to 8 switch modes, I acquires, Space pauses, X enlarges the results, L toggles labels, T opens training, / opens the command bar ("set energy 8979", "detune 30 %", "insert harmonic mirror", "acquire 3 scans"; a typo is corrected and confirmed before it runs), [ and ] hide the side panels, and \` opens the console.

**Read the spectrum** opens with **How XAS works**, one energy slider (or Scan) driving three linked pictures:
- the beam through the sample, dimming between I₀ and Iₜ as absorption rises;
- the absorber's levels, showing what the photon does to the core electron (nothing below the edge, a weak jump into a nearly full level at the pre‑edge, a jump into empty states at the edge, a freed electron wave, drawn at its wavelength, beyond);
- the spectrum building up to the cursor.

Five **Reading a spectrum** cards follow. Each sketches one feature for two materials or states: edge position, edge shape, and wiggle speed, height and fade. Each links to the panel where it can be tried, and a chapter bar runs through the page.

**Read the spectrum:** `/spectrum/` (the atom button in the twin's Results opens it beside the twin, following its sample, temperature and latest scan) splits a library sample's EXAFS into shells of neighbours. Each shell has its own curve in k²χ(k) and |χ(R)|, its atoms light up in a 3D cluster, and choosing one explains its wiggle, its peak and how far that peak sits from the true distance (about 0.3 to 0.5 Å short for light neighbours, close to it for heavy ones such as Pt and Au). Below the plots:
- **Electron wave:** the wave leaving the absorber and the wave reflected by the chosen neighbour, at true scale, with FEFF's phase. Whether they meet in step is the sign of that shell's χ(k); a test checks it.
- **What if controls:** distance, number of neighbours, disorder σ² and temperature, drawn against dashed curves from before the change.
- **Light against heavy neighbours:** FEFF's backscattering amplitude |F(k)| for oxygen, copper and platinum.
- **Around the edge:** the normalized edge with its pre-edge, edge, white line and the start of the fine structure, each explained. The edge position is the sample's measured one; the near-edge shapes are the twin's teaching model.
- **Edge and valence:** the element's series (Mn, Co, Cu, S, As) at their measured shifts, with the eV per unit of valence (`src/lib/twin/oxidation.ts`).
- **Guided tour:** five steps from the edge to a bond distance, using the sample's own numbers.

`src/lib/twin/shells.ts` groups the paths. The shells add up exactly to the twin's own path sum, and the transform is the Results one. The clusters in `src/data/twin/clusters/` are the atoms FEFF used, rebuilt by `scripts/twin/make-clusters.py` and checked against each site's stored input hash.

**Calculators and teaching:** `/tools/` has four calculators taken from the twin (ion chamber gas, harmonic rejection mirror angle, fluorescence self absorption and X-ray dose), each with worked examples computed at build time, and `/instructors/` explains class links and result files.

### Without a browser: command line and MCP server

The same `src/lib/twin` modules run headless in Node (bundled on the fly with esbuild):

```bash
npm run twin -- --sample limn2o4-pellet --mode fluorescence --seed 7 --do "detune 30 %" --out run.xdi --larch
npm run twin -- --formula CuO --edge Cu-K --density 6.3 --thickness 10 --realistic --out cuo.xdi
npm run twin -- --help
```

It writes XDI (or CSV or JSON by the file extension), prints the edge position, edge step and first-shell peak, and with `--larch` writes a Larch script that reduces the file. The same seed gives the same file.

`npm run --silent mcp` starts an MCP server on stdio for AI agents, with the tools `twin_status`, `twin_command` (the command bar grammar), `twin_acquire`, `twin_analyze`, `twin_export` (XDI, CSV, JSON or Larch), `twin_reset` and a one-off `simulate`. For Claude Code, from the project folder:

```bash
claude mcp add xaslab-twin -- npm run --silent --prefix "$PWD" mcp
```

The agent skill in [`skills/xas-lab-twin/SKILL.md`](skills/xas-lab-twin/SKILL.md) tells Claude or Codex how to use both. The server drives its own headless twin; it does not control a twin open in a browser.

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

On import the record is marked imported, with its declared synthetic provenance retained. `mu_cm_inv` means an **absolute linear absorption coefficient** in cm⁻¹. Dimensionless `ln(I0/It)`, normalized absorption and arbitrary fluorescence intensity must not be relabeled as `mu_cm_inv`. Convert a valid transmission optical depth using independently known thickness before importing. Normalized curves saved from Measured data are dimensionless and use their own names: `energy_eV,mu_norm` or `energy_eV,mu_flat` in CSV, `"units": {"energy": "eV", "mu": "normalized"}` (or `"flattened"`) with a `mu_norm` (or `mu_flat`) array in JSON, without `sigma_mu_cm_inv`. Raw beamline files go through Measured data, below.

## Measured data (beamline files to normalized spectra)

The Measured data panel in the Spectra studio does the Athena-style reduction in the browser. Files never leave the device.

1. **Import** XDI 1.0 or generic column text (comment lines starting with `#`, `;`, `%`, `*`, `!` or `$`, then columns), several files at once, up to 5 MB and 20,000 rows each. Columns are proposed from their names (energy, I0, It, Iref, fluorescence channels; a channel whose median is below 1 % of the strongest one is treated as dead) and can be changed. Files with the same column labels share one mapping.
2. **mu(E)**: transmission `ln(I0/It)`, fluorescence `(sum of channels)/I0`, reference foil `ln(It/Iref)`. Rows with undefined values (zero or negative counts) or repeated energies are removed and counted; rows are sorted by energy.
3. **Calibration**: the foil E0 of each scan is Larch `find_e0` (derivative maximum, a grid point); the shift to the tabulated XrayDB edge is added to that scan's sample energies and shown per scan.
4. **Merge**: Larch `merge_groups` (first scan's grid, cubic by default), with the scan-to-scan standard deviation shown in edge-step units. It is not stored as an uncertainty.
5. **Normalization**: Larch `pre_edge` with editable `e0`, `pre1`, `pre2`, `norm1`, `norm2`, `nnorm`, `nvict` and `step`; the fit ranges, pre-edge line and post-edge curve are drawn on mu(E), with normalized and flattened views.
6. **Save** the normalized or flattened curve to the saved curves (dimensionless, with the processing record in its notes), or download the processing record (JSON) and an xraylarch script that repeats the same steps.

The algorithms in `src/lib/xas-reduction.ts` are ports of xraylarch 2026.3.1; `src/lib/beamline-files.ts` reads the files and `src/lib/measured-data.ts` connects the steps. Heavy work runs in `src/workers/reduction.worker.ts`. `scripts/make-xas-reduction-fixtures.py` writes synthetic example files (`src/data/xas-reduction/examples.json`; model curves plus Poisson noise, not measurements) and the values xraylarch computes from them (`larch-reference.json`, with versions and exact calls). Regenerate both with a Python that has xraylarch and xraydb: `python -I scripts/make-xas-reduction-fixtures.py`. The unit tests agree with Larch to the 12-digit rounding of the fixtures: E0 and the fit ranges exactly, normalized values within about 1e-11. AUTOBK, Fourier transforms, LCF and PCA are not implemented here.

## Model equations and numerical conventions

- Idealized Li_xMnO2 assumes Li⁺, O²⁻ and Mn-only charge compensation: `v_Mn = 4-x`. The nominal Mn³⁺ fraction is x only under a Mn³⁺/Mn⁴⁺ mixture. MnO6 represents a local coordination motif with shared oxygen; changing x does not determine a unique local geometry.
- The battery synthetic absorption curve combines a logistic edge and illustrative pre-edge, white-line and damped oscillation terms, independently of the tabulated background and density. The general near-edge model instead broadens the tabulated step with an arctan and adds illustrative features. The editable loading-to-edge shift is not an experimentally calibrated prediction. The 6530–6580 eV range is an illustration near the Mn K edge.
- `d_cm = d_um × 10^-4`, `T = exp(-mu*d_cm)`, `It_expected = I0*T`, and `mu*d_cm = ln(I0/It)`. Photon animation is qualitative. Independently sampled Poisson monitors can yield apparent `It > I0`; zero-count log estimates are undefined and are not silently repaired.
- Electric-dipole Mn K-edge excitation accesses p character from 1s (`Δl = ±1`). Hybridization and quadrupole contributions can give weak d-like pre-edge intensity. The orbital diagram is not a many-body eigensystem.
- The toy quantum Hamiltonian contains displayed Z fields, XX couplings and X terms, with `D=X0`; q0 is the most significant bit. Browser dense diagonalization uses `ml-matrix`. `C(t)=⟨g|D† exp[-i(H-Eg)t]D|g⟩`; eigenstate peaks lie at `En-Eg` and carry `|⟨n|D|g⟩|²`. A possible elastic zero-energy component is retained and labeled.
- Quantum energies use a toy eV scale and time uses eV⁻¹ with ℏ=1. Multiply time by approximately 0.658212 to express fs. This energy scale has no mapping to the Mn K edge.
- The positive-sign FFT uses trapezoidal endpoint weights, exponential damping and an optional cosine taper. Broadening is a Lorentzian half width at half maximum. Physical resolution is approximately `2π/T`; zero padding only refines the plotted grid. Signed finite-window artifacts and clipped display diagnostics remain inspectable.
- EXAFS reduction uses a uniform `k` grid from 0 Å⁻¹ with `kstep = 0.05 Å⁻¹` and `nfft = 2048`. AUTOBK follows xraylarch 2026.3.1 spline knots, low-R minimization and endpoint clamps. xftf follows that release's `kstep / sqrt(pi)` NumPy FFT normalization. The fixture records the exact Larch calls. An uncorrected Fourier-transform `R` coordinate is not a bond length because photoelectron phase shifts move peaks.
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

## Install as an app and offline use

Browsers that support web apps (Chrome, Edge, and Safari through Add to Dock or Add to Home Screen) can install XAS Lab from the "Install app" link in the footer. `src/app/manifest.ts` describes the app and `scripts/make-sw.mjs` writes `out/sw.js` after every build, stamped with the build id. Pages and route data are fetched network first, so an online visitor always sees the current site; hashed build assets are cached. The installed app downloads the remaining assets for offline use, which suits beamline computers without internet. The build reports the asset count and download size. The element reference pages are left out of that bundle; they are cached when visited. Install icons are drawn by `scripts/make-share-assets.mjs`.

## Desktop app

Each release also carries desktop installers, built by `.github/workflows/desktop.yml` with [Tauri](https://tauri.app): `.msi` and `.exe` for Windows, a universal `.dmg` for Intel and Apple silicon Macs, and `.AppImage` and `.deb` for Linux. They bundle the whole site, so the app works offline from its first launch. They are not code-signed: Windows SmartScreen asks you to choose "More info, Run anyway", and on macOS you open the app the first time from its right-click menu (Open). The landing page and footer link the installers of the version in `package.json`, so publish that version's release right after the version bump reaches `main`; the links work once the workflow has attached the files.

To build one yourself you need Node.js, Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system, then `npm ci` and `npm run desktop`. The installers land in `src-tauri/target/release/bundle/`. `npm run build:desktop` builds the site for the app (no GitHub Pages subpath) into `desktop-dist/`; `src-tauri/src/lib.rs` opens the one window and sends links to other sites to the system browser. The app icon is the site's, rendered by `scripts/make-app-icon.mjs`.

## Search and sharing assets

Titles, descriptions, canonical URLs, Open Graph and Twitter tags and JSON-LD come from `src/data/site-pages.json` through `src/lib/site.ts`. The build also writes `sitemap.xml`, `robots.txt` and a `404.html`. After changing a page title or description, regenerate the share images and icons with `PLAYWRIGHT_CHANNEL=chrome node scripts/make-share-assets.mjs`. To rebuild the X-ray tables, run `scripts/build-xray-data.py` with the `xraydb` package installed (see `src/data/xray/README.md`).

The `/elements/` index links to 98 static reference pages using lower-case symbols, such as `/elements/fe/` and `/elements/cu/`. `src/lib/elements.ts` reads the XrayDB table at build time; each page lists every tabulated edge, marks the lab's scan range, and links to matching sample presets. These pages have their own titles, descriptions, canonical URLs and breadcrumbs, and share `public/og/elements.png`. Regenerate only this image with `node scripts/make-share-assets.mjs --elements-only`.

Links such as `/crystal/?element=Fe&edge=K` and `/beamline/?element=Cu&edge=L3` reload the lab, validate the symbol and shell against the tables, and set the photon energy to the selected edge within the available range. They retain the current density because the element table contains no density; enter the sample's density before using the thickness planner. Preset links instead load the preset's sourced density through a validated scenario URL. The element references sit outside the eight sidebar modules.

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
src/workers/         Quantum simulation, illustrative fitting and measured-data processing
science/             Optional independent SciPy model, tests and API
docs/                Research guide and scientific review
tests/               Browser interaction tests
.github/workflows/   Static Pages build and deployment
```

See [design_spec.md](design_spec.md) for architecture and [MASTER_PROMPT.md](MASTER_PROMPT.md) for the reusable implementation brief. Priority extensions are Athena/Larch project and FEFF adapters, calibration corrections as explicit processing steps, propagated systematic uncertainty, synchronized electrochemical data, licensed reference datasets, user-supplied Hamiltonians and independent convergence studies. Authentication, team audit trails, laboratory integrations and production qualification require additional work.

Research motivations include [Fomichev et al. (2024)](https://arxiv.org/abs/2405.11015), [Fomichev et al. (2025)](https://arxiv.org/abs/2506.15784), [Helmich-Paris (2020)](https://arxiv.org/abs/2004.05845), [Mazin and Sokolov (2023)](https://arxiv.org/abs/2305.03836), [Huang and Evangelista (2022)](https://arxiv.org/abs/2212.04369) and [Klementev (2000)](https://arxiv.org/abs/physics/0003086). The research guide explains what each source supports and which methods are not implemented here.
