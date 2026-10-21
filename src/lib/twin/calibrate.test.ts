import { beforeAll, describe, expect, it } from 'vitest';
import examples from '../../data/xas-reduction/examples.json';
import larchReference from '../../data/xas-reduction/larch-reference.json';
import { parseBeamlineFile } from '../beamline-files';
import { loadXrayData } from '../xraydata';
import { DEFAULT_TWIN } from '../../components/twin/twin-state';
import { loadLibraryFineStructure } from './sample';
import { PROFILE_PRESETS } from './presets';
import { outputRate } from './sdd';
import { loadOptics } from './tables';
import {
  calibrateText, fitDeadTime, fitEffectiveResolution, fitEnergyOffset, generateMysteryInstrument, profileFromJson,
  profileToJson, validateTwinProfile,
} from './calibrate';

beforeAll(async () => {
  await Promise.all([loadXrayData(), loadOptics()]);
  await loadLibraryFineStructure(DEFAULT_TWIN.sample);
});

describe('instrument profiles', () => {
  it('round-trips every field through xaslab-twin-profile/1 JSON', () => {
    expect(profileFromJson(profileToJson(DEFAULT_TWIN.profile))).toEqual(DEFAULT_TWIN.profile);
    for (const preset of PROFILE_PRESETS) expect(validateTwinProfile(preset.profile)).toEqual(preset.profile);
  });

  it('rejects a wrong format, range, gas sum, duplicate chamber and reversed ROI', () => {
    const bad = () => JSON.parse(profileToJson(DEFAULT_TWIN.profile));
    const format = bad(); format.format = 'profile/0';
    expect(() => validateTwinProfile(format)).toThrow(/format/);
    const angle = bad(); angle.mirrors[0].angle_mrad = 30;
    expect(() => validateTwinProfile(angle)).toThrow(/angle_mrad/);
    const gas = bad(); gas.chambers[0].gas = { N2: 0.8 };
    expect(() => validateTwinProfile(gas)).toThrow(/sum to 1/);
    const chamber = bad(); chamber.chambers[1].id = 'I0';
    expect(() => validateTwinProfile(chamber)).toThrow(/exactly once/);
    const roi = bad(); roi.sdd.roi_eV = [9000, 8000];
    expect(() => validateTwinProfile(roi)).toThrow(/upper energy/);
  });
});

describe('calibration fits', () => {
  it('matches Larch pre_edge E0 for the same stored synthetic reference-foil fixture', () => {
    const file = examples.files.find(item => item.name === larchReference.feScans[0].file)!;
    const table = parseBeamlineFile(file.text, file.name);
    const energy = table.columns[0], it = table.columns[2], iref = table.columns[3];
    const muRef = it.map((value, i) => Math.log(value / iref[i]));
    const result = fitEnergyOffset(energy, muRef, larchReference.tabulatedEdges_eV['Fe K']);
    expect(result.measuredInflection_eV).toBe(larchReference.preEdge['ref-scan1-defaults'].e0);
    expect(result.measuredInflection_eV).toBe(larchReference.feScans[0].e0_ref);
    expect(result.value).toBeCloseTo(larchReference.feScans[0].shift_eV, 12);
    expect(result.method).toContain('E_{\\mathrm{tabulated}} - E_{\\mathrm{inflection}}');
  });

  it('converts a declared keV energy column before calibration', () => {
    const rows = Array.from({ length: 401 }, (_, i) => {
      const energy_eV = 8967 + i * 0.05;
      const mu = 1 / (1 + Math.exp(-(energy_eV - 8977) / 0.35));
      return `${energy_eV / 1000} ${mu}`;
    });
    const text = [
      '# XDI/1.0 test/1', '# Column.1: energy keV', '# Column.2: murefer',
      '# Calibration.edge_energy: 8979', '# ///', '#----', '# energy murefer', ...rows,
    ].join('\n');
    const result = calibrateText(text, DEFAULT_TWIN).results.find(item => item.kind === 'energy-offset')!;
    expect(result.value).toBeCloseTo(2, 1);
  });

  it('selects and recovers a non-paralyzable per-element dead time', () => {
    const elements = 7, truth_us = 1.3;
    const icr = Array.from({ length: 30 }, (_, i) => 2e4 + i * 3e4);
    const ocr = icr.map(value => outputRate(value / elements, truth_us * 1e-6, 'non-paralyzable') * elements);
    const fit = fitDeadTime(icr, ocr, elements);
    expect(fit.preferredModel).toBe('non-paralyzable');
    expect(fit.value).toBeCloseTo(truth_us, 10);
    expect(fit.verdict).toContain('\\mathrm{ICR}/7');
  });

  it('estimates excess width only when a sharp feature is resolved above its reference', () => {
    const energy = Array.from({ length: 1001 }, (_, i) => -10 + i * 0.02);
    const step = (scale: number) => energy.map(value => 1 / (1 + Math.exp(-value / scale)));
    const result = fitEffectiveResolution({
      energy_eV: energy, observed: step(0.8), referenceEnergy_eV: energy, reference: step(0.2),
    });
    expect(result).not.toBeNull();
    expect(result!.value).toBeGreaterThan(2);
    expect(result!.uncertainty).toBeGreaterThan(0);
    expect(fitEffectiveResolution({
      energy_eV: energy, observed: step(0.2), referenceEnergy_eV: energy, reference: step(0.2),
    })).toBeNull();
  });

  it('recovers all three hidden settings over 20 mystery seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const mystery = generateMysteryInstrument(DEFAULT_TWIN, seed);
      const report = calibrateText(mystery.text, DEFAULT_TWIN);
      const offset = report.results.find(result => result.kind === 'energy-offset')!;
      const harmonic = report.results.find(result => result.kind === 'harmonic-fraction')!;
      const deadTime = report.results.find(result => result.kind === 'dead-time')!;
      expect(Math.abs(offset.value - mystery.truth.energyOffset_eV), `offset seed ${seed}: fit ${offset.value}, truth ${mystery.truth.energyOffset_eV}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(harmonic.value / 100 / mystery.truth.harmonicFraction - 1), `harmonic seed ${seed}`).toBeLessThanOrEqual(0.10);
      expect(Math.abs(deadTime.value / mystery.truth.deadTime_us - 1), `dead time seed ${seed}`).toBeLessThanOrEqual(0.05);
      expect('preferredModel' in deadTime && deadTime.preferredModel).toBe('paralyzable');
    }
  }, 60_000);
});
