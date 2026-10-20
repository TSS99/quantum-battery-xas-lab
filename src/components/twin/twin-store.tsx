'use client';
import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import { INITIAL_STORE, formatHash, parseHash, twinReducer, type TwinAction, type TwinStore } from './twin-state';

const TwinContext = createContext<{ store: TwinStore; dispatch: Dispatch<TwinAction> } | null>(null);

/** Holds the twin state for the /twin/ page. Mode and seed round-trip through the URL hash, e.g. #mode=xrf&seed=7. */
export function TwinProvider({ children }: { children: ReactNode }) {
  const [store, dispatch] = useReducer(twinReducer, INITIAL_STORE);
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
  return <TwinContext.Provider value={{ store, dispatch }}>{children}</TwinContext.Provider>;
}

export function useTwin() {
  const value = useContext(TwinContext);
  if (!value) throw new Error('TwinProvider is required');
  return value;
}
