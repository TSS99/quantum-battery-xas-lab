// The beamline twin's models for the Methods page: what each computes, from which data, what it was checked against,
// the tolerance, and the unit tests that hold it. methods.test.ts checks that every named test still exists.
import type { Provenance } from './types';

export interface TwinTestRef {
  /** Path from the repository root. */
  file: string;
  /** The test title, or a fixed part of it when the title is a template. */
  name: string;
}

export interface TwinMethod {
  quantity: string;
  /** Text with $...$ around LaTeX. */
  model: string;
  data: string;
  checked: string;
  /** Text with $...$ around LaTeX. */
  tolerance: string;
  provenance: Provenance;
  tests: readonly TwinTestRef[];
}

const twin = (file: string, name: string): TwinTestRef => ({ file: `src/lib/twin/${file}.test.ts`, name });

export const TWIN_METHODS: readonly TwinMethod[] = [
  {
    quantity: 'Bragg angle and photon energy',
    model: String.raw`$E = hc/(2d\sin\theta)$, with $d_{111} = a/\sqrt{3}$ from the CODATA 2018 silicon lattice constant`,
    data: 'Exact constants',
    checked: 'Analytic values; xraydb Bragg angles',
    tolerance: String.raw`exact; $1\%$ against xraydb`,
    provenance: 'tabulated',
    tests: [twin('beam', 'uses the exact silicon lattice constant and hc'), twin('beam', 'matches xraydb Bragg angles and Darwin energy widths within 1%')],
  },
  {
    quantity: 'Monochromator resolution',
    model: String.raw`$\Delta E = E\cot\theta\,\sqrt{\omega_D^2 + \Delta\theta_v^2}$: the Darwin width $\omega_D$ and the vertical divergence $\Delta\theta_v$ in quadrature`,
    data: 'xraydb Darwin widths',
    checked: 'xraydb off the table grid; Python reference beamlines',
    tolerance: String.raw`$2\%$ off the grid; $1\%$ for the reference beamlines`,
    provenance: 'tabulated',
    tests: [twin('tables', 'interpolates Darwin angles and widths within 2% of off-grid xraydb fixtures'), twin('beam', 'adds the vertical divergence term in quadrature'), twin('beam', 'matches the Python reference for every configuration')],
  },
  {
    quantity: 'Source flux',
    model: String.raw`Bending magnet: the universal function $G_1(E/E_c)$ about the critical energy $E_c$; undulator: odd harmonics with the gap tracking the energy`,
    data: 'X-ray Data Booklet tables',
    checked: 'X-ray Data Booklet; a reference ring flux table',
    tolerance: String.raw`$1\%$`,
    provenance: 'tabulated',
    tests: [twin('beam', 'places the critical energy where the X-ray Data Booklet does'), twin('beam', 'reproduces the generic ring flux table of the dossier within 1%')],
  },
  {
    quantity: 'Mirrors and harmonic content',
    model: String.raw`Reflectivity interpolated from tables; the harmonic fraction is the source flux at $nE$ times the crystal acceptance, the mirror reflectivity and the detune overlap`,
    data: 'xraydb mirror reflectivity and crystal reflections',
    checked: 'xraydb on the stored angle grid; Python reference beamlines',
    tolerance: String.raw`$1\%$ reflectivity; $5\%$ harmonic fraction`,
    provenance: 'tabulated',
    tests: [twin('beam', 'matches xraydb reflectivity on the stored angle grid within 1%'), twin('beam', 'matches the Python reference for every configuration'), twin('beam', 'leaves about 1.4e-3 of the Si(333) harmonic at a half-width detune at Cu K')],
  },
  {
    quantity: 'Ion chamber currents',
    model: String.raw`$I = e\,\Phi\,(1 - e^{-\mu L})\,E/W$, one charge collected per ion pair`,
    data: 'xraydb gas absorption and W values',
    checked: 'xraydb ionchamber_fluxes',
    tolerance: String.raw`$1\%$`,
    provenance: 'tabulated',
    tests: [twin('chambers', 'matches the xraydb absorbed and transmitted fractions within 1%'), twin('chambers', 'reproduces the xraydb one-carrier current within 1%')],
  },
  {
    quantity: 'Transmission signal',
    model: String.raw`$\mu x = \ln(I_0/I_t)$ less the chamber terms; Poisson counting in the Realistic view`,
    data: String.raw`Tabulated $\mu(E)$`,
    checked: 'Analytic means and variances',
    tolerance: 'exact; statistical for the noise',
    provenance: 'tabulated',
    tests: [twin('acquire', 'golden: with no harmonics and an ideal sample, ln(I0/It) is mu x from sample.ts plus the chamber terms'), twin('acquire', 'random helpers: Poisson and normal deviates have the right mean and spread')],
  },
  {
    quantity: 'Sample faults',
    model: String.raw`Pinholes: $\mu x_\mathrm{app} = -\ln[(1-a)\,e^{-\mu x} + a]$ for an open fraction $a$; uneven thickness by Gauss-Hermite averaging; harmonics by mixing the $E$ and $3E$ signals`,
    data: String.raw`Tabulated $\mu(E)$`,
    checked: 'Analytic formulas',
    tolerance: String.raw`$10^{-12}$ relative`,
    provenance: 'tabulated',
    tests: [twin('sample', 'reproduces the pinhole formula of dossier 5.2 item 1'), twin('sample', 'reproduces the analytic Gaussian thickness average of dossier 5.2 item 2'), twin('acquire', 'golden: a 10 % harmonic shrinks the edge step as the mixture formula predicts')],
  },
  {
    quantity: 'Fluorescence and self absorption',
    model: String.raw`Finite thickness fluorescence with incidence angle $\phi$ and exit angle $\psi$, $g = \sin\phi/\sin\psi$; thin limit $I_f/I_0 \propto \mu_a$`,
    data: String.raw`xraydb $\mu$, fluorescence yields and line energies`,
    checked: 'Larch fluo_corr; Python reference cases',
    tolerance: String.raw`$1\%$`,
    provenance: 'tabulated',
    tests: [twin('sample', 'matches the Larch fluo_corr alpha of the fixtures'), twin('sample', 'reproduces mu, transmission, fluorescence and electron yield within 1 %')],
  },
  {
    quantity: 'Electron yield',
    model: String.raw`$Y \propto \mu_a\lambda_e/(\sin\phi + \mu_T\lambda_e)$ with a teaching escape depth $\lambda_e = 100\ \mathrm{nm}$`,
    data: String.raw`Tabulated $\mu(E)$`,
    checked: 'Analytic limits; Python reference cases',
    tolerance: String.raw`$1\%$`,
    provenance: 'teaching-model',
    tests: [twin('sample', 'is proportional to mu_a while the attenuation depth is far above the escape depth'), twin('sample', 'saturates towards mu_a / mu_T as the escape depth grows')],
  },
  {
    quantity: 'Fluorescence detector',
    model: String.raw`Fano limited line widths, the solid angle of each element, and dead time per element: $\mathrm{OCR} = \mathrm{ICR}\,e^{-(\mathrm{ICR}/n)\tau}$ for $n$ elements`,
    data: 'xraydb window and sensor absorption',
    checked: 'Analytic Fano limit and live fractions',
    tolerance: 'exact to rounding',
    provenance: 'computed',
    tests: [twin('sdd', 'reproduces the dossier Fano limit at Mn Ka1'), twin('sdd', 'matches the dossier live fractions for both models'), twin('acquire', 'applies dead time per element: four elements lose what one element loses at a quarter of the rate')],
  },
  {
    quantity: String.raw`EXAFS`,
    model: String.raw`FEFF path sum $\chi(k) = \sum_j A_j(k)\sin[2kR_j + \delta_j(k)]$ with $A_j = N_j S_0^2 |f_j|\,e^{-2k^2\sigma_j^2}\,e^{-2R_j/\lambda}/(kR_j^2)$ and $S_0^2 = 0.9$`,
    data: 'FEFF6L paths computed for the library materials with Larch',
    checked: 'Larch path sums',
    tolerance: String.raw`$0.1\%$ RMS`,
    provenance: 'computed',
    tests: [twin('exafs', "matches Larch's rounded-path result")],
  },
  {
    quantity: 'Thermal disorder',
    model: String.raw`Einstein model $\sigma^2 = \frac{\hbar^2}{2\mu k_B\theta_E}\coth\frac{\theta_E}{2T}$; teaching $\theta_E$ of $250\ \mathrm{K}$ for the metals and $500\ \mathrm{K}$ for the oxides and the phosphate`,
    data: 'Path geometry and atomic masses',
    checked: 'Larch sigma2_eins',
    tolerance: String.raw`$0.5\%$`,
    provenance: 'teaching-model',
    tests: [twin('exafs', 'Einstein sigma2 agrees with Larch')],
  },
  {
    quantity: 'EXAFS fitting',
    model: String.raw`Levenberg-Marquardt in $k$ or $R$ space; errors scaled by $\sqrt{\chi^2_\nu}$ as in Larch, $N_\mathrm{idp} = 2\Delta k\,\Delta R/\pi$`,
    data: 'The FEFF library paths',
    checked: 'Larch feffit for Cu and NiO; 50 noisy synthetic spectra; the twin\'s own Cu foil',
    tolerance: 'within one Larch standard error; uncertainties within 20 %',
    provenance: 'computed',
    tests: [twin('exafs-fit', 'values within one Larch stderr; uncertainties within 20%'), twin('exafs-fit', 'recovers all four Cu parameters within one Larch-scaled stderr in at least 45 of 50 k-space noise draws'), twin('first-shell-fit', 'recovers the S0^2, distance and Einstein sigma^2 the twin used for the Cu foil')],
  },
  {
    quantity: 'Reduction',
    model: String.raw`Ports of Larch find_e0, pre_edge, AUTOBK and xftf`,
    data: 'Stored Larch 2026.3.1 outputs',
    checked: 'Larch on the same data',
    tolerance: 'as stored with each fixture',
    provenance: 'computed',
    tests: [
      { file: 'src/lib/xas-reduction.test.ts', name: 'finds the Cu foil and fluorescence E0' },
      { file: 'src/lib/exafs.test.ts', name: 'matches the stored xraylarch output for' },
      { file: 'src/lib/exafs.test.ts', name: 'matches xraylarch 2026.3.1 xftf for' },
      { file: 'src/lib/twin/larch-export.test.ts', name: 'matches xraylarch for E0, edge step and the uncorrected peak R' },
    ],
  },
  {
    quantity: 'Energy calibration',
    model: String.raw`$\Delta E = E_\mathrm{tab} - E_\mathrm{infl}$, the first inflection found as Larch find_e0 does`,
    data: 'Tabulated edge energies',
    checked: 'Larch pre_edge; 20 seeded mystery instruments',
    tolerance: String.raw`$0.05\ \mathrm{eV}$ offset, $10\%$ harmonic fraction, $5\%$ dead time`,
    provenance: 'computed',
    tests: [twin('calibrate', 'matches Larch pre_edge E0 for the same stored synthetic reference-foil fixture'), twin('calibrate', 'recovers all three hidden settings over 20 mystery seeds')],
  },
  {
    quantity: 'Dose',
    model: String.raw`$\dot D = \Phi E\,(1 - e^{-\mu x})/(\rho A x)$; the reduction of the sample with dose is a teaching model`,
    data: String.raw`Tabulated $\mu_\mathrm{en}/\rho$ proxy`,
    checked: 'NIST for water; a reference dose table',
    tolerance: String.raw`$1.2\%$`,
    provenance: 'teaching-model',
    tests: [twin('damage', 'matches the tabulated mu_en/rho proxy within 1.2 % of NIST for water'), twin('damage', 'reproduces the dose table of dossier 11.1'), twin('scenarios-s5-s8', 'divides the dose per spot by the scan spots, and clamps the beam size and the spots')],
  },
  {
    quantity: 'Glitches on uneven samples',
    model: String.raw`A glitch removes the fraction $d$ of the beam from part of the footprint; on an uneven sample $\ln(I_0/I_t)$ shifts by $d\,(\mu x - \mu x_\mathrm{app})$, and on a uniform one by nothing`,
    data: 'The seeded glitch map of the crystal set',
    checked: 'Analytic limits',
    tolerance: 'exact',
    provenance: 'teaching-model',
    tests: [twin('scenarios-s5-s8', 'lets a glitch cancel on a uniform sample and leaves the dip times the mu x gap on an uneven one'), twin('scenarios-s5-s8', 'hides a non-uniform foil whose glitches spike ln(I0/It), and a uniform foil removes the spikes')],
  },
  {
    quantity: 'XDI files',
    model: 'XDI 1.0 with the required fields, energy first and numbered columns',
    data: 'The acquisition',
    checked: 'The XDI rules; read back after writing',
    tolerance: 'exact',
    provenance: 'computed',
    tests: [twin('xdi', 'round-trips a simulated scan: header fields, column names and every value'), twin('xdi', 'follows the XDI rules: required fields, energy first, integer column tags in order')],
  },
];

/** Data and code the twin builds on, with their licences, for the Methods page and exported metadata. */
export const TWIN_ATTRIBUTIONS: readonly { name: string; use: string; licence: string; url: string }[] = [
  { name: 'XrayDB (Elam, Ravel and Sieber 2002)', use: 'absorption, fluorescence, crystal and mirror data', licence: 'database CC0 1.0; xraydb code MIT', url: 'https://github.com/xraypy/XrayDB' },
  { name: 'xraylarch', use: 'reference values for every Larch port, and the FEFF6L path calculations', licence: 'MIT', url: 'https://github.com/xraypy/xraylarch' },
  { name: 'FEFF6L', use: 'scattering amplitudes and phases of the library paths', licence: 'as distributed with xraylarch', url: 'https://feff.phys.washington.edu/' },
  { name: 'X-ray Data Booklet', use: 'bending magnet flux and critical energy', licence: 'cited reference', url: 'https://xdb.lbl.gov/' },
];
