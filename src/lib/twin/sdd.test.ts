import { beforeAll, describe, expect, it } from 'vitest';

import fixturesJson from '../../data/twin/fixtures.json';
import { elementMuOverRho, loadXrayData } from '../xraydata';
import {
  ELECTRON_REST_ENERGY_eV,
  MN_KA1_eV,
  RESPONSE_DEFAULTS,
  comptonEnergy,
  deadTime,
  deadTimeLoss,
  efficiency,
  fanoFwhm,
  filterTransmission,
  inputRate,
  maximumOutputRate,
  mcaSpectrum,
  noiseFwhm,
  outputRate,
  peakFwhm,
  productionLines,
  roiCounts,
  solidAngle,
} from './sdd';
import { emissionLines, loadOptics } from './tables';
import type { SddConfig } from './types';

interface DetectorFixture { energy_eV: number; be12_5umTransmission: number; si450umAbsorption: number }
const fixtures = fixturesJson as unknown as { detector: DetectorFixture[] };

const relativeError = (actual: number, expected: number) => Math.abs(actual / expected - 1);

const detector = (overrides: Partial<SddConfig> = {}): SddConfig => ({
  elements: 4, distance_mm: 30, area_mm2: 50, peaking_us: 1,
  roi_eV: [7890, 8190], soller: false, exitAngle_deg: 45, ...overrides,
});

describe('detector geometry', () => {
  it('uses the exact disc solid angle and sums over elements', () => {
    const one = solidAngle({ elements: 1, distance_mm: 30, area_mm2: 50 });
    const radius = Math.sqrt(50 / Math.PI);
    expect(one.radius_mm).toBeCloseTo(radius, 12);
    expect(one.perElement_sr).toBeCloseTo(2 * Math.PI * (1 - 30 / Math.hypot(30, radius)), 14);
    const four = solidAngle({ elements: 4, distance_mm: 30, area_mm2: 50 });
    expect(four.total_sr).toBeCloseTo(4 * one.perElement_sr, 15);
    expect(four.fraction).toBeCloseTo(four.total_sr / (4 * Math.PI), 15);
  });

  it('approaches a hemisphere up close and pi r^2 / d^2 far away', () => {
    const close = solidAngle({ elements: 1, distance_mm: 1e-9, area_mm2: 50 });
    expect(close.perElement_sr).toBeCloseTo(2 * Math.PI, 8);
    const far = solidAngle({ elements: 1, distance_mm: 1e5, area_mm2: 50 });
    expect(relativeError(far.perElement_sr, 50 / 1e10)).toBeLessThan(1e-8);
    expect(() => solidAngle({ elements: 0, distance_mm: 30, area_mm2: 50 })).toThrow(/at least one element/);
    expect(() => solidAngle({ elements: 1, distance_mm: 0, area_mm2: 50 })).toThrow(/distance/);
  });

  it('collects less as the detector is pulled back', () => {
    const near = solidAngle({ elements: 4, distance_mm: 20, area_mm2: 50 });
    const far = solidAngle({ elements: 4, distance_mm: 60, area_mm2: 50 });
    expect(far.total_sr).toBeLessThan(near.total_sr);
  });
});

describe('window and sensor efficiency', () => {
  beforeAll(async () => {
    await loadXrayData();
  });

  it('matches the xraydb Be and Si fixtures within 1%', () => {
    for (const fixture of fixtures.detector) {
      const actual = efficiency(fixture.energy_eV);
      expect(relativeError(actual.window, fixture.be12_5umTransmission)).toBeLessThan(0.01);
      expect(relativeError(actual.sensor, fixture.si450umAbsorption)).toBeLessThan(0.01);
      expect(actual.total).toBeCloseTo(actual.window * actual.sensor, 15);
    }
  });

  it('loses high energies through the sensor and low energies in the window', () => {
    expect(efficiency(2371).sensor).toBeGreaterThan(0.99);
    expect(efficiency(47_117).sensor).toBeLessThan(0.1);
    expect(efficiency(2371).window).toBeLessThan(efficiency(12_271).window);
    // A thicker sensor stops more of a hard line.
    expect(efficiency(23_713, { sensor_um: 1000 }).sensor).toBeGreaterThan(efficiency(23_713).sensor);
  });
});

describe('energy resolution', () => {
  it('reproduces the dossier Fano limit at Mn Ka1', () => {
    // 2.3548 sqrt(F epsilon E) with F = 0.115 and epsilon = 3.65 eV: dossier 6.5 gives 117 eV.
    expect(fanoFwhm(MN_KA1_eV)).toBeCloseTo(117.2, 1);
    expect(fanoFwhm(4 * MN_KA1_eV) / fanoFwhm(MN_KA1_eV)).toBeCloseTo(2, 12);
  });

  it('returns exactly the profile FWHM at Mn Ka1 when one is given', () => {
    for (const fwhmMnKa_eV of [125, 130, 140]) {
      expect(peakFwhm(MN_KA1_eV, 1, { fwhmMnKa_eV })).toBeCloseTo(fwhmMnKa_eV, 10);
      // The electronic term is energy independent, so other energies move only via Fano.
      const noise = noiseFwhm(1, { fwhmMnKa_eV });
      expect(peakFwhm(8046, 1, { fwhmMnKa_eV })).toBeCloseTo(Math.hypot(noise, fanoFwhm(8046)), 12);
    }
    expect(() => noiseFwhm(1, { fwhmMnKa_eV: 100 })).toThrow(/below the Fano limit/);
  });

  it('degrades at short peaking time and bottoms out at the noise optimum', () => {
    const fast = peakFwhm(MN_KA1_eV, 0.25);
    const typical = peakFwhm(MN_KA1_eV, 1);
    const slow = peakFwhm(MN_KA1_eV, 4);
    expect(fast).toBeGreaterThan(typical);
    expect(typical).toBeGreaterThan(slow);
    // The 4 us anchor is the dossier's 5 rms electrons, which it puts at 125 to 128 eV.
    expect(slow).toBeGreaterThan(124);
    expect(slow).toBeLessThan(129);
    expect(typical).toBeLessThan(140);
    // The U is symmetric in log peaking time about the optimum.
    expect(peakFwhm(MN_KA1_eV, 16)).toBeCloseTo(peakFwhm(MN_KA1_eV, 1), 10);
  });

  it('keeps the Fano factor and pair energy adjustable', () => {
    expect(RESPONSE_DEFAULTS.fanoFactor).toBeGreaterThanOrEqual(0.11);
    expect(RESPONSE_DEFAULTS.fanoFactor).toBeLessThanOrEqual(0.12);
    expect(RESPONSE_DEFAULTS.pairEnergy_eV).toBeGreaterThanOrEqual(3.6);
    expect(RESPONSE_DEFAULTS.pairEnergy_eV).toBeLessThanOrEqual(3.7);
    const wide = fanoFwhm(MN_KA1_eV, { fanoFactor: 0.12, pairEnergy_eV: 3.71 });
    expect(wide).toBeGreaterThan(fanoFwhm(MN_KA1_eV));
    expect(wide).toBeCloseTo(121, 0);  // dossier 6.5 upper end
  });
});

describe('dead time', () => {
  it('follows the peaking time unless overridden', () => {
    expect(deadTime(1)).toBeCloseTo(1e-6, 15);
    expect(deadTime(0.25)).toBeCloseTo(0.25e-6, 15);
    expect(deadTime(1, { deadTime_s: 4e-7 })).toBe(4e-7);
    // The 1 us ceiling sits just under the 4e5 cps per element of Woicik et al. (2010).
    expect(maximumOutputRate(deadTime(1))).toBeCloseTo(3.679e5, -2);
  });

  it('matches the dossier live fractions for both models', () => {
    // Dossier 6.6 table: paralyzable / non-paralyzable OCR divided by ICR.
    const rows: [number, number, number, number][] = [
      [0.25e-6, 1e5, 0.975, 0.975],
      [0.5e-6, 3e5, 0.861, 0.870],
      [1e-6, 1e6, 0.368, 0.500],
      [2e-6, 3e5, 0.549, 0.625],
    ];
    for (const [tau, icr, paralyzable, nonParalyzable] of rows) {
      expect(outputRate(icr, tau, 'paralyzable') / icr).toBeCloseTo(paralyzable, 2);
      expect(outputRate(icr, tau, 'non-paralyzable') / icr).toBeCloseTo(nonParalyzable, 2);
    }
  });

  it('peaks at 1/(e tau) and folds back past it', () => {
    const tau = 1e-6;
    const peak = outputRate(1 / tau, tau, 'paralyzable');
    expect(peak).toBeCloseTo(maximumOutputRate(tau), 6);
    expect(outputRate(2 / tau, tau, 'paralyzable')).toBeLessThan(peak);
    // Non-paralyzable saturates instead of folding back.
    expect(outputRate(1e9, tau, 'non-paralyzable')).toBeLessThan(1 / tau);
    expect(outputRate(1e9, tau, 'non-paralyzable')).toBeGreaterThan(0.99 / tau);
  });

  it('inverts both models on the usable branch', () => {
    const tau = 1e-6;
    for (const icr of [1e3, 1e4, 1e5, 3e5, 7e5, 1 / tau]) {
      for (const model of ['paralyzable', 'non-paralyzable'] as const) {
        const ocr = outputRate(icr, tau, model);
        expect(relativeError(inputRate(ocr, tau, model), icr), `${model} ${icr}`).toBeLessThan(1e-9);
      }
    }
    expect(inputRate(0, tau)).toBe(0);
    expect(() => inputRate(maximumOutputRate(tau) * 1.01, tau)).toThrow(/cannot exceed/);
    expect(() => inputRate(1.01 / tau, tau, 'non-paralyzable')).toThrow(/cannot reach/);
  });

  it('reports the dead fraction', () => {
    const loss = deadTimeLoss(3e5, 1e-6, 'non-paralyzable');
    expect(loss.ocr).toBeCloseTo(3e5 / 1.3, 6);
    expect(loss.deadFraction).toBeCloseTo(1 - 1 / 1.3, 12);
    expect(deadTimeLoss(0, 1e-6).deadFraction).toBe(0);
  });
});

describe('scatter energies', () => {
  it('reproduces the dossier 90 degree Compton shifts', () => {
    for (const [incident, scattered] of [[7212, 7112], [9079, 8921], [12_000, 11_725], [20_000, 19_247]]) {
      expect(comptonEnergy(incident, 90)).toBeCloseTo(scattered, 0);
    }
    expect(comptonEnergy(10_000, 90)).toBeCloseTo(10_000 / (1 + 10_000 / ELECTRON_REST_ENERGY_eV), 10);
  });

  it('shifts nothing forward and most at backscatter', () => {
    expect(comptonEnergy(10_000, 0)).toBeCloseTo(10_000, 10);
    expect(comptonEnergy(10_000, 180)).toBeLessThan(comptonEnergy(10_000, 90));
    expect(comptonEnergy(10_000, 180)).toBeCloseTo(10_000 / (1 + 2 * 10_000 / ELECTRON_REST_ENERGY_eV), 10);
  });
});

describe('fluorescence line production', () => {
  beforeAll(async () => {
    await Promise.all([loadOptics(), loadXrayData()]);
  });

  it('places Fe and Cu lines on their tabulated energies', () => {
    for (const [symbol, formula] of [['Fe', 'Fe'], ['Cu', 'Cu']]) {
      const tabulated = new Map(emissionLines(symbol).map(line => [line.name, line.energy_eV]));
      const produced = productionLines(formula, 10_000);
      expect(produced.length).toBeGreaterThan(0);
      for (const line of produced) {
        expect(line.element).toBe(symbol);
        expect(line.energy_eV).toBe(tabulated.get(line.line));
        expect(line.energy_eV).toBeLessThan(10_000);
      }
      const strongest = produced.reduce((best, line) => line.crossSection_cm2_g > best.crossSection_cm2_g ? line : best);
      expect(strongest.line).toBe('Ka1');
      expect(strongest.edge).toBe('K');
    }
  });

  it('switches off the K lines below the K edge', () => {
    // Cu K edge is 8979 eV; at 8500 eV only the L lines are open.
    const below = productionLines('Cu', 8500);
    expect(below.some(line => line.edge === 'K')).toBe(false);
    expect(below.some(line => line.edge.startsWith('L'))).toBe(true);
    expect(productionLines('Cu', 9500).some(line => line.edge === 'K')).toBe(true);
  });

  it('weights a compound by mass fraction and the edge jump', () => {
    const oxide = productionLines('Fe2O3', 10_000);
    const metal = productionLines('Fe', 10_000);
    const ka1 = (lines: ReturnType<typeof productionLines>) =>
      lines.find(line => line.element === 'Fe' && line.line === 'Ka1')!.crossSection_cm2_g;
    // Fe2O3 is 69.9 wt% Fe, and oxygen adds no Fe Ka.
    const ironFraction = (2 * 55.845) / (2 * 55.845 + 3 * 15.999);
    expect(ka1(oxide) / ka1(metal)).toBeCloseTo(ironFraction, 2);

    // K share of the photoabsorption is 1 - 1 / jumpRatio, and Fe K jumps by 7.893.
    const kLines = metal.filter(line => line.edge === 'K');
    const kTotal = kLines.reduce((sum, line) => sum + line.crossSection_cm2_g, 0);
    expect(kLines.map(line => line.line).sort()).toEqual(['Ka1', 'Ka2', 'Kb1', 'Kb3']);
    expect(kTotal).toBeGreaterThan(0);
    const expectedShare = (1 - 1 / 7.893) * 0.35098;  // jump ratio times fluorescence yield
    expect(kTotal / elementMuOverRho('Fe', 10_000).photo).toBeCloseTo(expectedShare, 3);
  });

  it('skips elements with no tabulated lines instead of throwing', () => {
    // Hydrogen has no emission-line table and no edge above 100 eV; oxygen has both.
    expect(productionLines('H2', 10_000)).toEqual([]);
    expect(productionLines('H2O', 10_000).every(line => line.element === 'O')).toBe(true);
    expect(productionLines('CuSO4·5H2O', 10_000).some(line => line.element === 'Cu')).toBe(true);
  });
});

describe('MCA spectrum', () => {
  beforeAll(async () => {
    await Promise.all([loadOptics(), loadXrayData()]);
  });

  const input = (overrides: Partial<Parameters<typeof mcaSpectrum>[0]> = {}) => ({
    sdd: detector(),
    sample: { formula: 'Cu' },
    energy_eV: 9500,
    fluorescenceScale: 1e4,
    dwell_s: 1,
    ...overrides,
  });

  it('puts the Fe and Cu Ka peaks in the right channels', () => {
    for (const [formula, roi] of [['Fe', [6300, 6500]], ['Cu', [7950, 8150]]] as const) {
      const spectrum = mcaSpectrum(input({ sample: { formula }, energy_eV: 9500, sdd: detector({ roi_eV: [...roi] as [number, number] }) }));
      const peak = spectrum.counts.indexOf(Math.max(...spectrum.counts));
      // A 130 eV detector cannot resolve the Ka doublet, so the single peak it shows sits
      // between Ka2 and Ka1, within a channel of the intensity-weighted mean.
      const ka1 = emissionLines(formula).find(line => line.name === 'Ka1')!.energy_eV;
      const ka2 = emissionLines(formula).find(line => line.name === 'Ka2')!.energy_eV;
      expect(spectrum.energies_eV[peak]).toBeGreaterThan(ka2 - spectrum.channelWidth_eV);
      expect(spectrum.energies_eV[peak]).toBeLessThan(ka1 + spectrum.channelWidth_eV);
      expect(spectrum.roiCounts).toBeGreaterThan(0.5 * spectrum.totalCounts);
    }
  });

  it('uses 2048 channels of 10 eV by default', () => {
    const spectrum = mcaSpectrum(input());
    expect(spectrum.energies_eV).toHaveLength(2048);
    expect(spectrum.channelWidth_eV).toBe(10);
    expect(spectrum.energies_eV[0]).toBeCloseTo(5, 12);
    expect(spectrum.energies_eV[2047]).toBeCloseTo(20_475, 12);
    expect(roiCounts(spectrum, [0, 20_480])).toBeCloseTo(spectrum.totalCounts, 6);
    expect(roiCounts(spectrum, [7890, 8190])).toBeCloseTo(spectrum.roiCounts, 9);
  });

  it('keeps the area of each line and scales counts with dwell', () => {
    const one = mcaSpectrum(input({ dwell_s: 1 }));
    const three = mcaSpectrum(input({ dwell_s: 3 }));
    expect(three.totalCounts / one.totalCounts).toBeCloseTo(3, 9);
    // Rendering loses nothing: the counts equal the surviving rate times the dwell.
    expect(one.totalCounts).toBeCloseTo(one.ocr * 1, 2);
  });

  it('adds elastic and Compton peaks at the right energies only when given rates', () => {
    const quiet = mcaSpectrum(input());
    expect(quiet.lines.some(line => line.kind === 'elastic')).toBe(false);
    expect(quiet.lines.some(line => line.kind === 'compton')).toBe(false);

    const scattered = mcaSpectrum(input({ scatter: { elastic_cps: 1e5, compton_cps: 3e5 } }));
    const elastic = scattered.lines.find(line => line.kind === 'elastic')!;
    const compton = scattered.lines.find(line => line.kind === 'compton')!;
    expect(elastic.energy_eV).toBe(9500);
    expect(compton.energy_eV).toBeCloseTo(comptonEnergy(9500, 90), 10);
    // The documented broadening makes the Compton peak wider than a fluorescence line.
    expect(compton.fwhm_eV).toBeGreaterThan(elastic.fwhm_eV);
    expect(scattered.icr).toBeGreaterThan(quiet.icr);
  });

  it('loses counts to dead time and reports the fraction', () => {
    const bright = mcaSpectrum(input({ fluorescenceScale: 1e5 }));
    expect(bright.deadTime_s).toBe(1e-6);
    expect(bright.deadFraction).toBeGreaterThan(0.1);
    // Each element has its own processor: dead time acts on one element's share of the summed rate.
    const elements = detector().elements;
    expect(elements).toBeGreaterThan(1);
    expect(bright.ocr).toBeCloseTo(outputRate(bright.icr / elements, bright.deadTime_s, 'paralyzable') * elements, 6);
    expect(bright.deadFraction).toBeCloseTo(1 - Math.exp(-bright.icr / elements * bright.deadTime_s), 12);
    expect(bright.totalCounts).toBeLessThan(bright.icr);

    const dim = mcaSpectrum(input({ fluorescenceScale: 10 }));
    expect(dim.deadFraction).toBeLessThan(1e-3);
  });

  it('suppresses scatter with a Z-1 filter and removes the filter lines with Soller slits', () => {
    const filter = { formula: 'Ni', density: 8.908, thickness_um: 20 };
    const scatter = { elastic_cps: 1e4, compton_cps: 1e4 };
    const bare = mcaSpectrum(input({ sdd: detector(), scatter }));
    const filtered = mcaSpectrum(input({ sdd: detector({ filter }), scatter }));
    const sollered = mcaSpectrum(input({ sdd: detector({ filter, soller: true }), scatter }));

    const kaRate = (spectrum: ReturnType<typeof mcaSpectrum>) =>
      spectrum.lines.find(line => line.label === 'Cu Ka1')!.rate_cps;
    const elasticRate = (spectrum: ReturnType<typeof mcaSpectrum>) =>
      spectrum.lines.find(line => line.kind === 'elastic')!.rate_cps;

    // Nickel sits between Cu Ka and the incident energy, so scatter is cut much harder.
    expect(elasticRate(filtered) / elasticRate(bare)).toBeLessThan(0.2 * (kaRate(filtered) / kaRate(bare)));
    expect(filtered.lines.some(line => line.kind === 'filter-fluorescence')).toBe(true);
    expect(sollered.lines.some(line => line.kind === 'filter-fluorescence')).toBe(false);
    expect(sollered.icr).toBeLessThan(filtered.icr);
    expect(filterTransmission({ filter }, 8046)).toBeGreaterThan(filterTransmission({ filter }, 9500));
    expect(filterTransmission({}, 8046)).toBe(1);
  });

  it('grows the pile-up sum peak as the square of the rate', () => {
    const low = mcaSpectrum(input({ fluorescenceScale: 1e3 }));
    const high = mcaSpectrum(input({ fluorescenceScale: 2e3 }));
    const sum = (spectrum: ReturnType<typeof mcaSpectrum>) =>
      spectrum.lines.filter(line => line.kind === 'pile-up').reduce((total, line) => total + line.rate_cps, 0);
    expect(sum(low)).toBeGreaterThan(0);
    expect(sum(high) / sum(low)).toBeCloseTo(4, 6);
    // Pulses pile up within one element, so splitting the same light over twice the elements halves the pile-up.
    const one = mcaSpectrum(input({ fluorescenceScale: 1e3, sdd: detector({ elements: 1 }) }));
    const two = mcaSpectrum(input({ fluorescenceScale: 1e3, sdd: detector({ elements: 2 }) }));
    expect(sum(two) / sum(one)).toBeCloseTo(0.5, 6);
    // A Ka1 + Ka1 sum peak sits at twice the Cu Ka1 energy, and the Ka1 + Ka2 cross term
    // next to it is the strongest of all, because the two Ka lines have similar rates.
    const ka1 = emissionLines('Cu').find(line => line.name === 'Ka1')!.energy_eV;
    const ka2 = emissionLines('Cu').find(line => line.name === 'Ka2')!.energy_eV;
    expect(high.lines.some(line => line.kind === 'pile-up' && line.energy_eV === 2 * ka1)).toBe(true);
    const strongest = high.lines.filter(line => line.kind === 'pile-up')
      .reduce((best, line) => line.rate_cps > best.rate_cps ? line : best);
    expect(strongest.energy_eV).toBeCloseTo(ka1 + ka2, 6);
  });
});
