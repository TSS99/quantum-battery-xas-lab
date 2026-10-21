// A first shell EXAFS fit of a twin acquisition, made with the same FEFF paths the twin used to build the
// spectrum, so the fitted S0^2, delta R and sigma^2 can be compared with the values behind the data.
import { preEdge } from '../xas-reduction';
import { processExafs } from '../exafs';
import { ETOK, sigma2Einstein } from './exafs';
import { fitExafs } from './exafs-fit';
import { LIBRARY_S02, einsteinTemperature_K } from './sample';
import type { ExafsFitResult, ExafsFitShell, FeffMaterial } from './types';

/** Single scattering paths within this distance of the shortest one form the first shell, in angstrom. */
const SHELL_WIDTH_A = 0.15;
/** The fit starts above k = 3.5 per angstrom, where the twin's near edge model has faded into the path sum. */
const KMIN = 3.5, KMAX = 12;

export interface FirstShellFit {
  result: ExafsFitResult;
  /** Shortest single scattering distance, in angstrom. */
  reff_A: number;
  /** Fitted ranges: R in angstrom, k per angstrom. */
  window_A: [number, number];
  kRange: [number, number];
  /** What made the spectrum: S0^2, no shift of the FEFF distance, and the Einstein sigma^2 of the nearest path. */
  truth: { s02: number; deltar_A: number; sigma2_A2: number };
}

/** Fits S0^2, delta E0, delta R and sigma^2 of the first shell in R space (k^2 weight, Hanning windows). */
export function firstShellFit(material: FeffMaterial, energy: number[], mu: number[], temperature_K: number): FirstShellFit {
  const e0 = preEdge(energy, mu).e0;
  // The background is removed over the whole scan; the fit stops 1 per angstrom short of its end for the window tail.
  const kTop = Math.sqrt(ETOK * (energy[energy.length - 1] - e0)), kmax = Math.min(KMAX, kTop - 1);
  if (kmax < KMIN + 3) throw new RangeError('The scan ends too close to the edge for an EXAFS fit; it needs to reach k = 7.5 per angstrom.');
  const { autobk } = processExafs(energy, mu, { rbkg: 1, kmin: 0, kmax: kTop, kweight: 2, dk: 1, window: 'hanning' });
  const single = material.sites.flatMap(site => site.paths.filter(path => path.nleg === 2));
  const nearest = single.reduce((a, b) => b.reff < a.reff ? b : a);
  const shells: ExafsFitShell[] = material.sites.map(site => ({
    id: site.id, weight: site.weight, deltar_A: 'dr', sigma2_A2: 'ss',
    paths: site.paths.filter(path => path.nleg === 2 && path.reff <= nearest.reff + SHELL_WIDTH_A),
  })).filter(shell => shell.paths.length > 0);
  // The first shell peak of |chi(R)| sits about 0.4 angstrom below reff, from the scattering phase shift.
  const window_A: [number, number] = [Math.max(1, nearest.reff - 0.9), nearest.reff + 0.1];
  const result = fitExafs({
    k_A_inv: autobk.k, chi: autobk.chi,
    parameters: {
      s02: { value: 0.8, min: 0.3, max: 1.5 },
      e0: { value: 0, min: -15, max: 15 },
      dr: { value: 0, min: -0.2, max: 0.2 },
      ss: { value: 0.005, min: 0.0005, max: 0.03 },
    },
    model: { s02: 's02', e0_eV: 'e0', shells },
    options: { space: 'r', kmin_A_inv: KMIN, kmax_A_inv: kmax, rmin_A: window_A[0], rmax_A: window_A[1], kweight: 2, dk_A_inv: 1 },
  });
  return {
    result, reff_A: nearest.reff, window_A, kRange: [KMIN, kmax],
    truth: { s02: LIBRARY_S02, deltar_A: 0, sigma2_A2: sigma2Einstein(nearest, einsteinTemperature_K(material.id), temperature_K) },
  };
}
