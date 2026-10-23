import { ToolsIndex } from '@/components/tools/tool-pages';
import { JsonLd } from '@/components/json-ld';
import { TOOLS_PAGE, toolsJsonLd, toolsMetadata } from '@/lib/site';

export const metadata = toolsMetadata(TOOLS_PAGE);
export default function Page() { return <><JsonLd data={toolsJsonLd()} /><ToolsIndex /></>; }
