'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimulatedPoint } from '@/lib/twin/acquire';
import type { Acquisition, ScanPlan, TwinState } from '@/lib/twin/types';
import { handleScanRequest, type ScanMessage, type ScanRequest } from '@/lib/twin/worker';

export interface ScanProgress {
  running: boolean;
  /** Points received so far, in scan order (all repeats). */
  points: SimulatedPoint[];
  total: number;
  acquisition: Acquisition | null;
  error: string | null;
}

const IDLE: ScanProgress = { running: false, points: [], total: 0, acquisition: null, error: null };

/**
 * Runs twin scans in a Web Worker and collects the streamed points; falls back to the main thread
 * where workers are unavailable. Points are handed to React at most once per animation frame.
 */
export function useTwinScan() {
  const [progress, setProgress] = useState<ScanProgress>(IDLE);
  const worker = useRef<Worker | null>(null);
  const current = useRef(0);
  const buffer = useRef<SimulatedPoint[]>([]);
  const frame = useRef(0);

  const flush = useCallback(() => {
    frame.current = 0;
    const points = buffer.current.slice();
    setProgress(p => ({ ...p, points }));
  }, []);

  const receive = useCallback((message: ScanMessage) => {
    if (message.id !== current.current) return;
    if (message.type === 'point') {
      buffer.current.push(message.point);
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    } else if (message.type === 'done') {
      cancelAnimationFrame(frame.current); frame.current = 0;
      setProgress(p => ({ ...p, running: false, points: buffer.current.slice(), acquisition: message.acquisition }));
    } else {
      setProgress(p => ({ ...p, running: false, error: message.message }));
    }
  }, [flush]);

  const start = useCallback((state: TwinState, plan: ScanPlan, total: number) => {
    const id = ++current.current;
    buffer.current = [];
    setProgress({ ...IDLE, running: true, total });
    const request: ScanRequest = { type: 'scan', id, state, plan, seed: state.seed + id };
    if (typeof Worker === 'undefined') { void handleScanRequest(request, receive); return; }
    if (!worker.current) {
      worker.current = new Worker(new URL('../../lib/twin/worker.ts', import.meta.url));
      worker.current.onmessage = (event: MessageEvent<ScanMessage>) => receive(event.data);
      worker.current.onerror = event => setProgress(p => ({ ...p, running: false, error: event.message || 'The scan worker failed to start.' }));
    }
    worker.current.postMessage(request);
  }, [receive]);

  /** Stops listening to the running scan; a restarted worker is created on the next start. */
  const cancel = useCallback(() => {
    current.current++;
    worker.current?.terminate(); worker.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    setProgress(p => ({ ...p, running: false }));
  }, []);

  useEffect(() => () => { worker.current?.terminate(); cancelAnimationFrame(frame.current); }, []);
  return { progress, start, cancel };
}
