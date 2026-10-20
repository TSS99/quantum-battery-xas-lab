import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '@/lib/xraydata';
import { loadOptics } from '@/lib/twin/tables';
import { foilTransmission } from '@/lib/twin/acquire';
import { beamAtSample } from '@/lib/twin/beam';
import { chamberReadout } from '@/lib/twin/chambers';
import { braggAngle_rad } from '@/lib/twin/mono';
import { transmission } from '@/lib/twin/sample';
import { hutchLive } from './hutch-live';
import { DEFAULT_TWIN } from './twin-state';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

const at = (energy_eV: number) => hutchLive({ ...DEFAULT_TWIN, energy_eV });
const chamber = (id: string) => DEFAULT_TWIN.profile.chambers.find(c => c.id === id)!;

describe('hutch live readings', () => {
  it('passes the beam model, the I0 chamber, the sample and the It chamber along in order', () => {
    const live = at(9000), beam = beamAtSample(DEFAULT_TWIN.profile, 9000);
    expect(live.theta_deg).toBeCloseTo(braggAngle_rad('Si111', 9000) * 180 / Math.PI, 9);
    expect(live.flux).toBe(beam.flux);
    const i0 = chamberReadout(chamber('I0'), beam.flux, 9000);
    expect(live.i0).toEqual(i0);
    expect(live.sampleFlux).toBe(i0.transmittedFlux);
    const through = transmission(DEFAULT_TWIN.sample, DEFAULT_TWIN.environment, 9000).transmission;
    expect(live.sampleTransmission).toBe(through);
    expect(live.it).toEqual(chamberReadout(chamber('It'), i0.transmittedFlux * through, 9000));
    expect(live.afterI0).toBeCloseTo(i0.transmittedFlux / beam.flux, 12);
    expect(live.afterSample).toBeCloseTo(live.afterI0 * through, 12);
    expect(live.afterIt).toBeLessThan(live.afterSample);
    // The Cu reference foil dims the beam again before the Iref chamber.
    expect(live.foilTransmission).toBe(foilTransmission(DEFAULT_TWIN.reference!, DEFAULT_TWIN.sample, 9000));
    expect(live.afterFoil).toBeCloseTo(live.afterIt * live.foilTransmission!, 12);
    expect(live.iref).toEqual(chamberReadout(chamber('Iref'), beam.flux * live.afterFoil, 9000));
    for (const reading of [live.i0, live.it, live.iref]) expect(reading!.saturated).toBe(false);
    expect(live.doseRate_Gy_per_s).toBeGreaterThan(0);
  });

  it('the Cu foil absorbs more and fluoresces far more above the Cu K edge (8979 eV)', () => {
    const below = at(8900), above = at(9000);
    expect(above.sampleTransmission!).toBeLessThan(below.sampleTransmission!);
    // Below the edge only the tail of the broadened teaching edge fluoresces (about 1.6 % at 8900 eV).
    expect(below.fluorescence_per_s!).toBeLessThan(0.05 * above.fluorescence_per_s!);
  });

  it('reports no angle and an undimmed beam when the crystal cannot reach the energy', () => {
    const live = at(1500);
    expect(live.theta_deg).toBeNull();
    expect(live.flux).toBeNull();
    expect(live.afterSample).toBe(1);
    expect(live.notes.length).toBeGreaterThan(0);
  });
});
