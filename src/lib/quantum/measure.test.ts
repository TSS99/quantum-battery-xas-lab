import { describe, expect, it } from 'vitest';
import o2 from '@/data/quantum/packs/li2mno3-o2-k.json';
import o1 from '@/data/quantum/packs/li2mno3-o1-k.json';
import li3 from '@/data/quantum/packs/li3mn2o-o2-k.json';
import li2 from '@/data/quantum/packs/li2mn2o-o2-k.json';
import { seededRandom } from '@/lib/xas';
import { BEAMLINE, LIFETIME_HWHM_EV, fit, measure, mixture, rank, readSpectrum, saturate, scanEnergies, surfaceDose, toCsv, type FitOptions, type Sticks } from './measure';
import { HARTREE_EV } from './packs';

const sticks = (pack: { reference: { centres_Ha: number[]; weights: number[] } }): Sticks =>
  ({ centres_eV: pack.reference.centres_Ha.map(c => c * HARTREE_EV), weights: pack.reference.weights });
const candidates = [o2, o1, li3, li2].map(sticks);
const edges = [o2, o1, li3, li2].map(p => p.reference.edge_eV);
const energies = scanEnergies(edges);
const options: FitOptions = { shifts: [-1, 1], broadenings: [0, 0.2, 0.5], resolvingPower: BEAMLINE.resolvingPower, halfWidth_eV: LIFETIME_HWHM_EV };

describe('soft X-ray measurement of a computed spectrum', () => {
  it('a noiseless scan fits back exactly', () => {
    const scan = measure(candidates[0], energies, BEAMLINE, seededRandom(1));
    const f = fit({ energies, measured: scan.truth }, [candidates[0]], options);
    expect(f.fractions[0]).toBe(1);
    expect(f.shift_eV).toBe(0);
    expect(f.extraFwhm_eV).toBe(0);
    expect(f.rFactor).toBeLessThan(1e-6);
  });

  it('recovers a known spectrum from a simulated measurement within its noise', () => {
    const scan = measure(candidates[0], energies, { ...BEAMLINE, flux: 1e9, dwell_s: 0.3 }, seededRandom(2));
    const f = fit(scan, [candidates[0]], options);
    expect(f.chi2).toBeGreaterThan(0.7);
    expect(f.chi2).toBeLessThan(1.4);
    expect(Math.abs(f.shift_eV)).toBeLessThanOrEqual(0.05);
  });

  it('recovers synthetic mixtures of the library clusters within their uncertainties', () => {
    const truth = [0.5, 0, 0.3, 0.2];
    const sample = mixture(candidates.map((s, k) => ({ sticks: s, fraction: truth[k] })));
    const f = fit(measure(sample, energies, BEAMLINE, seededRandom(3)), candidates, options);
    for (const k of [2, 3]) {
      expect(Math.abs(f.fractions[k] - truth[k]), `fraction ${k}`).toBeLessThan(Math.max(0.05, 3 * f.errors[k]));
    }
    // The two pristine oxygen sites have nearly the same spectrum, so only their sum is pinned down.
    expect(Math.abs(f.fractions[0] + f.fractions[1] - 0.5)).toBeLessThan(0.05);
  });

  it('recovers broadening in the sample as extra broadening', () => {
    const scan = measure(candidates[0], energies, BEAMLINE, seededRandom(7), 1);
    const f = fit(scan, [candidates[0]], { ...options, broadenings: [0, 0.5, 1, 1.5] });
    expect(f.extraFwhm_eV).toBe(1);
    expect(f.chi2).toBeLessThan(1.4);
  });

  it('ranks the right cluster first', () => {
    const scan = measure(candidates[2], energies, BEAMLINE, seededRandom(4));
    expect(rank(scan, candidates, options)[0].index).toBe(2);
  });

  it('finds a spectrum shifted by tens of eV on a sloping background, as measured data are', () => {
    const scan = measure(candidates[3], energies, BEAMLINE, seededRandom(5));
    const shifted = { energies: energies.map(e => e - 30), measured: scan.measured.map((y, i) => 3 * y + 0.4 + 0.01 * i) };
    const f = fit(shifted, [candidates[3]], { ...options, shifts: [-40, 5], background: true });
    expect(Math.abs(f.shift_eV + 30)).toBeLessThanOrEqual(0.05);
    expect(f.rFactor).toBeLessThan(1e-4);
  });

  it('reads back its own CSV', () => {
    const scan = measure(candidates[0], energies, BEAMLINE, seededRandom(6));
    const read = readSpectrum(toCsv(scan, 'test'), 'scan.csv');
    expect(read.column).toBe('measured');
    const first = Array.from(energies).findIndex(e => Math.abs(e - read.energies[0]) < 6e-4);
    expect(read.energies.length).toBeGreaterThan(100);
    expect(read.measured[10]).toBeCloseTo(scan.measured[first + 10], 5);
    expect(read.sigma![10]).toBeCloseTo(scan.sigma[first + 10], 3);
  });

  it('saturates fluorescence from a concentrated oxide, and not from a dilute one', () => {
    expect(saturate(1)).toBeCloseTo(1, 12);
    expect(saturate(0.5)).toBeGreaterThan(0.7);
    expect(saturate(0.5, 1e-6)).toBeCloseTo(0.5, 5);
  });

  it('gives the surface dose from photons, energy, attenuation and spot', () => {
    // 10^13 photons of 535 eV on 100 x 50 µm with μ/ρ = 9180 cm²/g: 8.57e-4 J × 918 m²/kg / 5e-9 m² = 157 MGy.
    expect(surfaceDose(1e13, 535, [100, 50])).toBeCloseTo(157.4, 1);
  });
});
