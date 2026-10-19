// The equations the lab evaluates, written as the code evaluates them, each traced to the function that does it.
// When a formula in src/lib changes, change its entry here too; model-equations.test.ts recomputes these from the code.
import { memo, type ReactNode } from 'react';
import { Num, Tex, Unit } from './tex';

export interface ModelEquation { title: string; lines: string[]; symbols: ReactNode; note?: ReactNode; sources: string[] }
export interface EquationGroup { title: string; equations: ModelEquation[] }

const A = '\\mathring{\\mathrm{A}}';

export const MODEL_EQUATIONS: EquationGroup[] = [
 { title: 'Sample attenuation and the mixture rule', equations: [
  { title: 'Tabulated cross sections', lines: [
    String.raw`\ln(\mu/\rho) = \ln(\mu/\rho)_i + t\,{[\ln(\mu/\rho)_{i+1} - \ln(\mu/\rho)_i]}`,
    String.raw`t = \frac{\ln E - \ln E_i}{\ln E_{i+1} - \ln E_i},\qquad\allowbreak {E_i \le E < E_{i+1}}`],
   symbols: <><Tex>{'(\\mu/\\rho)_i'}</Tex> is one element’s mass attenuation coefficient in <Unit>cm²/g</Unit> at the table energy <Tex>{'E_i'}</Tex> (Elam, Ravel and Sieber via XrayDB), joined by straight lines in <Tex>{'\\ln E'}</Tex> and <Tex>{'\\ln(\\mu/\\rho)'}</Tex>, once for photoabsorption and once for the total; at an edge, where two table rows share one energy, the value above the edge is used.</>,
   sources: ['xraydata.ts: elementCrossSection, lineAt'] },
  { title: 'Mixture rule', lines: [
    String.raw`w_j = \frac{n_j M_j}{\sum_k n_k M_k}`,
    String.raw`\mu(E) = \rho \sum_j w_j\,(\mu/\rho)_j(E)`],
   symbols: <><Tex>{'n_j'}</Tex> is the number of atoms of element <Tex>{'j'}</Tex> in the formula, <Tex>{'M_j'}</Tex> its molar mass in <Unit>g/mol</Unit>, <Tex>{'w_j'}</Tex> its mass fraction, <Tex>{'\\rho'}</Tex> the density you enter in <Unit>g/cm³</Unit> and <Tex>{'\\mu'}</Tex> the linear attenuation coefficient in <Unit>cm⁻¹</Unit>; the lab keeps a photoabsorption sum and a total sum that adds coherent and incoherent scattering, and plots, transmission and counts use the total.</>,
   sources: ['xraydata.ts: massFractions, muOverRho, mu'] },
 ] },
 { title: 'Beamline, transmission and optical depth', equations: [
  { title: 'Monochromator angle', lines: [String.raw`\theta = \arcsin\frac{hc}{2d_{111}E}`],
   symbols: <><Tex>{'E'}</Tex> is the photon energy in <Unit>eV</Unit>, <Tex>{`hc = 12398.42\\ \\mathrm{eV}\\,${A}`}</Tex> and <Tex>{`d_{111} = 3.1356\\ ${A}`}</Tex> is the <Tex>{'\\mathrm{Si}(111)'}</Tex> plane spacing; the beamline drawing shows this angle from <Num>2100</Num> <Unit>eV</Unit> up and draws a grating below that.</>,
   sources: ['beamline-scene.tsx: BeamScene'] },
  { title: 'Transmission and optical depth', lines: [
    String.raw`I_t = I_0\,e^{-\mu d}`,
    String.raw`\mu d = \ln(I_0/I_t)`],
   symbols: <><Tex>{'I_0'}</Tex> is the number of incident photons, <Tex>{'I_t'}</Tex> the expected number transmitted, <Tex>{'\\mu'}</Tex> the total attenuation coefficient in <Unit>cm⁻¹</Unit> at the current energy and <Tex>{'d'}</Tex> the thickness, entered in <Unit>μm</Unit> and converted with <Tex>{'1\\ \\mu\\mathrm{m} = 10^{-4}\\ \\mathrm{cm}'}</Tex>, so <Tex>{'\\mu d'}</Tex> is the dimensionless optical depth and the Transmission view plots <Tex>{'I_t/I_0 = e^{-\\mu d}'}</Tex>.</>,
   sources: ['xas.ts: transmission'] },
 ] },
 { title: 'Edge step and thickness planning', equations: [
  { title: 'Edge step', lines: [String.raw`\Delta\mu = {\mu_{+} - \mu_{-}} = \rho\,w_a\,{[(\mu/\rho)_a^{+} - (\mu/\rho)_a^{-}]}`],
   symbols: <><Tex>{'(\\mu/\\rho)_a^{+}'}</Tex> and <Tex>{'(\\mu/\\rho)_a^{-}'}</Tex> are the absorber’s total mass attenuation just above and just below the tabulated jump at its edge, in <Unit>cm²/g</Unit>, <Tex>{'w_a'}</Tex> is its mass fraction and <Tex>{'\\mu_{\\pm}'}</Tex> the compound’s total <Tex>{'\\mu'}</Tex> on either side in <Unit>cm⁻¹</Unit>; the other elements are taken at the same energy on both sides, so they cancel.</>,
   sources: ['xraydata.ts: edgeStep'] },
  { title: 'Suggested thickness', lines: [
    String.raw`m_A = \min\!\left(\frac{1}{\Delta(\mu/\rho)},\ \frac{3}{(\mu/\rho)_{+}}\right)`,
    String.raw`d = m_A/\rho,\qquad\allowbreak m = m_A A`,
    String.raw`{\Delta\mu\,d = m_A\,\Delta(\mu/\rho)},\qquad\allowbreak {\mu_{+}d = m_A\,(\mu/\rho)_{+}}`],
   symbols: <><Tex>{'\\Delta(\\mu/\\rho) = \\Delta\\mu/\\rho'}</Tex> and <Tex>{'(\\mu/\\rho)_{+} = \\mu_{+}/\\rho'}</Tex> are the edge step and the total just above the edge per unit mass in <Unit>cm²/g</Unit>, and <Tex>{'m_A'}</Tex> is the mass per area in <Unit>g/cm²</Unit> that gives an edge step <Tex>{'\\Delta\\mu\\,d = 1'}</Tex>, capped where the total absorption above the edge <Tex>{'\\mu_{+}d'}</Tex> would pass <Num>3</Num>; <Tex>{'d'}</Tex> is the equivalent fully dense thickness (shown in <Unit>μm</Unit>) and <Tex>{'m'}</Tex> the sample mass (shown in <Unit>mg</Unit>) for a <Num>13</Num> <Unit>mm</Unit> pellet, <Tex>{'A = \\pi\\,(0.65\\ \\mathrm{cm})^2 = 1.327\\ \\mathrm{cm}^2'}</Tex>.</>,
   sources: ['xraydata.ts: recommendThickness'] },
  { title: 'Transmission or fluorescence', lines: [
    String.raw`s_{\max} = \min\!\left(1,\ 3\,\frac{\Delta\mu}{\mu_{+}}\right)`,
    String.raw`\text{transmission if } E_0 \ge 2000\ \mathrm{eV} \text{ and } s_{\max} \ge 0.3`],
   symbols: <><Tex>{'s_{\\max}'}</Tex> is the largest edge step <Tex>{'\\Delta\\mu\\,d'}</Tex> reachable while <Tex>{'\\mu_{+}d \\le 3'}</Tex>, and <Tex>{'E_0'}</Tex> is the tabulated edge energy; otherwise the advice is fluorescence, with a self-absorption note on soft edges when <Tex>{'\\Delta\\mu/\\mu_{+} > 0.1'}</Tex> and an electron-yield note when the fluorescence yield is below <Num>5%</Num>.</>,
   sources: ['xraydata.ts: recommendMode'] },
 ] },
 { title: 'Counting statistics', equations: [
  { title: 'Detector counts and the inferred absorption', lines: [
    String.raw`{N_0 \sim \mathrm{Poisson}(I_0)},\qquad\allowbreak {N_t \sim \mathrm{Poisson}(I_0\,e^{-\mu d})}`,
    String.raw`\hat\mu = \frac{\ln(N_0/N_t)}{d}\quad\allowbreak {\text{for } N_0 > 0,\ N_t > 0}`],
   symbols: <><Tex>{'N_0'}</Tex> and <Tex>{'N_t'}</Tex> are independent Poisson draws from one seeded Mulberry32 random stream (Knuth’s method for means below <Num>30</Num>, transformed rejection above), and <Tex>{'\\hat\\mu'}</Tex> in <Unit>cm⁻¹</Unit> is left undefined when either count is zero, with no correction; a draw with <Tex>{'N_t > N_0'}</Tex> is kept as drawn.</>,
   sources: ['xas.ts: sampleCounts, poisson, seededRandom'] },
 ] },
 { title: 'Near-edge teaching models', equations: [
  { title: 'Charge balance in the battery example', lines: [String.raw`{x\,(+1) + v_{\mathrm{Mn}} + 2\,(-2) = 0}\quad\Rightarrow\quad {v_{\mathrm{Mn}} = 4 - x}`],
   symbols: <><Tex>{'x'}</Tex> is the lithium content of <Tex>{'\\mathrm{Li}_x\\mathrm{MnO_2}'}</Tex>, from <Num>0</Num> to <Num>1</Num>, and <Tex>{'v_{\\mathrm{Mn}}'}</Tex> the nominal Mn oxidation state, assuming <Tex>{'\\mathrm{Li^{+}}'}</Tex>, <Tex>{'\\mathrm{O^{2-}}'}</Tex> and charge compensation on Mn only; the <Tex>{'\\mathrm{Mn^{3+}}'}</Tex> share shown equals <Tex>{'x'}</Tex>, which holds only for a <Tex>{'\\mathrm{Mn^{3+}}/\\mathrm{Mn^{4+}}'}</Tex> mixture.</>,
   sources: ['xas.ts: nominalMnOxidation'] },
  { title: 'Battery teaching spectrum', lines: [
    String.raw`E_0 = E_{\mathrm{ref}} - s\,x`,
    String.raw`\mu(E) = 18 + 110\,L(E)\,M(E) + P\,{G(E;\,E_0 - 7,\,0.8)} + W\,{G(E;\,E_0 + 4,\,1.8)}`,
    String.raw`L(E) = \frac{1}{1 + e^{-(E - E_0)/\Gamma}},\qquad\allowbreak G(E;\,c,\,\sigma) = e^{-(E - c)^2/(2\sigma^2)}`,
    String.raw`M(E) = 1 + a\,\sin(0.8\,\varepsilon)\,e^{-\varepsilon/18},\qquad\allowbreak \varepsilon = {\max(0,\ E - E_0)}`],
   symbols: <><Tex>{'E_{\\mathrm{ref}}'}</Tex> is the reference model edge and <Tex>{'s'}</Tex> the edge shift per lithium, both in <Unit>eV</Unit>, <Tex>{'\\Gamma'}</Tex> the logistic width in <Unit>eV</Unit> set by the Edge sharpness slider, <Tex>{'P'}</Tex> and <Tex>{'W'}</Tex> the pre-edge and white-line heights in <Unit>cm⁻¹</Unit> and <Tex>{'a'}</Tex> the ripple amplitude; the constants <Num>18</Num> and <Num>110</Num> in front are in <Unit>cm⁻¹</Unit>, the offsets <Num>7</Num> and <Num>4</Num>, widths <Num>0.8</Num> and <Num>1.8</Num> and decay length <Num>18</Num> are in <Unit>eV</Unit>, and the ripple frequency <Num>0.8</Num> is in <Unit>rad/eV</Unit>.</>,
   sources: ['xas.ts: mu, edgeEnergy, logisticEdge'] },
  { title: 'Near-edge model for any compound', lines: [
    String.raw`\mu(E) = \mu_{-}(E) + {[\mu_{+}(E) - \mu_{-}(E)]}\,S(E)`,
    String.raw`S = A + h_p\,{G(E;\,E_0 - \delta_p,\,\sigma_p)} + h_w\,{G(E;\,E_0 + \delta_w,\,\sigma_w)} + a\,{\Theta(E - E_0)}\,A\,\sin(2kR)\,e^{-2\sigma^2k^2}`,
    String.raw`A = {\frac{1}{2} + \frac{1}{\pi}\arctan\frac{E - E_0}{\Gamma}},\qquad\allowbreak {k = \sqrt{0.2624684\,(E - E_0)}}`],
   symbols: <><Tex>{'\\mu_{-}'}</Tex> and <Tex>{'\\mu_{+}'}</Tex> are the compound’s total <Tex>{'\\mu'}</Tex> in <Unit>cm⁻¹</Unit> with the absorber’s cross section continued straight (in <Tex>{'\\ln E'}</Tex> and <Tex>{'\\ln\\mu'}</Tex>) across the edge from below and from above, so the jump is tabulated and only its shape is modeled; <Tex>{'E_0 = E_{\\mathrm{tab}} + \\Delta E'}</Tex> is the tabulated edge plus the Model edge shift slider in <Unit>eV</Unit>, <Tex>{'\\Gamma'}</Tex> the arctan half width in <Unit>eV</Unit>, <Tex>{'G'}</Tex> the Gaussian above, <Tex>{'\\Theta'}</Tex> the unit step, <Tex>{'k'}</Tex> the photoelectron wavenumber in <Tex>{`${A}^{-1}`}</Tex> (<Tex>{`2m_e/\\hbar^2 = 0.2624684\\ ${A}^{-2}\\,\\mathrm{eV}^{-1}`}</Tex>), <Tex>{'R'}</Tex> a scattering distance in <Tex>{A}</Tex>, <Tex>{'\\sigma^2'}</Tex> a damping in <Tex>{`${A}^2`}</Tex>, and <Tex>{'h_p'}</Tex>, <Tex>{'h_w'}</Tex> and <Tex>{'a'}</Tex> fractions of the jump.</>,
   note: <>Defaults: <Tex>{'\\Gamma = \\max(0.3,\\ 2\\times10^{-4}E_{\\mathrm{tab}})'}</Tex>, <Tex>{'\\delta_p = \\max(2,\\ 1.2\\times10^{-3}E_{\\mathrm{tab}})'}</Tex>, <Tex>{'\\sigma_p = \\max(0.4,\\ 1.5\\times10^{-4}E_{\\mathrm{tab}})'}</Tex>, <Tex>{'\\delta_w = \\max(1.5,\\ 10^{-3}E_{\\mathrm{tab}})'}</Tex> and <Tex>{'\\sigma_w = \\max(0.8,\\ 4\\times10^{-4}E_{\\mathrm{tab}})'}</Tex>, all in <Unit>eV</Unit>; <Tex>{'h_p = 0.05'}</Tex>, <Tex>{'h_w = 0.4'}</Tex>, <Tex>{'a = 0.06'}</Tex>, <Tex>{`R = 2\\ ${A}`}</Tex> and <Tex>{`\\sigma^2 = 0.008\\ ${A}^2`}</Tex>.</>,
   sources: ['xas-general.ts: modelSpectrum, defaultEdgeWidth, defaultNearEdgeFeatures', 'xraydata.ts: muAcrossEdge, elementMuOverRhoSide'] },
 ] },
 { title: 'Edge estimators', equations: [
  { title: 'Derivative on an uneven grid', lines: [
    String.raw`\mu'_i = -\frac{h_{+}\,\mu_{i-1}}{h_{-}(h_{-} + h_{+})} + \frac{(h_{+} - h_{-})\,\mu_i}{h_{-}h_{+}} + \frac{h_{-}\,\mu_{i+1}}{h_{+}(h_{-} + h_{+})}`,
    String.raw`h_{-} = {E_i - E_{i-1}},\qquad\allowbreak h_{+} = {E_{i+1} - E_i}`],
   symbols: <><Tex>{'\\mu_i'}</Tex> is the stored <Tex>{'\\mu'}</Tex> at energy <Tex>{'E_i'}</Tex> in <Unit>cm⁻¹</Unit> and <Tex>{String.raw`\mu'_i`}</Tex> the derivative in <Unit>cm⁻¹ eV⁻¹</Unit>; the first and last points use two-point differences, and nothing is smoothed.</>,
   sources: ['spectra.ts: derivativeSpectrum'] },
  { title: 'Steepest point', lines: [String.raw`E_0 = E_{i^*},\qquad\allowbreak i^* = \arg\max_i\,\mu'_i`],
   symbols: <>The edge is the grid energy where the derivative is largest (the first such point on ties), with no interpolation between points; it is undefined when that largest derivative is not positive.</>,
   sources: ['spectra.ts: estimateEdge'] },
  { title: 'Endpoint normalization', lines: [String.raw`\tilde\mu_i = \frac{\mu_i - \bar\mu_{\mathrm{pre}}}{\bar\mu_{\mathrm{post}} - \bar\mu_{\mathrm{pre}}}`],
   symbols: <><Tex>{'\\bar\\mu_{\\mathrm{pre}}'}</Tex> and <Tex>{'\\bar\\mu_{\\mathrm{post}}'}</Tex> are the plain means of the first and the last <Tex>{'\\max(1, \\lfloor N/10 \\rfloor)'}</Tex> of the <Tex>{'N'}</Tex> points, and <Tex>{'\\tilde\\mu'}</Tex> is dimensionless; it is undefined when the two means differ by less than <Tex>{'10^{-12}\\ \\mathrm{cm}^{-1}'}</Tex>, and no background polynomial is fitted.</>,
   sources: ['spectra.ts: normalizeSpectrum'] },
  { title: 'Half height', lines: [String.raw`E_{1/2} = E_{i-1} + \frac{1/2 - \tilde\mu_{i-1}}{\tilde\mu_i - \tilde\mu_{i-1}}\,{(E_i - E_{i-1})}`],
   symbols: <><Tex>{'i'}</Tex> is the first point where the normalized curve rises through one half, <Tex>{'\\tilde\\mu_{i-1} \\le 1/2 \\le \\tilde\\mu_i'}</Tex> with <Tex>{'\\tilde\\mu_i > \\tilde\\mu_{i-1}'}</Tex>, and <Tex>{'E_{1/2}'}</Tex> in <Unit>eV</Unit> interpolates linearly between those two points; it is undefined when there is no such crossing.</>,
   sources: ['spectra.ts: estimateEdge'] },
 ] },
 { title: 'Spectrum scores and the shape fit', equations: [
  { title: 'Paired points', lines: [String.raw`e_i = {E_i + s},\qquad\allowbreak p_i = \mu_{\mathrm{ref}}(e_i),\qquad\allowbreak q_i = \mu_i`],
   symbols: <><Tex>{'E_i'}</Tex> and <Tex>{'\\mu_i'}</Tex> are the selected curve’s points, <Tex>{'s'}</Tex> the comparison energy shift in <Unit>eV</Unit> and <Tex>{'\\mu_{\\mathrm{ref}}'}</Tex> the live reference curve, interpolated linearly at <Tex>{'e_i'}</Tex>; only points from <Tex>{'E_{\\mathrm{edge}} - 10'}</Tex> to <Tex>{'E_{\\mathrm{edge}} + 30\\ \\mathrm{eV}'}</Tex> inside the reference’s range are kept, at least five are required, <Tex>{'E_{\\mathrm{edge}}'}</Tex> is the sample’s tabulated edge, and raw <Tex>{'\\mu'}</Tex> in <Unit>cm⁻¹</Unit> is compared, not normalized <Tex>{'\\mu'}</Tex>.</>,
   sources: ['comparison.ts: compareSpectra'] },
  { title: 'Similarity scores', lines: [
    String.raw`\cos(p, q) = \frac{\sum_i p_i q_i}{\sqrt{\sum_i p_i^2\,\sum_i q_i^2}}`,
    String.raw`{r_{\mathrm{P}} = \cos(p - \bar p,\ q - \bar q)},\qquad\allowbreak {r_{\mathrm{S}} = \cos(R_p - \bar R_p,\ R_q - \bar R_q)}`],
   symbols: <><Tex>{'\\bar p'}</Tex> and <Tex>{'\\bar q'}</Tex> are means and <Tex>{'R_p'}</Tex>, <Tex>{'R_q'}</Tex> the ranks of the values (tied values share their mean rank), so Pearson <Tex>{'r_{\\mathrm{P}}'}</Tex> is the cosine of the centered values and Spearman <Tex>{'r_{\\mathrm{S}}'}</Tex> the cosine of the centered ranks; each score is clipped to <Tex>{'[-1, 1]'}</Tex> and undefined when either argument of the cosine is all zeros.</>,
   sources: ['comparison.ts: similarityMetrics, ranks'] },
  { title: 'Residual and relative error', lines: [
    String.raw`\varepsilon_i = q_i - p_i`,
    String.raw`L^1_{\mathrm{rel}} = \frac{\int|\varepsilon|\,dE}{\int|p|\,dE},\qquad\allowbreak {\mathrm{RMSE} = \sqrt{\frac{1}{N}\sum_i \varepsilon_i^2}}`],
   symbols: <><Tex>{'\\varepsilon_i'}</Tex> is the residual, selected minus reference, in <Unit>cm⁻¹</Unit>, both integrals are trapezoid sums over the <Tex>{'N'}</Tex> paired energies <Tex>{'e_i'}</Tex>, <Tex>{'L^1_{\\mathrm{rel}}'}</Tex> is dimensionless and RMSE is in <Unit>cm⁻¹</Unit>.</>,
   sources: ['comparison.ts: compareSpectra'] },
  { title: 'Illustrative shape fit', lines: [
    String.raw`\mu_{\mathrm{fit}}(E) = {b + a\,m(E)},\qquad\allowbreak {m(E) = \mu_{\mathrm{model}}(E;\ E_{\mathrm{ref}} + \Delta E)}`,
    String.raw`Q = \sum_i w_i\,{[y_i - \mu_{\mathrm{fit}}(E_i)]^2},\qquad\allowbreak {w_i = \sigma_i^{-2}\ \text{or}\ 1}`,
    String.raw`a = \max\!\left(0,\ \frac{S_{my}}{S_{mm}}\right),\qquad\allowbreak b = {\bar y - a\,\bar m}`,
    String.raw`S_{my} = \sum_i w_i\,{(m_i - \bar m)}{(y_i - \bar y)},\qquad\allowbreak S_{mm} = \sum_i w_i\,{(m_i - \bar m)^2}`,
    String.raw`\chi^2_\nu = \frac{1}{N - 3}\sum_i \left(\frac{y_i - \mu_{\mathrm{fit}}(E_i)}{\sigma_i}\right)^2`],
   symbols: <><Tex>{'y_i'}</Tex> are the data <Tex>{'\\mu'}</Tex> in <Unit>cm⁻¹</Unit> with optional <Tex>{'1\\sigma'}</Tex> uncertainties <Tex>{'\\sigma_i'}</Tex>, <Tex>{'m'}</Tex> is the battery teaching spectrum at the current settings with its reference edge moved by <Tex>{'\\Delta E'}</Tex>, and <Tex>{'\\bar m'}</Tex> and <Tex>{'\\bar y'}</Tex> are <Tex>{'w'}</Tex>-weighted means; <Tex>{'\\Delta E'}</Tex> runs from <Tex>{'-10'}</Tex> to <Tex>{'10\\ \\mathrm{eV}'}</Tex> in <Tex>{'0.1\\ \\mathrm{eV}'}</Tex> steps, <Tex>{'a'}</Tex> and <Tex>{'b'}</Tex> are solved exactly at each step, the step with the smallest <Tex>{'Q'}</Tex> is kept, RMSE is the unweighted root mean square residual and <Tex>{'\\chi^2_\\nu'}</Tex> is reported only when <Tex>{'\\sigma_i'}</Tex> are supplied.</>,
   sources: ['spectra.ts: fitSpectrum'] },
 ] },
 { title: 'Quantum model', equations: [
  { title: 'Hamiltonian', lines: [
    String.raw`H = \sum_{i=0}^{n-1} h\,{(1 + 0.13\,i)}\,Z_i + J\sum_{i=0}^{n-2} X_i X_{i+1} + 0.17\sum_{i=0}^{n-1} X_i`,
    String.raw`H = \sum_k c_k P_k\quad \text{(loaded Hamiltonian)}`],
   symbols: <><Tex>{'n'}</Tex> is the number of qubits, from <Num>2</Num> to <Num>6</Num>, <Tex>{'h'}</Tex> the longitudinal field and <Tex>{'J'}</Tex> the nearest-neighbor coupling in <Unit>eV</Unit>, <Tex>{'0.17\\ \\mathrm{eV}'}</Tex> a fixed transverse field, and <Tex>{'X_i'}</Tex>, <Tex>{'Z_i'}</Tex> Pauli operators on qubit <Tex>{'i'}</Tex>, with <Tex>{'q_0'}</Tex> the most significant bit and <Tex>{'Z|1\\rangle = -|1\\rangle'}</Tex>; a loaded Hamiltonian is your list of Pauli strings <Tex>{'P_k'}</Tex> with real coefficients <Tex>{'c_k'}</Tex> in <Unit>eV</Unit>, and <Tex>{'|g\\rangle'}</Tex>, <Tex>{'E_g'}</Tex> are the lowest eigenvector and eigenvalue of the dense matrix.</>,
   sources: ['quantum.ts: pauliTerms, hamiltonianMatrix, solveHamiltonian', 'custom-hamiltonian.ts: customMatrix, solveCustomHamiltonian'] },
  { title: 'Dipole kick and transition weights', lines: [
    String.raw`|v\rangle = D|g\rangle,\qquad\allowbreak D = X_0`,
    String.raw`w_n = |\langle n|v\rangle|^2,\qquad\allowbreak \omega_n = {E_n - E_g},\qquad\allowbreak \sum_n w_n = 1`],
   symbols: <><Tex>{'X_0'}</Tex> flips qubit <Tex>{'q_0'}</Tex>, <Tex>{'|n\\rangle'}</Tex> and <Tex>{'E_n'}</Tex> are the eigenvectors and eigenvalues, <Tex>{'w_n'}</Tex> dimensionless weights and <Tex>{'\\omega_n'}</Tex> excitation energies in <Unit>eV</Unit>; the weights sum to one because <Tex>{'X_0'}</Tex> is unitary, and the elastic term at <Tex>{'\\omega = 0'}</Tex> is kept and labeled.</>,
   sources: ['quantum.ts: simulateQuantum', 'custom-hamiltonian.ts: simulateCustomQuantum'] },
  { title: 'Exact propagation', lines: [
    String.raw`|\psi(t)\rangle = e^{-i(H - E_g)t}\,|v\rangle = \sum_n e^{-i\omega_n t}\,|n\rangle\langle n|v\rangle`,
    String.raw`t_j = j\,\Delta t,\qquad\allowbreak \Delta t = \frac{T}{N - 1},\qquad\allowbreak {j = 0, \ldots, N - 1}`],
   symbols: <><Tex>{'t'}</Tex> is time in <Unit>eV⁻¹</Unit> with <Tex>{'\\hbar = 1'}</Tex>, so <Tex>{'1\\ \\mathrm{eV}^{-1} \\approx 0.6582\\ \\mathrm{fs}'}</Tex>, <Tex>{'T'}</Tex> is the observation time and <Tex>{'N'}</Tex> the number of time samples.</>,
   sources: ['quantum.ts: evolveExact, simulateQuantum', 'custom-hamiltonian.ts: evolveCustomExact'] },
  { title: 'First-order product formula', lines: [
    String.raw`|\psi_r(t)\rangle = e^{iE_g t}\left[e^{-ic_M P_M t/r}\cdots e^{-ic_1 P_1 t/r}\right]^r|v\rangle`,
    String.raw`e^{-i\theta P} = \cos\theta\,I - i\sin\theta\,P`],
   symbols: <><Tex>{'c_k P_k'}</Tex> are the <Tex>{'M'}</Tex> Pauli terms of <Tex>{'H'}</Tex> in the order listed, term <Num>1</Num> applied first, <Tex>{'r'}</Tex> is the number of Trotter steps spread over <Tex>{'[0, t]'}</Tex> at every sampled <Tex>{'t'}</Tex>, and each factor is exact because <Tex>{'P^2 = I'}</Tex>; the phase <Tex>{'e^{iE_g t}'}</Tex> matches the exact branch.</>,
   sources: ['quantum.ts: evolveTrotter', 'custom-hamiltonian.ts: evolveCustomTrotter'] },
  { title: 'Correlation function', lines: [
    String.raw`C(t) = \langle g|D^\dagger e^{-i(H - E_g)t} D|g\rangle = \sum_n w_n\,e^{-i\omega_n t}`,
    String.raw`C_r(t) = \langle v|\psi_r(t)\rangle`],
   symbols: <><Tex>{'C'}</Tex> is the dimensionless return amplitude of the kicked state, with <Tex>{'C(0) = 1'}</Tex>, and <Tex>{'C_r'}</Tex> the same overlap for the product-formula state.</>,
   sources: ['quantum.ts: simulateQuantum, inner'] },
  { title: 'Fourier reconstruction', lines: [
    String.raw`S(\omega_k) = \frac{\Delta t}{\pi}\,\mathrm{Re}\sum_{j=0}^{N-1} z_j\,e^{+i\omega_k t_j}`,
    String.raw`z_j = c_j\,C(t_j)\,e^{-\eta t_j}\,w(t_j),\qquad\allowbreak {w(t) = \tfrac{1}{2}\,[1 + \cos(\pi t/T)]}`,
    String.raw`\omega_k = k\,\Delta\omega,\qquad\allowbreak \Delta\omega = \frac{2\pi}{PN\,\Delta t},\qquad\allowbreak k = {0, \ldots, PN/2}`],
   symbols: <><Tex>{'\\eta'}</Tex> is the lifetime broadening, a Lorentzian half width at half maximum in <Unit>eV</Unit>, <Tex>{'w'}</Tex> the cosine taper (<Tex>{'w = 1'}</Tex> with no taper), <Tex>{'c_j'}</Tex> the trapezoid weights (<Tex>{'1/2'}</Tex> at both ends, <Num>1</Num> between), <Tex>{'P'}</Tex> the zero-padding factor of the length-<Tex>{'PN'}</Tex> FFT and <Tex>{'S'}</Tex> the spectrum in <Unit>eV⁻¹</Unit>; this is the trapezoid rule for <Tex>{'\\tfrac{1}{\\pi}\\,\\mathrm{Re}\\int_0^T C(t)\\,e^{i\\omega t}e^{-\\eta t}w(t)\\,dt'}</Tex>, <Tex>{'S_r'}</Tex> is built from <Tex>{'C_r'}</Tex> the same way, and plots show <Tex>{'\\max(0, S)'}</Tex> with the removed area reported.</>,
   sources: ['quantum.ts: reconstructSpectrum, positiveFFT'] },
  { title: 'Lorentzian reference', lines: [String.raw`L(\omega) = \sum_n \frac{w_n}{\pi}\,\frac{\eta}{(\omega - \omega_n)^2 + \eta^2}`],
   symbols: <>Each line has half width <Tex>{'\\eta'}</Tex> at half maximum and area <Tex>{'w_n'}</Tex>; <Tex>{'L'}</Tex> is the <Tex>{'T \\to \\infty'}</Tex> limit of the same transform with no taper, and it includes the elastic line at <Tex>{'\\omega = 0'}</Tex>.</>,
   sources: ['quantum.ts: simulateQuantum'] },
  { title: 'State fidelity', lines: [String.raw`F(t) = |\langle\psi(t)|\psi_r(t)\rangle|^2`],
   symbols: <><Tex>{'F'}</Tex> compares the exact and product-formula states started from the same <Tex>{'|v\\rangle'}</Tex>, is clipped to <Tex>{'[0, 1]'}</Tex>, and the results show <Tex>{'F(T)'}</Tex>; it is the fidelity of one input state, not an average gate fidelity.</>,
   sources: ['quantum.ts: simulateQuantum'] },
  { title: 'Spectral errors', lines: [
    String.raw`{\epsilon_r = \frac{\int|S_r - S|\,d\omega}{\int|S|\,d\omega}},\qquad\allowbreak {\epsilon_L = \frac{\int|S - L|\,d\omega}{\int L\,d\omega}}`,
    String.raw`\mathrm{RMSE} = \sqrt{\frac{1}{K}\sum_k [S(\omega_k) - L(\omega_k)]^2}`],
   symbols: <>The integrals are trapezoid sums over the <Tex>{'K = PN/2 + 1'}</Tex> grid energies of the signed, unclipped spectra; <Tex>{'\\epsilon_r'}</Tex> is shown as Spectrum error vs exact and <Tex>{'\\epsilon_L'}</Tex> as Fourier / Lorentzian <Tex>{'L^1'}</Tex>, both dimensionless, and the RMSE as Fourier / reference RMSE in <Unit>eV⁻¹</Unit>.</>,
   sources: ['quantum.ts: simulateQuantum'] },
  { title: 'Resolution and Nyquist energy', lines: [String.raw`\delta\omega = \frac{2\pi}{T},\qquad\allowbreak {\omega_{\mathrm{Nyq}} = \frac{\pi}{\Delta t} = \frac{\pi\,(N - 1)}{T}}`],
   symbols: <><Tex>{'\\delta\\omega'}</Tex> is the nominal resolution in <Unit>eV</Unit>, which zero padding does not improve (it only refines <Tex>{'\\Delta\\omega'}</Tex>), and <Tex>{'\\omega_{\\mathrm{Nyq}}'}</Tex> the highest energy the time sampling can represent; a run warns when any weighted <Tex>{'\\omega_n'}</Tex> lies above it.</>,
   sources: ['quantum.ts: simulateQuantum, reconstructSpectrum'] },
 ] },
];

/** Memoized: about 300 KaTeX renders that never change, so parent state updates skip them. */
export const ModelEquations = memo(function ModelEquations() {
  return <>{MODEL_EQUATIONS.map(group => <section key={group.title} className="model-equations">
    <h3>{group.title}</h3>
    {group.equations.map(e => <div key={e.title} className="model-equation">
      <p><strong>{e.title}</strong></p>
      <div className="equation">{e.lines.map(line => <Tex block key={line}>{line}</Tex>)}</div>
      <p>{e.symbols}</p>
      {e.note && <p className="muted">{e.note}</p>}
      <p className="muted">{e.sources.length > 1 ? 'Sources: ' : 'Source: '}{e.sources.map((s, i) => <span key={s}>{i > 0 && '; '}<code>{s}</code></span>)}</p>
    </div>)}
  </section>)}</>;
});
