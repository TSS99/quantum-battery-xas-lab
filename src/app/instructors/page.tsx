import { InstructorsPage } from '@/components/tools/instructors-page';
import { JsonLd } from '@/components/json-ld';
import { instructorsJsonLd, instructorsMetadata } from '@/lib/site';

export const metadata = instructorsMetadata();
export default function Page() { return <><JsonLd data={instructorsJsonLd()} /><InstructorsPage /></>; }
