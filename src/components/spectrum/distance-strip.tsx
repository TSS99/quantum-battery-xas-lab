'use client';
import type { ClusterAtom, Shell } from '@/lib/twin/shells';

const W = 640, H = 118, L = 16, R = 16, BASE = 82, MAX_BAR = 40, FAR = '#59636f', INK = '#d4dae3', MUTED = '#a7b1c1';

/**
 * The cluster laid out by distance from the absorber: a bar for every distance at which atoms sit, its height their
 * number, coloured and labelled by shell. These are the true distances the |chi(R)| peaks are measured against, and
 * the labels carry each shell's identity where colour alone would not (two greens, for one).
 */
export function DistanceStrip({ atoms, shells, colors, active, onHover, onSelect, absorber, rmax }: {
  atoms: ClusterAtom[]; shells: Shell[]; colors: Record<string, string>; active: string | null;
  onHover: (id: string | null) => void; onSelect: (id: string) => void; absorber: string; rmax: number;
}) {
  // Atoms of one shell within 0.02 angstrom of each other make one bar.
  const bars: { r: number; n: number; shellId: string | null }[] = [];
  for (const a of atoms.slice(1)) {
    const bar = bars.find(b => b.shellId === a.shellId && Math.abs(b.r - a.r_A) < 0.02);
    if (bar) bar.n++; else bars.push({ r: a.r_A, n: 1, shellId: a.shellId });
  }
  const most = Math.max(1, ...bars.map(b => b.n));
  const px = (r: number) => L + r / rmax * (W - L - R);
  // Shell labels in up to three rows, so neighbouring shells (2.78, 2.90, 3.11 angstrom in CuO) do not overlap.
  const named = shells.filter(s => s.kind === 'shell').sort((a, b) => a.r_A - b.r_A);
  const rowEnds = [-Infinity, -Infinity, -Infinity];
  const labels = named.map(s => {
    const text = `${s.count} ${s.element}`, x = px(s.r_A), half = 3.6 * text.length;
    const row = Math.max(0, rowEnds.findIndex(end => x - half > end + 6));
    rowEnds[row] = x + half;
    return { s, text, x, y: 14 + row * 13 };
  });
  return <svg className="distance-strip" viewBox={`0 0 ${W} ${H}`} role="img"
    aria-label={`Distances from the ${absorber} atom: ${named.map(s => `${s.count} ${s.element} at ${s.r_A.toFixed(2)} angstrom`).join(', ')}`}
    onPointerLeave={() => onHover(null)}>
    <rect width={W} height={H} rx="8" fill="#121a2b" />
    {Array.from({ length: Math.floor(rmax) + 1 }, (_, r) => <g key={r}>
      <line x1={px(r)} x2={px(r)} y1={BASE} y2={BASE + 4} stroke={MUTED} />
      <text x={px(r)} y={BASE + 16} textAnchor="middle" fill={MUTED} fontSize="11.5">{r}</text>
    </g>)}
    <line x1={L} x2={W - R} y1={BASE} y2={BASE} stroke="#35404d" />
    <circle cx={px(0)} cy={BASE - 6} r="6" fill="#f3f6fa" />
    {bars.map((b, i) => {
      const lit = !active || b.shellId === active;
      return <line key={i} x1={px(b.r)} x2={px(b.r)} y1={BASE} y2={BASE - 4 - b.n / most * MAX_BAR} stroke={b.shellId && colors[b.shellId] ? colors[b.shellId] : FAR}
        strokeWidth="5" strokeLinecap="round" opacity={lit ? 0.95 : 0.25} />;
    })}
    {labels.map(({ s, text, x, y }) => <g key={s.id} opacity={!active || active === s.id ? 1 : 0.4} style={{ cursor: 'pointer' }}
      onPointerEnter={() => onHover(s.id)} onClick={() => onSelect(s.id)}>
      <rect x={x - 18} y={y - 11} width="36" height={BASE - y + 12} fill="transparent" />
      <text x={x} y={y} textAnchor="middle" fill={INK} fontSize="11.5" paintOrder="stroke" stroke="#121a2b" strokeWidth="3">{text}</text>
    </g>)}
    <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fill={MUTED} fontSize="12">Distance from the {absorber} atom (Å), true; the |χ(R)| peaks sit short of these</text>
  </svg>;
}
