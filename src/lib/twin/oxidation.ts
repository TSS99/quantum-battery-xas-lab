import { SAMPLE_PRESETS } from './presets';

/**
 * Valence series: samples of one element whose edge positions were measured beside the metal in one study (the edge
 * shifts in presets.ts, each with its source there). Members whose shift is interpolated or extrapolated by valence
 * say so. The shift is read from the preset, so this file holds only the valences and the sources.
 */
export interface SeriesMember { id: string; name: string; valence: number; shift_eV: number; derived?: 'interpolated' | 'extrapolated' }
export interface ValenceSeries { element: string; source: string; members: SeriesMember[]; perValence_eV: number }

const SERIES: { element: string; source: string; members: [id: string, valence: number, derived?: SeriesMember['derived']][] }[] = [
  { element: 'Mn', source: 'Imam et al., J. Synchrotron Rad. 29, 1187 (2022), at half the edge step', members: [['mn-foil', 0], ['mno-pellet', 2], ['mn2o3-pellet', 3], ['limn2o4-pellet', 3.5, 'interpolated'], ['mno2-pellet', 4]] },
  { element: 'Cu', source: 'Phys. Chem. Chem. Phys., doi:10.1039/D0CP06468H, SI table', members: [['cu-foil', 0], ['cu2o-pellet', 1], ['cuo-pellet', 2]] },
  { element: 'Co', source: 'Catal. Sci. Technol., doi:10.1039/D2CY02182J, SI table', members: [['co-foil', 0], ['coo-pellet', 2], ['co3o4-pellet', 8 / 3], ['licoo2-pellet', 3, 'extrapolated']] },
  { element: 'S', source: 'F. Jalilehvand, XANES lecture, University of Calgary (white lines)', members: [['s8-pellet', 0], ['na2so4-pellet', 6]] },
  { element: 'As', source: 'HZDR Publ-12521, against the tabulated As edge', members: [['as3-water', 3], ['as5-water', 5]] },
];

export function valenceSeries(element: string): ValenceSeries | null {
  const found = SERIES.find(s => s.element === element);
  if (!found) return null;
  const members = found.members.map(([id, valence, derived]) => {
    const preset = SAMPLE_PRESETS.find(p => p.id === id);
    if (!preset) throw new Error(`No sample ${id} for the ${element} valence series.`);
    return { id, name: preset.name, valence, shift_eV: preset.sample.edgeShift_eV ?? 0, ...(derived && { derived }) };
  });
  // Least squares slope of shift against valence over the measured members.
  const measured = members.filter(m => !m.derived), n = measured.length;
  const mx = measured.reduce((s, m) => s + m.valence, 0) / n, my = measured.reduce((s, m) => s + m.shift_eV, 0) / n;
  const sxy = measured.reduce((s, m) => s + (m.valence - mx) * (m.shift_eV - my), 0), sxx = measured.reduce((s, m) => s + (m.valence - mx) ** 2, 0);
  return { element, source: found.source, members, perValence_eV: sxx > 0 ? sxy / sxx : 0 };
}
