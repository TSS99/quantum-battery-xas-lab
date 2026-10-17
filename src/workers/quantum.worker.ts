/// <reference lib="webworker" />
import { simulateQuantum } from '../lib/quantum';
import { simulateCustomQuantum } from '../lib/custom-hamiltonian';

self.onmessage = (event: MessageEvent) => {
  const { id, params, hamiltonian } = event.data ?? {};
  try { self.postMessage({ id, result: hamiltonian ? simulateCustomQuantum(params, hamiltonian) : simulateQuantum(params) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'The quantum calculation failed.' }); }
};
