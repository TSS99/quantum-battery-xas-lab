/**
 * The live feed: what the amplifiers and the fluorescence detector read right now, sampled a few times a second at the
 * mono's current energy, like the oscilloscope and rate meters at a real beamline. Each sample is one simulatePoint
 * with a short dwell, so it carries the same physics, and in realistic mode the same noise, as a scan.
 */
import { READOUT_DEFAULTS } from './chambers';
import { simulatePoint, type Random } from './acquire';
import type { TwinState } from './types';

/** Samples a second, the dwell of each, and the seconds of history the scope keeps. */
export const LIVE_RATE_HZ = 10, LIVE_DWELL_S = 1 / LIVE_RATE_HZ, LIVE_WINDOW_S = 10;

export interface LiveSample {
  /** Seconds since the feed started. */
  t: number;
  i0_V: number;
  it_V: number;
  iref_V: number;
  /** Fluorescence counts per second in the counting window, after dead time. */
  if_cps: number;
  saturated: string[];
}

/** One reading of every channel at time t (seconds since the feed started). */
export function liveSample(state: TwinState, t: number, random: Random, dwell_s = LIVE_DWELL_S): LiveSample {
  const p = simulatePoint(state, state.energy_eV, random, { dwell_s, elapsed_s: t });
  const { fullScale_V, v2fFullScale_Hz, v2fOffset_Hz } = READOUT_DEFAULTS;
  // The V2F counts back to the amplifier voltage they came from.
  const volts = (counts: number) => Math.max(0, counts / dwell_s - v2fOffset_Hz) / v2fFullScale_Hz * fullScale_V;
  return { t, i0_V: volts(p.i0), it_V: volts(p.it), iref_V: volts(p.iref), if_cps: p.ifluor / dwell_s, saturated: p.saturated };
}

/** A round upper limit for the scope's voltage axis: the next 1, 2 or 5 step above the largest reading, at most full scale. */
export function scopeTop(max_V: number): number {
  if (!(max_V > 0)) return 1;
  const step = 10 ** Math.floor(Math.log10(max_V * 1.15));
  const top = [1, 2, 5, 10].map(m => m * step).find(v => v >= max_V * 1.15)!;
  return Math.min(top, READOUT_DEFAULTS.fullScale_V);
}
