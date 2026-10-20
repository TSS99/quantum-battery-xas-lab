/**
 * The numbers the hutch scene shows are the twin's own status readouts (src/lib/twin/twin.ts),
 * so the scene, the rails and the scans agree. Needs `loadXrayData()` and `loadOptics()` first.
 */
export { status as hutchLive, type TwinStatus as HutchLive } from '@/lib/twin/twin';
