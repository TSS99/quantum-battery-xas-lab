import type { Metadata } from 'next';
import { TwinPage } from '@/components/twin/twin-page';
import { JsonLd } from '@/components/json-ld';
import { twinJsonLd, twinMetadata } from '@/lib/site';
import { twinFonts } from '../fonts';
import '../twin.css';

export const metadata: Metadata = twinMetadata();

export default function Page() {
  return <><JsonLd data={twinJsonLd()} /><div className={twinFonts}><TwinPage /></div></>;
}
