import { beforeAll, describe, expect, it } from 'vitest';
import { COMMANDS, MODULES, completeInput, formatNumber, pythonScript, runCommand, type ConsoleResult } from './console';
import { DEFAULT_SAMPLE, defaultEdge, samplePlan, validateSample, type Sample } from './sample';
import { loadXrayData, mu } from './xraydata';

const iron: Sample = { formula: 'Fe2O3', density: 5.26, absorber: 'Fe', edge: 'K', preset: null };
const context = { sample: iron, energy: 7112 };
const run = (input: string) => runCommand(input, context);
const text = (result: ConsoleResult) => result.lines.map(line => line.kind === 'row' ? `${line.label}: ${line.value} ${line.note ?? ''}` : line.text).join('\n');
const value = (result: ConsoleResult, label: string) => result.lines.find(line => line.kind === 'row' && line.label === label);

describe('commands before tables load', () => {
  it('allows help, completion and navigation without data', () => {
    expect(text(run('help'))).toContain('Commands');
    expect(run('open beamline').effect).toEqual({ type: 'navigate', href: '/beamline/' });
    expect(completeInput('edges fe')).toEqual({ input: 'edges Fe ', options: [] });
    expect(text(run('mu Fe 7.8 7200'))).toContain('have not loaded');
  });
});

describe('lab console commands', () => {
  beforeAll(loadXrayData);

  it('lists every command and gives detailed help', () => {
    for (const command of COMMANDS) {
      expect(text(run('help'))).toContain(command.usage);
      expect(run(`help ${command.name}`).lines[0]).toEqual({ kind: 'title', text: command.usage });
    }
    expect(text(run('help plna'))).toContain('Did you mean plan?');
    expect(text(run('halp'))).toContain('Did you mean help?');
    expect(text(run('nonsense'))).toContain('Unknown command');
    expect(run(' \t\n ')).toEqual({ lines: [] });
    expect(run(' HELP ')).toEqual(run('help'));
  });

  it.each(['help a b', 'edges', 'edges Fe O', 'mu Fe 5', 'plan Fe 5 Fe', 'sample Fe', 'open', 'clear now', 'python Fe'])('explains argument errors for %s', command => {
    expect(run(command)).toMatchObject({ lines: [{ kind: 'error' }] });
    expect(text(run(command))).toContain('needs');
    expect(run(command).effect).toBeUndefined();
  });

  it('bounds command size and explains formula whitespace', () => {
    expect(text(run('x'.repeat(1001)))).toContain('under 1000');
    expect(text(run('plan CuSO4 · 5H2O 2.286 Cu K'))).toContain('without spaces');
    expect(text(run(`sample ${'Fe'.repeat(121)} 5`))).toContain('240 characters');
  });

  it('lists real edges, yields and table limits for elements H to Cf', () => {
    expect(text(run('edges fe'))).toContain('K: 7,112 eV fluorescence yield');
    expect(text(run('edges Fe'))).toContain('Iron · Z = 26');
    expect(text(run('edges H'))).toContain('outside the 100 eV to 100 keV tables');
    expect(text(run('edges Cf'))).toContain('Californium');
    expect(text(run('edges Es'))).toContain('not an element symbol');
    expect(text(run('edges Fe2O3'))).toContain('one symbol from H to Cf');
  });

  it.each(['7112', '7112eV', '7.112keV', '7.112 keV', '7.112 KEV', '7.112e3'])('accepts photon energy %s in the correct units', energy => {
    const result = run(`mu Fe2O3 5.26 ${energy}`);
    const expected = mu('Fe2O3', 5.26, 7112);
    expect(value(result, 'μ total')).toMatchObject({ value: `${formatNumber(expected.total)} cm⁻¹` });
    expect(value(result, 'μ photoabsorption')).toMatchObject({ value: `${formatNumber(expected.photo)} cm⁻¹` });
    expect(value(result, 'μ/ρ total')).toMatchObject({ value: `${formatNumber(expected.total / 5.26)} cm²/g` });
    expect(value(result, 'attenuation length')).toMatchObject({ value: `${formatNumber(1e4 / expected.total)} μm` });
  });

  it.each(['NaN', 'Infinity', '1e309', '-1', '0', '1001', '5kg'])('rejects density %s without effects', density => {
    const result = run(`sample Fe2O3 ${density} Fe K`);
    expect(result).toMatchObject({ lines: [{ kind: 'error' }] });
    expect(result.effect).toBeUndefined();
  });

  it.each(['NaN', '0', '-7112', '100001', 'Infinity', '1e309', '7.2MeV', '7200eV keV'])('rejects photon energy %s', energy => {
    expect(run(`mu Fe2O3 5.26 ${energy}`)).toMatchObject({ lines: [{ kind: 'error' }] });
  });

  it('suggests keV for small unitless energies and accepts table endpoints and density units', () => {
    expect(text(run('mu Fe2O3 5.26 7.112'))).toContain('write 7.112keV');
    expect(text(run('mu Fe2O3 -5 7112'))).toContain('−5');
    for (const unit of ['g/cm3', 'g/cm³', 'g/cm^3']) expect(run(`mu Fe2O3 5.26${unit} 7112`)).toEqual(run('mu Fe2O3 5.26 7112'));
    for (const energy of [100, 100000]) expect(run(`mu Fe 7.8 ${energy}`).lines.some(line => line.kind === 'error')).toBe(false);
  });

  it('parses brackets and hydrates, and distinguishes CO from Co', () => {
    for (const formula of ['Ca3(PO4)2', '[Cu(NH3)4]SO4', 'CuSO4·5H2O']) {
      expect(run(`mu ${formula} 2.5 7200`).lines[0].kind).toBe('title');
    }
    expect(value(run('mu CO 1 7200'), 'μ total')).not.toEqual(value(run('mu Co 1 7200'), 'μ total'));
    expect(text(run('mu fe2o3 5 7200'))).toContain('cannot start an element symbol');
    expect(text(run('mu Qq2O3 5 7200'))).toContain('Unknown element');
  });

  it('uses the existing planner, including the total absorption limit and mode advice', () => {
    for (const sample of [iron, { ...iron, formula: 'Fe0.002(SiO2)0.998', density: 2.65 }, { ...iron, absorber: 'O' }]) {
      const result = run(`plan ${sample.formula} ${sample.density} ${sample.absorber} ${sample.edge}`);
      const info = samplePlan(sample);
      expect(value(result, 'thickness')).toMatchObject({ value: `${formatNumber(info.plan!.thickness_um)} μm` });
      expect(value(result, 'mass per area')).toMatchObject({ value: `${formatNumber(info.plan!.massPerArea_mg_cm2)} mg/cm²` });
      expect(value(result, 'suggested mode')).toMatchObject({ value: info.mode!.mode });
      expect(text(result)).toContain(info.mode!.reason);
      expect(result.effect).toBeUndefined();
    }
    expect(run('plan')).toEqual(run('plan Fe2O3 5.26 Fe K'));
    expect(text(run('plan Fe0.002(SiO2)0.998 2.65 Fe K'))).toContain('limited by total absorption');
  });

  it('handles edges outside the tables and edges without jumps', () => {
    expect(text(run('plan H2O 1 H K'))).toContain('no thickness can be planned');
    expect(value(run('plan Fe2O3 5.26 Fe L2'), 'thickness')).toBeDefined();
    // Tl N6 is listed at 122.2 eV but has no discontinuity in the Elam table.
    const result = run('plan Tl 11.85 Tl N6');
    expect(result.lines.some(line => line.kind === 'error')).toBe(false);
    expect(value(result, 'thickness')).toBeUndefined();
    expect(text(result)).toContain('No tabulated jump');
  });

  it('sets samples using shared validation and resets the beamline energy', () => {
    const result = run('sample LiCoO2 5.05 co k');
    expect(result.effect).toEqual({ type: 'sample', sample: { formula: 'LiCoO2', density: 5.05, absorber: 'Co', edge: 'K', preset: null }, energy: 7709 });
    if (result.effect?.type === 'sample') expect(validateSample(result.effect.sample)).toEqual(result.effect.sample);
    expect(context.sample).toEqual(iron);
    expect(run('sample H2O 1 H K').effect).toMatchObject({ energy: 100 });
    expect(run('sample Cf 15 Cf K').effect).toMatchObject({ energy: 100000 });
  });

  it('matches the Sample page absorber and edge defaults', () => {
    expect(run('sample Fe2O3 5.26').effect).toMatchObject({ sample: iron });
    expect(runCommand('sample Fe2O3 5.26', { sample: { ...iron, absorber: 'O' }, energy: 543.1 }).effect).toMatchObject({ sample: { absorber: 'O', edge: 'K' } });
    expect(runCommand('sample LiCoO2 5.05', { sample: DEFAULT_SAMPLE, energy: 6550 }).effect).toMatchObject({ sample: { absorber: 'Co', edge: 'K' } });
    expect(run('sample UO2 10.97 U').effect).toMatchObject({ sample: { edge: defaultEdge('UO2', 'U')!.edge } });
    expect(defaultEdge('UO2', 'U')!.edge).toBe('L3');
  });

  it.each(['sample Fe2O3 5.26 Co K', 'sample Fe2O3 5.26 Fe L9', 'sample Fe2O3 5.26 Fe L', 'sample Qq2 5', 'sample Fe999999999999999 5'])('rejects invalid sample %s without mutating context', command => {
    expect(run(command)).toMatchObject({ lines: [{ kind: 'error' }] });
    expect(run(command).effect).toBeUndefined();
    expect(context.sample).toEqual(iron);
  });

  it('navigates only to known modules and clears with an explicit effect', () => {
    for (const module of MODULES) expect(run(`open ${module.name.toUpperCase()}`).effect).toEqual({ type: 'navigate', href: module.href });
    expect(run('open crystal').effect).toEqual(run('open sample').effect);
    expect(run('open https://example.com').effect).toBeUndefined();
    expect(text(run('open unknown'))).toContain('Choose one of overview, sample');
    expect(run('clear')).toEqual({ lines: [], effect: { type: 'clear' } });
  });
});

describe('completion and readable numbers', () => {
  it('completes commands, elements, sample absorbers and module names', () => {
    for (const [input, expected] of [['ed', 'edges '], ['  he', '  help '], ['help py', 'help python '], ['edges fe', 'edges Fe '], ['mu fe', 'mu Fe '], ['sample fe', 'sample Fe '], ['open be', 'open beamline '], ['sample Fe2O3 5 f', 'sample Fe2O3 5 Fe '], ['plan LiCoO2 5 c', 'plan LiCoO2 5 Co ']]) {
      expect(completeInput(input)).toEqual({ input: expected, options: [] });
    }
    expect(completeInput('')).toEqual({ input: '', options: COMMANDS.map(c => c.name) });
    expect(completeInput('edges C').options).toContain('Co');
    expect(completeInput('sample Fe2O3 5 ').options).toEqual(['Fe', 'O']);
    expect(completeInput('edges xx')).toEqual({ input: 'edges xx', options: [] });
    expect(completeInput('mu Fe2O3 5 ')).toEqual({ input: 'mu Fe2O3 5 ', options: [] });
    expect(completeInput('plan invalid 5 fe').input).toBe('plan invalid 5 Fe ');
  });

  it('prints true minus signs and scientific exponents', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-1.23456)).toBe('−1.235');
    expect(formatNumber(1234.56)).toBe('1,235');
    expect(formatNumber(0.000012345)).toBe('1.234×10⁻⁵');
    expect(formatNumber(-1e7)).toBe('−1×10⁷');
    expect(formatNumber(0.001)).toBe('0.001');
    expect(formatNumber(Infinity)).toBe('Infinity');
  });

  it('preserves case-sensitive compounds when completing a formula', () => {
    for (const command of ['mu', 'plan', 'sample']) {
      for (const formula of ['CO', 'NO', 'CN', 'Fe2O3']) {
        const input = `${command} ${formula}`;
        expect(completeInput(input)).toEqual({ input, options: [] });
      }
    }
    expect(completeInput('mu co')).toEqual({ input: 'mu Co ', options: [] });
  });
});

describe('Python export', () => {
  beforeAll(loadXrayData);
  it('returns runnable source, a safe filename and current context numbers', () => {
    const script = pythonScript(iron, 7120);
    expect(script.filename).toBe('xas_fe2o3_fe_k.py');
    expect(script.code).toContain('energy = 7120');
    expect(script.code).toContain("xraydb.material_mu(formula, energy, density=density, kind='total')");
    expect(script.code).toContain('xraydb.xray_edge(absorber, edge)');
    expect(script.code).toContain('d_cm = 1 / delta_mu');
    expect(script.code).toContain('d_cm = 3 / mu_above');
    expect(script.code).toContain('density * d_cm * 1000');
    expect(run('python').lines.some(line => line.kind === 'code' && line.filename === script.filename)).toBe(true);
    expect(() => pythonScript(iron, NaN)).toThrow();
  });

  it.each([
    ['CO', 'C', 'C1O1'], ['Co', 'Co', 'Co1'], ['LiCoO2', 'Co', 'Li1Co1O2'],
    ['CuSO4·5H2O', 'Cu', 'Cu1S1O9H10'], ['[Cu(NH3)4]SO4', 'Cu', 'Cu1N4H12S1O4'],
    ['Fe0.000000000000000001O', 'Fe', 'Fe0.000000000000000001O1'],
  ])('writes explicit decimal counts for %s', (formula, absorber, flat) => {
    expect(pythonScript({ ...iron, formula, absorber }, 7200).code).toContain(`formula = '${flat}'`);
  });

  it('omits thickness for an edge outside the supported range', () => {
    const script = pythonScript({ ...iron, formula: 'H2O', absorber: 'H', density: 1 }, 100);
    expect(script.code).toContain('# No thickness plan: this edge');
    expect(script.code).not.toContain('d_cm =');
    expect(script.code).toContain('xraydb.material_mu');
  });

  it('omits thickness for a listed edge with no discontinuity', () => {
    const script = pythonScript({ ...iron, formula: 'Tl', absorber: 'Tl', edge: 'N6', density: 11.85 }, 1000);
    expect(script.code).toContain('# No thickness plan: the tables have no jump');
    expect(script.code).not.toContain('d_cm =');
  });
});
