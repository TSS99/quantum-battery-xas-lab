/**
 * Example compounds for the general X-ray absorption tools (src/lib/xraydata.ts).
 * Densities are bulk or crystallographic values with their source; pressed powders and
 * porous samples are less dense, which is why pellet planning works with mass per area.
 * "X-ray density" = Z·M / (N_A·V_cell) from the cell quoted in the source text.
 */
export interface CompoundPreset {
  id: string;
  name: string;
  formula: string;
  /** g/cm^3 */
  density: number;
  phase: 'gas' | 'liquid' | 'solid';
  description: string;
  densitySource: string;
  /** Element and edge this material is usually measured at. */
  absorber: string;
  edge: string;
}

export const COMPOUND_PRESETS: readonly CompoundPreset[] = [
  {
    id: 'water', name: 'Water', formula: 'H2O', density: 0.997, phase: 'liquid',
    description: 'Liquid water, the reference system for O K-edge studies of hydrogen bonding.',
    densitySource: 'CRC Handbook of Chemistry and Physics: 0.99705 g/cm³ at 25 °C.',
    absorber: 'O', edge: 'K',
  },
  {
    id: 'n2-gas', name: 'Nitrogen gas', formula: 'N2', density: 0.001145, phase: 'gas',
    description: 'Nitrogen gas; its sharp N 1s → π* resonance is a standard soft X-ray energy calibrant.',
    densitySource: 'Ideal-gas density ρ = pM/RT at 25 °C and 101.325 kPa (1.145 g/L).',
    absorber: 'N', edge: 'K',
  },
  {
    id: 'co-gas', name: 'Carbon monoxide gas', formula: 'CO', density: 0.001145, phase: 'gas',
    description: 'Carbon monoxide gas, a classic small-molecule test case at the C K edge.',
    densitySource: 'Ideal-gas density ρ = pM/RT at 25 °C and 101.325 kPa (1.145 g/L).',
    absorber: 'C', edge: 'K',
  },
  {
    id: 'sio2-quartz', name: 'Quartz (SiO₂)', formula: 'SiO2', density: 2.65, phase: 'solid',
    description: 'Crystalline silica with silicon in tetrahedral oxygen coordination.',
    densitySource: 'Handbook of Mineralogy (Anthony et al.), quartz: D(meas.) = 2.65 g/cm³.',
    absorber: 'Si', edge: 'K',
  },
  {
    id: 'tio2-anatase', name: 'Anatase (TiO₂)', formula: 'TiO2', density: 3.89, phase: 'solid',
    description: 'Anatase titania, known for its three small pre-edge peaks at the Ti K edge.',
    densitySource: 'Handbook of Mineralogy, anatase: D(calc.) = 3.89 g/cm³ from a = 3.7845 Å, c = 9.5143 Å, Z = 4 (D(meas.) 3.79–3.97).',
    absorber: 'Ti', edge: 'K',
  },
  {
    id: 'zno', name: 'Zinc oxide', formula: 'ZnO', density: 5.67, phase: 'solid',
    description: 'Wurtzite zinc oxide, a filled-3d Zn²⁺ reference.',
    densitySource: 'Handbook of Mineralogy, zincite: D(calc.) = 5.673 g/cm³ from a = 3.24992 Å, c = 5.20658 Å, Z = 2.',
    absorber: 'Zn', edge: 'K',
  },
  {
    id: 'nio', name: 'Nickel(II) oxide', formula: 'NiO', density: 6.81, phase: 'solid',
    description: 'Rock-salt NiO, the usual Ni²⁺ reference for nickel-containing cathodes.',
    densitySource: 'Handbook of Mineralogy, bunsenite: D(calc.) = 6.806 g/cm³ from a = 4.1769 Å, Z = 4.',
    absorber: 'Ni', edge: 'K',
  },
  {
    id: 'fe2o3-hematite', name: 'Hematite (Fe₂O₃)', formula: 'Fe2O3', density: 5.26, phase: 'solid',
    description: 'Hematite, the standard Fe³⁺ oxide reference at the Fe K edge.',
    densitySource: 'Handbook of Mineralogy, hematite: D(meas.) = 5.26 g/cm³ (D(calc.) = 5.255).',
    absorber: 'Fe', edge: 'K',
  },
  {
    id: 'cuso4-5h2o', name: 'Copper sulfate pentahydrate', formula: 'CuSO4·5H2O', density: 2.286, phase: 'solid',
    description: 'Blue vitriol, a Cu²⁺ reference with water molecules around the copper.',
    densitySource: 'Handbook of Mineralogy, chalcanthite: D(meas.) = 2.286 g/cm³ (synthetic).',
    absorber: 'Cu', edge: 'K',
  },
  {
    id: 'lifepo4', name: 'Lithium iron phosphate', formula: 'LiFePO4', density: 3.60, phase: 'solid',
    description: 'Olivine LiFePO₄ cathode; iron cycles between Fe²⁺ and Fe³⁺.',
    densitySource: 'X-ray density from the widely reported olivine (Pnma) cell a = 10.334 Å, b = 6.008 Å, c = 4.693 Å, Z = 4.',
    absorber: 'Fe', edge: 'K',
  },
  {
    id: 'licoo2', name: 'Lithium cobalt oxide', formula: 'LiCoO2', density: 5.05, phase: 'solid',
    description: 'Layered LiCoO₂ cathode; cobalt is oxidised from Co³⁺ on charging.',
    densitySource: 'X-ray density from the layered (R-3m) cell a = 2.816 Å, c = 14.05 Å, Z = 3.',
    absorber: 'Co', edge: 'K',
  },
  {
    id: 'limn2o4', name: 'Lithium manganese oxide spinel', formula: 'LiMn2O4', density: 4.28, phase: 'solid',
    description: 'Spinel LiMn₂O₄ cathode with mixed Mn³⁺/Mn⁴⁺.',
    densitySource: 'X-ray density from the cubic spinel cell a = 8.247 Å, Z = 8.',
    absorber: 'Mn', edge: 'K',
  },
  {
    id: 'lnmo', name: 'High-voltage spinel LNMO', formula: 'LiNi0.5Mn1.5O4', density: 4.45, phase: 'solid',
    description: '5 V spinel cathode; nickel carries the charge (Ni²⁺ to Ni⁴⁺) while Mn stays near Mn⁴⁺.',
    densitySource: 'X-ray density from the cubic spinel cell a = 8.17 Å, Z = 8.',
    absorber: 'Ni', edge: 'K',
  },
  {
    id: 'cu-foil', name: 'Copper foil', formula: 'Cu', density: 8.96, phase: 'solid',
    description: 'Copper metal foil, the usual energy-calibration reference near 8979 eV.',
    densitySource: 'CRC Handbook of Chemistry and Physics: 8.96 g/cm³ (same value in the XrayDB materials list).',
    absorber: 'Cu', edge: 'K',
  },
  {
    id: 'pt-foil', name: 'Platinum foil', formula: 'Pt', density: 21.45, phase: 'solid',
    description: 'Platinum metal foil, an L3-edge reference for catalysts and electrodes.',
    densitySource: 'XrayDB materials list: 21.45 g/cm³ (CRC Handbook: 21.5 g/cm³).',
    absorber: 'Pt', edge: 'L3',
  },
];
