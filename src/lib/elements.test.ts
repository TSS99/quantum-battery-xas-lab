import { beforeAll, describe, expect, it } from 'vitest';
import table from '@/data/xray/elements.json';
import { COMPOUND_PRESETS } from '@/data/compound-presets';
import { ELEMENTS, compoundsWith, defaultEdge, edgeBand, elementBySlug, elementLabPath, formatEnergy, scannableEdges, tablePosition } from './elements';
import { DEFAULT_STATE, elementFromURL, scenarioFromURL, selectElement, validateScenario } from './scenario';
import { resolveSample } from './sample';
import { ELEMENT_SYMBOLS, loadXrayData, parseFormula } from './xraydata';

beforeAll(async () => { await loadXrayData(); });

describe('tabulated element references', () => {
  it('contains every element from H to Cf exactly once in atomic-number order', () => {
    expect(ELEMENTS).toHaveLength(98);
    expect(ELEMENTS.map(el => el.Z)).toEqual(Array.from({ length: 98 }, (_, i) => i + 1));
    expect(ELEMENTS.map(el => el.symbol)).toEqual(ELEMENT_SYMBOLS);
    expect(new Set(ELEMENTS.map(el => el.slug)).size).toBe(98);
    for (const el of ELEMENTS) expect(elementBySlug(el.slug)).toBe(el);
    for (const slug of ['Fe', 'og', '../fe', 'constructor', '']) expect(elementBySlug(slug)).toBeUndefined();
  });

  it('preserves every edge, mass and name from the source table without rounding', () => {
    for (const [i, el] of ELEMENTS.entries()) {
      const source = table.elements[i];
      expect([el.name, el.molarMass]).toEqual([source.name, source.mass]);
      expect(el.edges.map(e => [e.edge, e.energy_eV, e.jumpRatio, e.fluorescenceYield])).toEqual(source.edges);
      for (const edge of el.edges) expect(Number(formatEnergy(edge.energy_eV).replaceAll(',', ''))).toBe(edge.energy_eV);
    }
    expect(elementBySlug('fe')!.edges.find(e => e.edge === 'K')!.energy_eV).toBe(7112);
    expect(elementBySlug('cu')!.edges.find(e => e.edge === 'L3')!.energy_eV).toBe(932.7);
  });

  it('places each element in a unique periodic-table cell, including the detached series', () => {
    const positions = ELEMENTS.map(el => tablePosition(el.Z));
    expect(new Set(positions.map(p => `${p.row}:${p.col}`)).size).toBe(98);
    for (const p of positions) {
      expect([1, 2, 3, 4, 5, 6, 7, 9, 10]).toContain(p.row);
      expect(p.col).toBeGreaterThanOrEqual(1);
      expect(p.col).toBeLessThanOrEqual(18);
    }
    for (const [z, row, col] of [[2, 1, 18], [5, 2, 13], [18, 3, 18], [26, 4, 8], [57, 9, 3], [71, 9, 17], [72, 6, 4], [89, 10, 3], [98, 10, 12]]) {
      expect(tablePosition(z)).toEqual({ row, col });
    }
  });

  it('uses the lab scan limits and soft/hard boundary, including exact endpoints', () => {
    for (const [energy, band] of [[99, 'outside'], [100, 'outside'], [100.1, 'soft'], [1999.9, 'soft'], [2000, 'hard'], [99999, 'hard'], [100000, 'outside'], [100001, 'outside']] as const) {
      expect(edgeBand(energy)).toBe(band);
    }
    for (const el of ELEMENTS) {
      for (const e of el.edges) {
        expect(e.band !== 'outside').toBe(resolveSample({ formula: el.symbol, absorber: el.symbol, edge: e.edge, density: 1, preset: null }).inRange);
      }
      expect(scannableEdges(el).length).toBe(el.edges.filter(e => e.energy_eV > 100 && e.energy_eV < 100000).length);
    }
  });

  it('chooses K, then L3 for heavy elements, and a reference edge for hydrogen', () => {
    for (const [slug, edge, band] of [['fe', 'K', 'hard'], ['o', 'K', 'soft'], ['u', 'L3', 'hard'], ['cf', 'L3', 'hard'], ['h', 'K', 'outside']]) {
      expect(defaultEdge(elementBySlug(slug)!)).toMatchObject({ edge, band });
    }
  });
});

describe('element and compound lab links', () => {
  it('round trips every tabulated edge on both routes, including a deployment base path', () => {
    for (const el of ELEMENTS) for (const e of el.edges) for (const route of ['crystal', 'beamline'] as const) {
      const path = elementLabPath(route, el.symbol, e.edge);
      const url = new URL('/quantum-battery-xas-lab' + path, 'https://example.com');
      expect(url.pathname).toBe(`/quantum-battery-xas-lab/${route}/`);
      const link = elementFromURL(url)!;
      expect(link).toEqual({ element: el.symbol, edge: e.edge });
      const state = selectElement(DEFAULT_STATE, link);
      expect(state.sample).toEqual({ formula: el.symbol, absorber: el.symbol, edge: e.edge, density: DEFAULT_STATE.sample.density, preset: null });
      expect(state.energy).toBe(Math.max(100, Math.min(100000, e.energy_eV)));
      expect(validateScenario(state)).toEqual(state);
    }
    expect(DEFAULT_STATE.sample.absorber).toBe('Mn');
  });

  it('refuses to generate links to missing elements and edges', () => {
    for (const [symbol, edge] of [['fe', 'K'], ['Og', 'K'], ['H', 'L3'], ['Fe', 'P5']]) {
      expect(() => elementLabPath('crystal', symbol, edge)).toThrow('tabulated');
    }
  });

  it('links every matching preset with its sourced density and this element as absorber', () => {
    for (const el of ELEMENTS) {
      const matching = COMPOUND_PRESETS.filter(p => el.symbol in parseFormula(p.formula));
      const links = compoundsWith(el);
      expect(links.map(l => l.preset.id).sort()).toEqual(matching.map(p => p.id).sort());
      for (const link of links) {
        const state = scenarioFromURL(link.path)!;
        expect(state.sample).toEqual({ formula: link.preset.formula, density: link.preset.density, absorber: el.symbol, edge: link.edge, preset: link.preset.id });
        expect(resolveSample(state.sample).edge.edge).toBe(link.edge);
        expect(state.energy).toBe(Math.max(100, Math.min(100000, resolveSample(state.sample).edge.energy_eV)));
      }
    }
    expect(compoundsWith(elementBySlug('o')!).length).toBeGreaterThan(6);
    expect(compoundsWith(elementBySlug('he')!)).toEqual([]);
  });
});
