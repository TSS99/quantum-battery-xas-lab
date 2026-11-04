import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { QuantumPage } from '@/components/quantum/quantum-page';
import { QUANTUM_PAGE, pageMetadata } from '@/lib/site';
import { twinFonts } from '../fonts';
import '../twin.css';
import '../quantum.css';

export const metadata: Metadata = pageMetadata(QUANTUM_PAGE);

export default function Page() {
  return <><JsonLd page={QUANTUM_PAGE} /><div className={twinFonts}><QuantumPage /></div></>;
}
