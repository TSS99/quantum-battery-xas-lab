import type { Metadata } from 'next';
import { TwinPage } from '@/components/twin/twin-page';
import { JsonLd } from '@/components/json-ld';
import { HOME_PAGE, pageMetadata } from '@/lib/site';
import { twinFonts } from './fonts';
import './twin.css';

export const metadata: Metadata = pageMetadata(HOME_PAGE);

export default function Page() {
  return <><JsonLd page={HOME_PAGE} /><div className={twinFonts}><TwinPage /></div></>;
}
