import { COMPOUND_PRESETS } from '@/data/compound-presets';
import { MAX_TOTAL_ABSORPTION, SOFT_EDGE_eV, muOverRho, recommendThickness, type ThicknessRecommendation } from './xraydata';
import { samplePlan, type Sample } from './sample';

export type Phase = 'gas' | 'liquid' | 'solid';
/** How the sample sits in the beam: a pressed pellet, a metal foil, a thin film on a membrane, or a cell with windows. */
export type PrepForm = 'pellet' | 'foil' | 'film' | 'cell';

/** About 100 mg of powder makes a 13 mm pellet that holds together. A common rule of thumb, not a property of the sample. */
export const PELLET_MASS_MG = 100;
/** Without a preset, a density below this (g/cm³) is read as a gas; the presets keep gases under it and condensed matter above. */
export const GAS_DENSITY = 0.01;
/** Boron nitride absorbs less per gram than cellulose at hard X-ray edges, so it is the filler. */
const DILUENT = 'BN';

export interface SamplePreparation {
  form: PrepForm;
  phase: Phase;
  /** Edge below 2 keV, where transmission needs very thin samples and a vacuum path. */
  soft: boolean;
  /** The thickness plan; for pellets it includes the diluent, if any. */
  plan: ThicknessRecommendation;
  diameter_mm: number;
  /** Sample plus diluent. */
  pelletMass_mg: number;
  /** More diluent would push total absorption past the limit, so the pellet is lighter than PELLET_MASS_MG. */
  light: boolean;
}

export function phaseOf(sample: Sample): Phase {
  const preset = COMPOUND_PRESETS.find(p => p.id === sample.preset);
  return preset ? preset.phase : sample.density < GAS_DENSITY ? 'gas' : 'solid';
}

/**
 * Turns the transmission plan into a preparation: gases and liquids go in a cell, soft-edge solids become a thin film,
 * the foil presets stay foils, and other solids are pressed. A pellet is made up to PELLET_MASS_MG with BN unless the
 * BN would raise total absorption above MAX_TOTAL_ABSORPTION. Null when the edge has no thickness plan.
 */
export function samplePreparation(sample: Sample, info = samplePlan(sample)): SamplePreparation | null {
  const plan = info.plan;
  if (!plan) return null;
  const phase = phaseOf(sample), soft = info.edge.energy_eV < SOFT_EDGE_eV;
  const form: PrepForm = phase !== 'solid' ? 'cell' : soft ? 'film' : sample.preset?.endsWith('-foil') ? 'foil' : 'pellet';
  const diameter_mm = 20 * Math.sqrt(plan.pelletArea_cm2 / Math.PI);
  if (form !== 'pellet') return { form, phase, soft, plan, diameter_mm, pelletMass_mg: plan.sampleMass_mg, light: false };
  const fill = PELLET_MASS_MG - plan.sampleMass_mg;
  const room = (MAX_TOTAL_ABSORPTION - plan.totalAbsorptionAbove) * plan.pelletArea_cm2 * 1000 / muOverRho(DILUENT, plan.edgeStep.edgeEnergy_eV).total;
  const mass_mg = Math.min(fill, room);
  // Less than 1 mg of filler is not worth weighing.
  const mixed = mass_mg >= 1 ? recommendThickness(sample.formula, sample.absorber, sample.edge, sample.density, { pelletArea_cm2: plan.pelletArea_cm2, diluent: { material: DILUENT, mass_mg } }) : plan;
  return { form, phase, soft, plan: mixed, diameter_mm, pelletMass_mg: mixed.sampleMass_mg + (mixed.diluent?.mass_mg ?? 0), light: room < fill };
}
