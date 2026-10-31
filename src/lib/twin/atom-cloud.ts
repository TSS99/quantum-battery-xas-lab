/**
 * The electron cloud of one neutral atom, for the 3D atom of the Read the spectrum story: its subshells (aufbau order
 * with the usual exceptions), each subshell's effective charge by Slater's rules, and electron positions drawn from the
 * Slater orbital's radial density r^(2n*) exp(-2 zeta r), zeta = Zeff / n*. Sizes are real (Å); only the drawing
 * compresses them, because the innermost layer is tens of times smaller than the atom.
 */

export interface Subshell { n: number; l: number; electrons: number }
export interface CloudShell { n: number; l: number; electrons: number; zeff: number; meanR_A: number; points: Float32Array }

const BOHR_A = 0.529177;
const L_NAME = 'spdf';
/** Filling order and capacities. */
const AUFBAU: [number, number][] = [[1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0], [3, 2], [4, 1], [5, 0], [4, 2], [5, 1], [6, 0], [4, 3], [5, 2], [6, 1], [7, 0], [5, 3], [6, 2], [7, 1]];
/** Ground states that differ from the filling order: electrons moved from one subshell to another (NIST). */
const EXCEPTIONS: Record<number, [string, string, number][]> = {
  24: [['4s', '3d', 1]], 29: [['4s', '3d', 1]], 41: [['5s', '4d', 1]], 42: [['5s', '4d', 1]], 44: [['5s', '4d', 1]], 45: [['5s', '4d', 1]],
  46: [['5s', '4d', 2]], 47: [['5s', '4d', 1]], 57: [['4f', '5d', 1]], 58: [['4f', '5d', 1]], 64: [['4f', '5d', 1]], 78: [['6s', '5d', 1]],
  79: [['6s', '5d', 1]], 89: [['5f', '6d', 1]], 90: [['5f', '6d', 2]], 91: [['5f', '6d', 1]], 92: [['5f', '6d', 1]], 93: [['5f', '6d', 1]],
};
/** Slater's effective principal quantum number. */
const N_STAR = [0, 1, 2, 3, 3.7, 4.0, 4.2, 4.3];

/** The occupied subshells of element Z, in filling order. */
export function subshells(Z: number): Subshell[] {
  const out: Subshell[] = [];
  let left = Z;
  for (const [n, l] of AUFBAU) {
    if (left <= 0) break;
    const take = Math.min(left, 2 * (2 * l + 1));
    out.push({ n, l, electrons: take });
    left -= take;
  }
  for (const [from, to, count] of EXCEPTIONS[Z] ?? []) {
    const name = (s: Subshell) => `${s.n}${L_NAME[s.l]}`;
    const a = out.find(s => name(s) === from)!;
    let b = out.find(s => name(s) === to);
    if (!b) { b = { n: +to[0], l: L_NAME.indexOf(to[1]), electrons: 0 }; out.push(b); }
    a.electrons -= count; b.electrons += count;
  }
  return out.filter(s => s.electrons > 0);
}

/**
 * The subshells of the ion that has given `charge` electrons away: they leave from the highest shell first, and within a
 * shell from the highest l (copper(II) is 3d9: both 4s electrons go before a 3d one).
 */
export function ionSubshells(Z: number, charge: number): Subshell[] {
  const out = subshells(Z).map(s => ({ ...s }));
  for (let left = Math.round(charge); left > 0; left--) {
    const outer = out.filter(s => s.electrons > 0).reduce((a, b) => b.n > a.n || (b.n === a.n && b.l > a.l) ? b : a);
    outer.electrons--;
  }
  return out.filter(s => s.electrons > 0);
}

/** Electrons in each principal shell (K, L, M, ...). */
export function shellCounts(Z: number): number[] {
  const counts: number[] = [];
  for (const s of subshells(Z)) counts[s.n - 1] = (counts[s.n - 1] ?? 0) + s.electrons;
  return Array.from(counts, c => c ?? 0);
}

/** Slater's groups, in order: (1s)(2s,2p)(3s,3p)(3d)(4s,4p)(4d)(4f)(5s,5p)(5d)... */
const group = (s: Pick<Subshell, 'n' | 'l'>) => s.l <= 1 ? `${s.n}sp` : `${s.n}${L_NAME[s.l]}`;
const groupRank = (s: Pick<Subshell, 'n' | 'l'>) => s.l <= 1 ? s.n * 10 : s.n * 10 + 1 + s.l;

/** Effective nuclear charge felt by one electron of subshell s (Slater's rules). */
export function slaterZeff(Z: number, s: Pick<Subshell, 'n' | 'l'>, all = subshells(Z)): number {
  let shield = 0;
  for (const o of all) {
    if (group(o) === group(s)) shield += (o.electrons - (o.n === s.n && o.l === s.l ? 1 : 0)) * (s.n === 1 ? 0.3 : 0.35);
    else if (groupRank(o) < groupRank(s) || (s.l <= 1 && o.n < s.n)) {
      if (s.l >= 2) shield += o.electrons;
      else shield += o.electrons * (o.n === s.n - 1 ? 0.85 : o.n < s.n - 1 ? 1 : 0);
    }
  }
  return Z - shield;
}

/** A small seeded generator (mulberry32), so the cloud is the same on every visit and in tests. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Electron positions for every subshell, `perElectron` points per electron, in Å. The radius follows the Slater
 * density, a Gamma distribution of shape 2n*+1 (rounded) and rate 2 zeta, drawn as a sum of exponentials; the direction
 * is uniform (the cloud of a filled or averaged shell is round).
 */
export function atomCloud(Z: number, perElectron = 160, seed = 7, charge = 0): CloudShell[] {
  const all = ionSubshells(Z, charge), rand = random(seed);
  return all.map(s => {
    const zeff = slaterZeff(Z, s, all), nStar = N_STAR[s.n], zeta = zeff / nStar, shape = Math.round(2 * nStar) + 1;
    const count = s.electrons * perElectron, points = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let r = 0;
      for (let j = 0; j < shape; j++) r -= Math.log(1 - rand());
      r = r / (2 * zeta) * BOHR_A;
      const z = 2 * rand() - 1, phi = 2 * Math.PI * rand(), xy = Math.sqrt(1 - z * z);
      points.set([r * xy * Math.cos(phi), r * xy * Math.sin(phi), r * z], 3 * i);
    }
    return { n: s.n, l: s.l, electrons: s.electrons, zeff, meanR_A: shape / (2 * zeta) * BOHR_A, points };
  });
}
