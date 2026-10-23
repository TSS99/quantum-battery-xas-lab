// Number formatting shared by the calculator pages (server) and the live calculators (client).
import { Num, Unit } from '../tex';

/** 0.153 as "15.3 %" with a typeset percent sign. */
export const Percent = ({ value, digits = 1 }: { value: number; digits?: number }) => <Num>{`${(value * 100).toFixed(digits)}%`}</Num>;

/** Three significant figures, switching to a power of ten outside 0.01 to 10 000. */
export function sig(value: number): string {
  const a = Math.abs(value);
  return a !== 0 && (a < 0.01 || a >= 1e4) ? value.toExponential(2).replace(/e\+?/, 'e') : String(Number(value.toPrecision(3)));
}

/** A value with its unit, three significant figures. */
export const Quantity = ({ value, unit }: { value: number; unit: string }) => <><Num>{sig(value)}</Num> <Unit>{unit}</Unit></>;

/** A duration in the largest unit that keeps it above 1: microseconds up to years. */
export function Duration({ seconds }: { seconds: number }) {
  const steps: [number, string][] = [[365.25 * 86400, 'years'], [86400, 'days'], [3600, 'h'], [60, 'min'], [1, 's'], [1e-3, 'ms'], [1e-6, 'µs']];
  const [size, unit] = steps.find(([s]) => seconds >= s) ?? steps[steps.length - 1];
  const value = Number((seconds / size).toPrecision(2));
  return unit === 'years' || unit === 'days' ? <><Num>{String(value)}</Num> {unit}</> : <><Num>{String(value)}</Num> <Unit>{unit}</Unit></>;
}
