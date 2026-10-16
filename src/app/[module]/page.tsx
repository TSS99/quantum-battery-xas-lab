import { Laboratory } from '@/components/laboratory';
export function generateStaticParams() { return ['crystal','beamline','spectra','electronic','quantum','experiments','validation'].map(module=>({module})); }
export const dynamicParams = false;
export default async function Page({params}: {params: Promise<{module:string}>}) { const {module}=await params; return <Laboratory module={module}/>; }
