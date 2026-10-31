import { describe, expect, it } from 'vitest';
import { bumpMagnitude, correctedTransform } from './distance-chart';
import { loadPaths } from './exafs';
import { groupShells, shellSpectra } from './shells';

describe('the story distance chart', () => {
  it('puts each shell bump at its true distance, where the plain transform falls short', async () => {
    for (const [id, near] of [['cu', 2], ['cuo', 1], ['pt', 1], ['zno', 2]] as const) {
      const material = await loadPaths(id), shells = groupShells(material).filter(s => s.siteId === material.sites[0].id);
      const spectra = shellSpectra(material, shells);
      for (const shell of shells.filter(s => s.kind === 'shell').slice(0, near)) {
        const bump = correctedTransform(spectra.k, spectra.chi[shell.id], shell.paths[0], spectra.window);
        const mag = bumpMagnitude([bump]), peak = bump.r[mag.indexOf(Math.max(...mag))];
        expect(Math.abs(peak - shell.r_A), `${id} ${shell.id}: peak ${peak.toFixed(2)}, true ${shell.r_A.toFixed(2)}`).toBeLessThan(0.06);
        // The detailed view's plain transform puts the same shell well short of it (heavy Pt the least).
        if (id !== 'pt') expect(shell.r_A - spectra.peak_A[shell.id]).toBeGreaterThan(0.15);
      }
    }
  });
});
