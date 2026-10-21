'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Atom, ChevronDown, Github, Menu, X } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useLab } from './lab-context';
import { InstallApp } from './install-app';
import { Chevron } from './chevron';
import { LandingHero } from './landing';
const LabConsole = dynamic(() => import('./lab-console'), { ssr: false });
const REPO = 'https://github.com/TSS99/quantum-battery-xas-lab';
const routes = [
  ['/', 'Overview', 'Start here: what the lab does and how the pieces connect'],
  ['/crystal/', 'Sample', 'Any formula, absorber and edge, with a thickness plan'],
  ['/beamline/', 'XAS beamline', 'Scan the energy and follow the beam to the detectors'],
  ['/spectra/', 'Spectra studio', 'Compare, import, normalize and fit spectra'],
  ['/electronic/', 'Electronic structure', 'Which empty states a core electron can reach'],
  ['/quantum/', 'Quantum dynamics', 'Hamiltonian to spectrum, exact and product formula'],
  ['/experiments/', 'Experiments', 'Ready-made examples and saved work'],
  ['/validation/', 'Methods & validation', 'Equations, checks and agreement with xraydb'],
] as const;
// Pages in preview: named in the breadcrumb with a Preview badge, but kept out of the module navigation.
const previews = [['/twin/', 'Beamline twin', 'Operate a simulated XAS beamline']] as const;

export function Shell({ children, elementNames }: { children: React.ReactNode; elementNames: Record<string, string> }) {
  const pathname = usePathname(), { state, set, notice, canUndo, undoPreset } = useLab();
  const [consoleOpen, setConsoleOpen] = useState(false), [consoleLoaded, setConsoleLoaded] = useState(false);
  const [scrolled, setScrolled] = useState(false), [labMenu, setLabMenu] = useState(false), [mobileMenu, setMobileMenu] = useState(false);
  const labMenuRef = useRef<HTMLDivElement>(null);
  const closeConsole = useCallback(() => setConsoleOpen(false), []);
  const openConsole = useCallback(() => { setConsoleLoaded(true); setConsoleOpen(true); }, []);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.key === 'Escape') {
        if (consoleOpen) { event.preventDefault(); closeConsole(); return; }
        setLabMenu(false); setMobileMenu(false); return;
      }
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
  // The header is expanded over the landing hero and becomes a floating pill once the page scrolls.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { setLabMenu(false); setMobileMenu(false); }, [pathname]);
  useEffect(() => {
    if (!labMenu) return;
    const away = (event: PointerEvent) => { if (!labMenuRef.current?.contains(event.target as Node)) setLabMenu(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [labMenu]);
  useEffect(() => { document.body.style.overflow = mobileMenu ? 'hidden' : ''; }, [mobileMenu]);
  // Full-screen pages have no top bar, so they open the console with this event.
  useEffect(() => {
    window.addEventListener('xaslab:console', openConsole);
    return () => window.removeEventListener('xaslab:console', openConsole);
  }, [openConsole]);

  // Unknown paths (the 404 page) match no route, so nothing is marked as the current page.
  const matches = ([href]: readonly string[]) => pathname.replace(/\/$/, '') === href.replace(/\/$/, '');
  const preview = previews.find(matches);
  const current = routes.find(matches) ?? preview ?? ['', 'Page not found', ''] as const;
  // Element pages sit outside the eight modules: Overview / Elements / Iron.
  const elementPath = /^\/elements(?:\/([a-z]{1,2}))?\/?$/.exec(pathname), elementSlug = elementPath?.[1];
  const elementName = elementSlug && Object.hasOwn(elementNames, elementSlug) ? elementNames[elementSlug] : undefined;
  const inElements = !!elementPath && (!elementSlug || !!elementName);
  const home = current[0] === '/';
  const expanded = home && !scrolled;

  const overlays = <>{consoleLoaded && <LabConsole open={consoleOpen} onClose={closeConsole} />}{notice && <div className="toast" role="status">{notice}{canUndo && <button className="button secondary small" onClick={undoPreset}>Undo preset</button>}</div>}</>;
  // Preview pages run full screen, like an instrument console: no site header, module bar or footer.
  if (preview) return <MotionConfig reducedMotion="user"><a className="skip-link" href="#main">Skip to laboratory</a>
    <main id="main" tabIndex={-1} className="bare-main">{children}</main>{overlays}</MotionConfig>;

  return <MotionConfig reducedMotion="user"><a className="skip-link" href="#main">Skip to laboratory</a>
    <header className={'site-header' + (expanded ? ' is-expanded' : ' is-pill')}>
      <div className="site-header-inner">
        <Link href="/" className="wordmark" aria-label="XAS Lab overview"><Atom size={18} aria-hidden="true" /><span>XAS Lab</span></Link>
        <div className="header-links">
          <div className="lab-menu" ref={labMenuRef}>
            <button type="button" className="header-link" aria-expanded={labMenu} aria-controls="lab-menu-list" onClick={() => setLabMenu(v => !v)}>Lab modules <ChevronDown size={14} aria-hidden="true" /></button>
            <div id="lab-menu-list" className="lab-menu-list" hidden={!labMenu}>
              <ul>{routes.map(([href, name, description]) => <li key={href}><Link href={href} aria-current={current[0] === href ? 'page' : undefined}><strong>{name}</strong><span>{description}</span></Link></li>)}</ul>
            </div>
          </div>
          <Link className="header-link" href="/elements/">Elements</Link>
          <Link className="header-link" href="/validation/">Methods</Link>
          <a className="header-link" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <Link className="button cta" href="/crystal/">Open the lab<Chevron /></Link>
        <button type="button" className="menu-toggle" aria-expanded={mobileMenu} aria-controls="mobile-menu" aria-label={mobileMenu ? 'Close menu' : 'Open menu'} onClick={() => setMobileMenu(v => !v)}>{mobileMenu ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
      <div id="mobile-menu" className="mobile-menu" hidden={!mobileMenu}>
        <ul>{routes.map(([href, name, description]) => <li key={href}><Link href={href}><strong>{name}</strong><span>{description}</span></Link></li>)}</ul>
        <div className="mobile-menu-links"><Link href="/elements/">Elements</Link><Link href="/validation/">Methods</Link><a href={REPO} target="_blank" rel="noreferrer">GitHub</a></div>
      </div>
    </header>
    <div className={'app-shell' + (home ? ' is-home' : '')}>
      <main id="main" tabIndex={-1}>
        {home && <LandingHero />}
        <div className="page-bar">
          <nav aria-label="Breadcrumb"><ol className="breadcrumb"><li><Link href="/" aria-current={home ? 'page' : undefined}>Overview</Link></li>{inElements ? <><li><Link href="/elements/" aria-current={elementName ? undefined : 'page'}>Elements</Link></li>{elementName && <li><Link href={`/elements/${elementSlug}/`} aria-current="page">{elementName}</Link></li>}</> : current[0] === '' ? <li><span aria-current="page">{current[1]}</span></li> : !home && <li><Link href={current[0]} aria-current="page">{current[1]}</Link>{preview && <span className="preview-badge">Preview</span>}</li>}</ol></nav>
          <div className="topbar-actions"><button className="console-toggle" type="button" aria-haspopup="dialog" aria-expanded={consoleOpen} aria-controls={consoleLoaded ? 'lab-console' : undefined} aria-keyshortcuts="`" title="Open console (`)" onClick={consoleOpen ? closeConsole : openConsole}><span aria-hidden="true">&gt;_</span> Console</button><div className="mode-switch" role="group" aria-label="Explanation level"><button aria-pressed={!state.expert} className={!state.expert ? 'selected' : ''} onClick={() => set({ expert: false })}>Explore</button><button aria-pressed={state.expert} className={state.expert ? 'selected' : ''} onClick={() => set({ expert: true })}>Research</button></div></div>
        </div>
        <nav aria-label="Laboratory modules" className="module-bar"><ul>{routes.map(([href, name]) => <li key={href}><Link href={href} aria-current={current[0] === href ? 'page' : undefined} className={current[0] === href ? 'active' : undefined}>{name}</Link></li>)}</ul></nav>
        {children}
      </main>
      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand"><Link href="/" className="wordmark large" aria-label="XAS Lab overview"><Atom size={22} aria-hidden="true" /><span>XAS Lab</span></Link><p>X-ray absorption spectroscopy for any material, in your browser. Calculations stay on your computer.</p><InstallApp /></div>
          <div className="footer-cols">
            <div><h2>Lab</h2><ul>{routes.slice(1, 6).map(([href, name]) => <li key={href}><Link href={href}>{name}</Link></li>)}</ul></div>
            <div><h2>Reference</h2><ul><li><Link href="/elements/">Elements</Link></li><li><Link href="/validation/">Methods</Link></li><li><Link href="/experiments/">Experiments</Link></li></ul></div>
            <div><h2>Project</h2><ul><li><a href={REPO} target="_blank" rel="noreferrer"><Github size={14} aria-hidden="true" /> Source code</a></li><li><a href={REPO + '/issues'} target="_blank" rel="noreferrer">Report an issue</a></li></ul></div>
          </div>
        </div>
        <div className="footer-bottom"><span>XAS Lab · built by TSS99</span><span>Calculations run in your browser.</span></div>
        <div className="footer-wordmark" aria-hidden="true">XAS Lab</div>
      </footer>
    </div>
    {overlays}</MotionConfig>;
}
