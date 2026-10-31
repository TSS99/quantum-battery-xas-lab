/** Axis ticks at round values (1, 2, 2.5 or 5 times a power of ten) covering lo to hi, about `target` of them. */
export function niceTicks(lo: number, hi: number, target = 5): { values: number[]; step: number } {
  const raw = (hi - lo) / Math.max(1, target - 1) || 1, power = 10 ** Math.floor(Math.log10(raw)), f = raw / power;
  const step = (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * power;
  const values: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) values.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { values, step };
}

/** A tick label with as many decimals as the step needs. */
export function tickLabel(value: number, step: number): string {
  const power = Math.floor(Math.log10(step) + 1e-9), mantissa = step / 10 ** power;
  const decimals = Math.max(0, -power + (Math.abs(mantissa - 2.5) < 1e-6 ? 1 : 0));
  return value.toFixed(Math.min(3, decimals)).replace('-', '−');
}
