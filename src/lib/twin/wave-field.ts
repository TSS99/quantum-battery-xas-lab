/**
 * The photoelectron of one shell as a scalar spherical wave in a plane through the absorber, for the Read the spectrum
 * wave map. The absorber sends out exp(i(kr + dc)) / r, damped by the mean free path, exp(-r / lambda); every neighbour
 * in the plane re-emits the wave that reaches it with FEFF's backscattering amplitude |F(k)| and phase. The echo that
 * comes home, with the absorber's phase once more, has phase 2kR + 2dc + phi(k): the phase of the path's chi(k), so its
 * sign at the absorber is the sign of that shell's chi(k). dc is half FEFF's central phase (real_phc).
 */

export interface WaveCurves { central: number; backscatter: number; amplitude: number; lambda: number }
/** A point in the plane's coordinates; z, its height off the plane, for atoms that echo from above or below it. */
export interface PlanePoint { x: number; y: number; z?: number }

/** Nearest the absorber and the neighbours the drawn amplitude stops growing as 1/r, angstrom. */
const CORE_A = 0.3;

/**
 * The field's real part at (x, y) and time phase wt, angstrom: the outgoing wave (unless left out) plus every
 * neighbour's echo. Neighbours are given in the plane; their distance from the absorber sets the echo's start.
 */
export function waveField(k: number, neighbours: PlanePoint[], c: WaveCurves, outgoing = true) {
  const phasor = wavePhasor(k, neighbours, c, outgoing);
  return (x: number, y: number, wt: number) => {
    const [cos, sin] = phasor(x, y);
    return cos * Math.cos(wt) + sin * Math.sin(wt);
  };
}

/**
 * The same field split in time: at (x, y) it is C cos(wt) + S sin(wt), every part sharing one frequency, so an
 * animation computes C and S once per k and only mixes them per frame.
 */
export function wavePhasor(k: number, neighbours: PlanePoint[], c: WaveCurves, outgoing = true) {
  const dc = c.central / 2;
  const sources = neighbours.map(n => {
    const R = Math.hypot(n.x, n.y, n.z ?? 0);
    // The wave that reaches the neighbour, scattered: amplitude |F| e^{-R/lambda} / R, phase kR + dc + phi.
    return { x: n.x, y: n.y, z: n.z ?? 0, amplitude: c.amplitude * Math.exp(-R / c.lambda) / R, phase: k * R + dc + c.backscatter };
  });
  return (x: number, y: number): [number, number] => {
    const r = Math.max(CORE_A, Math.hypot(x, y));
    let cos = 0, sin = 0;
    if (outgoing) { const a = Math.exp(-r / c.lambda) / r, p = k * r + dc; cos += a * Math.cos(p); sin += a * Math.sin(p); }
    for (const s of sources) {
      const d = Math.max(CORE_A, Math.hypot(x - s.x, y - s.y, s.z)), a = s.amplitude * Math.exp(-d / c.lambda) / d, p = s.phase + k * d;
      cos += a * Math.cos(p); sin += a * Math.sin(p);
    }
    return [cos, sin];
  };
}

/** How the echo of a neighbour at R meets the absorber: sin(2kR + 2dc + phi), the sign of that path's chi(k). */
export function echoAtAbsorber(k: number, R: number, c: WaveCurves): number {
  return Math.sin(2 * k * R + c.central + c.backscatter);
}

/**
 * A plane through the absorber (at the origin) holding as many of the shell's atoms as can share one: through the
 * first atom and the one most nearly at right angles to it. Atoms within 0.35 angstrom of the plane are kept, in its
 * coordinates; with one atom the plane is any through it.
 */
export function shellSlice(atoms: [number, number, number][]): { points: PlanePoint[]; total: number } {
  if (!atoms.length) return { points: [], total: 0 };
  const { u, v, n } = slicePlane(atoms);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const points = atoms.filter(a => Math.abs(dot(a, n)) < 0.35).map(a => ({ x: dot(a, u), y: dot(a, v) }));
  return { points, total: atoms.length };
}

/** The slice's axes in the crystal: u through the first atom, v at right angles in the plane, n its normal. */
export function slicePlane(atoms: [number, number, number][]) {
  const norm = (v: number[]) => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const u = norm(atoms[0]);
  let best = atoms.length > 1 ? atoms.slice(1).reduce((b, a) => Math.hypot(...cross(u, norm(a))) > Math.hypot(...cross(u, norm(b))) ? a : b) : null;
  if (!best || Math.hypot(...cross(u, norm(best))) < 0.2) best = (Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]) as [number, number, number];
  const v = norm(best.map((x, i) => x - dot(best!, u) * u[i]));
  return { u, v, n: cross(u, v) };
}
