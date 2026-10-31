# Read the spectrum for everyone: plan (2026-10-31)

Who it is for: anyone from about 15 to 50 years old, with no physics. Goal: in about five minutes they can say what an
X-ray absorption spectrum is and what it tells us, mostly from pictures.

## What is wrong now, for a newcomer

From the live page (Cu foil, 1440 px, 4600 px tall):

1. Twelve panels at once: the explorer, three reading cards, around the edge, valence, 3D atoms, two plots with eight
   lanes each, the explanation, the shell table, the wave, What if, light and heavy neighbours, sources. Nothing says
   where to start, so the eye has nowhere to land.
2. Jargon before ideas: XANES, EXAFS, E0, 1s, 3d, chi(k), |chi(R)|, k weight, sigma squared, Einstein model, phase
   correction, multiple scattering. A newcomer meets more than a dozen symbols before the first idea.
3. Graphs drawn for experts: axes in k and R, tick labels, legends with eight entries, overlays, ghost curves.
4. The picture people get at once, the electron wave, is chapter 7 of 8 and is driven by k, a quantity nobody outside
   the field knows.
5. The story itself (energy up, electron out, wave, echoes, wiggles, distances; edge position, charge) is spread over
   panels in another order.
6. Peaks sit 0.3 to 0.5 Å short of the true distance. That is correct physics, but a newcomer reads it as a mistake.

## The idea

Two views of the same data:

- **Simple (the default)**: a story in seven short scenes. Each scene has one idea, one picture and at most one control,
  in plain words. The scientific name appears only as a small "Scientists call this" tag.
- **Detailed**: today's page, unchanged, for students and scientists (`?view=detailed`). Opening the page from the
  beamline twin goes there, because that is a lab session.

Both views use the same computed data: FEFF10 near edges, FEFF paths and the measured references. The Simple view is
not a cartoon. It is the same physics with less on screen.

**Everything with atoms in it is 3D and built from real data** (owner's request, 2026-11-01): the bench in step 1
(beamline pipe, the sample in its holder, the detector, photons that are absorbed at the sample in the share the counter
shows); one atom as an electron cloud in step 2 (`src/lib/twin/atom-cloud.ts`: the ground state shells, Slater's
effective charges, electrons drawn from the Slater density; radii squeezed for the drawing, with the real ratio said on
screen); the real crystal, from the FEFF cluster, in steps 3 to 7. Graphs of measured quantities stay flat, because
they are graphs.

## The seven scenes

Copper is the example. Every number and name follows the chosen material.

1. **Shine and count.** "We shine X-rays through a thin piece of copper and count how many come out the other side."
   Picture: the 3D bench (the beam, the sample in its holder, the detector) and a big counter ("62 of every 100 get through").
   Control: an X-ray energy slider. As you slide, the graph below draws itself (X-rays absorbed against X-ray energy).
   Tag: absorption spectrum.
2. **The jump.** "At 8,979 eV an X-ray has just enough energy to knock out one of copper's innermost electrons, so far
   more X-rays are absorbed." Picture: one atom in 3D, its electrons as a cloud (bright core, outer haze), and a bar
   for the X-ray's energy rising toward a line, "needed". Below the line the X-ray passes; above it the core electron
   leaves as an outgoing wave and the innermost layer dims by one electron's share.
   Each element jumps at its own energy, which is how we choose which atoms to look at. Tag: absorption edge.
3. **The electron is a ripple.** "The freed electron spreads out as a wave, like a ripple on a pond." Picture: the
   real crystal in 3D with the computed wave on a glass slice through it, first on its own, then with the
   neighbours, each of which sends a faint echo back. To scale. Tag: photoelectron.
4. **Echoes make the wiggles.** "When the echo comes back in step, copper absorbs a little more; out of step, a little
   less. Raise the energy and the ripples get shorter, so it flips back and forth." Picture: the wave map, a ring at
   the centre (bright: more, dark: less), and under it the wiggle line against energy with a dot that follows the
   slider. Control: energy above the jump in eV, not k. Tag: EXAFS.
5. **Wiggle speed is a distance.** "Push the neighbours farther away and the wiggles come faster. Measure how fast it
   wiggles and you have measured the distance between atoms." Picture: the copper atom and its nearest neighbours in
   3D, moving out as you slide, and the wiggle line with a faint copy at the real distance. Control: the neighbours' distance (the real
   crystal plus or minus 0.6 Å). Tag: bond length.
6. **Unmix the wiggles into a distance chart.** "A real crystal has rings of neighbours at several distances, and their
   wiggles mix. A computer unmixes them into bumps, one bump for each ring." Picture: the crystal in 3D with each
   ring of neighbours lit as a see-through sphere, beside a bump chart on the same distance axis. "Add the next ring"
   adds a ring and its bump together until they make the real spectrum. Each ring's bump is corrected with its own
   calculated phase, so it sits at the true distance; the uncorrected transform stays in the Detailed view.
   Tag: Fourier transform.
7. **The jump moves when atoms lose electrons.** "When copper rusts it gives electrons away. The rest are held tighter,
   so the jump moves to a higher energy. The metal in a battery does this every time it charges." Picture: the three
   real edges (Cu, Cu2O, CuO: computed shapes at measured positions) and a switch, "electrons given away: 0, 1, 2",
   that moves a marker while the 3D atom's outer cloud loses electrons. Tag: oxidation state.

The story ends with one card, "What one spectrum tells you": where the jump is (how many electrons the atom has given
away) and the wiggles (which neighbours, and how far). Then two buttons: the Detailed view and the beamline twin.

## Design rules (tests check the ones marked *)

- One column, at most 960 px wide; one scene per screen at 1440 by 900; readable at 375 px with no sideways scroll*.
- Each scene: a number, a headline of at most 10 words, at most 45 words of text*, one picture, at most one control*,
  one tag.
- The whole story at most 340 words*, at a reading grade of 8 or lower (Flesch Kincaid)*.
- No symbols or field names in the story text (chi, sigma, k, R, E0, XANES, EXAFS, Fourier) except in the tags*.
- Graphs: at most three labels on an axis, plain axis names, labels on the lines, no legends.
- Colour by meaning only: X-rays amber, the electron cyan, neighbours in the shell colours, controls periwinkle.
- Motion: the beam and the ripples move; nothing moves under reduced motion*.
- Material picker in plain words: Copper, Black copper oxide, Platinum, Rust (iron oxide), Phone battery cathode
  (LiCoO2), Battery manganese oxide (MnO2). The Detailed view keeps all 40.
- One "How this is drawn" fold at the end lists the data, as the Detailed view's "Model and sources" does.

## Steps (one release each; tests pass before every push)

1. **v1.25.0 Two views and scenes 1 and 2** (done, with the 3D bench and the 3D atom). The Simple and Detailed switch; the Detailed view is today's page, loaded
   only when asked for (its tests open `?view=detailed`, the twin opens it); the story frame with the progress dots
   and the material picker; scenes 1 and 2; story tests (word budget, reading grade, no symbols, one control per
   scene, no sideways scroll at 375 px).
2. **v1.26.0 The wave.** Scenes 3 and 4: ripples alone, then with echoes; the energy slider with the wiggle line and
   the in step or out of step ring. The wave map scales to the column.
3. **v1.27.0 Distances.** Scenes 5 and 6: the distance slider; the half target over bumps corrected for phase. Unit
   test: copper's first ring bump within 0.05 Å of 2.56 Å.
4. **v1.28.0 Charge, and finish.** Scene 7, the ending card and the "How this is drawn" fold; a visual check at 375,
   768 and 1440 px; accessibility audit; page weight within its 321 KB budget.

## How we will know it worked

- A first-time reader sees what the page is about in one sentence and the first picture without scrolling.
- The tests above pass, and every test of the Detailed view still passes.
- Screenshots at 375, 768 and 1440 px show one idea per screen, nothing overlapping, nothing cut off.
