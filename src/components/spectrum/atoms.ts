/** The elements in the FEFF library's clusters: their names, and covalent radii in angstrom (Cordero et al., Dalton Trans. 2832 (2008); low spin for Mn and Fe). */
export const ATOMS: Record<string, { name: string; radius_A: number }> = {
  Li: { name: 'lithium', radius_A: 1.28 }, C: { name: 'carbon', radius_A: 0.76 }, O: { name: 'oxygen', radius_A: 0.66 },
  Na: { name: 'sodium', radius_A: 1.66 }, P: { name: 'phosphorus', radius_A: 1.07 }, S: { name: 'sulfur', radius_A: 1.05 },
  Cl: { name: 'chlorine', radius_A: 1.02 }, K: { name: 'potassium', radius_A: 2.03 }, Ca: { name: 'calcium', radius_A: 1.76 },
  Ti: { name: 'titanium', radius_A: 1.6 }, Cr: { name: 'chromium', radius_A: 1.39 }, Mn: { name: 'manganese', radius_A: 1.39 },
  Fe: { name: 'iron', radius_A: 1.32 }, Co: { name: 'cobalt', radius_A: 1.26 }, Ni: { name: 'nickel', radius_A: 1.24 },
  Cu: { name: 'copper', radius_A: 1.32 }, Zn: { name: 'zinc', radius_A: 1.22 }, Mo: { name: 'molybdenum', radius_A: 1.54 },
  Pd: { name: 'palladium', radius_A: 1.39 }, Ce: { name: 'cerium', radius_A: 2.04 }, W: { name: 'tungsten', radius_A: 1.62 },
  Pt: { name: 'platinum', radius_A: 1.36 }, Au: { name: 'gold', radius_A: 1.36 }, Pb: { name: 'lead', radius_A: 1.46 },
};

export const atomName = (symbol: string) => ATOMS[symbol]?.name ?? symbol;
