---
name: xas-lab-twin
description: Run the XAS Lab beamline twin without a browser to simulate X-ray absorption scans (XANES and EXAFS) for any sample, beamline profile and detector setting, and get XDI files, Larch scripts and edge and first-shell numbers. Use when asked to simulate an XAS measurement, plan ion chamber gases, detune or harmonic rejection, compare transmission and fluorescence, or produce test XDI data.
---

# XAS Lab beamline twin, headless

The twin is a quantitative model of an XAS beamline (source, mirrors, Si(111)/(311)/(220) monochromator, three ion chambers, a fluorescence detector, sample and environment) built on tabulated cross sections (XrayDB) and FEFF6L path sums. Run everything from the repository root.

## Command line

```bash
npm run twin -- --sample <preset> [--mode <mode>] [--scan default|xanes] [--repeats n] [--realistic] [--seed n] [--do "<command>"]... --out <file.xdi|.csv|.json> [--larch]
npm run twin -- --formula CuO --edge Cu-K --density 6.3 --thickness 10 --out cuo.xdi
```

- Presets: `cu-foil`, `limn2o4-pellet`, `fe-2mm-water`, `nio-pellet`, `pt-alumina`, `cu-solution`, `li2s`. Profiles: `--profile bm3` (default), `und6`, `tender`.
- Modes: `transmission`, `fluorescence`, `electron-yield`, `xrf`, `mono`, `calibration`, `time-resolved`, `damage`.
- `--do` takes any command bar command (below) and can repeat. The output line gives E0, the edge step and, when the scan reaches k = 8 per angstrom, the first-shell peak of |chi(R)| (not phase corrected).
- The same seed and options give the same file; add `--realistic` for counting noise, drift, glitches and dead time.

## MCP server

`npm run --silent mcp` serves MCP over stdio. Tools:

| Tool | Use |
|---|---|
| `twin_status` | Settings and live readings: energy, Bragg angle, flux, chamber voltages, fluorescence rate, dead time, dose rate |
| `twin_command` | One typed command (grammar below); returns what changed |
| `twin_acquire` | Scan with the current settings; `plan` = `default` or `xanes`, `repeats` |
| `twin_analyze` | E0, edge step, first-shell peak of an acquisition, or why it could not be reduced |
| `twin_export` | An acquisition as `xdi`, `csv`, `json` or a `larch` script |
| `twin_reset` | Back to the starting state |
| `simulate` | One-off scan on a fresh twin, returned as XDI |

## Command grammar

`set energy 8979`, `energy 9 keV`, `go to edge`, `fluorescence`, `mode 5`, `detune 30 %`, `insert harmonic mirror`, `retract focusing mirror`, `crystal Si(311)`, `realistic on`, `auto gain`, `fill I0 with nitrogen`, `thickness 20 um`, `temperature 80 K`, `beam 5 x 5 um`, `cryostat`, `sample NiO`, `profile undulator`, `acquire 3 scans`. Small typos are corrected and reported ("Read as ...").

## Reading the results

- A detector at dead time near 1 or a chamber marked saturated means the data are not usable: thin or dilute the sample, change the gas or the gain (`auto gain`).
- Thick concentrated samples in fluorescence show self absorption; `/tools/self-absorption/` on the site estimates it.
- Simulated data carry `Facility.name: XAS Lab beamline twin (simulated)` in the XDI header. Never present them as measured.
