/// <reference lib="webworker" />
import { reduceScans, type ReductionRequest } from '../lib/measured-data';

// Calibration, merging and normalization of measured scans, off the main thread. Data never leave the browser.
self.onmessage = (event: MessageEvent<{ id: number; request: ReductionRequest }>) => {
  const { id, request } = event.data;
  try { self.postMessage({ id, result: reduceScans(request) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'The scans could not be processed.' }); }
};
