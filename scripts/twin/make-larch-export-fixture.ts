import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadXrayData } from '../../src/lib/xraydata';
import { seededRandom } from '../../src/lib/xas';
import { runScan } from '../../src/lib/twin/acquire';
import { larchScript } from '../../src/lib/twin/larch-export';
import { defaultPlan } from '../../src/lib/twin/scan';
import { loadOptics } from '../../src/lib/twin/tables';
import { DEFAULT_STATE } from '../../src/lib/twin/twin';
import { writeXdi } from '../../src/lib/twin/xdi';

await Promise.all([loadXrayData(), loadOptics()]);
const acquisition = runScan({ ...DEFAULT_STATE, realistic: false }, defaultPlan(8979), seededRandom(17));
const directory = join(process.cwd(), 'scripts', 'twin', 'fixtures');
const base = 'larch-acquisition';
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, `${base}.xdi`), writeXdi(acquisition, ['Deterministic twin acquisition for the Larch export parity test.']));
writeFileSync(join(directory, `${base}.py`), larchScript(acquisition, base).code);
