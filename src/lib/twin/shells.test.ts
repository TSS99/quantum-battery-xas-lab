import { describe, expect, it } from 'vitest';
import FEFF_INDEX from '../../data/twin/feff/index.json';
import { chiSum, loadPaths } from './exafs';
import { libraryParameters } from './sample';
import { clusterAtoms, clusterIds, groupShells, loadCluster, pathCurves, shellSpectra } from './shells';

const ids = FEFF_INDEX.map(m => m.id);
const maxAbs = (values: number[]) => values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('shells of the FEFF library', () => {
  it('has an atom cluster for every library material, and nothing else', () => {
    expect([...clusterIds].sort()).toEqual([...ids].sort());
  });

  it.each(ids)('%s: the cluster is the one FEFF used, in the frame of the path geometries', async id => {
    const [material, cluster] = await Promise.all([loadPaths(id), loadCluster(id)]);
    expect(cluster.sites.map(s => s.id)).toEqual(material.sites.map(s => s.id));
    for (const site of material.sites) {
      const atoms = cluster.sites.find(s => s.id === site.id)!.atoms;
      expect(atoms[0]).toEqual([material.absorber, 0, 0, 0]);
      expect(atoms.length).toBeLessThanOrEqual(site.cluster_atoms);
      // Every atom of every kept path, single or multiple scattering, is a cluster atom.
      for (const path of site.paths) for (const g of path.geometry) {
        const hit = atoms.some(([element, x, y, z]) => element === g.label && Math.hypot(x - g.xyz_A[0], y - g.xyz_A[1], z - g.xyz_A[2]) < 2e-3);
        expect(hit, `${id}/${site.id}/${path.id} ${g.label} at ${g.xyz_A}`).toBe(true);
      }
    }
  });

  it.each(ids)('%s: shells partition the paths, add up to the path sum and reach as many atoms as their degeneracy', async id => {
    const [material, cluster] = await Promise.all([loadPaths(id), loadCluster(id)]);
    const shells = groupShells(material);
    const owned = shells.flatMap(s => s.paths.map(p => `${s.siteId}/${p.id}`));
    expect(new Set(owned).size).toBe(owned.length);
    expect(owned.length).toBe(material.sites.reduce((n, s) => n + s.paths.length, 0));

    const spectra = shellSpectra(material, shells);
    const reference = chiSum(material, libraryParameters(material), spectra.k).chi;
    const sumK = spectra.k.map((_, i) => shells.reduce((s, shell) => s + spectra.chi[shell.id][i], 0));
    expect(maxAbs(sumK.map((v, i) => v - reference[i]))).toBeLessThan(1e-12 * Math.max(1, maxAbs(reference)));
    const sumR = spectra.r.map((_, i) => shells.reduce((s, shell) => s + spectra.real[shell.id][i], 0));
    expect(maxAbs(sumR.map((v, i) => v - spectra.totalReal[i]))).toBeLessThan(1e-9 * maxAbs(spectra.totalReal));

    for (const site of material.sites) {
      const atoms = clusterAtoms(cluster, site.id, shells);
      for (const shell of shells.filter(s => s.siteId === site.id && s.kind !== 'ms')) {
        expect(atoms.filter(a => a.shellId === shell.id).length, `${shell.id}`).toBe(shell.count);
      }
    }
  });

  // Light and middle neighbours pull the peak short by the scattering phase shift. Heavy ones (Pt, Au) have a phase
  // far from linear in k and can peak close to the true distance, so the view reports each shell's own offset.
  it.each(ids)('%s: the first shell peaks in |chi(R)| near its true distance, short of it for neighbours up to Xe', async id => {
    const material = await loadPaths(id);
    const shells = groupShells(material);
    const spectra = shellSpectra(material, shells);
    for (const first of shells.filter(s => s.id.endsWith('/s1'))) {
      const shift = first.r_A - spectra.peak_A[first.id];
      const z = first.paths[0].geometry[1].atomic_number;
      const note = `${first.id} (${first.element}) at ${first.r_A.toFixed(3)} peaks at ${spectra.peak_A[first.id].toFixed(3)}`;
      expect(Math.abs(shift), note).toBeLessThan(0.8);
      if (z <= 54) expect(shift, note).toBeGreaterThan(0.05);
    }
  });

  it('weights the transform by k^n: for CuO, k^3 lifts the copper shells against the first oxygen shell', async () => {
    const material = await loadPaths('cuo'), shells = groupShells(material);
    const oxygen = shells.find(s => s.kind === 'shell' && s.element === 'O')!, copper = shells.find(s => s.kind === 'shell' && s.element === 'Cu')!;
    const ratio = (kweight: number) => { const s = shellSpectra(material, shells, undefined, undefined, {}, kweight); return maxAbs(s.magnitude[copper.id]) / maxAbs(s.magnitude[oxygen.id]); };
    // Oxygen reflects the electron mostly at low k, copper out to high k, so a heavier weight favours copper.
    expect(ratio(3)).toBeGreaterThan(1.5 * ratio(1));
    expect(shellSpectra(material, shells).window.kweight).toBe(2);
  });

  describe('what if', () => {
    const rms =(values: number[], k: number[], from: number, to: number) => {
      const picked = values.filter((_, i) => k[i] >= from && k[i] <= to);
      return Math.sqrt(picked.reduce((s, v) => s + v * v, 0) / picked.length);
    };

    it('scales a shell with its number of neighbours and leaves the others alone', async () => {
      const material = await loadPaths('cuo'), shells = groupShells(material);
      const base = shellSpectra(material, shells), doubled = shellSpectra(material, shells, undefined, undefined, { 'Cu1/s1': { scale: 2 } });
      expect(maxAbs(doubled.chi['Cu1/s1'].map((v, i) => v - 2 * base.chi['Cu1/s1'][i]))).toBeLessThan(1e-12 * maxAbs(base.chi['Cu1/s1']));
      expect(maxAbs(doubled.chi['Cu1/s2'].map((v, i) => v - base.chi['Cu1/s2'][i]))).toBe(0);
    });

    it.each(['cu', 'cuo', 'nio'])('%s: moving the first shell out moves its |chi(R)| peak out by as much', async id => {
      const material = await loadPaths(id), shells = groupShells(material), first = shells.find(s => s.id.endsWith('/s1'))!;
      const base = shellSpectra(material, shells), moved = shellSpectra(material, shells, undefined, undefined, { [first.id]: { deltar_A: 0.2 } });
      // The transform's grid is 0.031 angstrom.
      expect(moved.peak_A[first.id] - base.peak_A[first.id]).toBeCloseTo(0.2, 1);
    });

    it('damps a shell by exp(-2 k^2 delta sigma^2) when its disorder grows', async () => {
      const material = await loadPaths('cu'), shells = groupShells(material);
      const base = shellSpectra(material, shells, undefined, undefined, { 'Cu1/s1': { sigma2_A2: 0.005 } });
      const blurred = shellSpectra(material, shells, undefined, undefined, { 'Cu1/s1': { sigma2_A2: 0.01 } });
      const ratio = rms(blurred.chi['Cu1/s1'], base.k, 9.5, 10.5) / rms(base.chi['Cu1/s1'], base.k, 9.5, 10.5);
      expect(ratio / Math.exp(-2 * 100 * 0.005)).toBeCloseTo(1, 1);
    });

    // The wave drawing puts the returning wave 2kR + phase(k) behind the outgoing one at the absorber; in step there
    // should mean a positive chi, as the path sum says.
    it.each(['cu', 'cuo', 'pt'])('%s: the drawn wave meets itself in step where the first shell chi(k) is positive', async id => {
      const material = await loadPaths(id), shells = groupShells(material), first = shells.find(s => s.id.endsWith('/s1'))!;
      const spectra = shellSpectra(material, shells), path = first.paths[0];
      let agree = 0, counted = 0;
      spectra.k.forEach((k, i) => {
        const chi = spectra.chi[first.id][i];
        if (k < 3 || k > 14 || Math.abs(chi) < 0.3 * rms(spectra.chi[first.id], spectra.k, k - 1, k + 1)) return;
        counted++;
        if (Math.sign(Math.sin(2 * k * path.reff + pathCurves(path, k).phase)) === Math.sign(chi)) agree++;
      });
      expect(agree / counted).toBeGreaterThan(0.95);
    });
  });
});
