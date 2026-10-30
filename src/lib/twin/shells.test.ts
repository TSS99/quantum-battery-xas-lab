import { describe, expect, it } from 'vitest';
import FEFF_INDEX from '../../data/twin/feff/index.json';
import { chiSum, loadPaths } from './exafs';
import { libraryParameters } from './sample';
import { clusterAtoms, clusterIds, groupShells, loadCluster, shellSpectra } from './shells';

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
});
