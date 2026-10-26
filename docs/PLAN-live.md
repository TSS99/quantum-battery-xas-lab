# Live operation plan (from 2026-10-26)

The owner wants the beamline twin to feel like [TEM-view](https://advanced-em.github.io/TEM-view/): the whole instrument
visibly working, live, while you operate it, and the 3D hutch as the default view. This file says what is done and what
is next, so any session (local or cloud) can carry on. Ship each step on its own: tests, push main, deploy, live check,
release notes.

## What TEM-view does that the twin did not

1. Its data panel streams all the time (the detector image redraws about 40 times a second) and follows a slider while
   it is being dragged.
2. The instrument answers each control with motion: the beam reshapes through the column over about a second when the
   mode changes, and the screen in the column shows the same live image as the panel.
3. Nothing waits for a button to look alive.

## Done

- v1.9.1: 3D is the default (a still of the hutch stands in while the model loads; a diagram chosen before then no longer
  wins). The camera sways slowly when nobody touches the page (`swayAngle`, hutch-3d-layout.ts).
- v1.9.2: no button on top of the scene; the guided tour starts from its icon under the hutch.
- v1.10.0: Live channels is the first results view, a live oscilloscope of I0, It and Iref at ten readings a second
  (src/lib/twin/live-feed.ts, src/components/twin/live-scope.tsx).

## Next, in order

1. **The 3D hutch moves with its controls.** The crystals turn to a new Bragg angle at a motor-like pace instead of
   snapping, and the second crystal slides with them; the fluorescence detector slides when its distance changes.
   Check: unit test for the easing; a browser test that the crystal is between its old and new angle shortly after an
   energy change; reduced motion still snaps.
2. **Acquire runs in the 3D view.** During a scan the monochromator steps through the scan energies in step with the
   points appearing on the plot, the readout strip shows the scan energy, and the scene says it is scanning. A small
   shared cursor (not React state) carries the shown point's energy from the results dock to the scene.
   Check: browser test that the drawn energy changes during a scan and returns after it.
3. **The XRF spectrum fills up live** like a real MCA: counts accumulate with live time and dead time shown, and start
   again when a control changes. Check: the total counts grow with time; the shape matches the expected spectrum.
4. **The whole site feels smooth.** Measure interaction latency and layout shift on the main pages at phone size, fix the
   worst, and add gentle page transitions where the framework supports them. Check: before and after numbers in the
   release notes.

## Working notes

- Build from PowerShell with `NEXT_PUBLIC_BASE_PATH=/quantum-battery-xas-lab`; Git Bash mangles the path.
- The twin's first-load JavaScript is at its 400 KB budget (tests/budget.spec.ts): load new UI with `next/dynamic`.
- `scripts/visual-shots.mjs` captures six reference views; `scripts/tour-video.mjs` renders the guided tour to MP4.
- Reduced motion must keep working: no sway, no sweeping, cuts instead of camera flights.
