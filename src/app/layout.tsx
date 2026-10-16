import type { Metadata } from 'next';
import { LabProvider } from '@/components/lab-context';
import { Shell } from '@/components/shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quantum Battery XAS Lab',
  description: 'An interactive laboratory connecting battery materials, X-ray absorption and quantum dynamics. Transparent models. Reproducible experiments.',
};
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="en"><body><LabProvider><Shell>{children}</Shell></LabProvider></body></html>;
}
