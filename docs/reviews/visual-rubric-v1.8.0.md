# Visual rubric, v1.7.0 against v1.8.0

Scored by GPT (gpt-5.6-sol through the Codex CLI, read only) from the same six views before and after. Its fixes 1, 2, 5 and 6 went into v1.8.0 in part: fainter photon streaks and smaller secondary photons, smaller and muted part markers, a fade on the phone mode bar, and a shorter phone scene.

| Criterion | Before | After | Reason |
|---|---:|---:|---|
| Physical realism and scale | 3/5 | 4/5 | After has more convincing exposure, depth, materials, and equipment proportions; particles and oversized interaction markers still weaken realism. |
| Physical correctness of what is shown | 3/5 | 4/5 | After communicates the crystal path, transmission sequence, and 90° fluorescence geometry more clearly, though some beam/particle trajectories remain ambiguous. |
| Clutter and legibility of labels and overlays | 2/5 | 4/5 | Removing the large explanatory overlay and many peripheral labels greatly improves the scene; close labels still collide on mobile. |
| Attractiveness and art direction | 3/5 | 4/5 | After feels more cohesive, restrained, and instrument-like, but glowing particles and blue interaction nodes retain a game-like quality. |
| Mobile layout | 2/5 | 3/5 | After prioritizes controls and enlarges the beamline, but truncates context, overflows mode tabs, and creates an excessively tall viewport crop. |
| Accessibility cues visible in the UI | 3/5 | 3/5 | Selected states use shape, border, and text—not color alone—but icon-only controls, small labels, and uncertain focus treatment remain. |

**Average — Before: 2.67/5 · After: 3.67/5**

1. Replace free-floating photon streaks with subtler, beam-aligned scientific animation.
2. Reduce interaction-node size and saturation; distinguish them from physical sensors.
3. Add automatic label collision avoidance, edge clamping, and shorter leader lines.
4. Keep beam paths precisely centered through apertures, crystals, sample, and chambers.
5. Give mobile mode tabs a clear horizontal-scroll cue or compact selector.
6. Use a shorter mobile scene with preset views instead of one very tall camera crop.
7. Add persistent keyboard focus rings and text tooltips to every icon-only control.
8. Improve small-text contrast and keep all touch targets at least 44 × 44 px.