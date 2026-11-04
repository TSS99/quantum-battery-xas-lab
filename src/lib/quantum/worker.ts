/**
 * Web Worker entry for the Quantum XAS page: runs the browser emulator on a live pack, one dipole direction after
 * another, and reports each time step. The handling is a plain function so tests use exactly the same code; only the
 * last lines touch the worker global.
 */
import { HadamardTest, type Fragments, type LiveProblem } from './emulate';

export interface RunRequest {
  type: 'run';
  id: number;
  problem: LiveProblem;
  fragments: Fragments;
  states: (number[][] | null)[];
  tau: number;
  jmax: number;
  substeps: number;
}

export type RunMessage =
  | { type: 'step'; id: number; done: number; total: number }
  | { type: 'done'; id: number; signals: ([number[], number[]] | null)[]; seconds: number }
  | { type: 'error'; id: number; message: string };

export function handleRun(request: RunRequest, post: (message: RunMessage) => void): void {
  try {
    const started = performance.now();
    const test = new HadamardTest(request.problem, request.fragments);
    const directions = request.states.filter(Boolean).length;
    let finished = 0;
    const signals = request.states.map(psi => {
      if (!psi) return null;
      const [re, im] = test.signal(psi, request.tau, request.jmax, request.substeps,
        j => post({ type: 'step', id: request.id, done: finished * request.jmax + j, total: directions * request.jmax }));
      finished++;
      return [Array.from(re), Array.from(im)] as [number[], number[]];
    });
    post({ type: 'done', id: request.id, signals, seconds: (performance.now() - started) / 1000 });
  } catch (error) {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
}

// Inside a dedicated worker only: `importScripts` exists there and nowhere else.
const scope = globalThis as unknown as { importScripts?: unknown; onmessage: ((event: { data: RunRequest }) => void) | null; postMessage: (message: RunMessage) => void };
if (typeof scope.importScripts === 'function') {
  scope.onmessage = event => handleRun(event.data, message => scope.postMessage(message));
}
