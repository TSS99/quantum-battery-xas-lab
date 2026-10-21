/**
 * Scan plans: regions in energy relative to the edge and in photoelectron wavenumber k, the
 * point list a plan produces, and how long it takes.
 *
 * Reference: project physics dossier sections 8.3 and 13.
 */
import type { ScanPlan, ScanRegion } from './types';

/**
 * 2 m_e / hbar^2 in eV^-1 Å^-2, so that k = sqrt(KAPPA (E - E0)) with k in Å^-1: 2 m_e c^2 / (hbar c)^2
 * from the CODATA 2018 values m_e c^2 = 510998.95 eV and hbar c = 1973.269804 eV Å, about 0.26246842.
 * Larch builds its KTOE from the same CODATA constants (via scipy); the older 0.2624682843 that
 * some texts quote differs by 5e-7 relative.
 */
export const KAPPA = 2 * 510998.95 / 1973.269804 ** 2;

export const kOf = (energy_eV: number, e0_eV: number) => Math.sqrt(Math.max(0, KAPPA * (energy_eV - e0_eV)));
export const energyOfK = (k: number, e0_eV: number) => e0_eV + k * k / KAPPA;

/**
 * Larch `rebin_xafs` XANES step, 0.05 eV * max(1, floor(E0 / 1250)): about E0 / 25000, so 0.35 eV
 * at the Cu K edge and 0.45 eV at Pt L3 (dossier 13).
 */
export const xanesStep_eV = (e0_eV: number) => 0.05 * Math.max(1, Math.floor(e0_eV / 1250));

/**
 * A plan for one edge following dossier 13: pre edge from -200 to -30 eV in 10 eV steps, XANES
 * from -30 to +40 eV at the Larch step, EXAFS on a uniform k grid to 12 Å^-1 in 0.05 Å^-1 steps
 * with dwell growing as k^1. The region ends and the k^1 weight are a typical choice, not a
 * survey of beamline practice.
 */
export function defaultPlan(e0_eV: number): ScanPlan {
  return {
    kind: 'step', repeats: 1, settle_s: 0.2,
    regions: [
      { space: 'E', start: -200, end: -30, step: 10, dwell_s: 1 },
      { space: 'E', start: -30, end: 40, step: xanesStep_eV(e0_eV), dwell_s: 1 },
      { space: 'k', start: kOf(e0_eV + 40, e0_eV), end: 12, step: 0.05, dwell_s: 1, kWeight: 1 },
    ],
  };
}

/** A XANES plan: pre edge from -100 to -30 eV in 5 eV steps, then -30 to +70 eV at the Larch step. */
export function xanesPlan(e0_eV: number): ScanPlan {
  return { kind: 'step', repeats: 1, settle_s: 0.2, regions: [
    { space: 'E', start: -100, end: -30, step: 5, dwell_s: 1 }, { space: 'E', start: -30, end: 70, step: xanesStep_eV(e0_eV), dwell_s: 1 }] };
}

export interface PlanPoints {
  /** Mono reading of every point, eV. */
  energy_eV: Float64Array;
  dwell_s: Float64Array;
  /** Index of the region each point belongs to. */
  region: Uint16Array;
}

function regionValues(region: ScanRegion, last: boolean): number[] {
  if (!(region.step > 0)) throw new RangeError('Scan step must be greater than zero.');
  if (!(region.dwell_s > 0)) throw new RangeError('Dwell time must be greater than zero seconds.');
  if (!(region.end > region.start)) throw new RangeError('A scan region must end above where it starts.');
  const count = (region.end - region.start) / region.step;
  // Each region stops short of its end, which is where the next one starts; the last one keeps it.
  const n = Math.ceil(count - 1e-9) + (last && Math.abs(count - Math.round(count)) < 1e-9 ? 1 : 0);
  return Array.from({ length: n }, (_, i) => region.start + i * region.step);
}

/** Energies and dwells of one pass through the plan, in scan order, for an edge at e0_eV. */
export function planPoints(plan: ScanPlan, e0_eV: number): PlanPoints {
  const energies: number[] = [], dwells: number[] = [], regions: number[] = [];
  plan.regions.forEach((region, index) => {
    const last = index === plan.regions.length - 1;
    for (const value of regionValues(region, last)) {
      if (region.space === 'E') {
        energies.push(e0_eV + value);
        dwells.push(region.dwell_s);
      } else {
        energies.push(energyOfK(value, e0_eV));
        // t = t0 (k / k0)^w with k0 the region start (dossier 8.3).
        const w = region.kWeight ?? 0;
        dwells.push(region.dwell_s * (region.start > 0 ? (value / region.start) ** w : 1));
      }
      regions.push(index);
    }
  });
  for (let i = 1; i < energies.length; i++) {
    if (!(energies[i] > energies[i - 1])) throw new RangeError('Scan regions overlap: energies must increase through the plan.');
  }
  return { energy_eV: Float64Array.from(energies), dwell_s: Float64Array.from(dwells), region: Uint16Array.from(regions) };
}

export interface PlanDuration {
  points: number;
  /** Counting time of one spectrum, s. */
  counting_s: number;
  /** One spectrum including motor settling; for a continuous scan this is its time resolution. */
  perSpectrum_s: number;
  /** All repeats. */
  total_s: number;
}

/** How long a plan takes. Continuous scans move without stopping, so they have no settle time. */
export function planDuration(plan: ScanPlan, e0_eV: number): PlanDuration {
  const { dwell_s } = planPoints(plan, e0_eV);
  const counting_s = dwell_s.reduce((sum, t) => sum + t, 0);
  const perSpectrum_s = counting_s + (plan.kind === 'step' ? plan.settle_s * dwell_s.length : 0);
  return { points: dwell_s.length, counting_s, perSpectrum_s, total_s: perSpectrum_s * Math.max(1, plan.repeats) };
}
