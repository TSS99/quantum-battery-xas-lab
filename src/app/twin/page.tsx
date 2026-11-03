import type { Metadata } from 'next';
import { pageUrl } from '@/lib/site';
import { TwinMoved } from './twin-moved';

// The twin used to live at /twin/; it is the whole site now. Old links, with their #settings, land on the new address.
export const metadata: Metadata = { title: 'Beamline Twin has moved', robots: { index: false, follow: true }, alternates: { canonical: pageUrl('') } };

export default function Page() {
  return <TwinMoved />;
}
