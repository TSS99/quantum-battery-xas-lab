/// <reference lib="webworker" />

import { processExafs, type ExafsProcessingOptions } from '../lib/exafs';

interface Request {
  id: number;
  energy_eV: number[];
  mu: number[];
  options: ExafsProcessingOptions;
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, energy_eV, mu, options } = event.data;
  try {
    self.postMessage({ id, result: processExafs(energy_eV, mu, options) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'EXAFS processing could not be completed.' });
  }
};
