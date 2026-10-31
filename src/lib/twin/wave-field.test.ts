import { describe, expect, it } from 'vitest';
import { chiPath, loadPaths } from './exafs';
import { clusterAtoms, groupShells, loadCluster, pathCurves } from './shells';
import { echoAtAbsorber, shellSlice, waveField, wavePhasor } from './wave-field';

describe('the wave map', () => {
  it('brings the echo home in step exactly where the shell path chi(k) is positive (Cu, CuO, Pt)', async () => {
    for (const id of ['cu', 'cuo', 'pt']) {
      const material = await loadPaths(id), shell = groupShells(material).find(s => s.kind === 'shell')!, path = shell.paths[0];
      // The map draws the geometric echo; disorder damps chi and nudges its phase, so compare with sigma^2 = 0, away
      // from the zero crossings where the path sum's spline and this linear interpolation differ by a hair.
      for (let k = 3; k <= 13; k += 0.37) {
        const chi = chiPath(path, { sigma2_A2: 0 }, [k])[0], echo = echoAtAbsorber(k, path.reff, pathCurves(path, k));
        if (Math.abs(echo) < 0.05) continue;
        expect(Math.sign(echo), `${id} k=${k.toFixed(2)}`).toBe(Math.sign(chi));
      }
    }
  });

  it('falls off as 1/r and with the mean free path, and each neighbour adds its echo', () => {
    const curves = { central: 0, backscatter: 0, amplitude: 0.5, lambda: 6 };
    const bare = waveField(6, [], curves), shell = waveField(6, [{ x: 2, y: 0 }], curves);
    // Envelope of the outgoing wave: the largest value over a period at r = 1 and r = 3.
    const peak = (f: (x: number, y: number, t: number) => number, x: number, y: number) => Math.max(...Array.from({ length: 64 }, (_, i) => f(x, y, i * Math.PI / 32)));
    expect(peak(bare, 1, 0) / peak(bare, 3, 0)).toBeCloseTo(3 * Math.exp(2 / 6), 2);
    expect(peak(shell, 2, 1)).not.toBeCloseTo(peak(bare, 2, 1), 2);
  });

  it('splits in time for the animation, and an atom off the plane echoes from its true distance', () => {
    const curves = { central: 0.4, backscatter: -1.1, amplitude: 0.5, lambda: 6 };
    const field = waveField(7, [{ x: 1.4, y: 0.6 }], curves), [cos, sin] = wavePhasor(7, [{ x: 1.4, y: 0.6 }], curves)(0.8, -0.5);
    for (const wt of [0, 0.7, 2.1, 4]) expect(field(0.8, -0.5, wt)).toBeCloseTo(cos * Math.cos(wt) + sin * Math.sin(wt), 12);
    // At the absorber, an atom 2 angstrom above the plane echoes exactly as one 2 angstrom away in it.
    const above = waveField(7, [{ x: 0, y: 0, z: 2 }], curves, false), beside = waveField(7, [{ x: 2, y: 0 }], curves, false);
    for (const wt of [0, 1, 2]) expect(above(0, 0, wt)).toBeCloseTo(beside(0, 0, wt), 12);
  });

  it('slices CuO through its four oxygens, which lie in one plane with the copper atom', async () => {
    const [cuo, cluster] = await Promise.all([loadPaths('cuo'), loadCluster('cuo')]);
    const atoms = clusterAtoms(cluster, 'Cu1', groupShells(cuo)).filter(a => a.shellId === 'Cu1/s1').map(a => a.xyz);
    const { points, total } = shellSlice(atoms);
    expect(total).toBe(4);
    expect(points).toHaveLength(4);
    for (const p of points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1.96, 1);
  });
});
