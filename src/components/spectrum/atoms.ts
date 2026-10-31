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

/** Shell colours in distance order: the validated dark categorical slots (dataviz palette), fixed per position, never cycled. */
export const SHELL_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];

/** Atom colours for the 3D pictures (Jmol's scheme where it reads on the dark stage). */
export const ATOM_COLORS: Record<string, string> = { O: '#ff5a4a', S: '#f2d24b', Cu: '#d0875a', Ni: '#9fc7a1', Co: '#8fa8e6', Fe: '#e0915a', Mn: '#b08ad8', Pt: '#dcdcdc', Au: '#e8c25a', Zn: '#8f93c9', Ti: '#c0c5cc', Cr: '#93a6c9', Li: '#c88ff0', P: '#ff9a3c', C: '#9aa0a6' };
