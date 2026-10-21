import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fixtures from '../../data/twin/exafs-fit-fixtures.json';
import { seededRandom } from '../xas';
import { chiPath, loadPaths, sigma2Einstein } from './exafs';
import { fitExafs } from './exafs-fit';
import type { ExafsFitRequest } from './types';

type Case = typeof fixtures.cases[number];
type Mode = keyof Case['fits'];

async function requestFor(entry = fixtures.cases[0], mode: Mode = 'r'): Promise<ExafsFitRequest> {
  const material = await loadPaths(entry.material), reference = entry.fits[mode], t = entry.transform;
  return {
    k_A_inv: entry.k_A_inv, chi: entry.chi,
    parameters: Object.fromEntries(Object.entries(entry.parameters).flatMap(([name, spec]) => spec ? [[name, { ...spec }]] : [])),
    model: { s02: 's02', e0_eV: 'e0', shells: entry.paths.map((p, i) => ({
      id: `shell${i}`, paths: [material.sites[0].paths.find(path => path.id === p.id)!],
      deltar_A: `dr${i}`, sigma2_A2: `ss${i}`,
    })) },
    options: {
      space: reference.space as 'k' | 'r', kmin_A_inv: t.kmin, kmax_A_inv: t.kmax,
      rmin_A: t.rmin, rmax_A: t.rmax, kweight: 2, dk_A_inv: t.dk, dk2_A_inv: t.dk2,
      nfft: t.nfft, kstep_A_inv: t.kstep, independentPoints: 'larch',
      epsilonK: reference.epsilonK ?? undefined,
    },
  };
}

function closeArray(actual: number[], expected: number[], tolerance: number) {
  expect(actual).toHaveLength(expected.length);
  expect(Math.max(...actual.map((v, i) => Math.abs(v - expected[i])))).toBeLessThan(tolerance);
}

function gaussian(seed: number) {
  const random = seededRandom(seed);
  return () => Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random());
}

describe('EXAFS fits against independently generated Larch fixtures', () => {
  for (const entry of fixtures.cases) {
    it(`${entry.material}: identifies the source paths and generator`, async () => {
      const bytes = readFileSync(`src/data/twin/feff/${entry.material}.json`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.source_sha256);
      expect(fixtures.versions.xraylarch).toBe('2026.3.1');
      expect(fixtures.provenance).toBe('synthetic');
      expect(fixtures.calls.some(call => call.startsWith('feffit('))).toBe(true);
      const request = await requestFor(entry);
      request.model.shells.forEach((shell, i) => {
        expect(shell.paths[0].reff).toBe(entry.paths[i].reff_A);
        expect(shell.paths[0].degen).toBe(entry.paths[i].degen);
      });
    });
    for (const mode of Object.keys(entry.fits) as Mode[]) {
      it(`${entry.material}, ${mode}: values within one Larch stderr; uncertainties within 20%`, async () => {
        const result = fitExafs(await requestFor(entry, mode)), reference = entry.fits[mode];
        expect(result.success, result.message).toBe(true);
        expect(result.uncertaintyStatus).toBe('estimated');
        expect(result.variableNames).toEqual(reference.variableNames);
        for (const [name, target] of Object.entries(reference.parameters)) {
          if (!target) continue;
          expect(Math.abs(result.parameters[name].value - target.value), name).toBeLessThan(target.stderr);
          expect(Math.abs(result.parameters[name].stderr! / target.stderr - 1), name).toBeLessThan(0.2);
        }
        expect(result.nIdp).toBeCloseTo(reference.nIdp, 12);
        expect(result.nResiduals).toBe(reference.nResiduals);
        expect(result.rFactor! / reference.rFactor).toBeCloseTo(1, 7);
        expect(result.chiSquare / reference.chiSquare).toBeCloseTo(1, 7);
        expect(result.reducedChiSquare / reference.reducedChiSquare).toBeCloseTo(1, 7);
        expect(result.residualSumSquares / reference.residualSumSquares).toBeCloseTo(1, 7);
        expect(result.epsilonR).toBeCloseTo(reference.epsilonR, 11);
        closeArray(result.epsilonK, reference.resolvedEpsilonK, 1e-11);
        closeArray(result.curves.window, reference.window, 1e-12);
        closeArray(result.curves.r_A, reference.r_A, 1e-12);
        closeArray(result.curves.dataR.real, reference.dataR.real, 1e-10);
        closeArray(result.curves.dataR.imaginary, reference.dataR.imaginary, 1e-10);
        // Near k=0 FEFF extrapolation is sensitive to tiny fitted E0 differences.
        closeArray(result.curves.modelChi.slice(60), reference.modelChi.slice(60), 1e-7);
        closeArray(result.curves.modelR.real, reference.modelR.real, 1e-6);
        closeArray(result.curves.modelR.imaginary, reference.modelR.imaginary, 1e-6);
        result.correlations!.forEach((row, i) => closeArray(row, reference.correlations[i], 0.002));
        result.covariance!.forEach((row, i) => row.forEach((v, j) => {
          expect(Math.abs(v - reference.covariance[i][j]) / Math.sqrt(reference.covariance[i][i] * reference.covariance[j][j])).toBeLessThan(0.002);
        }));
        if (process.env.EXAFS_FIT_AUDIT === '1') console.info(entry.material, mode, Object.fromEntries(
          Object.entries(reference.parameters).flatMap(([name, target]) => target ? [[name, {
            errorInLarchSigma: (result.parameters[name].value - target.value) / target.stderr,
            stderrRatio: result.parameters[name].stderr! / target.stderr,
          }]] : [])));
      });
    }
  }
});

describe('synthetic parameter recovery and uncertainty scaling', () => {
  it('recovers all four Cu parameters within one Larch-scaled stderr in at least 45 of 50 k-space noise draws', async () => {
    const request = await requestFor(fixtures.cases[0], 'k'), truth = fixtures.cases[0].truth;
    request.options.independentPoints = 'nyquist';
    const exact = chiPath(request.model.shells[0].paths[0], {
      s02: truth.s02, e0_eV: truth.e0, deltar_A: truth.dr0, sigma2_A2: truth.ss0,
    }, request.k_A_inv);
    const counts = Object.fromEntries(['s02', 'e0', 'dr0', 'ss0'].map(name => [name, 0]));
    let simultaneous = 0;
    for (let seed = 0; seed < 50; seed++) {
      const normal = gaussian(seed);
      const result = fitExafs({ ...request, chi: exact.map(v => v + 0.0005 * normal()) });
      expect(result.success, `seed ${seed}: ${result.message}`).toBe(true);
      let all = true;
      for (const name of Object.keys(counts) as (keyof typeof truth)[]) {
        const recovered = Math.abs(result.parameters[name].value - truth[name]!) <= result.parameters[name].stderr!;
        counts[name] += Number(recovered); all &&= recovered;
      }
      simultaneous += Number(all);
    }
    expect(simultaneous, JSON.stringify(counts)).toBeGreaterThanOrEqual(45);
    Object.values(counts).forEach(count => expect(count).toBeGreaterThanOrEqual(45));
    if (process.env.EXAFS_FIT_AUDIT === '1') console.info('k-space recovery', { simultaneous, counts });
  });

  it('checks R-space recovery for bias across the same 50 seeds', async () => {
    const request = await requestFor(), truth = fixtures.cases[0].truth;
    request.options.independentPoints = 'nyquist';
    const names = ['s02', 'e0', 'dr0', 'ss0'] as const;
    const exact = chiPath(request.model.shells[0].paths[0], {
      s02: truth.s02, e0_eV: truth.e0, deltar_A: truth.dr0, sigma2_A2: truth.ss0,
    }, request.k_A_inv);
    const errors = names.map(() => [] as number[]), coverage = names.map(() => 0);
    for (let seed = 0; seed < 50; seed++) {
      const normal = gaussian(seed), result = fitExafs({ ...request, chi: exact.map(v => v + 0.0005 * normal()) });
      expect(result.success, `seed ${seed}: ${result.message}`).toBe(true);
      names.forEach((name, i) => {
        const error = result.parameters[name].value - truth[name];
        errors[i].push(error);
        coverage[i] += Number(Math.abs(error) <= result.parameters[name].stderr!);
      });
    }
    errors.forEach((values, i) => {
      const mean = values.reduce((sum, v) => sum + v, 0) / 50;
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / 49;
      expect(Math.abs(mean), names[i]).toBeLessThan(3 * Math.sqrt(variance / 50));
    });
    if (process.env.EXAFS_FIT_AUDIT === '1') console.info('R-space one-sigma coverage', Object.fromEntries(names.map((name, i) => [name, coverage[i]])));
  });

  it('keeps the two independent-point definitions explicit and scales covariance by SSE/(Nidp-P)', async () => {
    const request = await requestFor(), larch = fitExafs(request);
    const nyquist = fitExafs({ ...request, options: { ...request.options, independentPoints: undefined } });
    expect(nyquist.nIdp).toBeCloseTo(2 * 10 * 1.7 / Math.PI, 12);
    expect(larch.nIdp - nyquist.nIdp).toBeCloseTo(1, 12);
    expect(nyquist.parameters.s02.value).toBe(larch.parameters.s02.value);
    expect(nyquist.covariance![0][0] / larch.covariance![0][0]).toBeCloseTo(larch.degreesOfFreedom / nyquist.degreesOfFreedom, 12);
    expect(larch.chiSquare).toBeCloseTo(larch.residualSumSquares * larch.nIdp / larch.nResiduals, 12);
    expect(larch.reducedChiSquare).toBeCloseTo(larch.chiSquare / larch.degreesOfFreedom, 12);
    // A common mistake is using N residual grid bins as the information count.
    expect(larch.nResiduals).toBeGreaterThan(5 * larch.nIdp);
  });

  it('is invariant to scalar epsilon rescaling except chi square, and to extra FFT zero padding', async () => {
    const request = await requestFor(), base = fitExafs(request);
    const scaled = fitExafs({ ...request, options: { ...request.options, epsilonK: 0.001 } });
    expect(scaled.chiSquare / base.chiSquare).toBeCloseTo(0.25, 8);
    expect(scaled.parameters.s02.stderr! / base.parameters.s02.stderr!).toBeCloseTo(1, 5);
    expect(scaled.rFactor! / base.rFactor!).toBeCloseTo(1, 8);
    const padded = fitExafs({ ...request, options: { ...request.options, nfft: 4096 } });
    expect(padded.nIdp).toBe(base.nIdp);
    expect(Math.abs(padded.parameters.s02.stderr! / base.parameters.s02.stderr! - 1)).toBeLessThan(0.05);
    expect(Math.abs(padded.parameters.s02.value - base.parameters.s02.value)).toBeLessThan(base.parameters.s02.stderr! / 10);
  });
});

describe('parameter links, physical alternatives, bounds and failures', () => {
  it('fits shared expansion and Einstein temperature, propagating chained links and preserving the request', async () => {
    const request = await requestFor(fixtures.cases[1], 'k'), normal = gaussian(100);
    const paths = request.model.shells.map(shell => shell.paths[0]);
    const exact = paths.map(path => chiPath(path, { s02: 0.9, e0_eV: 2, deltar_A: 0.004 * path.reff,
      sigma2_A2: sigma2Einstein(path, 300, 250) }, request.k_A_inv));
    request.chi = request.k_A_inv.map((_, i) => exact.reduce((sum, curve) => sum + curve[i], 0) + normal() * 0.0005);
    request.parameters = {
      s02: { value: 0.9, vary: false }, alpha: { value: 0, min: -0.05, max: 0.05 },
      theta: { value: 250, min: 100, max: 1000 },
      doubled: { expr: { parameter: 'alpha', scale: 2, offset: 0.02 } },
      linked: { expr: { parameter: 'doubled', scale: 0.5, offset: -0.01 } },
    };
    request.model = { s02: 's02', e0_eV: 2, shells: paths.map((path, i) => ({ id: `shell${i}`, paths: [path], alpha: 'linked', thetaE_K: 'theta', temperature_K: 250 })) };
    const before = JSON.stringify(request), result = fitExafs(request);
    expect(result.success, result.message).toBe(true);
    expect(JSON.stringify(request)).toBe(before);
    expect(Math.abs(result.parameters.alpha.value - 0.004)).toBeLessThan(result.parameters.alpha.stderr!);
    expect(Math.abs(result.parameters.theta.value - 300)).toBeLessThan(result.parameters.theta.stderr!);
    expect(result.parameters.s02.stderr).toBe(0);
    expect(result.parameters.doubled.value).toBeCloseTo(2 * result.parameters.alpha.value + 0.02, 12);
    expect(result.parameters.doubled.stderr).toBeCloseTo(2 * result.parameters.alpha.stderr!, 12);
    expect(result.parameters.linked.stderr).toBeCloseTo(result.parameters.alpha.stderr!, 12);
    expect(result.paths[1].parameters.deltar_A).toBeCloseTo(result.parameters.alpha.value * paths[1].reff, 12);
    expect(result.paths[0].parameters.sigma2_A2).toBeCloseTo(sigma2Einstein(paths[0], result.parameters.theta.value, 250), 12);
  });

  it('does not claim symmetric errors for a solution at a bound or an unconverged fit', async () => {
    const request = await requestFor();
    request.parameters.s02 = { value: 0.7, min: 0.3, max: 0.8 };
    const result = fitExafs(request);
    expect(result.success, result.message).toBe(true);
    expect(result.parameters.s02.value).toBe(0.8);
    expect(result.parameters.s02.atBound).toBe(true);
    expect(result.uncertaintyStatus).toBe('at-bound');
    expect(result.covariance).toBeNull();
    expect(result.parameters.ss0.stderr).toBeNull();
    const limited = fitExafs({ ...request, options: { ...request.options, maxIterations: 1 } });
    expect(limited.success).toBe(false);
    expect(limited.uncertaintyStatus).toBe('not-converged');
    expect(limited.parameters.s02.stderr).toBeNull();
  });

  it('identifies indistinguishable shells without inventing a covariance', async () => {
    const request = await requestFor();
    const shell = request.model.shells[0];
    request.parameters = { a: { value: 0.004, min: 0, max: 0.03 }, b: { value: 0.004, min: 0, max: 0.03 } };
    request.model = { s02: 0.88, e0_eV: 1.7, shells: [
      { ...shell, id: 'a', sigma2_A2: 'a', deltar_A: 0.015, weight: 0.5 },
      { ...shell, id: 'b', sigma2_A2: 'b', deltar_A: 0.015, weight: 0.5 },
    ] };
    const result = fitExafs(request);
    expect(result.success, result.message).toBe(true);
    expect(result.uncertaintyStatus).toBe('rank-deficient');
    expect(result.covariance).toBeNull();
    expect(result.parameters.a.stderr).toBeNull();
  });

  it('handles fixed models and a zero data norm explicitly', async () => {
    const request = await requestFor();
    Object.values(request.parameters).forEach(p => { p.vary = false; });
    const result = fitExafs(request);
    expect(result.success).toBe(true);
    expect(result.uncertaintyStatus).toBe('fixed');
    expect(result.covariance).toEqual([]);
    expect(result.parameters.e0.stderr).toBe(0);
    request.chi = request.chi.map(() => 0);
    expect(fitExafs(request).rFactor).toBeNull();
  });

  it('recognizes the zero-disorder physical boundary even without explicit bounds', async () => {
    const request = await requestFor(), path = request.model.shells[0].paths[0];
    request.parameters = { disorder: { value: 0 } };
    request.model = { s02: 0.9, e0_eV: 0, shells: [{ id: 'Cu', paths: [path], sigma2_A2: 'disorder' }] };
    request.chi = chiPath(path, { s02: 0.9 }, request.k_A_inv);
    const result = fitExafs(request);
    expect(result.success).toBe(true);
    expect(result.uncertaintyStatus).toBe('at-bound');
    expect(result.parameters.disorder.atBound).toBe(true);
    expect(result.parameters.disorder.stderr).toBeNull();
  });

  it('retains sensitivity correlations for an exactly fitted noiseless curve', async () => {
    const request = await requestFor(), truth = fixtures.cases[0].truth;
    request.k_A_inv = Array.from({ length: 321 }, (_, i) => i * 0.05);
    Object.entries(request.parameters).forEach(([name, p]) => { p.value = truth[name as keyof typeof truth]; });
    request.chi = chiPath(request.model.shells[0].paths[0], {
      s02: truth.s02, e0_eV: truth.e0, deltar_A: truth.dr0, sigma2_A2: truth.ss0,
    }, request.k_A_inv);
    const result = fitExafs(request);
    expect(result.success).toBe(true);
    expect(result.residualSumSquares).toBe(0);
    expect(result.parameters.s02.stderr).toBe(0);
    expect(result.correlations!.flat().every(Number.isFinite)).toBe(true);
    expect(result.correlations![result.variableNames.indexOf('e0')][result.variableNames.indexOf('dr0')]).toBeGreaterThan(0.7);
  });

  it('interpolates input data and uncertainty on the Larch uniform grid', async () => {
    const request = await requestFor();
    const irregular = { ...request, k_A_inv: request.k_A_inv.filter((_, i) => i % 2 === 0),
      chi: request.chi.filter((_, i) => i % 2 === 0) };
    const result = fitExafs(irregular);
    expect(result.success).toBe(true);
    expect(result.curves.dataChi[101]).toBeCloseTo((request.chi[100] + request.chi[102]) / 2, 12);
    const trimmed = { ...request, k_A_inv: request.k_A_inv.slice(40), chi: request.chi.slice(40) };
    expect(fitExafs(trimmed).parameters.s02.value).toBeCloseTo(fitExafs(request).parameters.s02.value, 10);
  });

  it('rejects malformed data, inadequate ranges and ambiguous parameter definitions', async () => {
    const request = await requestFor();
    const invalid: [string, (r: ExafsFitRequest) => void][] = [
      ['strictly increasing', r => { r.k_A_inv = [0, 1, 1]; r.chi = [0, 0, 0]; }],
      ['finite', r => { r.chi = [NaN, ...r.chi.slice(1)]; }],
      ['same length', r => { r.options.epsilonK = [0.001]; }],
      ['positive', r => { r.options.epsilonK = 0; }],
      ['cover', r => { r.options.kmax_A_inv = 16; }],
      ['overlap', r => { r.options.dk_A_inv = 30; }],
      ['power of two', r => { r.options.nfft = 1000; }],
      ['independent', r => { r.options.rmax_A = 1.6; }],
      ['Cyclic', r => { r.parameters.s02 = { expr: { parameter: 's02' } }; }],
      ['Unknown parameter', r => { r.model.s02 = 'absent'; }],
      ['unused', r => { r.parameters.unused = { value: 1 }; }],
      ['outside', r => { r.parameters.s02.min = 1; }],
      ['cannot have', r => { r.parameters.s02.expr = { parameter: 'e0' }; }],
      ['Choose deltar', r => { r.model.shells[0].alpha = 0; }],
      ['Choose sigma2', r => { r.model.shells[0].thetaE_K = 300; }],
      ['temperature_K', r => { delete r.model.shells[0].sigma2_A2; r.model.shells[0].thetaE_K = 300; }],
    ];
    for (const [message, change] of invalid) {
      const modified = structuredClone(request); change(modified);
      expect(() => fitExafs(modified), message).toThrow(message);
    }
  });
});
