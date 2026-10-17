import type { Metadata } from 'next';
import { LabProvider } from '@/components/lab-context';
import { Shell } from '@/components/shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quantum Battery XAS Lab',
  description: 'Explore lithium charge balance, X-ray attenuation and small quantum models. Compare spectra and export model parameters.',
};
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="en"><body><LabProvider><Shell>{children}</Shell></LabProvider></body></html>;
}
