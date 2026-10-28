# Third-party notices

XAS Lab's own code is under the MIT License (see LICENSE). These parts come from other projects and keep their licences.

## Data

| What | Where in this repository | Source | Licence |
| --- | --- | --- | --- |
| X-ray cross sections, edges, fluorescence yields and lines; crystal and mirror optics; Compton shares | `src/data/xray/`, `src/data/twin/optics.json`, `src/data/twin/compton-share.json` | XrayDB (Elam, Ravel and Sieber 2002), via xraydb 4.5.8 | Database CC0 1.0; xraydb code MIT |
| Reference values for the Larch ports and tests | `src/data/**/*larch*.json` and the test fixtures | xraylarch 2026.3.1 | MIT |
| Measured Cu foil spectrum (APS 13-ID, 2001) | `src/data/twin/measured/cu-metal-rt.json` | xraylarch examples, `examples/xafsdata/cu_metal_rt.xdi` | MIT (xraylarch) |
| FEFF scattering paths of the library materials | `src/data/twin/feff/` | Computed with FEFF6L as distributed with xraylarch | As distributed with xraylarch; full FEFF is licensed separately by the FEFF project |
| Bending magnet flux and critical energy formulas | `src/lib/twin/source.ts` | X-ray Data Booklet (LBNL) | Cited reference |

## Fonts

| Font | Use | Licence |
| --- | --- | --- |
| IBM Plex Sans, IBM Plex Mono | Interface text and readouts | SIL Open Font License 1.1 |
| Instrument Serif | Beamline twin titles | SIL Open Font License 1.1 |
| KaTeX fonts | Equations | MIT (KaTeX) |

## Libraries

npm dependencies (Next.js, React, three.js, React Three Fiber, KaTeX, motion, lucide-react, ml-matrix and others) are installed from npm under their own licences, listed in each package in `node_modules` and in `package-lock.json`.
