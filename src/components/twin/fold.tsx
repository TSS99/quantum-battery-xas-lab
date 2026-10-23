'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Below this width the twin page is one scrolling column (twin.css uses the same breakpoint). */
export const NARROW_QUERY = '(max-width: 1149.98px)';

/**
 * A heading button that folds its body. `desktopOpen` sections start open on wide screens and folded on phones.
 * Until the screen width is known, data-fold="auto" lets the CSS fold them on phones so nothing flashes open.
 * They open or fold again when the window crosses the breakpoint, so a widened window does not keep the phone folds.
 */
export function Fold({ id, title, desktopOpen = false, level = 3, className = '', children }: { id: string; title: ReactNode; desktopOpen?: boolean; level?: 2 | 3; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState<boolean | undefined>(desktopOpen ? undefined : false);
  useEffect(() => {
    if (!desktopOpen) return;
    const narrow = matchMedia(NARROW_QUERY), follow = () => setOpen(!narrow.matches);
    follow();
    narrow.addEventListener('change', follow);
    return () => narrow.removeEventListener('change', follow);
  }, [desktopOpen]);
  const Heading = level === 2 ? 'h2' : 'h3';
  return <div className={'twin-fold ' + className} data-fold={open === undefined ? 'auto' : open ? 'open' : 'closed'}>
    <Heading className="twin-fold-head"><button type="button" aria-expanded={open ?? true} aria-controls={id} onClick={() => setOpen(!(open ?? true))}>{title}<ChevronDown size={16} aria-hidden="true" /></button></Heading>
    {/* A folded section does not build its body, so a slider step elsewhere does not re-render hidden controls. */}
    <div id={id} className="twin-fold-body">{open !== false && children}</div>
  </div>;
}
