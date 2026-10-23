import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '../xraydata';
import { loadOptics } from './tables';
import { COMMAND_EXAMPLES, blockedBy, parseCommand } from './command-bar';
import { DEFAULT_STATE, applyCommand, type TwinCommand } from './twin';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

const intents = (text: string) => {
  const parsed = parseCommand(text, DEFAULT_STATE);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.intents;
};

describe('command bar grammar', () => {
  it('reads energies in eV or keV', () => {
    expect(intents('set energy 8979')).toEqual([{ type: 'energy', energy_eV: 8979 }]);
    expect(intents('Energy 9 keV')).toEqual([{ type: 'energy', energy_eV: 9000 }]);
    expect(intents('go to 8.5 kev')).toEqual([{ type: 'energy', energy_eV: 8500 }]);
    expect(intents('8333 eV')).toEqual([{ type: 'energy', energy_eV: 8333 }]);
    expect(intents('go to edge')).toEqual([{ type: 'energy', energy_eV: 8979 }]);
  });

  it('switches modes by name, alias or number', () => {
    expect(intents('switch to fluorescence')).toEqual([{ type: 'mode', mode: 'fluorescence' }]);
    expect(intents('TEY')).toEqual([{ type: 'mode', mode: 'electron-yield' }]);
    expect(intents('mode 5')).toEqual([{ type: 'mode', mode: 'mono' }]);
    expect(intents('beam damage')).toEqual([{ type: 'mode', mode: 'damage' }]);
    expect(intents('time resolved mode')).toEqual([{ type: 'mode', mode: 'time-resolved' }]);
  });

  it('turns instrument phrases into twin commands', () => {
    expect(intents('detune 30 %')).toEqual([{ type: 'detune', detune: 0.3 }]);
    expect(intents('detune by 0.5')).toEqual([{ type: 'detune', detune: 0.5 }]);
    expect(intents('insert harmonic mirror')).toEqual([{ type: 'mirror', id: 'M3', inserted: true }]);
    expect(intents('retract the focusing mirror')).toEqual([{ type: 'mirror', id: 'M2', inserted: false }]);
    expect(intents('crystal Si(311)')).toEqual([{ type: 'crystal', crystal: 'Si311' }]);
    expect(intents('realistic off')).toEqual([{ type: 'realistic', value: false }]);
    expect(intents('educational')).toEqual([{ type: 'realistic', value: false }]);
    expect(intents('auto gain')).toEqual([{ type: 'autoGain' }]);
    expect(intents('fill It with argon')).toEqual([{ type: 'gas', chamber: 'It', gas: { Ar: 1 } }]);
    expect(intents('thickness 0.5 mm')).toEqual([{ type: 'thickness', thickness_um: 500 }]);
    expect(intents('thickness 20 µm')).toEqual([{ type: 'thickness', thickness_um: 20 }]);
    expect(intents('temperature 80 K')).toEqual([{ type: 'temperature', temperature_K: 80 }]);
    expect(intents('focus 5 x 5 um')).toEqual([{ type: 'beam', beam_um: [5, 5] }]);
    expect(intents('cryostat')).toEqual([{ type: 'environment', kind: 'cryostat' }]);
    expect(intents('sample NiO')).toEqual([{ type: 'samplePreset', id: 'nio-pellet' }]);
    expect(intents('sample LiMn2O4')).toEqual([{ type: 'samplePreset', id: 'limn2o4-pellet' }]);
    expect(intents('profile undulator')).toEqual([{ type: 'profile', id: 'und6' }]);
    expect(intents('acquire')).toEqual([{ type: 'acquire' }]);
    expect(intents('acquire 3 scans')).toEqual([{ type: 'acquire', repeats: 3 }]);
  });

  it('corrects typos and says so, so the bar can ask before running', () => {
    const fixed = parseCommand('swich to flourescence', DEFAULT_STATE);
    expect(fixed).toMatchObject({ ok: true, corrected: true, understood: 'switch to fluorescence', intents: [{ type: 'mode', mode: 'fluorescence' }] });
    expect(parseCommand('detnue 20 %', DEFAULT_STATE)).toMatchObject({ ok: true, corrected: true, intents: [{ type: 'detune', detune: 0.2 }] });
    expect(parseCommand('aqcuire 2 scans', DEFAULT_STATE)).toMatchObject({ ok: true, corrected: true });
    expect(parseCommand('set energy 8979', DEFAULT_STATE)).toMatchObject({ ok: true, corrected: false });
  });

  it('explains what it cannot do', () => {
    for (const text of ['', 'make coffee', 'acquire 99 scans', 'detune 150 %', 'sample unobtainium']) {
      const parsed = parseCommand(text, DEFAULT_STATE);
      expect(parsed.ok, text).toBe(false);
      if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(10);
    }
    // The undulator profile has no collimating mirror.
    const und = applyCommand(DEFAULT_STATE, { type: 'profile', id: 'und6' }).state;
    expect(parseCommand('insert collimating mirror', und)).toMatchObject({ ok: false });
  });

  it('respects the controls a training task locks', () => {
    expect(blockedBy(intents('sample NiO'), ['sample'])).toBe('sample');
    expect(blockedBy(intents('crystal Si(220)'), ['profile', 'mono'])).toBe('mono');
    expect(blockedBy(intents('profile tender'), ['profile'])).toBe('profile');
    expect(blockedBy(intents('set energy 8979'), ['profile', 'sample', 'mono'])).toBeNull();
  });

  it('runs every help example through the twin without error', () => {
    for (const text of COMMAND_EXAMPLES) {
      for (const intent of intents(text)) if (intent.type !== 'acquire') expect(() => applyCommand(DEFAULT_STATE, intent as TwinCommand), text).not.toThrow();
    }
  });
});
