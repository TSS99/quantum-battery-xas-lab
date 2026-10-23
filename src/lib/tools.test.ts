import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from './xraydata';
import { loadOptics } from './twin/tables';
import { CHAMBER_FILLS, FILL_TARGETS } from './twin/chambers';
import { REJECTION_KEEP_FUNDAMENTAL, REJECTION_PASS_HARMONIC } from './twin/mirrors';
import {
  DOSE_EXAMPLES, EXAFS_K, GAS_EXAMPLE_EDGES, MIRROR_COATINGS_SHOWN, MIRROR_EXAMPLE_ENERGIES_eV, SELF_ABSORPTION_EXAMPLES,
  dosePlan, edgeOf, gasPlan, mirrorChoice, mixLabel, selfAbsorption,
} from './tools';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

describe('calculator pages', () => {
  it('labels gas mixes the way the twin lists them', () => {
    expect(mixLabel({ He: 1 })).toBe('He');
    expect(mixLabel({ N2: 0.8, Ar: 0.2 })).toBe('N₂ 80 %, Ar 20 %');
    expect(mixLabel({ Ar: 0.25, N2: 0.75, Kr: 0 })).toBe('N₂ 75 %, Ar 25 %');
  });

  it('suggests ion chamber fills inside the target band at the common edges', () => {
    for (const [label, element, edge] of GAS_EXAMPLE_EDGES) {
      for (const [role, length] of [['I0', 15], ['It', 30]] as const) {
        const plan = gasPlan(edgeOf(element, edge), length, role);
        expect(plan.fills.map(f => f.id)).toEqual(CHAMBER_FILLS.map(f => f.id));
        expect(plan.suggestion.inBand, `${label} ${role}`).toBe(true);
        expect(plan.suggestion.absorbed).toBeGreaterThanOrEqual(FILL_TARGETS[role].min);
        expect(plan.suggestion.absorbed).toBeLessThanOrEqual(FILL_TARGETS[role].max);
      }
    }
    // Heavier gases absorb more at 9 keV, and a longer chamber absorbs more of the same gas.
    const cu = gasPlan(8979, 15, 'I0'), absorbed = (id: string) => cu.fills.find(f => f.id === id)!.absorbed;
    expect(absorbed('He')).toBeLessThan(absorbed('N2'));
    expect(absorbed('N2')).toBeLessThan(absorbed('Ar'));
    expect(gasPlan(8979, 30, 'I0').fills[1].absorbed).toBeGreaterThan(absorbed('N2'));
  });

  it('picks mirror angles that keep the fundamental and reject the third harmonic, or says why not', () => {
    for (const coating of MIRROR_COATINGS_SHOWN) {
      for (const energy of MIRROR_EXAMPLE_ENERGIES_eV) {
        const choice = mirrorChoice(coating, energy);
        if (!choice.ok) { expect(choice.reason).toMatch(/eV/); continue; }
        expect(choice.fundamental).toBeGreaterThanOrEqual(REJECTION_KEEP_FUNDAMENTAL);
        expect(choice.harmonic).toBeLessThanOrEqual(REJECTION_PASS_HARMONIC);
        // A mirror that passes E and stops 3E has its cutoff between the two.
        expect(choice.cutoff_eV).toBeGreaterThan(energy);
        expect(choice.cutoff_eV).toBeLessThan(3 * energy);
      }
    }
    expect(mirrorChoice('Rh', 9000).ok).toBe(true);
    const tooHigh = mirrorChoice('Rh', 25000);
    expect(tooHigh.ok).toBe(false);
  });

  it('keeps all of the fine structure for thin or dilute samples and damps it for thick concentrated ones', () => {
    const results = Object.fromEntries(SELF_ABSORPTION_EXAMPLES.map(e => [e.label, selfAbsorption(e.input)]));
    for (const result of Object.values(results)) for (const p of result.points) { expect(p.kept).toBeGreaterThan(0); expect(p.kept).toBeLessThanOrEqual(1 + 1e-9); }
    const pellet = results['NiO pellet, 200 µm'], dilute = results['Fe 2 mM in water, 1 mm'], diluted = results['NiO pellet diluted 1 to 20 in BN'];
    expect(pellet.exponent).toBeGreaterThan(10);
    expect(pellet.points[1].kept).toBeLessThan(0.6);
    expect(diluted.points[1].kept).toBeGreaterThan(pellet.points[1].kept);
    expect(dilute.points[1].kept).toBeGreaterThan(0.99);
    expect(pellet.points[1].energy_eV - pellet.edge_eV).toBeCloseTo(3.80998 * EXAFS_K ** 2, 6);
    expect(pellet.line.group).toBe('Ka');
    // A thin enough layer measured face on keeps nearly everything.
    expect(selfAbsorption({ formula: 'Cu', density: 8.96, thickness_um: 0.01, absorber: 'Cu', edge: 'K', incidence_deg: 45, exit_deg: 45 }).points[1].kept).toBeGreaterThan(0.99);
  });

  it('matches the thick-sample limit 1 - mu_a / alpha for a thick pellet', async () => {
    const { mu } = await import('./xraydata');
    const { muComponents, sharpEdge, fluorescenceLine } = await import('./twin/sample');
    const input = SELF_ABSORPTION_EXAMPLES[0].input, result = selfAbsorption(input), e = result.points[1].energy_eV;
    const parts = muComponents({ ...input, form: 'pellet', pinholeFraction: 0, thicknessSpread: 0, particle_um: 0 }, e, { fineStructure: sharpEdge(result.edge_eV) });
    const alpha = parts.total_cm_inv + 1 * mu(input.formula, input.density, fluorescenceLine('Ni', 'K').energy_eV).total;
    expect(result.points[1].kept).toBeCloseTo(1 - parts.absorber_cm_inv / alpha, 4);
  });

  it('scales the dose rate with flux over beam area and gives the time to each threshold', () => {
    const [wide, focused] = DOSE_EXAMPLES.map(e => dosePlan(e.input));
    expect(focused.meanRate_Gy_per_s / wide.meanRate_Gy_per_s).toBeCloseTo((1e13 / 1e11) * (1000 * 500) / (50 * 50), 6);
    for (const plan of DOSE_EXAMPLES.map(e => dosePlan(e.input))) {
      for (const t of plan.timeTo) expect(t.seconds * plan.meanRate_Gy_per_s).toBeCloseTo(t.dose_Gy, 6);
      expect(plan.meanRate_Gy_per_s).toBeLessThanOrEqual(plan.surfaceRate_Gy_per_s);
    }
  });
});
