import { beforeAll, describe, expect, it } from 'vitest';
import fixture from '../data/xray/benchmark.json';
import { COMPOUND_PRESETS } from '../data/compound-presets';
import { benchmarkDeviations, summarizeAgreement, type Benchmark, type BenchmarkQuantity } from './benchmark';
import { loadXrayData, parseFormula, recommendThickness, xrayDataInfo } from './xraydata';

const benchmark: Benchmark = fixture;

/**
 * Tolerances on |lab / xraydb - 1|, set from the agreement measured with xraydb 4.5.8 (max, median):
 *   total mu    343 values  0.275 %  0.009 %
 *   photo mu    301 values  0.262 %  0.011 %
 *   edge energy 165 edges   0        0        (stored with 7 significant digits, all exact)
 *   edge step    21 edges   0.075 %  0.007 %
 *   thickness    21 plans   0.075 %  0.009 %
 * The bound for mu follows from how elements.json was built: knots fitted to 0.3 % in ln(mu/rho)
 * plus storage to 4 significant digits (at most 0.05 %), so about 0.35 %. The edge step is the
 * difference of two stored knots, each rounded to 4 digits. Median limits catch a systematic
 * shift (molar mass, mixing rule, density) that a max limit alone would let through.
 */
const TOLERANCE: Record<BenchmarkQuantity, { max: number; median: number }> = {
  total: { max: 0.0035, median: 0.0002 },
  photo: { max: 0.0035, median: 0.0002 },
  edgeEnergy: { max: 0, median: 0 },
  edgeStep: { max: 0.001, median: 0.0002 },
  thickness: { max: 0.001, median: 0.0002 },
};

describe('agreement with xraydb', () => {
  beforeAll(async () => { await loadXrayData(); });

  it('uses the xraydb version the tables were built with', () => {
    expect(xrayDataInfo().source).toContain(`XrayDB database ${benchmark.xraydbDatabase} via the xraydb Python package ${benchmark.xraydbVersion}`);
  });

  it('covers every compound preset with the same formula, density and edge', () => {
    for (const preset of COMPOUND_PRESETS) {
      const item = benchmark.cases.find(entry => entry.id === preset.id);
      expect(item, preset.id).toMatchObject({ source: 'preset', formula: preset.formula, density: preset.density, absorber: preset.absorber, edge: preset.edge });
    }
    expect(benchmark.cases.filter(item => item.source === 'preset')).toHaveLength(COMPOUND_PRESETS.length);
  });

  it('reads every formula with the same composition as xraydb', () => {
    for (const item of benchmark.cases) {
      const lab = parseFormula(item.formula);
      expect(Object.keys(lab).sort(), item.formula).toEqual(Object.keys(item.composition).sort());
      for (const symbol of Object.keys(lab)) expect(lab[symbol], `${item.formula} ${symbol}`).toBeCloseTo(item.composition[symbol] ?? NaN, 12);
    }
  });

  it('matches xraydb within the stated tolerance for every quantity', () => {
    const summary = summarizeAgreement(benchmarkDeviations(benchmark));
    expect(summary.map(row => row.quantity)).toEqual(Object.keys(TOLERANCE));
    for (const row of summary) {
      const where = `${row.quantity}: worst ${row.worst.caseId} ${row.worst.where} at ${row.worst.energy_eV} eV`;
      expect(row.max, where).toBeLessThanOrEqual(TOLERANCE[row.quantity].max);
      expect(row.median, row.quantity).toBeLessThanOrEqual(TOLERANCE[row.quantity].median);
    }
  });

  it('picks the same limit for the transmission thickness', () => {
    for (const item of benchmark.cases) {
      if (!item.edgeStep) continue;
      expect(recommendThickness(item.formula, item.absorber, item.edge, item.density).limitedBy, item.id).toBe(item.edgeStep.limitedBy);
    }
    expect(benchmark.cases.filter(item => item.edgeStep?.limitedBy === 'total-absorption').length).toBeGreaterThan(0);
  });
});
