import { describe, expect, it } from 'vitest';
import index from '@/data/quantum/ledge/index.json';
import { seededRandom } from '../xas';
import { ledgeSpectra, loadLedge } from './ledge';
import { lorentzian } from './spectrum';

describe('Mn L edges', () => {
  it('gives the Python check values for every oxidation state', async () => {
    for (const id of index.problems) {
      const d = await loadLedge(id);
      const y = lorentzian(Float64Array.from(d.check.energies_eV), d.spin_orbit.centres_eV, d.spin_orbit.weights, d.settings.eta_eV);
      d.check.values.forEach((v, i) => expect(y[i] / v, `${id} at ${d.check.energies_eV[i]} eV`).toBeCloseTo(1, 9));
    }
  });

  it('rebuilds the exact edge from the product formula signal as the shots grow', async () => {
    for (const id of index.problems) for (const spinOrbit of [true, false]) {
      const d = await loadLedge(id);
      const few = ledgeSpectra(d, spinOrbit, 1_000, 1.3384, seededRandom(2)), many = ledgeSpectra(d, spinOrbit, 100_000_000, 1.3384, seededRandom(2));
      expect(many.difference, `${id} ${spinOrbit}`).toBeLessThan(few.difference);
      expect(many.difference, `${id} ${spinOrbit}`).toBeLessThan(0.05);  // the product formula's own error is under 4 %
      expect(Math.abs(many.peak_eV.measured - many.peak_eV.exact)).toBeLessThanOrEqual(0.3);
    }
  });

  it('splits into L3 and L2 only with spin orbit coupling, L3 first and strongest', async () => {
    for (const id of index.problems) {
      const d = await loadLedge(id), so = d.spin_orbit;
      expect(so.l2_eV! - so.l3_eV!).toBeGreaterThan(10);
      expect(so.l3_share!).toBeGreaterThan(0.5);
      expect(d.spin_free.l3_eV).toBeUndefined();
      expect(d.spin_free.centroid_eV!).toBeGreaterThan(so.l3_eV!);
      expect(d.spin_free.centroid_eV!).toBeLessThan(so.l2_eV!);
    }
  });
});
