/**
 * The mono reading of the scan point on show while a scan replays, or null between scans. The results dock writes it as
 * points appear; the 3D hutch reads it every frame to step its crystals with the scan. A plain shared object rather
 * than React state, so following the scan never re-renders the page.
 */
export const scanCursor: { energy_eV: number | null } = { energy_eV: null };
