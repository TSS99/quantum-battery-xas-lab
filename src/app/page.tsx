import { Laboratory } from '@/components/laboratory';
import { JsonLd } from '@/components/json-ld';
import { pageMetadata } from '@/lib/site';

export const metadata = pageMetadata('');
export default function Page() { return <><JsonLd slug="" /><Laboratory module="home" /></>; }
