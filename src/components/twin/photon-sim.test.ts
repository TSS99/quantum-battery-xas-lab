import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '@/lib/xraydata';
import { seededRandom } from '@/lib/xas';
import { loadOptics, mirrorReflectivity } from '@/lib/twin/tables';
import { DEFAULT_STATE, applyCommand, status } from '@/lib/twin/twin';
import type { TwinState } from '@/lib/twin/types';
import { XS } from './hutch-parts';
import { COLOR_RANGE_eV, PhotonSim, beamEnvelope, boost, dipoleScatter, energyColor, photonSetup, secondCrystalX, type PhotonSetup } from './photon-sim';

beforeAll(async () => { await Promise.all([loadXrayData(), loadOptics()]); });

const setupFor = (state: TwinState) => {
  const live = status(state), setup = photonSetup(state, live, live.theta_deg! * Math.PI / 180);
  if (!setup) throw new Error('no beam');
  return { live, setup };
};
const survive = (setup: PhotonSetup, upTo: string, order = 0) => {
  let r = 1;
  for (const s of setup.stages) { if (s.id === upTo) break; r *= 1 - s.remove[order]; }
  return r;
};
const run = (state: TwinState, seconds: number, seed = 1) => {
  const { setup } = setupFor(state), sim = new PhotonSim(setup, seededRandom(seed));
  const ends = new Map<string, number>(), secondaries = { fluorescence: 0, scatter: 0, detected: 0 };
  // Count every packet's end by wrapping step: packets that vanish after reaching their end have ended there.
  const seen = new Set<object>();
  for (let t = 0; t < seconds; t += 1 / 30) {
    sim.step(1 / 30);
    for (const p of sim.packets) {
      // A white packet becomes a beam packet at the first crystal, so count it then.
      if (seen.has(p) || p.species === 'white') continue;
      seen.add(p);
      if (p.species === 'beam' && p.end) ends.set(p.end.stage, (ends.get(p.end.stage) ?? 0) + 1);
      if (p.species === 'fluorescence' || p.species === 'scatter') { secondaries[p.species]++; if (p.limit < 260) secondaries.detected++; }
    }
  }
  return { setup, ends, secondaries };
};

describe('photon packets in the 3D hutch', () => {
  it('colours energies on a false scale from red to violet', () => {
    const [r, , b] = energyColor(COLOR_RANGE_eV[0]), [r2, , b2] = energyColor(COLOR_RANGE_eV[1]);
    expect(r).toBeGreaterThan(b);
    expect(b2).toBeGreaterThan(r2 * 0.9);
  });

  it('removes packets at each stage with exactly the probabilities behind the readouts', () => {
    for (const state of [DEFAULT_STATE, applyCommand(DEFAULT_STATE, { type: 'samplePreset', id: 'limn2o4-pellet' }).state]) {
      const { live, setup } = setupFor(state);
      // Through I0, the sample, It and the foil the fundamental keeps what status() says.
      const at = (id: string) => survive(setup, id) / survive(setup, 'I0');
      expect(at('sample')).toBeCloseTo(live.afterI0, 10);
      expect(at('It')).toBeCloseTo(live.afterSample, 10);
      const afterIt = setup.stages.find(s => s.id === 'reference-foil') ? at('reference-foil') : at('Iref');
      expect(afterIt).toBeCloseTo(live.afterIt, 10);
    }
  });

  it('lets the Monte Carlo reproduce the sample transmission within counting error', () => {
    const state = applyCommand(DEFAULT_STATE, { type: 'thickness', thickness_um: 10 }).state;
    const { setup, ends } = run(state, 120, 7);
    const passed = [...ends].filter(([stage]) => !['second-crystal', 'M2', 'M3', 'I0', 'sample'].includes(stage)).reduce((a, [, n]) => a + n, 0);
    const reached = passed + (ends.get('sample') ?? 0);
    const t = 1 - setup.stages.find(s => s.id === 'sample')!.remove[0], n = reached;
    expect(Math.abs(passed / n - t)).toBeLessThan(4 * Math.sqrt(t * (1 - t) / n) + 0.01);
  });

  it('absorbs most of the white beam at the slits and the first crystal, and high energies at the collimating mirror', () => {
    const { setup } = setupFor(DEFAULT_STATE);
    expect(setup.slitShare).toBeCloseTo(0.25, 6);
    expect(setup.collimating!(5000)).toBeGreaterThan(0.8);
    expect(setup.collimating!(40000)).toBeLessThan(0.01);
    expect(setup.whitePerSelected).toBeGreaterThan(500);
    expect(setup.orders[0].energy_eV).toBeCloseTo(DEFAULT_STATE.energy_eV, 6);
    expect(setup.c2x).toBeCloseTo(secondCrystalX(status(DEFAULT_STATE).theta_deg! * Math.PI / 180), 6);
  });

  it('carries harmonics in the shares the beam model gives, and the harmonic rejection mirror removes them', () => {
    const out = setupFor(DEFAULT_STATE).setup;
    expect(out.orders.length).toBeGreaterThan(1);
    expect(out.orders[1].energy_eV).toBeCloseTo(3 * out.orders[0].energy_eV, 0);
    const inserted = setupFor(applyCommand(DEFAULT_STATE, { type: 'mirror', id: 'M3', inserted: true }).state).setup;
    const m3 = inserted.stages.find(s => s.id === 'M3')!;
    expect(m3.remove[1]).toBeGreaterThan(0.9);
    expect(m3.remove[0]).toBeCloseTo(1 - mirrorReflectivity('Si', inserted.orders[0].energy_eV > 0 ? DEFAULT_STATE.profile.mirrors[2].angle_mrad : 0, inserted.orders[0].energy_eV), 1);
    // A thick sample stops the fundamental but lets more of the harmonic through.
    const thick = setupFor(applyCommand(DEFAULT_STATE, { type: 'thickness', thickness_um: 60 }).state).setup.stages.find(s => s.id === 'sample')!;
    expect(1 - thick.remove[1]).toBeGreaterThan(1 - thick.remove[0]);
  });

  it('emits fluorescence in every direction and scatters mostly out of the horizontal plane', () => {
    const random = seededRandom(3);
    let towardDetector = 0;
    for (let i = 0; i < 20000; i++) if (Math.abs(dipoleScatter(random)[2]) > 0.9) towardDetector++;
    // Isotropic would put 10 % within |cos| > 0.9; the dipole pattern of a horizontally polarised beam about 1.4 %.
    expect(towardDetector / 20000).toBeLessThan(0.025);
    const state = applyCommand(DEFAULT_STATE, { type: 'mode', mode: 'fluorescence' }).state;
    const { secondaries, setup } = run(applyCommand(state, { type: 'samplePreset', id: 'nio-pellet' }).state, 120, 5);
    expect(secondaries.fluorescence).toBeGreaterThan(100);
    // The detector catches about its solid angle of the isotropic fluorescence.
    expect(secondaries.detected / secondaries.fluorescence).toBeGreaterThan(setup.detector.fraction * 0.4);
    expect(secondaries.detected / secondaries.fluorescence).toBeLessThan(setup.detector.fraction * 2.5);
    expect(setup.sample.line!.energy_eV).toBeLessThan(setup.orders[0].energy_eV);
    expect(setup.sample.rotation).toBeCloseTo(Math.PI / 4, 6);
  });

  it('lets the crystals filter the white beam without changing any packet energy', () => {
    const { setup } = setupFor(DEFAULT_STATE), sim = new PhotonSim(setup, seededRandom(11));
    const drawn = new Map<object, number>();
    let passed = 0;
    for (let t = 0; t < 20; t += 1 / 30) {
      sim.step(1 / 30);
      for (const p of sim.packets) {
        if (p.species === 'white' && p.order >= 0) drawn.set(p, p.energy_eV);
        if (p.species === 'beam' && drawn.has(p)) { expect(p.energy_eV).toBe(drawn.get(p)); drawn.delete(p); passed++; }
      }
    }
    expect(passed).toBeGreaterThan(500);
    // White packets that end at the first crystal carry energies from the whole spectrum, not the mono's.
    const heat = sim.packets.filter(p => p.species === 'white' && p.order < 0);
    expect(new Set(heat.map(p => Math.round(p.energy_eV / 1000))).size).toBeGreaterThan(5);
  });

  it('lets a rocking second crystal pass what its throughput says right now', () => {
    const state = applyCommand(DEFAULT_STATE, { type: 'thickness', thickness_um: 10 }).state;
    const { setup } = setupFor(state), sim = new PhotonSim(setup, seededRandom(4));
    sim.secondCrystalPass = setup.orders.map(() => 0.25);
    let atCrystal = 0, beyond = 0;
    const seen = new Set<object>();
    for (let t = 0; t < 60; t += 1 / 30) {
      sim.step(1 / 30);
      for (const p of sim.packets) {
        if (p.species !== 'beam' || seen.has(p)) continue;
        seen.add(p);
        if (p.end?.stage === 'second-crystal') atCrystal++; else beyond++;
      }
    }
    const n = atCrystal + beyond;
    expect(Math.abs(beyond / n - 0.25)).toBeLessThan(4 * Math.sqrt(0.25 * 0.75 / n));
  });

  it('boosts rare events by a round factor and says so', () => {
    expect(boost(20, 14)).toBe(1);
    expect(boost(0.07, 14)).toBe(200);
    expect(boost(1e-9, 14)).toBe(1000);
  });

  it('narrows the beam to the profile spot at the sample, crossing over past the focus', () => {
    const env = beamEnvelope(DEFAULT_STATE);
    expect(env.focusX).toBe(XS);
    expect(env.real(XS).width_mm).toBeCloseTo(0.5, 6);
    expect(env.real(XS).height_mm).toBeCloseTo(0.2, 6);
    expect(env.real(700).width_mm).toBeGreaterThan(env.real(XS).width_mm * 20);
    expect(Math.sign(env.width(XS + 200))).toBe(-1);
    // The undulator profile has no collimating mirror; its beam stays much narrower.
    const und = beamEnvelope(applyCommand(DEFAULT_STATE, { type: 'profile', id: 'und6' }).state);
    expect(und.real(700).width_mm).toBeLessThan(env.real(700).width_mm / 5);
  });
});
