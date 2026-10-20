import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE } from './scenario';
import { MAX_SPECTRUM_BYTES, derivativeSpectrum, estimateEdge, fitSpectrum, normalizeSpectrum, parseSpectrum, snapshotSpectrum, spectrumManifest, spectrumProvenance, spectrumToCSV, spectrumToJSON, spectrumView, validateSpectrum, type Spectrum } from './spectra';
import { mu } from './xas';

const measured: Spectrum = {
  id: 'supplied-1', name: 'User supplied; quality unverified', provenance: 'imported',
  energy_eV: [6540, 6541, 6543, 6546, 6550], mu_cm_inv: [2, 4, 9, 14, 20],
  sigma_mu_cm_inv: [0.1, 0.2, 0.3, 0.4, 0.5], sampleId: 'batch-A',
  notes: 'Raw absolute coefficient, independently supplied.', source: 'user.csv',
  calibration: { reference: 'User reference foil, not verified', offset_eV: 0.4, status: 'user-declared' },
};

describe('strict unit and provenance contracts', () => {
  it.each(['CSV', 'JSON'])('preserves raw data, uncertainties and metadata through %s', format => {
    const serialized = format === 'CSV' ? spectrumToCSV(measured) : spectrumToJSON(measured);
    const parsed = parseSpectrum(serialized, `export.${format.toLowerCase()}`);
    expect(parsed.energy_eV).toEqual(measured.energy_eV);
    expect(parsed.mu_cm_inv).toEqual(measured.mu_cm_inv);
    expect(parsed.sigma_mu_cm_inv).toEqual(measured.sigma_mu_cm_inv);
    expect(parsed.calibration).toEqual(measured.calibration);
    expect(parsed.sampleId).toBe('batch-A');
    expect(parsed.notes).toBe(measured.notes);
    expect(parsed.provenance).toBe('imported');
  });

  const normalized: Spectrum = { ...measured, id: 'norm-1', sigma_mu_cm_inv: undefined, mu_cm_inv: [0, 0.02, 0.6, 1.1, 1], quantity: 'normalized' };

  it.each(['CSV', 'JSON'])('exports a normalized curve as dimensionless mu_norm and reads it back through %s', format => {
    const serialized = format === 'CSV' ? spectrumToCSV(normalized) : spectrumToJSON(normalized);
    expect(serialized).toContain('mu_norm');
    expect(serialized).not.toContain('mu_cm_inv');
    expect(serialized).not.toContain('cm^-1');
    const parsed = parseSpectrum(serialized, `norm.${format.toLowerCase()}`);
    expect(parsed.quantity).toBe('normalized');
    expect(parsed.mu_cm_inv).toEqual(normalized.mu_cm_inv);
    expect(parseSpectrum(format === 'CSV' ? spectrumToCSV({ ...normalized, quantity: 'flattened' }) : spectrumToJSON({ ...normalized, quantity: 'flattened' })).quantity).toBe('flattened');
  });

  it('keeps units and value fields consistent for normalized curves', () => {
    const envelope = JSON.parse(spectrumToJSON(normalized));
    expect(envelope.units).toEqual({ energy: 'eV', mu: 'normalized' });
    expect(() => parseSpectrum(JSON.stringify({ ...envelope, units: { energy: 'eV', mu: 'cm^-1' } }))).toThrow('mu_norm');
    expect(() => parseSpectrum(JSON.stringify({ energy_eV: measured.energy_eV, mu_cm_inv: measured.mu_cm_inv, quantity: 'normalized' }))).toThrow('mu_norm or mu_flat');
    expect(() => parseSpectrum(JSON.stringify({ energy_eV: measured.energy_eV, mu_cm_inv: measured.mu_cm_inv, mu_norm: measured.mu_cm_inv }))).toThrow('one value array');
    expect(() => validateSpectrum({ ...normalized, sigma_mu_cm_inv: [1, 1, 1, 1, 1] })).toThrow('only for absolute');
    expect(() => validateSpectrum({ ...normalized, quantity: 'arbitrary' })).toThrow('quantity');
    expect(spectrumView(normalized, 'raw').valueUnit).toBe('dimensionless');
    expect(spectrumView(normalized, 'derivative').valueUnit).toBe('eV^-1');
  });

  it('retains a synthetic declaration on import without claiming measured provenance', () => {
    const synthetic = snapshotSpectrum(DEFAULT_STATE);
    const roundTrip = parseSpectrum(spectrumToJSON(synthetic), 'synthetic.json');
    expect(roundTrip.provenance).toBe('imported');
    expect(roundTrip.declaredProvenance).toBe('synthetic');
    expect(roundTrip.parameters).toEqual(synthetic.parameters);
  });

  it('accepts only explicit absolute coefficient headers and rejects nonnumeric or incomplete rows', () => {
    const rows = '\n1,2\n2,3\n3,4\n4,5\n5,6';
    expect(() => parseSpectrum(`energy,mu${rows}`, 'bad.csv')).toThrow('headers');
    expect(() => parseSpectrum(`energy_eV,mu_normalized${rows}`, 'bad.csv')).toThrow('headers');
    expect(() => parseSpectrum(`energy_eV,mu_norm,mu_cm_inv${rows.replace(/\n(\d),(\d)/g, '\n$1,$2,$2')}`, 'bad.csv')).toThrow('headers');
    expect(() => parseSpectrum(`energy_eV,mu_norm,sigma_mu_cm_inv${rows.replace(/\n(\d),(\d)/g, '\n$1,$2,1')}`, 'bad.csv')).toThrow('headers');
    expect(() => parseSpectrum(`energy_eV,mu_cm_inv${rows}\n6,NaN`, 'bad.csv')).toThrow('numeric');
    expect(() => parseSpectrum(`energy_eV,mu_cm_inv${rows}\n6,`, 'bad.csv')).toThrow('numeric');
    expect(() => parseSpectrum(JSON.stringify({ energy_eV: [1, 2, 3, 4, 5], mu: [1, 2, 3, 4, 5] }), 'bad.json')).toThrow('mu_cm_inv');
    expect(() => parseSpectrum(JSON.stringify({ ...measured, units: { energy: 'keV', mu: 'cm^-1' } }), 'bad.json')).toThrow('units');
  });

  it('validates increasing energies, finite data, positive uncertainties, lengths and calibration', () => {
    expect(() => validateSpectrum({ ...measured, energy_eV: [1, 2, 2, 4, 5] })).toThrow('increasing');
    expect(() => validateSpectrum({ ...measured, mu_cm_inv: [1, 2] })).toThrow('equal');
    expect(() => validateSpectrum({ ...measured, mu_cm_inv: [1, NaN, 3, 4, 5] })).toThrow('finite');
    expect(() => validateSpectrum({ ...measured, sigma_mu_cm_inv: [1, 0, 1, 1, 1] })).toThrow('positive');
    expect(() => validateSpectrum({ ...measured, calibration: { status: 'user-declared', reference: '', offset_eV: 1 } })).toThrow('reference');
    expect(validateSpectrum({ ...measured, mu_cm_inv: [-1, 0, 2, 3, 4] }).mu_cm_inv[0]).toBe(-1);
  });

  it('bounds imports and retains an optional source-byte integrity fingerprint', () => {
    expect(() => parseSpectrum(' '.repeat(MAX_SPECTRUM_BYTES + 1))).toThrow('5 MB');
    const hashed = { ...measured, sourceSha256: 'a'.repeat(64) };
    expect(parseSpectrum(spectrumToJSON(hashed)).sourceSha256).toBe(hashed.sourceSha256);
    expect(() => validateSpectrum({ ...measured, sourceSha256: 'not-a-sha256' })).toThrow('SHA-256');
    expect(spectrumProvenance(measured)).toBe('Imported data (user supplied)');
    expect(spectrumProvenance({ ...measured, declaredProvenance: 'synthetic' })).toBe('Imported synthetic');
  });
});

describe('transparent spectrum transforms and illustrative fitting', () => {
  it('uses the unequal-grid derivative and preserves raw arrays through normalization', () => {
    const x = [1, 2, 4, 7, 11];
    const spectrum = { ...measured, energy_eV: x, mu_cm_inv: x.map(value => value ** 2), sigma_mu_cm_inv: undefined };
    const derivative = derivativeSpectrum(spectrum);
    for (let i = 1; i < x.length - 1; i++) expect(derivative[i]).toBeCloseTo(2 * x[i], 12);
    const before = [...spectrum.mu_cm_inv];
    const normalized = normalizeSpectrum(spectrum);
    expect(normalized[0]).toBe(0);
    expect(normalized.at(-1)).toBe(1);
    expect(spectrum.mu_cm_inv).toEqual(before);
    expect(() => normalizeSpectrum({ ...spectrum, mu_cm_inv: x.map(() => 1) })).toThrow('undefined');
  });

  it('locates the logistic midpoint by two independently defined methods', () => {
    const spectrum = snapshotSpectrum({ ...DEFAULT_STATE, x: 0, whiteLine: 0, preEdge: 0, oscillation: 0 });
    expect(estimateEdge(spectrum, 'derivative')).toBeCloseTo(6550, 1);
    expect(estimateEdge(spectrum, 'half-height')).toBeCloseTo(6550, 1);
  });

  it('fails clearly when pathological energy spacing overflows the derivative', () => {
    const tiny = { ...measured, energy_eV: [0, 1e-320, 2e-320, 3e-320, 4e-320] };
    expect(() => derivativeSpectrum(tiny)).toThrow('spacing');
    expect(() => derivativeSpectrum({ ...measured, energy_eV: [1, 1, 2, 3, 4] })).toThrow('increasing');
  });

  it('applies declared offsets only on explicit display request and keeps transformed uncertainty honest', () => {
    const before = JSON.stringify(measured);
    const raw = spectrumView(measured, 'raw');
    const aligned = spectrumView(measured, 'raw', true);
    expect(raw.energy_eV).toEqual(measured.energy_eV);
    expect(aligned.energy_eV).toEqual(measured.energy_eV.map(value => value + 0.4));
    expect(aligned.sigma).toEqual(measured.sigma_mu_cm_inv);
    expect(spectrumView(measured, 'normalized', true).sigma).toBeUndefined();
    expect(spectrumView(measured, 'derivative', true).sigma).toBeUndefined();
    expect(spectrumView({ ...measured, calibration: { reference: '', offset_eV: 3, status: 'uncalibrated' } }, 'raw', true).appliedOffset_eV).toBe(0);
    expect(JSON.stringify(measured)).toBe(before);
    const manifest = spectrumManifest(measured, DEFAULT_STATE, 'derivative', true);
    expect(manifest.rawSpectrum.energy_eV).toEqual(measured.energy_eV);
    expect(manifest.processing.uncertainty).toContain('not propagated');
    expect(manifest.displayed.valueUnit).toBe('cm^-1/eV');
    expect(manifest.laboratoryContext.seed).toBe(DEFAULT_STATE.seed);
    expect(manifest.version).toBe(1);
    expect(Number.isFinite(Date.parse(manifest.exportedAt))).toBe(true);
  });

  it('recovers a known shift, scale and baseline and reports residuals in original units', () => {
    const spectrum = snapshotSpectrum(DEFAULT_STATE);
    spectrum.mu_cm_inv = spectrum.energy_eV.map(energy => 4 + 1.3 * mu(energy, { ...DEFAULT_STATE, edge: DEFAULT_STATE.edge + 1.7 }));
    spectrum.sigma_mu_cm_inv = spectrum.energy_eV.map(() => 0.5);
    const fit = fitSpectrum(spectrum, DEFAULT_STATE);
    expect(fit.shift_eV).toBeCloseTo(1.7, 8);
    expect(fit.scale).toBeCloseTo(1.3, 8);
    expect(fit.baseline_cm_inv).toBeCloseTo(4, 8);
    expect(fit.rmse_cm_inv).toBeLessThan(1e-8);
    expect(fit.reducedChiSquare).toBeLessThan(1e-12);
    expect(fit.residuals).toHaveLength(spectrum.energy_eV.length);
    expect(fit.weighted).toBe(true);
    expect(fit.boundary).toBe(false);
  });

  it('reports bounded progress from a reproducible fit', () => {
    const progress: number[] = [];
    fitSpectrum(snapshotSpectrum(DEFAULT_STATE), DEFAULT_STATE, value => progress.push(value));
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, i) => value >= 0 && value <= 1 && (i === 0 || value >= progress[i - 1]))).toBe(true);
  });

  it('downweights a high-uncertainty outlier rather than silently treating sigma as decoration', () => {
    const spectrum = snapshotSpectrum(DEFAULT_STATE);
    const outlier = 100;
    spectrum.mu_cm_inv[outlier] += 200;
    const unweighted = fitSpectrum(spectrum, DEFAULT_STATE);
    spectrum.sigma_mu_cm_inv = spectrum.energy_eV.map((_, i) => i === outlier ? 1000 : 1);
    const weighted = fitSpectrum(spectrum, DEFAULT_STATE);
    expect(Math.abs(weighted.scale - 1)).toBeLessThan(Math.abs(unweighted.scale - 1));
    expect(weighted.weighted).toBe(true);
    expect(weighted.residuals[outlier]).toBeGreaterThan(199);
  });
});
