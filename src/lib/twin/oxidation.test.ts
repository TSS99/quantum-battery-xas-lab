import { describe, expect, it } from 'vitest';
import { valenceSeries } from './oxidation';

describe('valence series', () => {
  it('reads each member from its sample and keeps the measured shifts', () => {
    const cu = valenceSeries('Cu')!;
    expect(cu.members.map(m => [m.id, m.valence, m.shift_eV])).toEqual([['cu-foil', 0, 0], ['cu2o-pellet', 1, 1.4], ['cuo-pellet', 2, 5.4]]);
    // Imam et al.: MnO's edge sits with the metal's at half the edge step, the others well above.
    const mn = valenceSeries('Mn')!;
    expect(mn.members.find(m => m.id === 'mno-pellet')!.shift_eV).toBeCloseTo(-0.1, 6);
    expect(mn.members.find(m => m.id === 'limn2o4-pellet')!.derived).toBe('interpolated');
  });

  it('gives a few electronvolts per unit of valence, from the measured members only', () => {
    expect(valenceSeries('Cu')!.perValence_eV).toBeCloseTo(2.7, 1);
    expect(valenceSeries('Mn')!.perValence_eV).toBeGreaterThan(1.5);
    expect(valenceSeries('Mn')!.perValence_eV).toBeLessThan(2.5);
    expect(valenceSeries('S')!.perValence_eV).toBeCloseTo(1.6, 1);
    expect(valenceSeries('Fe')).toBeNull();
  });
});
