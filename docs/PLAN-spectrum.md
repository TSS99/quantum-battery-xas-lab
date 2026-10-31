# Read the spectrum: realism and clarity plan (2026-10-31)

From a critical review of the live page (CuO, 1440 px): 1227 words, 4073 px tall.

## Findings

Realism
1. The near edge was one teaching shape for all 40 materials (Cu, CuO, Na2SO4, Pt identical); RMS 0.28 against a measured Cu foil.
2. Valence panel: Cu, Cu2O, CuO drawn as one arctangent step, shifted; the change of shape could not be seen.
3. Edge shape card was a sketch, while the library holds the textbook pair Cr2O3 (octahedral) and K2CrO4 (tetrahedral).
4. No measured data on the EXAFS plots unless the twin is linked; Larch examples give measured Cu, Ni, Pt, Fe2O3, FeO.
5. Explorer: EXAFS looks flat (no magnifier); the axis stretch at +60 eV drew a fake kink.
6. Wave panel: two flat sines, no decay, arbitrary echo amplitude; R from the path (1.95) against the shell (1.96).

Clarity
7. k^2 chi(k): 8 coloured curves and the total on one axis; tick labels at odd values (0.1, -1.0, 2.3, 3.3, 6.5, 9.8).
8. Nothing links a shell's true distance to its peak (4 O at 1.96 A peaking at 1.50 A).
9. 3D cluster: about 80 grey spheres bury the shells; no shell spheres or ruler; two similar greens.
10. No k weight switch, though the text relies on k^2 and k^3.

Fluff
11. The edge is explained four times; long grey notes in five panels.
12. Reading cards: abstract sketches without axes, overlapping What if.
13. Layout holes (cluster panel), page 4073 px.

## Steps (one release each)

1. **Real near edge** (v1.20.0, done). FEFF10 (full multiple scattering, SCF, RPA core hole, dipole and quadrupole) for all 40
   materials on the EXAFS atoms (`scripts/twin/make-xanes-library.py`, `run-feff10.sh`); one E0 rule for computed and
   measured spectra (`scripts/twin/edge_e0.py`, `edgeE0` in `src/lib/twin/xanes-features.ts`); hand over to the path sum
   at k = 3.3 to 4.1. Used by the twin's model, the explorer, Around the edge, the valence series and the edge shape
   card. Measured check: Cu 0.10, Ni 0.11, Pt 0.13, Fe2O3 0.14, FeO 0.15 (teaching shape 0.22, 0.27, 0.16, 0.15, 0.10);
   twin against the measured Cu foil 0.28 to 0.12. Known: oxide white lines run tall, Pt L3 short, CeO2 L3 single peak.
   Left for step 5: the main peak search window ends at +30 eV (K2CrO4 reports its peak at the window edge).
2. **Readable shell plots** (v1.21.0, done). Round ticks; Stacked (default, one lane per shell on a shared scale),
   Overlay and Build up (groups added in distance order until they make the total); bars at the true distances, height
   by number of atoms, with an arrow to each peak ("true 1.96 A -> peak 1.50 A"); k weight 1, 2, 3 for the plots and the
   transform; measured chi(k) (Larch autobk of the Larch examples) drawn with the model for Cu, Ni, Pt, Fe2O3, FeO.
   The plot is a lazy chunk, so the page stays within its 321 KB budget.
3. **Atoms and distance.** Translucent shell spheres and a radial ruler matching the R axis; farther atoms hidden until
   asked; distinct shell colours.
4. **Real wave picture.** A 2D interference map on a slice through the cluster: outgoing spherical wave, echoes with
   FEFF amplitude and phase, 1/r and mean free path decay; the brightness at the absorber follows chi(k).
5. **Cut fluff.** At most 600 words, one takeaway line per panel, model notes in one fold, reading cards from real
   library pairs or dropped, layout holes closed, tour updated.
