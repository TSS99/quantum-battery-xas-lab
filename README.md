# Beamline Twin

Beamline Twin is a working X-ray absorption (XAS) beamline that runs in your browser, laid out like an instrument console. Every reading comes from tabulated cross sections and optics: the beam crosses the mirrors, the monochromator, the sample and the detectors as it would at a synchrotron.

**Live:** [tss99.github.io/quantum-battery-xas-lab](https://tss99.github.io/quantum-battery-xas-lab/), deployed by the GitHub Actions workflow on every push to `main`. Old links to `/twin/` still open the twin, with their settings.

Until version 1.29 this repository was XAS Lab, a wider lab with eight modules, element pages, calculators and Read the spectrum. From 2.0.0 the site is the Beamline Twin alone; the older pages are in the git history and in the earlier releases.

## Quick start

Use Node.js 22 LTS and npm. From this project directory:

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Everything runs in the browser, without Python, accounts or API keys. The project uses Next.js App Router with static export, React, TypeScript, three.js with React Three Fiber, KaTeX, SVG charts and Web Workers.

## The twin

The physics lives in `src/lib/twin/` (pure TypeScript, run in a Web Worker), and every model is listed with its checks and tests on the Methods page (`/methods/`).

* **Instrument:** bending magnet or undulator source, mirrors with harmonic rejection, a Si(111), Si(311) or Si(220) monochromator with detune and glitches, three ion chambers with gas, gain and saturation, and a multi-element fluorescence detector with Fano widths, dead time per element and pile-up. Click any part of the drawing for its physics card and live equation.
* **Detector noise:** one switch. Off, every reading is its expected value; on, photon counting noise, amplifier noise, beam flicker, glitches and a slow drift are added. The physics underneath is the same.
* **3D hutch:** the beamline as a lit, shaded WebGL model (three.js with ambient occlusion and bloom) that you can turn and zoom, with the same labels, beam and live readings as the diagram, which stays one click away and is used when WebGL 2 is missing. The tileable textures and the hutch panorama used for reflections were made with an image model (GPT image generation) and live in `public/images/twin/`.
  - **Two layers** (`hutch-3d-cache.ts`): the still hutch, with its multisampling, shadows and ambient occlusion, is drawn once into a cached image, redrawn only when something in it changes. Each frame copies that image and draws only what moves (photons, beam, bunches) against its depth.
  - **Photons as in a synchrotron:** they arrive at random (Poisson) in 15 ps Gaussian bunches timed by a 499.654 MHz RF. A bending magnet's beam is uniform across its fan and Gaussian in height, its opening shrinking with energy as (E₁/E)^0.425 (Kim); an undulator's is Gaussian both ways.
* **Eight modes:** transmission, fluorescence, electron yield, XRF spectrum, monochromator, energy calibration, time resolved and beam damage, each with a General and a Physics explanation that can be read aloud.
* **Results:** live channels, μ(E), normalized, derivative, χ(k), |χ(R)|, a first shell EXAFS fit, the XRF spectrum with a draggable counting window and the rocking curve. Acquisitions download as XDI, CSV or JSON; the results can be popped out into a second window.
* **EXAFS:** FEFF6L path sums for the library materials with Einstein disorder at the sample temperature, and a Levenberg-Marquardt fit with Larch-scaled uncertainties, checked against Larch `feffit`. Near edges come from FEFF10.
* **Training:** nine scenarios with hidden truth, a judge, a reveal and a replay: find the edge, calibrate the energy with a Cu foil, a small EXAFS amplitude, a dilute sample, self absorption, planning the beamtime, ion chamber gases, beam damage and a glitch hunt. **Classroom:** an instructor copies a class link (one task and seed for everyone), students download a result file after the reveal, and the instructor loads the files to see the class in a table and as CSV, all in the browser.
* **Sessions and sharing:** save the instrument, settings and every acquisition as a session file and load it back; copy a share link that carries the settings and seed; import your own XDI or named columns as Measured data; download a Larch script per acquisition that repeats the dock's reduction (checked against xraylarch).
* **Calibrate from data:** load your own XDI or columns to fit the energy offset, harmonic fraction and dead time, edit the instrument profile, or test yourself on a seeded mystery instrument.

Keys: 1 to 8 switch modes, C turns detector noise on or off, I acquires, Space pauses, X enlarges the results, L toggles labels, T opens training, / opens the command bar ("set energy 8979", "detune 30 %", "insert harmonic mirror", "noise on", "acquire 3 scans"; a typo is corrected and confirmed before it runs), and [ and ] hide the side panels.

## Without a browser: command line and MCP server

The same `src/lib/twin` modules run headless in Node (bundled on the fly with esbuild):

```bash
npm run twin -- --sample limn2o4-pellet --mode fluorescence --seed 7 --do "detune 30 %" --out run.xdi --larch
npm run twin -- --formula CuO --edge Cu-K --density 6.3 --thickness 10 --realistic --out cuo.xdi
npm run twin -- --help
```

It writes XDI (or CSV or JSON by the file extension), prints the edge position, edge step and first shell peak, and with `--larch` writes a Larch script that reduces the file. The same seed gives the same file. `--realistic` turns detector noise on.

`npm run --silent mcp` starts an MCP server on stdio for AI agents, with the tools `twin_status`, `twin_command` (the command bar grammar), `twin_acquire`, `twin_analyze`, `twin_export` (XDI, CSV, JSON or Larch), `twin_reset` and a one-off `simulate`. For Claude Code, from the project folder:

```bash
claude mcp add xaslab-twin -- npm run --silent --prefix "$PWD" mcp
```

The agent skill in [`skills/xas-lab-twin/SKILL.md`](skills/xas-lab-twin/SKILL.md) tells Claude or Codex how to use both. The server drives its own headless twin; it does not control a twin open in a browser.

## Verification

```sh
npm run typecheck
npm test
npm run test:ui
```

The browser suite uses Microsoft Edge by default. Without Edge, run `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=chromium` (PowerShell: `$env:PLAYWRIGHT_CHANNEL='chromium'`). The suite starts or reuses the local dev server; set `PLAYWRIGHT_EXTERNAL_SERVER=1` and `PLAYWRIGHT_BASE_URL` to test an already running static preview instead. The reference data generators and checks against xraylarch and FEFF live in `scripts/twin/`.

## Install as an app and offline use

Browsers that support web apps (Chrome, Edge, and Safari through Add to Dock or Add to Home Screen) can install the twin from the browser's own Install button. `src/app/manifest.ts` describes the app and `scripts/make-sw.mjs` writes `out/sw.js` after every build, stamped with the build id. Pages are fetched network first, so an online visitor always sees the current site; hashed build assets are cached. The installed app downloads the remaining assets for offline use, which suits beamline computers without internet.

## Desktop app

Each release also carries desktop installers, built by `.github/workflows/desktop.yml` with [Tauri](https://tauri.app): `.msi` and `.exe` for Windows, a universal `.dmg` for Intel and Apple silicon Macs, and `.AppImage`, `.deb` and `.rpm` for Linux. The twin's Desktop app link opens the latest release. The installers bundle the whole site, so the app works offline from its first launch. They are not code-signed: Windows SmartScreen asks you to choose "More info, Run anyway", and on macOS you open the app the first time from its right-click menu (Open).

To build one yourself you need Node.js, Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system, then `npm ci` and `npm run desktop`. The installers land in `src-tauri/target/release/bundle/`. `npm run build:desktop` builds the site for the app (no GitHub Pages subpath) into `desktop-dist/`; `src-tauri/src/lib.rs` opens the one window and sends links to other sites to the system browser.

## Search and sharing

Titles, descriptions, canonical URLs, Open Graph and Twitter tags and JSON-LD come from `src/data/site-pages.json` through `src/lib/site.ts`. The build also writes `sitemap.xml`, `robots.txt` and a `404.html`. After changing the title or description, regenerate the share image and icons with `PLAYWRIGHT_CHANNEL=chrome node scripts/make-share-assets.mjs`. To rebuild the X-ray tables, run `scripts/build-xray-data.py` with the `xraydb` package installed (see `src/data/xray/README.md`).

## Static build and GitHub Pages

```powershell
$env:NEXT_PUBLIC_BASE_PATH='/quantum-battery-xas-lab'
npm run build
```

Or `NEXT_PUBLIC_BASE_PATH=/quantum-battery-xas-lab npm run build` in a POSIX shell. Next.js exports the site to `out/`; serve it with `npm start` (a static server mounted at `/quantum-battery-xas-lab/`). The [deployment workflow](.github/workflows/deploy.yml) type checks, runs the unit tests, builds with that base path and deploys `out/` to GitHub Pages on every push to `main`.

## Project map

```text
src/app/             The twin (/), Methods (/methods/), the /twin/ forward and the 404 page
src/components/twin/ The console: 3D hutch, diagram, controls, results, training and dialogs
src/lib/twin/        The beamline physics, scans, EXAFS, training scenarios and the command grammar
src/lib/             X-ray tables, EXAFS reduction and file readers the twin shares
src/cli/             The command line and MCP server
scripts/twin/        Reference data generators and checks against xraylarch and FEFF
tests/               Browser tests
.github/workflows/   Pages deploy, page checks and desktop installers
```
