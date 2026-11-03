'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { setAddress, type SpectrumView } from './view-switch';

const loading = () => <p className="spectrum-empty">Loading…</p>;
// Each view is its own chunk: a reader of the story never loads the detailed panels, nor the other way round.
const StoryView = dynamic(() => import('./story/story-view').then(m => m.StoryView), { ssr: false, loading });
const DetailedView = dynamic(() => import('./spectrum-page').then(m => m.DetailedView), { ssr: false, loading });

/**
 * Read the spectrum in one of two views of the same data. The story is the default; `?view=detailed`, or arriving from
 * the beamline twin (`?from=twin`, a lab session), opens every panel.
 */
export function SpectrumPage() {
  const [view, setView] = useState<SpectrumView | null>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setView(query.get('view') === 'detailed' || query.get('from') === 'twin' ? 'detailed' : 'simple');
  }, []);
  const choose = (next: SpectrumView) => {
    setAddress({ view: next === 'detailed' ? 'detailed' : null, from: null });
    setView(next);
    window.scrollTo(0, 0);
  };
  return <div className="twin-app spectrum-app">
    {view === 'simple' && <StoryView onView={choose} />}
    {view === 'detailed' && <DetailedView onView={choose} />}
    {view === null && loading()}
  </div>;
}
