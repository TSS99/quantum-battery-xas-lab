import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { JsonLd } from '@/components/json-ld';
import { TwinMethods } from '@/components/twin/twin-methods';
import { METHODS_PAGE, pageMetadata } from '@/lib/site';
import { twinFonts } from '../fonts';
import '../twin.css';

export const metadata: Metadata = pageMetadata(METHODS_PAGE);

export default function Page() {
  return <><JsonLd page={METHODS_PAGE} /><div className={twinFonts}><article className="twin-doc">
    <header className="twin-hero">
      <nav aria-label="Breadcrumb" className="twin-crumbs"><ol>
        <li><Link href="/">Beamline Twin</Link></li>
        <li><Link href="/methods/" aria-current="page">Methods</Link></li>
      </ol></nav>
      <h1>Methods</h1>
      <p className="twin-intro">Where every reading comes from: the tables and FEFF paths behind it, the teaching models, and the tests that hold each one.</p>
      <div className="twin-chips"><Link className="twin-chip" href="/"><ArrowLeft size={14} aria-hidden="true" />Back to the twin</Link></div>
    </header>
    <TwinMethods />
  </article></div></>;
}
