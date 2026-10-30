import { xftf } from '../exafs';
import { chiSum } from './exafs';
import { TWIN_REDUCTION } from './reduction';
import { ROOM_TEMPERATURE_K, libraryParameters } from './sample';
import type { ExafsParameters, FeffMaterial, FeffPath } from './types';

/**
 * The FEFF paths of one library material grouped the way a spectroscopist reads them: shells of like neighbours at one
 * distance (single scattering), the farther single scattering paths together, and the multiple scattering paths
 * together. Each group's chi(k) is its paths' share of the twin's own path sum (same S0^2 and Einstein sigma^2), so the
 * groups add up to the total exactly; the Fourier transform is linear, so |chi(R)| splits the same way.
 */

/** Shells shown one by one per absorber site; farther single scattering is grouped. */
export const SHELL_LIMIT = 6;
/** Single scattering paths to like neighbours within this of a shell's first path join that shell, angstrom. */
const SHELL_SPREAD_A = 0.1;
/**
 * A cluster atom belongs to the path whose length is closest to its distance, within this, angstrom. The coordinates
 * and reff are stored to 1e-4; a looser match would claim atoms of a dropped path 0.0018 away (alpha-Mn, 5.9079 and 5.9061).
 */
const ATOM_MATCH_A = 0.0005;

export interface Shell {
  /** `site/s1`, `site/s2`, ... for shells, `site/far` and `site/ms` for the groups. */
  id: string;
  siteId: string;
  kind: 'shell' | 'far' | 'ms';
  /** The neighbour element of a shell; null for the groups. */
  element: string | null;
  /** Atoms in a shell or in the farther group (the paths' degeneracies); paths in the multiple scattering group. */
  count: number;
  /** Degeneracy-weighted mean half path length, angstrom. */
  r_A: number;
  paths: FeffPath[];
}

const neighbour = (path: FeffPath) => path.geometry[1].label;

export function groupShells(material: FeffMaterial, limit = SHELL_LIMIT): Shell[] {
  const shells: Shell[] = [];
  const make = (siteId: string, kind: Shell['kind'], paths: FeffPath[], n = 0): Shell => {
    const degeneracy = paths.reduce((sum, p) => sum + p.degen, 0);
    return {
      id: `${siteId}/${kind === 'shell' ? 's' + n : kind}`, siteId, kind, paths,
      element: kind === 'shell' ? neighbour(paths[0]) : null,
      count: kind === 'ms' ? paths.length : Math.round(degeneracy),
      r_A: paths.reduce((sum, p) => sum + p.degen * p.reff, 0) / degeneracy,
    };
  };
  for (const site of material.sites) {
    const groups: FeffPath[][] = [];
    for (const path of site.paths.filter(p => p.nleg === 2).sort((a, b) => a.reff - b.reff)) {
      const last = groups.at(-1);
      if (last && neighbour(last[0]) === neighbour(path) && path.reff - last[0].reff <= SHELL_SPREAD_A) last.push(path);
      else groups.push([path]);
    }
    groups.slice(0, limit).forEach((paths, i) => shells.push(make(site.id, 'shell', paths, i + 1)));
    const far = groups.slice(limit).flat(), multiple = site.paths.filter(p => p.nleg > 2);
    if (far.length) shells.push(make(site.id, 'far', far));
    if (multiple.length) shells.push(make(site.id, 'ms', multiple));
  }
  return shells;
}

export interface ShellSpectra {
  k: number[];
  /** chi(k) of the whole path sum and of each group, keyed by shell id. */
  total: number[];
  chi: Record<string, number[]>;
  r: number[];
  /** |chi(R)| of the k^2-weighted, Hanning-windowed transform the twin's Results use. */
  totalR: number[];
  magnitude: Record<string, number[]>;
  real: Record<string, number[]>;
  totalReal: number[];
  /** Where each group's |chi(R)| peaks, angstrom. */
  peak_A: Record<string, number>;
  window: { kmin: number; kmax: number; dk: number };
}

const K_TOP = 16, R_MAX = 6.5;

/** The twin Results' transform: k^2 weight, Hanning window from kmin to kmax with dk = 1, the same FFT grid. */
export function transform(k: number[], chi: number[], kmax: number = TWIN_REDUCTION.kmax) {
  return xftf(k, chi, {
    kmin: TWIN_REDUCTION.kmin, kmax, kweight: TWIN_REDUCTION.kweight, dk: TWIN_REDUCTION.dk,
    window: TWIN_REDUCTION.window, rmax: R_MAX, nfft: TWIN_REDUCTION.nfft, kstep: TWIN_REDUCTION.kstep,
  });
}

/**
 * "What if" changes to one shell's paths: a change of distance, a factor on the number of neighbours (each path's
 * degeneracy) and a disorder sigma^2 in place of the Einstein value.
 */
export interface ShellTweak { deltar_A?: number; scale?: number; sigma2_A2?: number }

/** The library parameters with the tweaks applied to each tweaked shell's paths. */
export function tweakedParameters(material: FeffMaterial, shells: Shell[], temperature_K: number, tweaks: Record<string, ShellTweak> = {}): ExafsParameters {
  const params = libraryParameters(material, temperature_K);
  for (const shell of shells) {
    const tweak = tweaks[shell.id];
    if (!tweak) continue;
    for (const path of shell.paths) {
      const key = `${shell.siteId}/${path.id}`;
      params.paths![key] = {
        ...params.paths![key],
        ...(tweak.deltar_A !== undefined && { deltar_A: tweak.deltar_A }),
        ...(tweak.scale !== undefined && { degen: path.degen * tweak.scale }),
        ...(tweak.sigma2_A2 !== undefined && { sigma2_A2: tweak.sigma2_A2 }),
      };
    }
  }
  return params;
}

export function shellSpectra(material: FeffMaterial, shells: Shell[], temperature_K = ROOM_TEMPERATURE_K, kmax: number = TWIN_REDUCTION.kmax, tweaks: Record<string, ShellTweak> = {}): ShellSpectra {
  const k = Array.from({ length: Math.round(K_TOP / TWIN_REDUCTION.kstep) + 1 }, (_, i) => i * TWIN_REDUCTION.kstep);
  const sum = chiSum(material, tweakedParameters(material, shells, temperature_K, tweaks), k);
  const owner = new Map<string, string>(shells.flatMap(s => s.paths.map(p => [`${s.siteId}/${p.id}`, s.id] as const)));
  const chi: Record<string, number[]> = Object.fromEntries(shells.map(s => [s.id, new Array<number>(k.length).fill(0)]));
  for (const c of sum.contributions) {
    const id = owner.get(c.key);
    if (!id) throw new Error(`Path ${c.key} of ${material.id} belongs to no shell.`);
    c.chi.forEach((v, i) => { chi[id][i] += v; });
  }
  const whole = transform(k, sum.chi, kmax);
  const magnitude: Record<string, number[]> = {}, real: Record<string, number[]> = {}, peak_A: Record<string, number> = {};
  for (const s of shells) {
    const t = transform(k, chi[s.id], kmax);
    magnitude[s.id] = t.magnitude; real[s.id] = t.real;
    let best = 0;
    t.magnitude.forEach((m, i) => { if (t.r[i] >= 0.5 && m > t.magnitude[best]) best = i; });
    peak_A[s.id] = t.r[best];
  }
  return {
    k, total: sum.chi, chi, r: whole.r, totalR: whole.magnitude, totalReal: whole.real, magnitude, real, peak_A,
    window: { kmin: TWIN_REDUCTION.kmin, kmax, dk: TWIN_REDUCTION.dk },
  };
}

/**
 * A path's FEFF curves at k, linearly interpolated on its (uneven) grid: the total phase (the absorber's 2 delta plus
 * the neighbour's backscattering phase) and the effective backscattering amplitude |F(k)| of the neighbour.
 */
export function pathCurves(path: FeffPath, k: number) {
  const grid = path.k, kk = Math.min(grid[grid.length - 1], Math.max(grid[0], k));
  let i = 0;
  while (i < grid.length - 2 && grid[i + 1] < kk) i++;
  const f = (kk - grid[i]) / (grid[i + 1] - grid[i]);
  const at = (values: number[]) => values[i] * (1 - f) + values[i + 1] * f;
  return { phase: at(path.real_phc) + at(path.pha_feff), amplitude: at(path.mag_feff) };
}

/** The atoms FEFF used around each absorber site (scripts/twin/make-clusters.py), absorber first. */
export interface ClusterFile {
  id: string;
  rmax_A: number;
  sites: { id: string; atoms: [string, number, number, number][] }[];
}

export interface ClusterAtom {
  element: string;
  xyz: [number, number, number];
  r_A: number;
  /** The shell or group whose single scattering paths reach this atom; null for the absorber and for atoms whose weak paths were not kept. */
  shellId: string | null;
}

export function clusterAtoms(file: ClusterFile, siteId: string, shells: Shell[]): ClusterAtom[] {
  const site = file.sites.find(s => s.id === siteId);
  if (!site) throw new Error(`No cluster for site ${siteId} of ${file.id}.`);
  const reach = shells.filter(s => s.siteId === siteId && s.kind !== 'ms').flatMap(s => s.paths.map(p => ({ shell: s.id, element: neighbour(p), reff: p.reff })));
  return site.atoms.map(([element, x, y, z], i) => {
    const r_A = Math.hypot(x, y, z);
    let match: typeof reach[number] | undefined;
    if (i > 0) for (const p of reach) {
      const off = Math.abs(p.reff - r_A);
      if (p.element === element && off <= ATOM_MATCH_A && (!match || off < Math.abs(match.reff - r_A))) match = p;
    }
    return { element, xyz: [x, y, z], r_A, shellId: match?.shell ?? null };
  });
}

type JsonModule = { default: unknown };
const clusterLoaders: Record<string, () => Promise<JsonModule>> = {
  ceo2: () => import('../../data/twin/clusters/ceo2.json'),
  cu: () => import('../../data/twin/clusters/cu.json'),
  'fe-bcc': () => import('../../data/twin/clusters/fe-bcc.json'),
  fe3o4: () => import('../../data/twin/clusters/fe3o4.json'),
  licoo2: () => import('../../data/twin/clusters/licoo2.json'),
  lifepo4: () => import('../../data/twin/clusters/lifepo4.json'),
  limn2o4: () => import('../../data/twin/clusters/limn2o4.json'),
  ni: () => import('../../data/twin/clusters/ni.json'),
  nio: () => import('../../data/twin/clusters/nio.json'),
  pt: () => import('../../data/twin/clusters/pt.json'),
  zno: () => import('../../data/twin/clusters/zno.json'),
  ti: () => import('../../data/twin/clusters/ti.json'),
  cr: () => import('../../data/twin/clusters/cr.json'),
  mn: () => import('../../data/twin/clusters/mn.json'),
  co: () => import('../../data/twin/clusters/co.json'),
  zn: () => import('../../data/twin/clusters/zn.json'),
  mo: () => import('../../data/twin/clusters/mo.json'),
  pd: () => import('../../data/twin/clusters/pd.json'),
  au: () => import('../../data/twin/clusters/au.json'),
  w: () => import('../../data/twin/clusters/w.json'),
  cu2o: () => import('../../data/twin/clusters/cu2o.json'),
  cuo: () => import('../../data/twin/clusters/cuo.json'),
  mno: () => import('../../data/twin/clusters/mno.json'),
  mn2o3: () => import('../../data/twin/clusters/mn2o3.json'),
  mno2: () => import('../../data/twin/clusters/mno2.json'),
  feo: () => import('../../data/twin/clusters/feo.json'),
  fe2o3: () => import('../../data/twin/clusters/fe2o3.json'),
  co3o4: () => import('../../data/twin/clusters/co3o4.json'),
  coo: () => import('../../data/twin/clusters/coo.json'),
  'tio2-anatase': () => import('../../data/twin/clusters/tio2-anatase.json'),
  'tio2-rutile': () => import('../../data/twin/clusters/tio2-rutile.json'),
  cr2o3: () => import('../../data/twin/clusters/cr2o3.json'),
  k2cro4: () => import('../../data/twin/clusters/k2cro4.json'),
  pbo: () => import('../../data/twin/clusters/pbo.json'),
  zns: () => import('../../data/twin/clusters/zns.json'),
  na2so4: () => import('../../data/twin/clusters/na2so4.json'),
  nacl: () => import('../../data/twin/clusters/nacl.json'),
  kcl: () => import('../../data/twin/clusters/kcl.json'),
  caco3: () => import('../../data/twin/clusters/caco3.json'),
  'lifepo4-p': () => import('../../data/twin/clusters/lifepo4-p.json'),
};

export const clusterIds = Object.keys(clusterLoaders);

export function loadCluster(id: string): Promise<ClusterFile> {
  const loader = clusterLoaders[id];
  if (!loader) return Promise.reject(new Error(`No atom cluster for "${id}".`));
  return loader().then(module => module.default as ClusterFile);
}
