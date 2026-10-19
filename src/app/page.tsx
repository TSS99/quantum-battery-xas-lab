import { Laboratory } from '@/components/laboratory';
import { JsonLd } from '@/components/json-ld';
import { pageMetadata } from '@/lib/site';
import { buildValidationCards } from '@/lib/validation-cards';

export const metadata = pageMetadata('');
export default async function Page() { return <><JsonLd slug="" /><Laboratory module="home" validation={await buildValidationCards()} /></>; }
