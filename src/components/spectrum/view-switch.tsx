'use client';

/** Simple: the story in seven scenes; Detailed: every panel, for students and scientists. */
export type SpectrumView = 'simple' | 'detailed';

/** Sets (or, with null, removes) query parameters in the address without a reload, so a link keeps the view and sample. */
export function setAddress(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) if (value === null) url.searchParams.delete(key); else url.searchParams.set(key, value);
  window.history.replaceState(window.history.state, '', url);
}

export function ViewSwitch({ view, onChange }: { view: SpectrumView; onChange: (view: SpectrumView) => void }) {
  return <div className="view-switch" role="group" aria-label="How much detail">
    <button type="button" aria-pressed={view === 'simple'} onClick={() => onChange('simple')}>Simple</button>
    <button type="button" aria-pressed={view === 'detailed'} onClick={() => onChange('detailed')}>Detailed</button>
  </div>;
}
