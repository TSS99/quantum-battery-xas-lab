import { ElementsIndex } from '@/components/element-pages';
import { JsonLd } from '@/components/json-ld';
import { ELEMENTS_PAGE, elementsJsonLd, elementsMetadata } from '@/lib/site';

export const metadata = elementsMetadata(ELEMENTS_PAGE.slug, ELEMENTS_PAGE.title, ELEMENTS_PAGE.description);
export default function Page() { return <><JsonLd data={elementsJsonLd()} /><ElementsIndex /></>; }
