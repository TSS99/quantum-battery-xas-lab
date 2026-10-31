/**
 * Loaders for the computed near edge spectra, one chunk per material; kept apart from xanes.ts so the twin's first load
 * carries none of them (sample.ts imports this module only when a library sample loads).
 */
import type { XanesFile } from './xanes';

const xanesLoaders: Record<string, () => Promise<{ default: unknown }>> = {
  cu: () => import('../../data/twin/xanes/cu.json'),
  'fe-bcc': () => import('../../data/twin/xanes/fe-bcc.json'),
  ni: () => import('../../data/twin/xanes/ni.json'),
  pt: () => import('../../data/twin/xanes/pt.json'),
  limn2o4: () => import('../../data/twin/xanes/limn2o4.json'),
  licoo2: () => import('../../data/twin/xanes/licoo2.json'),
  lifepo4: () => import('../../data/twin/xanes/lifepo4.json'),
  nio: () => import('../../data/twin/xanes/nio.json'),
  fe3o4: () => import('../../data/twin/xanes/fe3o4.json'),
  zno: () => import('../../data/twin/xanes/zno.json'),
  ceo2: () => import('../../data/twin/xanes/ceo2.json'),
  ti: () => import('../../data/twin/xanes/ti.json'),
  cr: () => import('../../data/twin/xanes/cr.json'),
  mn: () => import('../../data/twin/xanes/mn.json'),
  co: () => import('../../data/twin/xanes/co.json'),
  zn: () => import('../../data/twin/xanes/zn.json'),
  mo: () => import('../../data/twin/xanes/mo.json'),
  pd: () => import('../../data/twin/xanes/pd.json'),
  au: () => import('../../data/twin/xanes/au.json'),
  w: () => import('../../data/twin/xanes/w.json'),
  cu2o: () => import('../../data/twin/xanes/cu2o.json'),
  cuo: () => import('../../data/twin/xanes/cuo.json'),
  mno: () => import('../../data/twin/xanes/mno.json'),
  mn2o3: () => import('../../data/twin/xanes/mn2o3.json'),
  mno2: () => import('../../data/twin/xanes/mno2.json'),
  feo: () => import('../../data/twin/xanes/feo.json'),
  fe2o3: () => import('../../data/twin/xanes/fe2o3.json'),
  co3o4: () => import('../../data/twin/xanes/co3o4.json'),
  coo: () => import('../../data/twin/xanes/coo.json'),
  'tio2-anatase': () => import('../../data/twin/xanes/tio2-anatase.json'),
  'tio2-rutile': () => import('../../data/twin/xanes/tio2-rutile.json'),
  cr2o3: () => import('../../data/twin/xanes/cr2o3.json'),
  k2cro4: () => import('../../data/twin/xanes/k2cro4.json'),
  pbo: () => import('../../data/twin/xanes/pbo.json'),
  zns: () => import('../../data/twin/xanes/zns.json'),
  na2so4: () => import('../../data/twin/xanes/na2so4.json'),
  nacl: () => import('../../data/twin/xanes/nacl.json'),
  kcl: () => import('../../data/twin/xanes/kcl.json'),
  caco3: () => import('../../data/twin/xanes/caco3.json'),
  'lifepo4-p': () => import('../../data/twin/xanes/lifepo4-p.json'),
};

export const xanesIds = Object.keys(xanesLoaders);
const loaded = new Map<string, Promise<XanesFile>>();

/** One material's computed near edge, as its own chunk. */
export function loadXanes(id: string): Promise<XanesFile> {
  const loader = xanesLoaders[id];
  if (!loader) return Promise.reject(new Error(`No computed near edge for "${id}".`));
  let pending = loaded.get(id);
  if (!pending) {
    pending = loader().then(module => module.default as XanesFile).catch(error => { loaded.delete(id); throw error; });
    loaded.set(id, pending);
  }
  return pending;
}
