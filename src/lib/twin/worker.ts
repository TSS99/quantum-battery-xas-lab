/**
 * Web Worker entry: runs a scan off the main thread and streams every point back. The message
 * handling is a plain function so tests and the main-thread fallback use exactly the same code;
 * only the last lines touch the worker global.
 */
import { loadXrayData } from '../xraydata';
import { seededRandom } from '../xas';
import { runScan, type SimulatedPoint } from './acquire';
import { loadLibraryFineStructure } from './sample';
import { loadOptics } from './tables';
import type { Acquisition, ScanPlan, TwinState } from './types';

export interface ScanRequest {
  type: 'scan';
  /** Echoed in every reply, so a late reply from a cancelled scan can be ignored. */
  id: number;
  state: TwinState;
  plan: ScanPlan;
  /** Seed of the noise generator; the same seed repeats a realistic scan exactly. */
  seed: number;
}

export type ScanMessage =
  | { type: 'point'; id: number; index: number; repeat: number; point: SimulatedPoint }
  | { type: 'done'; id: number; acquisition: Acquisition }
  | { type: 'error'; id: number; message: string };

/** Runs one request and posts a point message per point, then one done (or error) message. */
export async function handleScanRequest(request: ScanRequest, post: (message: ScanMessage) => void): Promise<void> {
  try {
    if (request.type !== 'scan') throw new Error(`Unknown request "${String((request as { type: unknown }).type)}".`);
    await Promise.all([loadXrayData(), loadOptics()]);
    // A sample the FEFF library knows gets its path sum; if the paths cannot load, the teaching shape stays.
    await loadLibraryFineStructure(request.state.sample).catch(() => false);
    const acquisition = runScan(request.state, request.plan, seededRandom(request.seed >>> 0),
      (point, index, repeat) => post({ type: 'point', id: request.id, index, repeat, point }));
    post({ type: 'done', id: request.id, acquisition });
  } catch (error) {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
}

// Inside a dedicated worker only: `importScripts` exists there and nowhere else.
const scope = globalThis as unknown as { importScripts?: unknown; onmessage: ((event: { data: ScanRequest }) => void) | null; postMessage: (message: ScanMessage) => void };
if (typeof scope.importScripts === 'function') {
  scope.onmessage = event => { void handleScanRequest(event.data, message => scope.postMessage(message)); };
}
