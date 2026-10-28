import { beforeAll, describe, expect, it } from 'vitest';
import fixtures from '@/data/twin/compton-fixtures.json';
import { loadXrayData, muOverRho } from '../xraydata';
import { seededRandom } from '../xas';
import { comptonEnergy } from './sdd';
import { comptonShare, comptonShifted, elementComptonShare, kleinNishinaDirection } from './compton';

beforeAll(async () => { await loadXrayData(); });

describe('Compton scattering', () => {
  it('matches xraydb Compton shares off the table grid within 0.002', () => {
    for (const p of fixtures.points) expect(Math.abs(elementComptonShare(p.symbol, p.energy_eV) - p.share), `${p.symbol} ${p.energy_eV}`).toBeLessThan(0.002);
  });

  it('makes light elements scatter mostly by Compton and heavy ones mostly elastically, more so at higher energy', () => {
    expect(elementComptonShare('H', 9000)).toBeGreaterThan(0.9);
    expect(elementComptonShare('Pb', 9000)).toBeLessThan(0.02);
    expect(elementComptonShare('Cu', 30000)).toBeGreaterThan(elementComptonShare('Cu', 9000));
  });

  it('weights a compound by each element\'s own scattering', () => {
    const e = 9000, h = muOverRho('H', e), o = muOverRho('O', e);
    const wh = 2 * 1.008 / 18.015, wo = 15.999 / 18.015;
    const sh = wh * (h.total - h.photo), so = wo * (o.total - o.photo);
    const expected = (sh * elementComptonShare('H', e) + so * elementComptonShare('O', e)) / (sh + so);
    expect(comptonShare('H2O', e)).toBeCloseTo(expected, 3);
  });

  it('shifts the energy as the sdd model does: E / (1 + (E / m c^2)(1 - cos theta))', () => {
    for (const angle of [30, 90, 150]) expect(comptonShifted(20000, Math.cos(angle * Math.PI / 180))).toBeCloseTo(comptonEnergy(20000, angle), 9);
    expect(comptonShifted(9000, 1)).toBe(9000);
  });

  it('draws the polarised Klein-Nishina pattern: the dipole pattern at low energy, forward at high energy', () => {
    const random = seededRandom(5), n = 40000;
    let alongE = 0, forward = 0;
    for (let i = 0; i < n; i++) { const d = kleinNishinaDirection(random, 100); if (Math.abs(d[2]) > 0.9) alongE++; if (d[0] > 0) forward++; }
    // Dipole: about 1.4 % within |cos| > 0.9 of the polarisation, and as much forwards as back.
    expect(alongE / n).toBeLessThan(0.025);
    expect(Math.abs(forward / n - 0.5)).toBeLessThan(4 * Math.sqrt(0.25 / n));
    let mean = 0;
    for (let i = 0; i < n; i++) mean += kleinNishinaDirection(random, 511000)[0];
    expect(mean / n).toBeGreaterThan(0.15);
  });
});
