import { fitSpectrum, type Spectrum } from '../lib/spectra';
import type { XASParams } from '../lib/xas';

self.onmessage = (event: MessageEvent<{ id: string | number; spectrum: Spectrum; params: XASParams }>) => {
  const { id, spectrum, params } = event.data;
  try {
    self.postMessage({ id, result: fitSpectrum(spectrum, params, progress => self.postMessage({ id, progress })) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'The illustrative fit could not be completed.' });
  }
};
