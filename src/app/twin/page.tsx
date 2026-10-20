import type { Metadata } from 'next';
import { TwinPage } from '@/components/twin/twin-page';
import '../twin.css';

// In preview: not indexed, not in the sitemap and not in the module navigation.
export const metadata: Metadata = {
  title: 'Beamline twin',
  description: 'Preview of an XAS beamline you operate in the browser: eight measurement modes, the monochromator energy and the results each detector would record.',
  robots: { index: false, follow: true },
};

export default function Page() {
  return <TwinPage />;
}
