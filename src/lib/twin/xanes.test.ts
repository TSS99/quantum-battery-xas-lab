import { describe, expect, it } from 'vitest';
import FEFF_INDEX from '../../data/twin/feff/index.json';
import measured from '../../data/twin/measured/xanes-references.json';
import { loadPaths } from './exafs';
import { libraryFineStructure, teachingFineStructure } from './sample';
import { xanesAt } from './xanes';
import { edgeE0, nearEdgeMarks } from './xanes-features';
import { loadXanes, xanesIds } from './xanes-files';

const grid = (from: number, to: number) => Array.from({ length: Math.round((to - from) / 0.25) + 1 }, (_, i) => from + i * 0.25);
const rms = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
/** Measured normalized mu at d = E - E0 on the references' grid. */
const measuredAt = (mu: number[], d: number) => mu[Math.round((d - measured.energy.from_eV) / measured.energy.step_eV)];

describe('computed near edges (FEFF10)', () => {
  it('cover every library material: near zero well below the edge, level with the FEFF path sum where they meet', async () => {
    expect([...xanesIds].sort()).toEqual(FEFF_INDEX.map(m => m.id).sort());
    const offsets: number[] = [];
    for (const m of FEFF_INDEX) {
      const [paths, x] = await Promise.all([loadPaths(m.id), loadXanes(m.id)]);
      expect(x.id).toBe(m.id);
      expect(xanesAt(x, -25), m.id).toBeLessThan(0.1);
      // Two independent calculations (FEFF10 full multiple scattering, FEFF6L paths) over the hand over, 47 to 64 eV:
      // the same normalization puts them level, up to the phase of the wiggles (largest mean offset 0.15, K2CrO4).
      const pathSum = libraryFineStructure(m.edge_energy_eV, paths, 295), d = grid(47, 64);
      const offset = d.reduce((s, v) => s + xanesAt(x, v) - pathSum.factor(m.edge_energy_eV + v), 0) / d.length;
      expect(Math.abs(offset), m.id).toBeLessThan(0.16);
      offsets.push(Math.abs(offset));
    }
    expect(offsets.sort((a, b) => a - b)[offsets.length >> 1]).toBeLessThan(0.05);
  }, 120000);

  it('match measured Cu, Ni, Pt, Fe2O3 and FeO spectra within 0.16, the metals at least twice as closely as the teaching model', async () => {
    const d = grid(-20, 60), result: Record<string, { computed: number; taught: number }> = {};
    for (const ref of measured.references) {
      const x = await loadXanes(ref.id), entry = FEFF_INDEX.find(m => m.id === ref.id)!;
      const teaching = teachingFineStructure(entry.edge_energy_eV, { oscillation: 0 });
      const data = d.map(v => measuredAt(ref.mu, v));
      result[ref.id] = { computed: rms(d.map(v => xanesAt(x, v)), data), taught: rms(d.map(v => teaching.factor(entry.edge_energy_eV + v)), data) };
      expect(result[ref.id].computed, ref.id).toBeLessThan(0.16);
    }
    // Cu 0.10 against 0.22, Ni 0.11 against 0.27. FEFF overshoots the iron oxides' white lines (FeO 1.95 against 1.49
    // measured), so FeO alone is closer with the teaching shape; on average the calculation is still closer.
    for (const id of ['cu', 'ni']) expect(result[id].computed, id).toBeLessThan(0.5 * result[id].taught);
    const mean = (key: 'computed' | 'taught') => Object.values(result).reduce((s, r) => s + r[key], 0) / Object.keys(result).length;
    expect(mean('computed')).toBeLessThan(0.8 * mean('taught'));
  });

  it('place E0 by the same rule in the app as in the generator: every stored grid starts from it', async () => {
    const at = (from: number, step: number, mu: number[]) => mu.map((_, i) => from + i * step);
    for (const ref of measured.references) expect(Math.abs(edgeE0(at(measured.energy.from_eV, measured.energy.step_eV, ref.mu), ref.mu)), ref.id).toBeLessThan(0.15);
    for (const id of xanesIds) {
      const x = await loadXanes(id);
      expect(Math.abs(edgeE0(at(x.energy.from_eV, x.energy.step_eV, x.mu), x.mu)), id).toBeLessThan(0.15);
    }
  });

  it('name the main peak where the spectrum has it: a white line just above the edge, or a slow rise where it tops out', async () => {
    const peak = async (id: string) => nearEdgeMarks(await loadXanes(id)).peak.at_eV;
    expect(await peak('cuo')).toBeCloseTo(13, 0);
    expect(await peak('na2so4')).toBeLessThan(5);
    // Chromate rises slowly; its main peak is a real local top, not the end of a search window (it was +30 eV).
    const k2cro4 = await loadXanes('k2cro4'), top = nearEdgeMarks(k2cro4).peak, i = Math.round((top.at_eV - k2cro4.energy.from_eV) / k2cro4.energy.step_eV);
    expect(top.at_eV).toBeGreaterThan(15);
    expect(k2cro4.mu[i]).toBeGreaterThan(k2cro4.mu[i + 1]);
    expect(k2cro4.mu[i]).toBeGreaterThanOrEqual(k2cro4.mu[i - 1]);
  });

  it('give tetrahedral K2CrO4 a pre-edge many times that of octahedral Cr2O3', async () => {
    const oct = nearEdgeMarks(await loadXanes('cr2o3')), tet = nearEdgeMarks(await loadXanes('k2cro4'));
    expect(tet.preEdge).not.toBeNull();
    expect(tet.preEdge!.height).toBeGreaterThan(3 * (oct.preEdge?.height ?? 0.01));
  });

  it('hand over to the FEFF path sum without a step: the model is continuous through the blend', async () => {
    const [cu, x] = await Promise.all([loadPaths('cu'), loadXanes('cu')]);
    const model = libraryFineStructure(8979, cu, 295, x);
    // Through k = 3.2 to 4.4 per angstrom (39 to 74 eV), neighbouring points 0.05 eV apart never jump.
    for (let e = 39; e < 74; e += 0.05) expect(Math.abs(model.factor(8979 + e + 0.05) - model.factor(8979 + e)), `${e} eV`).toBeLessThan(0.01);
    expect(model.provenance).toBe('computed');
  });
});
