import { mu, scan, type XASParams } from './xas';
import { validateScenario, type LabState } from './scenario';

export interface Spectrum {
  id: string;
  name: string;
  provenance: 'synthetic' | 'imported' | 'tabulated';
  energy_eV: number[];
  /** Absolute linear coefficient in cm^-1, unless `quantity` says the values are dimensionless. */
  mu_cm_inv: number[];
  sigma_mu_cm_inv?: number[];
  /**
   * Absent: absolute linear absorption coefficient (cm^-1). 'normalized' and 'flattened' are the
   * dimensionless Larch pre_edge outputs `norm` and `flat` from the Measured data workflow. They are
   * exported as mu_norm / mu_flat, never as mu_cm_inv.
   */
  quantity?: SpectrumQuantity;
  parameters?: XASParams;
  source?: string;
  sourceSha256?: string;
  sampleId?: string;
  notes?: string;
  calibration?: { reference: string; offset_eV: number; status: 'uncalibrated' | 'user-declared' };
  /** An imported file's declaration is retained, but is not independently verified. */
  declaredProvenance?: 'synthetic' | 'imported' | 'tabulated';
}

export type SpectrumQuantity = 'normalized' | 'flattened';
/** Column and JSON field names that carry each quantity's unit. */
const QUANTITY_FIELDS = { normalized: 'mu_norm', flattened: 'mu_flat' } as const;
const fieldQuantity = (field: string): SpectrumQuantity | undefined => (Object.keys(QUANTITY_FIELDS) as SpectrumQuantity[]).find(q => QUANTITY_FIELDS[q] === field);

/** Unit of the stored values, as text: cm^-1 or dimensionless. */
export const spectrumUnit = (spectrum: Pick<Spectrum, 'quantity'>) => spectrum.quantity ? 'dimensionless' : 'cm^-1';
/** Whether two curves can share a value axis. */
export const sameUnits = (a: Pick<Spectrum, 'quantity'>, b: Pick<Spectrum, 'quantity'>) => !a.quantity === !b.quantity;

export const MAX_SPECTRUM_ROWS = 20000;
export const MAX_SPECTRUM_BYTES = 5_000_000;

function finiteArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some(number => typeof number !== 'number' || !Number.isFinite(number))) throw new Error(`${label} must be an array of finite numbers.`);
  return [...value];
}

function textField(value: unknown, key: string, max = 2000): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new Error(`${key} must be text with at most ${max} characters.`);
  return value;
}

/** Absolute linear coefficients, or dimensionless normalized curves marked by `quantity`. Arbitrary units are not accepted. */
export function validateSpectrum(input: unknown): Spectrum {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Spectrum must be an object.');
  const data = input as Record<string, unknown>;
  const energy = finiteArray(data.energy_eV, 'energy_eV');
  const coefficient = finiteArray(data.mu_cm_inv, 'mu_cm_inv (absolute coefficient in cm^-1)');
  if (energy.length < 5 || energy.length > MAX_SPECTRUM_ROWS) throw new Error(`Spectrum must contain 5 to ${MAX_SPECTRUM_ROWS} rows.`);
  if (coefficient.length !== energy.length) throw new Error('Energy and absorption arrays must have equal lengths.');
  if (energy.some((value, i) => value < 0 || value > 1e9 || (i > 0 && value <= energy[i - 1]))) throw new Error('Energies must be nonnegative and strictly increasing in eV.');
  if (coefficient.some(value => Math.abs(value) > 1e9)) throw new Error('Absorption coefficients exceed the supported range.');
  if (data.provenance !== 'synthetic' && data.provenance !== 'imported' && data.provenance !== 'tabulated') throw new Error('Spectrum provenance must be synthetic or imported.');
  if (data.quantity !== undefined && data.quantity !== 'normalized' && data.quantity !== 'flattened') throw new Error('Spectrum quantity must be normalized or flattened when given.');
  const quantity = data.quantity as SpectrumQuantity | undefined;
  let sigma: number[] | undefined;
  if (data.sigma_mu_cm_inv !== undefined) {
    if (quantity) throw new Error('Pointwise uncertainties are supported only for absolute cm^-1 coefficients.');
    sigma = finiteArray(data.sigma_mu_cm_inv, 'sigma_mu_cm_inv');
    if (sigma.length !== energy.length || sigma.some(value => value <= 0 || value > 1e9)) throw new Error('Uncertainties must be positive cm^-1 values, one per row.');
  }
  let calibration: Spectrum['calibration'];
  if (data.calibration !== undefined) {
    if (!data.calibration || typeof data.calibration !== 'object' || Array.isArray(data.calibration)) throw new Error('Calibration must be an object.');
    const item = data.calibration as Record<string, unknown>;
    if (item.status !== 'uncalibrated' && item.status !== 'user-declared') throw new Error('Unsupported calibration status.');
    if (typeof item.offset_eV !== 'number' || !Number.isFinite(item.offset_eV) || Math.abs(item.offset_eV) > 1000) throw new Error('Calibration offset must be finite and within ±1000 eV.');
    const reference = textField(item.reference, 'Calibration reference', 512);
    if (reference === undefined || (item.status === 'user-declared' && !reference.trim())) throw new Error('User-declared calibration requires a reference.');
    calibration = { reference, offset_eV: item.offset_eV, status: item.status };
  }
  let parameters: XASParams | undefined;
  if (data.parameters !== undefined) {
    if (!data.parameters || typeof data.parameters !== 'object' || Array.isArray(data.parameters)) throw new Error('Model parameters must be an object.');
    const item = data.parameters as Record<string, unknown>;
    const bounds: Record<keyof XASParams, [number, number]> = { x: [0, 1], edge: [6530, 6580], shift: [-10, 10], width: [0.2, 8], whiteLine: [0, 300], preEdge: [0, 100], oscillation: [0, 0.3] };
    parameters = {} as XASParams;
    for (const [key, [low, high]] of Object.entries(bounds)) {
      const value = item[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new Error(`Invalid model parameter: ${key}.`);
      parameters[key as keyof XASParams] = value;
    }
  }
  if (data.declaredProvenance !== undefined && data.declaredProvenance !== 'synthetic' && data.declaredProvenance !== 'imported' && data.declaredProvenance !== 'tabulated') throw new Error('Invalid declared provenance.');
  if (data.sourceSha256 !== undefined && (typeof data.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sourceSha256))) throw new Error('Source SHA-256 must be a lowercase 64-digit hexadecimal hash.');
  return {
    id: textField(data.id, 'id', 200) ?? 'imported-spectrum',
    name: textField(data.name, 'name', 200) ?? 'Imported spectrum',
    provenance: data.provenance,
    energy_eV: energy,
    mu_cm_inv: coefficient,
    sigma_mu_cm_inv: sigma,
    quantity,
    source: textField(data.source, 'source', 512),
    sourceSha256: data.sourceSha256 as string | undefined,
    sampleId: textField(data.sampleId, 'sampleId', 200),
    notes: textField(data.notes, 'notes', 8000),
    calibration,
    parameters,
    declaredProvenance: data.declaredProvenance,
  };
}

export function snapshotSpectrum(params: XASParams, name?: string): Spectrum {
  const parameters: XASParams = { x: params.x, edge: params.edge, shift: params.shift, width: params.width, whiteLine: params.whiteLine, preEdge: params.preEdge, oscillation: params.oscillation };
  return {
    ...scan(parameters), id: `synthetic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name ?? `Li loading x = ${params.x.toFixed(2)}`, provenance: 'synthetic', parameters,
    calibration: { reference: 'Illustrative energy axis; no experimental calibration', offset_eV: 0, status: 'uncalibrated' },
  };
}

/** mu_norm / mu_flat arrays become the stored values with their quantity; only one value array is allowed. */
function fromFieldNames(input: Record<string, unknown>): Record<string, unknown> {
  const { mu_norm, mu_flat, quantity, ...rest } = input;
  const given = (['mu_cm_inv', 'mu_norm', 'mu_flat'] as const).filter(field => input[field] !== undefined);
  if (given.length > 1) throw new Error('Give one value array: mu_cm_inv, mu_norm or mu_flat.');
  if (!given.length || given[0] === 'mu_cm_inv') {
    if (quantity !== undefined) throw new Error('mu_cm_inv holds absolute cm^-1 coefficients; use mu_norm or mu_flat for normalized curves.');
    return rest;
  }
  return { ...rest, mu_cm_inv: given[0] === 'mu_norm' ? mu_norm : mu_flat, quantity: fieldQuantity(given[0]) };
}

function imported(input: Record<string, unknown>, filename: string): Spectrum {
  const declared = input.declaredProvenance ?? input.provenance;
  return validateSpectrum({ ...fromFieldNames(input), provenance: 'imported', declaredProvenance: declared, source: input.source ?? filename, id: input.id ?? `imported-${Date.now()}`, name: input.name ?? filename });
}

/** The units object must agree with the value field: cm^-1 for mu_cm_inv, normalized for mu_norm, flattened for mu_flat. */
function checkUnits(units: unknown, spectrum: Record<string, unknown>) {
  const item = units && typeof units === 'object' ? units as Record<string, unknown> : {};
  if (item.energy !== 'eV' || !['cm^-1', 'normalized', 'flattened'].includes(item.mu as string)) throw new Error('JSON units must be eV and cm^-1 (absolute linear coefficient), or eV and normalized or flattened.');
  const expected = spectrum.mu_norm !== undefined ? 'normalized' : spectrum.mu_flat !== undefined ? 'flattened' : 'cm^-1';
  if (item.mu !== expected) throw new Error(`JSON units say ${item.mu}, but the values are given as ${expected === 'cm^-1' ? 'mu_cm_inv' : QUANTITY_FIELDS[expected]}.`);
}

/** Import a strict units-bearing CSV or JSON. Import never certifies a dataset as measured. */
export function parseSpectrum(text: string, filename = 'Imported spectrum'): Spectrum {
  if (new TextEncoder().encode(text).length > MAX_SPECTRUM_BYTES) throw new Error('Spectrum exceeds the 5 MB file limit.');
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (trimmed.startsWith('{') || filename.toLowerCase().endsWith('.json')) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { throw new Error('Spectrum is not valid JSON.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON requires a spectrum object with energy_eV and mu_cm_inv arrays.');
    const envelope = parsed as Record<string, unknown>;
    if ('schema' in envelope) {
      if (envelope.schema !== 'quantum-battery-xas-spectrum' || envelope.version !== 1) throw new Error('Unsupported spectrum schema or version.');
      if (!envelope.spectrum || typeof envelope.spectrum !== 'object' || Array.isArray(envelope.spectrum)) throw new Error('Missing spectrum object.');
      checkUnits(envelope.units, envelope.spectrum as Record<string, unknown>);
      return imported(envelope.spectrum as Record<string, unknown>, filename);
    }
    // Plain arrays carry their units in the exact field names. Generic mu/energy is rejected.
    if (envelope.units !== undefined) checkUnits(envelope.units, envelope);
    const { units: _units, ...plain } = envelope;
    return imported(plain, filename);
  }
  const lines = trimmed.split(/\r?\n/).filter(line => line.trim());
  let metadata: Record<string, unknown> = {};
  const rows: string[] = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('#')) {
      const match = line.match(/^\s*#\s*metadata:\s*(.*)$/);
      if (match) {
        try {
          const candidate: unknown = JSON.parse(match[1]);
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('object required');
          metadata = candidate as Record<string, unknown>;
        } catch { throw new Error('CSV metadata is not a valid JSON object.'); }
      }
    } else rows.push(line);
  }
  if (!rows.length) throw new Error('CSV is empty.');
  const header = rows[0].split(',').map(value => value.trim());
  const valueColumn = ['mu_cm_inv', 'mu_norm', 'mu_flat'].filter(name => header.includes(name));
  const allowed = valueColumn[0] === 'mu_cm_inv' ? ['energy_eV', 'mu_cm_inv', 'sigma_mu_cm_inv'] : ['energy_eV', ...valueColumn];
  if (new Set(header).size !== header.length || valueColumn.length !== 1 || header.some(value => !allowed.includes(value)) || !header.includes('energy_eV')) {
    throw new Error('CSV headers must be energy_eV,mu_cm_inv with optional sigma_mu_cm_inv, where mu is an absolute cm^-1 coefficient. Normalized curves use energy_eV,mu_norm or energy_eV,mu_flat. Arbitrary units are not accepted.');
  }
  if (rows.length - 1 > MAX_SPECTRUM_ROWS) throw new Error(`CSV exceeds ${MAX_SPECTRUM_ROWS} rows.`);
  const energy: number[] = [], coefficient: number[] = [], sigma: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(',').map(cell => cell.trim());
    if (cells.length !== header.length || cells.some(cell => cell === '' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell))) throw new Error(`Invalid numeric CSV row ${i + 1}.`);
    energy.push(Number(cells[header.indexOf('energy_eV')]));
    coefficient.push(Number(cells[header.indexOf(valueColumn[0])]));
    if (header.includes('sigma_mu_cm_inv')) sigma.push(Number(cells[header.indexOf('sigma_mu_cm_inv')]));
  }
  const { quantity: _quantity, mu_cm_inv: _mu, mu_norm: _norm, mu_flat: _flat, ...described } = metadata;
  return imported({ ...described, energy_eV: energy, [valueColumn[0]]: coefficient, sigma_mu_cm_inv: sigma.length ? sigma : undefined }, filename);
}

const QUANTITY_TEXT = { normalized: 'Normalized absorption (Larch pre_edge norm); energy=eV; mu_norm dimensionless', flattened: 'Flattened normalized absorption (Larch pre_edge flat); energy=eV; mu_flat dimensionless' } as const;

export function spectrumToCSV(spectrum: Spectrum): string {
  const checked = validateSpectrum(spectrum);
  const { energy_eV, mu_cm_inv, sigma_mu_cm_inv, quantity, ...metadata } = checked;
  const header = `energy_eV,${quantity ? QUANTITY_FIELDS[quantity] : 'mu_cm_inv'}${sigma_mu_cm_inv ? ',sigma_mu_cm_inv' : ''}`;
  const rows = energy_eV.map((energy, i) => `${energy},${mu_cm_inv[i]}${sigma_mu_cm_inv ? `,${sigma_mu_cm_inv[i]}` : ''}`);
  return [`# ${quantity ? QUANTITY_TEXT[quantity] : 'Absolute linear absorption coefficient; energy=eV; mu=cm^-1'}`, `# metadata: ${JSON.stringify(metadata)}`, header, ...rows].join('\n');
}

export function spectrumToJSON(spectrum: Spectrum): string {
  const checked = validateSpectrum(spectrum);
  if (!checked.quantity) return JSON.stringify({ schema: 'quantum-battery-xas-spectrum', version: 1, units: { energy: 'eV', mu: 'cm^-1' }, spectrum: checked }, null, 2);
  const { mu_cm_inv, quantity, ...rest } = checked;
  return JSON.stringify({ schema: 'quantum-battery-xas-spectrum', version: 1, units: { energy: 'eV', mu: quantity }, spectrum: { ...rest, [QUANTITY_FIELDS[quantity]]: mu_cm_inv } }, null, 2);
}

/** Subtract first-window mean and divide by last-minus-first mean; no XAFS background fit. */
export function normalizeSpectrum(spectrum: Spectrum): number[] {
  const values = spectrum.mu_cm_inv;
  const count = Math.max(1, Math.floor(values.length * 0.1));
  const average = (items: number[]) => items.reduce((a, b) => a + b, 0) / items.length;
  const pre = average(values.slice(0, count)), post = average(values.slice(-count));
  if (!Number.isFinite(post - pre) || Math.abs(post - pre) < 1e-12) throw new Error('Endpoint normalization is undefined: endpoint window means are equal.');
  return values.map(value => (value - pre) / (post - pre));
}

/** Three-point nonuniform derivative internally, two-point endpoints. Units cm^-1/eV. */
export function derivativeSpectrum(spectrum: Spectrum): number[] {
  const x = spectrum.energy_eV, y = spectrum.mu_cm_inv;
  if (x.length !== y.length || x.length < 2 || x.some((value, i) => !Number.isFinite(value) || (i > 0 && value <= x[i - 1])) || y.some(value => !Number.isFinite(value))) throw new Error('Derivative requires finite arrays on a strictly increasing energy grid.');
  const derivative = x.map((_, i) => {
    if (i === 0) return (y[1] - y[0]) / (x[1] - x[0]);
    if (i === x.length - 1) return (y[i] - y[i - 1]) / (x[i] - x[i - 1]);
    const before = x[i] - x[i - 1], after = x[i + 1] - x[i];
    return -after * y[i - 1] / (before * (before + after)) + (after - before) * y[i] / (before * after) + before * y[i + 1] / (after * (before + after));
  });
  if (derivative.some(value => !Number.isFinite(value))) throw new Error('Energy spacing is too small for a finite numerical derivative.');
  return derivative;
}

export function estimateEdge(spectrum: Spectrum, method: 'derivative' | 'half-height' = 'derivative'): number | null {
  if (method === 'derivative') {
    const derivative = derivativeSpectrum(spectrum);
    let index = 0;
    for (let i = 1; i < derivative.length; i++) if (derivative[i] > derivative[index]) index = i;
    return derivative[index] > 0 ? spectrum.energy_eV[index] : null;
  }
  let normalized: number[];
  try { normalized = normalizeSpectrum(spectrum); } catch { return null; }
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i - 1] <= 0.5 && normalized[i] >= 0.5 && normalized[i] > normalized[i - 1]) {
      const fraction = (0.5 - normalized[i - 1]) / (normalized[i] - normalized[i - 1]);
      return spectrum.energy_eV[i - 1] + fraction * (spectrum.energy_eV[i] - spectrum.energy_eV[i - 1]);
    }
  }
  return null;
}

export interface FitResult {
  shift_eV: number;
  scale: number;
  baseline_cm_inv: number;
  rmse_cm_inv: number;
  reducedChiSquare: number | null;
  fitted: number[];
  residuals: number[];
  weighted: boolean;
  boundary: boolean;
  caveat: string;
}

/** Grid shift [-10,+10] eV in 0.1-eV steps + analytic nonnegative scale/intercept fit. */
export function fitSpectrum(spectrum: Spectrum, params: XASParams, onProgress?: (fraction: number) => void): FitResult {
  const checked = validateSpectrum(spectrum), y = checked.mu_cm_inv;
  const rawWeights = checked.sigma_mu_cm_inv?.map(sigma => 1 / sigma ** 2) ?? y.map(() => 1);
  const maximumWeight = Math.max(...rawWeights);
  if (!Number.isFinite(maximumWeight) || maximumWeight === 0) throw new Error('Uncertainties are outside the stable numerical weighting range.');
  const weights = rawWeights.map(weight => weight / maximumWeight);
  const sumWeight = weights.reduce((a, b) => a + b, 0);
  const yMean = y.reduce((sum, value, i) => sum + value * weights[i], 0) / sumWeight;
  let best: { objective: number; shift: number; scale: number; baseline: number; fitted: number[] } | undefined;
  for (let step = -100; step <= 100; step++) {
    const shift = step / 10;
    const basis = checked.energy_eV.map(energy => mu(energy, { ...params, edge: params.edge + shift }));
    const xMean = basis.reduce((sum, value, i) => sum + value * weights[i], 0) / sumWeight;
    let variance = 0, covariance = 0;
    for (let i = 0; i < y.length; i++) { variance += weights[i] * (basis[i] - xMean) ** 2; covariance += weights[i] * (basis[i] - xMean) * (y[i] - yMean); }
    const scale = variance > 1e-20 ? Math.max(0, covariance / variance) : 0;
    const baseline = yMean - scale * xMean;
    const fitted = basis.map(value => baseline + scale * value);
    const objective = y.reduce((sum, value, i) => sum + weights[i] * (value - fitted[i]) ** 2, 0);
    if (!best || objective < best.objective) best = { objective, shift, scale, baseline, fitted };
    if (step % 10 === 0) onProgress?.((step + 100) / 200);
  }
  if (!best) throw new Error('Fit failed.');
  const residuals = y.map((value, i) => value - best!.fitted[i]);
  const rmse = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / y.length);
  const chi = checked.sigma_mu_cm_inv ? residuals.reduce((sum, value, i) => sum + (value / checked.sigma_mu_cm_inv![i]) ** 2, 0) / (y.length - 3) : null;
  return {
    shift_eV: best.shift, scale: best.scale, baseline_cm_inv: best.baseline, rmse_cm_inv: rmse,
    reducedChiSquare: chi, fitted: best.fitted, residuals, weighted: !!checked.sigma_mu_cm_inv,
    boundary: Math.abs(best.shift) >= 10 || best.scale === 0,
    caveat: 'Illustrative synthetic-shape fit only: shift grid ±10 eV / 0.1 eV, nonnegative scale and constant baseline. Residual = data − model. No chemical-valence, structure, calibration or parameter-confidence inference. Reduced χ² assumes independent supplied 1σ errors and 3 fitted parameters; grid search and correlations limit its interpretation.',
  };
}

export type SpectrumView = 'raw' | 'normalized' | 'derivative';

export function spectrumProvenance(spectrum: Spectrum): string {
  if (spectrum.provenance === 'tabulated') return 'Tabulated atomic data';
  if (spectrum.declaredProvenance === 'tabulated') return 'Imported tabulated data';
  return spectrum.provenance === 'synthetic' ? 'Synthetic educational model' : spectrum.declaredProvenance === 'synthetic' ? 'Imported synthetic' : 'Imported data (user supplied)';
}

/** A display transform never overwrites the stored raw arrays or claims propagated uncertainty. */
export function spectrumView(spectrum: Spectrum, view: SpectrumView, applyCalibration = false) {
  const offset = applyCalibration && spectrum.calibration?.status === 'user-declared' ? spectrum.calibration.offset_eV : 0;
  return {
    energy_eV: spectrum.energy_eV.map(energy => energy + offset),
    values: view === 'raw' ? [...spectrum.mu_cm_inv] : view === 'normalized' ? normalizeSpectrum(spectrum) : derivativeSpectrum(spectrum),
    sigma: view === 'raw' ? spectrum.sigma_mu_cm_inv?.slice() : undefined,
    valueUnit: view === 'raw' ? spectrumUnit(spectrum) : view === 'normalized' ? 'dimensionless' : spectrum.quantity ? 'eV^-1' : 'cm^-1/eV',
    appliedOffset_eV: offset,
  };
}

export function spectrumManifest(spectrum: Spectrum, state: LabState, view: SpectrumView, applyCalibration: boolean, fit?: { parameters: XASParams; result: FitResult }) {
  const checked = validateSpectrum(spectrum);
  return {
    schema: 'quantum-battery-xas-run', version: 1, appVersion: '0.1.0', exportedAt: new Date().toISOString(),
    codeRevision: 'Record the publishing commit separately',
    provenanceLabel: spectrumProvenance(checked), sourceIntegrity: checked.sourceSha256 ? 'SHA-256 of the original imported bytes' : 'No original-file hash available',
    units: { rawEnergy: 'eV', rawAbsorption: checked.quantity ? `dimensionless (Larch pre_edge ${checked.quantity === 'normalized' ? 'norm' : 'flat'})` : 'cm^-1', rawSigma: 'cm^-1 (pointwise standard deviation supplied by user)' },
    rawSpectrum: checked, laboratoryContext: validateScenario(state),
    processing: { view, normalization: view === 'normalized' ? 'Subtract mean of first 10% of rows; divide by last 10% mean minus first 10% mean' : null,
      derivative: view === 'derivative' ? 'Three-point nonuniform interior derivative; two-point endpoints' : null,
      calibration: applyCalibration ? 'Display energy = raw energy + user-declared offset; raw arrays preserved' : 'Calibration metadata only; no energy correction applied',
      uncertainty: view === 'raw' ? 'Supplied pointwise sigma only; excludes unspecified systematic errors' : 'Uncertainty is not propagated through this transform' },
    displayed: spectrumView(checked, view, applyCalibration),
    fit: fit ? { ...fit, energyAxis: 'Raw energy (eV); calibration display offset not fitted', model: 'Synthetic logistic/feature basis, fixed shape; fitted shift, nonnegative scale and baseline' } : null,
    limitations: ['An imported file is user supplied; measurement origin and calibration are unverified.', 'Synthetic models and descriptive fits do not predict cathode properties or establish chemical valence.'],
  };
}
