import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { twinFonts } from './fonts';
import './twin.css';

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'This address does not match a page of the Beamline Twin.',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return <div className={twinFonts}><article className="twin-doc">
    <header className="twin-hero">
      <p className="twin-kicker">Error 404</p>
      <h1>Page not found</h1>
      <p className="twin-intro">This address does not match a page. The site is now the Beamline Twin alone, so pages of the old XAS Lab are gone.</p>
      <div className="twin-chips"><Link className="twin-chip is-accent" href="/"><ArrowLeft size={14} aria-hidden="true" />Open the Beamline Twin</Link><Link className="twin-chip" href="/methods/">Methods</Link></div>
    </header>
  </article></div>;
}
