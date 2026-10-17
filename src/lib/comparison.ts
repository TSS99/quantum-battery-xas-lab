import { validateSpectrum, type Spectrum } from './spectra';
export function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v), result = values.map(() => 0);
  for (let i = 0; i < order.length;) {
    let end = i + 1;
    while (end < order.length && order[end].v === order[i].v) end++;
    const rank = (i + 1 + end) / 2;
    for (let j = i; j < end; j++) result[order[j].i] = rank;
    i = end;
  }
  return result;
}
function cosine(a: number[], b: number[]): number | null {
  const aa = a.reduce((s, v) => s + v * v, 0), bb = b.reduce((s, v) => s + v * v, 0);
  return aa > 0 && bb > 0 ? Math.max(-1, Math.min(1, a.reduce((s, v, i) => s + v * b[i], 0) / Math.sqrt(aa * bb))) : null;
}
const centred = (a: number[]) => { const mean = a.reduce((s, v) => s + v, 0) / a.length; return a.map(v => v - mean); };
export function similarityMetrics(a: number[], b: number[]) {
  if (a.length !== b.length || a.length < 3 || [...a, ...b].some(v => !Number.isFinite(v))) throw new Error('Scores need equal finite arrays with at least three points.');
  return { cosine: cosine(a, b), pearson: cosine(centred(a), centred(b)), spearman: cosine(centred(ranks(a)), centred(ranks(b))) };
}
/** Compare raw linear coefficients on the shifted target grid, with one constant energy shift. */
export function compareSpectra(reference: Spectrum, target: Spectrum, shift_eV: number, window: readonly [number, number]) {
  const r = validateSpectrum(reference), t = validateSpectrum(target);
  if (!Number.isFinite(shift_eV) || Math.abs(shift_eV) > 1000) throw new Error('Shift must be finite and within ±1000 eV.');
  if (!window.every(Number.isFinite) || window[1] <= window[0]) throw new Error('Set an increasing energy window.');
  const energies: number[] = [], a: number[] = [], b: number[] = [];
  let j = 0;
  for (let i = 0; i < t.energy_eV.length; i++) {
    const e = t.energy_eV[i] + shift_eV;
    if (e < window[0] || e > window[1] || e < r.energy_eV[0] || e > r.energy_eV.at(-1)!) continue;
    while (j + 1 < r.energy_eV.length - 1 && r.energy_eV[j + 1] < e) j++;
    const f = (e - r.energy_eV[j]) / (r.energy_eV[j + 1] - r.energy_eV[j]);
    energies.push(e); a.push(r.mu_cm_inv[j] + f * (r.mu_cm_inv[j + 1] - r.mu_cm_inv[j])); b.push(t.mu_cm_inv[i]);
  }
  if (energies.length < 5) throw new Error('The comparison window needs at least five overlapping points.');
  const residuals = b.map((v, i) => v - a[i]);
  let errorArea = 0, referenceArea = 0;
  for (let i = 1; i < energies.length; i++) {
    const dx = energies[i] - energies[i - 1];
    errorArea += dx * (Math.abs(residuals[i - 1]) + Math.abs(residuals[i])) / 2;
    referenceArea += dx * (Math.abs(a[i - 1]) + Math.abs(a[i])) / 2;
  }
  return { ...similarityMetrics(a, b), relativeL1: referenceArea > 0 ? errorArea / referenceArea : null,
    rmse: Math.sqrt(residuals.reduce((s, v) => s + v * v, 0) / residuals.length), energies, residuals,
    window: [energies[0], energies.at(-1)!] as const, shift_eV };
}
