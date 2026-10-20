/**
 * The numbers the hutch scene shows: what each detector reads and how much beam is left after
 * each element, from the twin physics modules at the current energy. Expected values only, no
 * noise. Needs `loadXrayData()` and `loadOptics()` first. No React, so it is unit tested in Node.
 */
import { foilTransmission } from '@/lib/twin/acquire';
import { beamAtSample } from '@/lib/twin/beam';
import { chamberReadout, type ChamberReadout } from '@/lib/twin/chambers';
import { sampleDoseRate } from '@/lib/twin/damage';
import { fluorescence, fluorescenceLine, transmission } from '@/lib/twin/sample';
import { efficiency, filterTransmission, solidAngle } from '@/lib/twin/sdd';
import type { ChamberConfig, TwinState } from '@/lib/twin/types';

export interface HutchLive {
  energy_eV: number;
  /** True Bragg angle of the fundamental, degrees; null when the crystal cannot reach the energy. */
  theta_deg: number | null;
  /** Photons per second arriving at the I0 chamber. */
  flux: number | null;
  i0: ChamberReadout | null;
  /** Photons per second on the sample, after the I0 chamber. */
  sampleFlux: number | null;
  /** Fraction of the beam through the sample and its environment windows. */
  sampleTransmission: number | null;
  it: ChamberReadout | null;
  /** Fraction of the beam through the reference foil; null without a foil. */
  foilTransmission: number | null;
  iref: ChamberReadout | null;
  /** Line photons per second reaching the fluorescence detector, before dead time; null below the tabulated range. */
  fluorescence_per_s: number | null;
  /** Surface dose rate on the sample, Gy/s. */
  doseRate_Gy_per_s: number | null;
  /** Fraction of the photons at I0 still in the beam after each element, for the drawn glow. */
  afterI0: number;
  afterSample: number;
  afterIt: number;
  afterFoil: number;
  /** Why a number is missing, in plain words. */
  notes: string[];
}

const chamber = (state: TwinState, id: ChamberConfig['id']) => state.profile.chambers.find(c => c.id === id);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function hutchLive(state: TwinState): HutchLive {
  const { energy_eV, profile, sample, environment } = state;
  const notes: string[] = [];
  const live: HutchLive = {
    energy_eV, theta_deg: null, flux: null, i0: null, sampleFlux: null, sampleTransmission: null, it: null, foilTransmission: null, iref: null,
    fluorescence_per_s: null, doseRate_Gy_per_s: null, afterI0: 1, afterSample: 1, afterIt: 1, afterFoil: 1, notes,
  };
  let beam;
  try { beam = beamAtSample(profile, energy_eV); } catch (error) { notes.push(message(error)); return live; }
  live.theta_deg = beam.thetaB_rad * 180 / Math.PI;
  live.flux = beam.flux;

  const i0Config = chamber(state, 'I0'), itConfig = chamber(state, 'It'), irefConfig = chamber(state, 'Iref');
  live.i0 = i0Config ? chamberReadout(i0Config, beam.flux, energy_eV) : null;
  const sampleFlux = live.i0 ? live.i0.transmittedFlux : beam.flux;
  live.sampleFlux = sampleFlux;
  live.afterI0 = beam.flux > 0 ? sampleFlux / beam.flux : 0;

  const through = transmission(sample, environment, energy_eV).transmission;
  live.sampleTransmission = through;
  live.afterSample = live.afterI0 * through;
  live.it = itConfig ? chamberReadout(itConfig, sampleFlux * through, energy_eV) : null;
  live.afterIt = live.it && beam.flux > 0 ? live.it.transmittedFlux / beam.flux : live.afterSample;
  const foil = state.reference ? foilTransmission(state.reference, sample, energy_eV) : 1;
  live.foilTransmission = state.reference ? foil : null;
  live.afterFoil = live.afterIt * foil;
  live.iref = irefConfig ? chamberReadout(irefConfig, beam.flux * live.afterFoil, energy_eV) : null;

  try {
    const line = fluorescenceLine(sample.absorber, sample.edge);
    const detected = efficiency(line.energy_eV).total * filterTransmission(profile.sdd, line.energy_eV);
    const result = fluorescence(sample, environment, energy_eV, {
      solidAngleFraction: solidAngle(profile.sdd).fraction, efficiency: detected, exit_deg: profile.sdd.exitAngle_deg,
    });
    live.fluorescence_per_s = sampleFlux * result.ratio;
  } catch (error) { notes.push(message(error)); }

  live.doseRate_Gy_per_s = sampleDoseRate(sample, sampleFlux, energy_eV, profile.beam_um).surfaceRate_Gy_per_s;
  return live;
}
