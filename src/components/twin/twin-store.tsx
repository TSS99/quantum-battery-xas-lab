'use client';
import { createContext, useContext, useEffect, useMemo, useReducer, useState, type Dispatch, type ReactNode } from 'react';
import { loadLibraryFineStructure } from '@/lib/twin/sample';
import { INITIAL_STORE, formatHash, parseHash, twinReducer, type TwinAction, type TwinStore } from './twin-state';
import { hutchLive, type HutchLive } from './hutch-live';
import { useTables } from './use-tables';

interface TwinContextValue {
  store: TwinStore;
  dispatch: Dispatch<TwinAction>;
  tables: ReturnType<typeof useTables>;
  /** The live readings once the tables are in; a message if the models fail; null while loading. */
  live: HutchLive | string | null;
}
const TwinContext = createContext<TwinContextValue | null>(null);

/** Holds the twin state for the /twin/ page. Mode and seed round-trip through the URL hash, e.g. #mode=xrf&seed=7. */
export function TwinProvider({ children }: { children: ReactNode }) {
  const [store, dispatch] = useReducer(twinReducer, INITIAL_STORE);
  const tables = useTables();
  // A sample the FEFF library knows gets its path sum once the paths load; the readings recompute then.
  const [library, setLibrary] = useState(0);
  const { formula, absorber, edge } = store.twin.sample;
  useEffect(() => {
    let current = true;
    loadLibraryFineStructure({ formula, absorber, edge }).then(found => { if (found && current) setLibrary(n => n + 1); }, () => {});
    return () => { current = false; };
  }, [formula, absorber, edge]);
  const live = useMemo(() => {
    if (tables !== 'ready') return null;
    try { return hutchLive(store.twin); } catch (error) { return error instanceof Error ? error.message : String(error); }
  }, [tables, store.twin, library]);
  const { mode, seed } = store.twin, { hashRead } = store.view;
  // The static HTML carries the defaults, so the hash is read after hydration and again when the user edits it.
  useEffect(() => {
    const read = () => dispatch({ type: 'hash', ...parseHash(window.location.hash) });
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  useEffect(() => {
    if (!hashRead) return;
    const hash = formatHash({ mode, seed });
    // replaceState keeps the router's history entry and does not fire hashchange.
    if (window.location.hash !== hash) history.replaceState(history.state, '', hash);
  }, [hashRead, mode, seed]);
  return <TwinContext.Provider value={{ store, dispatch, tables, live }}>{children}</TwinContext.Provider>;
}

export function useTwin() {
  const value = useContext(TwinContext);
  if (!value) throw new Error('TwinProvider is required');
  return value;
}
