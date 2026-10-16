/// <reference lib="webworker" />
import { simulateQuantum } from '../lib/quantum';

self.onmessage = (event: MessageEvent) => {
  const { id, params } = event.data ?? {};
  try { self.postMessage({ id, result: simulateQuantum(params) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'The quantum calculation failed.' }); }
};
