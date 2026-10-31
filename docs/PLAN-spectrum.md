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
3. **Atoms and distance** (v1.22.0, done). The chosen shell as a see-through sphere at its distance, named in the
   corner; farther atoms hidden until asked; a distance strip under the 3D view (a bar per distance, height by number
   of atoms, every shell labelled). Colours: the validator puts aqua and green 11.9 apart (normal vision, floor 15), and
   with six shells on screen no order of the documented palette passes every pair, so identity rides on labels and
   position (strip, lanes, table), as the dataviz rules require, instead of colour alone.
4. **Real wave picture** (v1.23.0, done). A field map on a slice through the real cluster (`src/lib/twin/wave-field.ts`,
   `wave-map.tsx`): outgoing spherical wave, each neighbour's echo with FEFF's |F(k)| and phase, 1/r and mean free path
   decay, to scale with a 1 A bar; Whole wave or Echoes alone (the echoes are physically far weaker). The ring at the
   absorber gives sin(2kR + phase), checked against the path sum's chi(k) sign for Cu, CuO and Pt (sigma^2 = 0). The
   panel now uses the shell's distance (was the first path's: 1.95 against 1.96 for CuO).
5. **Cut fluff** (v1.24.0, done). Prose 685 to 347 words (a test holds it at 450 or fewer); one takeaway per panel;
   every model note and source in one "Model and sources" fold; reading cards 5 to 3, all real data (computed Cu and
   CuO edges, computed Cr2O3 and K2CrO4, this sample's nearest and farthest shells); the atoms, the explanation and What
   if stay in view beside their taller neighbours (sticky inside cells as tall as their rows). The main peak is the
   first local maximum within 45 eV that reaches 90 % of the highest (chromate's was cut at the +30 eV window edge).
