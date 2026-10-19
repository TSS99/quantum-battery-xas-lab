import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMPOUND_PRESETS } from '@/data/compound-presets';
import { loadXrayData } from '@/lib/xraydata';
import type { Sample } from '@/lib/sample';
import { samplePreparation } from '@/lib/sample-prep';
import { PrepSteps } from './sample-prep-scene';

beforeAll(async () => { await loadXrayData(); });
const preset = (id: string): Sample => {
  const p = COMPOUND_PRESETS.find(p => p.id === id)!;
  return { formula: p.formula, density: p.density, absorber: p.absorber, edge: p.edge, preset: p.id };
};
const render = (sample: Sample, dilute = false) => {
  const prep = samplePreparation(sample)!;
  return { prep, html: renderToStaticMarkup(createElement(PrepSteps, { sample, prep, dilute })) };
};

describe('sample preparation scene', () => {
  it('puts the plan numbers for a pellet in the captions and keeps every drawing hidden', () => {
    const { prep, html } = render(preset('fe2o3-hematite'));
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain(prep.plan.sampleMass_mg.toPrecision(3));
    expect(html).toContain(prep.plan.diluent!.mass_mg.toPrecision(3));
    expect(html).toContain(prep.plan.thickness_um.toPrecision(3));
    expect(html).toContain(prep.plan.massPerArea_mg_cm2.toPrecision(3));
    expect(html).toContain('boron nitride');
    expect(html.match(/<svg[^>]*>/g)!.every(tag => tag.includes('aria-hidden="true"'))).toBe(true);
    expect(html.match(/id="bl-front"/g)).toHaveLength(1);
    expect(html).not.toContain('katex-error');
    // Numbers belong in the legend, not inside the drawings.
    for (const svg of html.match(/<svg.*?<\/svg>/gs)!) expect(svg).not.toMatch(/<text/);
  });

  it('describes foils, soft-edge films and cells with their own steps', () => {
    expect(render(preset('cu-foil')).html.match(/<li>/g)).toHaveLength(2);
    const film = render(preset('sio2-quartz')).html;
    expect(film).toContain('A thin film');
    expect(film).toContain('Transmission is hard here');
    const water = render(preset('water')).html;
    expect(water).toContain('A liquid cell');
    expect(water).toContain('Transmission is hard here');
    const gas = render(preset('n2-gas')).html;
    expect(gas).toContain('A gas cell');
    expect(gas).toContain('halving the pressure doubles it');
    for (const html of [film, water, gas]) expect(html).not.toContain('katex-error');
  });

  it('warns when a pellet is lighter than usual and when transmission is a poor choice', () => {
    const { html } = render({ formula: 'Fe0.002(SiO2)0.998', density: 2.65, absorber: 'Fe', edge: 'K', preset: null }, true);
    expect(html).toContain('Kapton tape');
    expect(html).toContain('Fluorescence is likely the better choice');
    expect(html).not.toContain('boron nitride');
  });
});
