import { beforeAll, describe, expect, it } from 'vitest';
import { loadXrayData } from '@/lib/xraydata';
import { seededRandom } from '@/lib/xas';
import { loadOptics, mirrorReflectivity } from '@/lib/twin/tables';
import { DEFAULT_STATE, applyCommand, status } from '@/lib/twin/twin';
import type { TwinState } from '@/lib/twin/types';
import { SAMPLE_PRESETS } from '@/lib/twin/presets';
import { comptonShifted } from '@/lib/twin/compton';
import { electronRangeInGas_cm } from '@/lib/twin/ionization';
import { CHAMBERS, CHAMBER_PLATE_OFFSET, XS } from './hutch-parts';
import { YB } from '../scene-kit';
import { COLOR_RANGE_eV, ELECTRON_DRIFT, ION_SLOWER, PhotonSim, SLOW_MOTION, TRACK_SCALE, WHITE_RATE, absorptionDepth, beamEnvelope, boost, dipoleScatter, energyColor, escapeChance, photonSetup, secondCrystalX, type PhotonSetup } from './photon-sim';

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

  it('lets fluorescence out of a thick sample with the analytic self-absorption share', () => {
    // A thick slab, beam at 45 degrees, photons leaving at 60 degrees to the normal: the share that gets out is
    // (mu_in / cos_in) / (mu_in / cos_in + mu_line / cos_out), whatever the absolute attenuations.
    const random = seededRandom(9), muIn = 400, muLine = 150, cosIn = Math.SQRT1_2, cosOut = 0.5, thick = 1;
    let out = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) if (random() < escapeChance(absorptionDepth(random, muIn, thick, cosIn), thick, cosOut, muLine)) out++;
    const expected = (muIn / cosIn) / (muIn / cosIn + muLine / cosOut);
    expect(Math.abs(out / n - expected)).toBeLessThan(4 * Math.sqrt(expected * (1 - expected) / n));
    // Out of the back of a thin slab, and never along the plane.
    expect(escapeChance(0, 1e-4, -1, 100)).toBeCloseTo(Math.exp(-0.01), 12);
    expect(escapeChance(5e-5, 1e-4, 0, 100)).toBe(0);
  });

  it('loses much of the fluorescence inside a thick concentrated pellet, and little inside a thin film', () => {
    const fluo = applyCommand(DEFAULT_STATE, { type: 'mode', mode: 'fluorescence' }).state;
    const share = (state: TwinState) => {
      const { setup } = setupFor(state), sim = new PhotonSim(setup, seededRandom(6));
      let drawn = 0;
      const seen = new Set<object>();
      for (let t = 0; t < 40; t += 1 / 30) { sim.step(1 / 30); for (const p of sim.packets) if (p.species === 'fluorescence' && !seen.has(p)) { seen.add(p); drawn++; } }
      return sim.selfAbsorbed / (sim.selfAbsorbed + drawn);
    };
    const pellet = share(applyCommand(fluo, { type: 'samplePreset', id: 'nio-pellet' }).state);
    const film = share(applyCommand(applyCommand(fluo, { type: 'samplePreset', id: 'nio-pellet' }).state, { type: 'thickness', thickness_um: 0.05 }).state);
    expect(pellet).toBeGreaterThan(0.45);
    expect(film).toBeLessThan(0.1);
  });

  it('replays light about 10^8 times slower, clock and all: one scene unit a centimetre at SPEED a second', () => {
    expect(SLOW_MOTION).toBeCloseTo(299_792_458 / 2.6, -3);
    expect(SLOW_MOTION).toBeGreaterThan(1e8);
    expect(SLOW_MOTION).toBeLessThan(1.2e8);
  });

  it('makes a dot the photons that cross I0 in its share of the slowed time, about a hundred at a bending magnet', () => {
    const { live, setup } = setupFor(DEFAULT_STATE), sim = new PhotonSim(setup, seededRandom(4));
    sim.prewarm(6);
    // Fundamental packets entering I0 in 20 s of the drawing, counted as they cross its front.
    const crossed = new Set<object>();
    for (let t = 0; t < 20; t += 1 / 60) {
      sim.step(1 / 60);
      for (const p of sim.packets) if (p.species === 'beam' && p.order === 0 && p.x >= CHAMBERS.I0.x0) crossed.add(p);
    }
    const perSecond = crossed.size / 20;
    // The photons that really cross I0 in one second of the drawing, shared by the packets that do.
    expect(setup.photonsPerPacket * perSecond / (live.flux! / SLOW_MOTION)).toBeCloseTo(1, 1);
    expect(setup.photonsPerPacket).toBeGreaterThan(50);
    expect(setup.photonsPerPacket).toBeLessThan(500);
  });

  it('lets photons arrive at random, with Poisson shot noise', () => {
    const { setup } = setupFor(DEFAULT_STATE), sim = new PhotonSim(setup, seededRandom(5));
    const seen = new Set<object>(), counts: number[] = [];
    for (let window = 0; window < 300; window++) {
      let n = 0;
      for (let f = 0; f < 6; f++) {
        sim.step(1 / 60);
        for (const p of sim.packets) if (p.species === 'white' && !seen.has(p)) { seen.add(p); n++; }
      }
      counts.push(n);
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / (counts.length - 1);
    expect(mean / (WHITE_RATE * 0.1)).toBeCloseTo(1, 1);
    // A Poisson count's variance equals its mean; evenly spaced arrivals would give almost none.
    expect(variance / mean).toBeGreaterThan(0.8);
    expect(variance / mean).toBeLessThan(1.25);
  });

  it('emits in bursts as each bunch passes, at the same average rate', () => {
    const { setup } = setupFor(DEFAULT_STATE), sim = new PhotonSim(setup, seededRandom(2));
    sim.pulse = { hz: 4, phase_s: 0.1 };
    const seen = new Set<object>();
    let total = 0, framesWithLight = 0;
    for (let i = 1; i <= 600; i++) {
      sim.step(1 / 60, i / 60);
      // Packets that left the source this frame: white ones not seen before.
      const fresh = sim.packets.filter(p => p.species === 'white' && !seen.has(p));
      fresh.forEach(p => seen.add(p));
      if (fresh.length) framesWithLight++;
      total += fresh.length;
    }
    // Ten seconds at four bunches a second: light in about 40 of the 600 frames, and the steady rate on average, give or
    // take the arrivals still waiting for the next bunch (a quarter second's worth) and three standard deviations of
    // Poisson noise.
    expect(framesWithLight).toBeGreaterThanOrEqual(39);
    expect(framesWithLight).toBeLessThanOrEqual(41);
    expect(Math.abs(total - 10 * WHITE_RATE)).toBeLessThan(WHITE_RATE / 4 + 3 * Math.sqrt(10 * WHITE_RATE));
  });

  it('Compton scatters the share the tables give, each photon at the energy its angle sets', () => {
    // Fe in 2 mm of water: the scatter comes mostly from the water, so about a quarter of it is Compton at 7 keV.
    const state = applyCommand(DEFAULT_STATE, { type: 'samplePreset', id: 'fe-2mm-water' }).state;
    const { setup } = setupFor(state), sim = new PhotonSim(setup, seededRandom(8));
    let compton = 0, elastic = 0;
    const seen = new Set<object>();
    for (let t = 0; t < 300; t += 1 / 30) {
      sim.step(1 / 30);
      for (const p of sim.packets) {
        if (p.species !== 'scatter' || seen.has(p)) continue;
        seen.add(p);
        // Each order (the fundamental or a harmonic) scatters at its own energy.
        if (setup.orders.some(o => Math.abs(p.energy_eV - o.energy_eV) < 1e-6)) elastic++;
        else { compton++; expect(setup.orders.some(o => Math.abs(p.energy_eV - comptonShifted(o.energy_eV, p.dir[0])) < 1e-6)).toBe(true); }
      }
    }
    const n = compton + elastic, share = setup.sample.compton[0];
    expect(share).toBeGreaterThan(0.2);
    expect(n).toBeGreaterThan(200);
    // Harmonics also scatter, so allow their small part on top of counting error.
    expect(Math.abs(compton / n - share)).toBeLessThan(4 * Math.sqrt(share * (1 - share) / n) + 0.03);
  });

  it('leaves a photoelectron track as long as its range in the gas, and pairs that drift to the plates', () => {
    const { setup } = setupFor(DEFAULT_STATE), sim = new PhotonSim(setup, seededRandom(12));
    const seenTracks = new Set<object>(), seenCarriers = new Set<object>();
    let gasTracks = 0, electrons = 0, ions = 0;
    for (let t = 0; t < 15; t += 1 / 30) {
      sim.step(1 / 30);
      for (const track of sim.tracks) {
        if (seenTracks.has(track) || track.life < 0.5) continue;
        seenTracks.add(track); gasTracks++;
        const length = track.points.slice(1).reduce((sum, q, i) => sum + Math.hypot(q[0] - track.points[i][0], q[1] - track.points[i][1], q[2] - track.points[i][2]), 0);
        // The chamber the track sits in, and the range of a photoelectron of the fundamental's energy in its gas.
        const stage = setup.stages.find(s => s.kind === 'chamber' && track.points[0][0] >= s.x0 - 1e-9 && track.points[0][0] <= s.x1 + 1e-9)!;
        const expected = setup.orders.map(o => electronRangeInGas_cm(o.energy_eV, stage.gas!) * TRACK_SCALE);
        // Full length, unless the electron reached a plate first.
        expect(expected.some(e => Math.abs(length - e) < 1e-9 * e) || length < Math.max(...expected)).toBe(true);
      }
      for (const c of sim.carriers) {
        if (seenCarriers.has(c)) continue;
        seenCarriers.add(c);
        if (c.kind === 'electron') { electrons++; expect(c.vy).toBeGreaterThan(0); } else { ions++; expect(c.vy).toBeCloseTo(-ELECTRON_DRIFT / ION_SLOWER, 12); }
        // Every carrier starts between the plates and heads for its own.
        expect(Math.abs(c.at[1] - YB)).toBeLessThan(CHAMBER_PLATE_OFFSET);
      }
    }
    expect(gasTracks).toBeGreaterThan(20);
    expect(electrons).toBe(ions);
    // About E / W / PAIRS_PER_DOT carriers of each sign per absorbed photon: 9 keV in the 50/50 Ar and N2 fill gives about 10.
    expect(electrons / gasTracks).toBeGreaterThan(5);
    expect(electrons / gasTracks).toBeLessThan(16.0001);
  });

  it('draws each absorption in the sample at its depth inside the drawn sample', () => {
    const state = applyCommand(DEFAULT_STATE, { type: 'samplePreset', id: 'nio-pellet' }).state;
    const { setup } = setupFor(state), sim = new PhotonSim(setup, seededRandom(13));
    const front = XS - setup.sample.drawnThickness_cm / Math.cos(setup.sample.rotation);
    let seen = 0;
    const counted = new Set<object>();
    for (let t = 0; t < 10; t += 1 / 30) {
      sim.step(1 / 30);
      for (const f of sim.flashes) if (f.kind === 'absorb' && !counted.has(f)) { counted.add(f); seen++; expect(f.at[0]).toBeGreaterThanOrEqual(front - 1e-9); expect(f.at[0]).toBeLessThanOrEqual(XS + 1e-9); }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('builds the photons of every sample: its orders, its fluorescence line and its slab', () => {
    for (const preset of SAMPLE_PRESETS) {
      const state = applyCommand(DEFAULT_STATE, { type: 'samplePreset', id: preset.id }).state;
      const live = status(state), setup = photonSetup(state, live, live.theta_deg! * Math.PI / 180);
      expect(setup, preset.id).not.toBeNull();
      expect(setup!.sample.line, preset.id).not.toBeNull();
      expect(setup!.sample.line!.energy_eV, preset.id).toBeLessThan(setup!.orders[0].energy_eV);
      expect(setup!.sample.slab.thickness_cm, preset.id).toBeGreaterThan(0);
      expect(setup!.sample.drawnThickness_cm, preset.id).toBeGreaterThanOrEqual(setup!.sample.slab.thickness_cm - 1e-12);
    }
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
