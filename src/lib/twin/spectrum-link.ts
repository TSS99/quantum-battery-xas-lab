import type { SampleConfig } from './types';

/**
 * The twin and the Read the spectrum window talk over this BroadcastChannel (same origin, any number of windows).
 * The window says hello when it opens; the twin answers, and again whenever its sample, temperature or latest scan
 * changes.
 */
export const SPECTRUM_CHANNEL = 'xaslab-spectrum';

/** The latest reduced scan: k^2-weighted chi(k) and |chi(R)| exactly as the twin's Results show them. */
export interface LinkedScan {
  n: number;
  /** The FEFF library material of the scanned sample, or null when it has none. */
  materialId: string | null;
  k: number[];
  chi: number[];
  r: number[];
  magnitude: number[];
  kmax: number;
}

export type SpectrumMessage =
  | { type: 'hello' }
  | { type: 'state'; sample: Pick<SampleConfig, 'formula' | 'absorber' | 'edge' | 'libraryId' | 'edgeShift_eV'>; temperature_K: number; scan: LinkedScan | null };
