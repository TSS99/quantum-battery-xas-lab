'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Atom, AudioLines, Box, FlaskConical, GitBranch, LayoutGrid, Orbit, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useLab } from './lab-context';
import { InstallApp } from './install-app';
const LabConsole = dynamic(() => import('./lab-console'), { ssr: false });
const routes = [['/', 'Overview', LayoutGrid], ['/crystal/', 'Sample', Box], ['/beamline/', 'XAS beamline', AudioLines], ['/spectra/', 'Spectra studio', SlidersHorizontal], ['/electronic/', 'Electronic structure', Orbit], ['/quantum/', 'Quantum dynamics', GitBranch], ['/experiments/', 'Experiments', FlaskConical], ['/validation/', 'Methods & validation', ShieldCheck]] as const;
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(), { state, set, notice,canUndo,undoPreset } = useLab();
  const [consoleOpen, setConsoleOpen] = useState(false), [consoleLoaded, setConsoleLoaded] = useState(false);
  const closeConsole = useCallback(() => setConsoleOpen(false), []);
  const openConsole = useCallback(() => { setConsoleLoaded(true); setConsoleOpen(true); }, []);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.key === 'Escape' && consoleOpen) { event.preventDefault(); closeConsole(); return; }
      if (event.key !== '`') return;
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, select, [role="textbox"]') ||
        target instanceof HTMLInputElement && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes(target.type));
      if (editing) return;
      event.preventDefault();
      if (consoleOpen) closeConsole(); else openConsole();
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [consoleOpen, closeConsole, openConsole]);
  // Unknown paths (the 404 page) match no route, so nothing is marked as the current page.
  const current = routes.find(([href]) => pathname.replace(/\/$/, '') === href.replace(/\/$/, '')) ?? ['', 'Page not found'] as const;
  return <MotionConfig reducedMotion="user"><a className="skip-link" href="#main">Skip to laboratory</a><div className="app-shell">
    <aside className="sidebar"><Link href="/" className="brand" aria-label="XAS Lab overview"><span className="brand-symbol"><Atom size={25} /></span><span>XAS Lab<span>Materials & quantum dynamics</span></span></Link>
      <nav aria-label="Laboratory modules">{routes.map(([href, name, Icon]) => <Link key={href} href={href} aria-current={current[0] === href ? 'page' : undefined} className={'nav-item ' + (current[0] === href ? 'active' : '')}><Icon size={18} /><span>{name}</span></Link>)}</nav>
    </aside>
    <div className="workspace"><header className="topbar"><nav aria-label="Breadcrumb"><ol className="breadcrumb"><li><Link href="/" aria-current={current[0] === '/' ? 'page' : undefined}>Overview</Link></li>{current[0] === '' ? <li><span aria-current="page">{current[1]}</span></li> : current[0] !== '/' && <li><Link href={current[0]} aria-current="page">{current[1]}</Link></li>}</ol></nav><div className="topbar-actions"><button className="console-toggle" type="button" aria-haspopup="dialog" aria-expanded={consoleOpen} aria-controls={consoleLoaded ? 'lab-console' : undefined} aria-keyshortcuts="`" title="Open console (`)" onClick={consoleOpen ? closeConsole : openConsole}><span aria-hidden="true">&gt;_</span> Console</button><div className="mode-switch" role="group" aria-label="Explanation level"><button aria-pressed={!state.expert} className={!state.expert ? 'selected' : ''} onClick={() => set({ expert: false })}>Explore</button><button aria-pressed={state.expert} className={state.expert ? 'selected' : ''} onClick={() => set({ expert: true })}>Research</button></div></div></header>
      <main id="main" tabIndex={-1}>{children}</main><footer><span>XAS Lab</span><span>Calculations run in your browser.</span><InstallApp /><Link href="/validation/">Methods</Link></footer>
    </div>
  </div>{consoleLoaded && <LabConsole open={consoleOpen} onClose={closeConsole} />}{notice && <div className="toast" role="status">{notice}{canUndo&&<button className="button secondary small" onClick={undoPreset}>Undo preset</button>}</div>}</MotionConfig>;
}
