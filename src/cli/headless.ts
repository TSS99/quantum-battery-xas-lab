// A beamline twin without a browser, for the command line tool and the MCP server. It runs the same modules as the
// page (src/lib/twin): the same tables, the same commands, the same scan engine and the same XDI writer.
import { loadXrayData } from '../lib/xraydata';
import { seededRandom } from '../lib/xas';
import { loadOptics } from '../lib/twin/tables';
import { runScan } from '../lib/twin/acquire';
import { loadLibraryFineStructure } from '../lib/twin/sample';
import { DEFAULT_STATE, applyCommand, status, type TwinCommand } from '../lib/twin/twin';
import { defaultPlan, planDuration, xanesPlan } from '../lib/twin/scan';
import { edgeEnergy } from '../lib/twin/acquire';
import { reduceAcquisition } from '../lib/twin/reduction';
import { writeXdi } from '../lib/twin/xdi';
import { larchScript } from '../lib/twin/larch-export';
import { parseCommand, type CommandIntent } from '../lib/twin/command-bar';
import type { Acquisition, TwinState } from '../lib/twin/types';

export const loadTables = () => Promise.all([loadXrayData(), loadOptics()]);

/** "$\mu(E)$ rises" becomes "mu(E) rises": the twin's notes are written for KaTeX. */
export const plain = (text: string) => text.replace(/\$([^$]*)\$/g, (_, tex: string) => tex
  .replace(/\\(?:mathrm|text|mathit)\{([^}]*)\}/g, '$1').replace(/\\(mu|chi|sigma|theta|Delta|alpha|beta|times)\b/g, (_m, g: string) => ({ times: '×' } as Record<string, string>)[g] ?? g)
  .replace(/\\[,;: ]|\\ /g, ' ').replace(/[{}]/g, '').replace(/\\/g, '')).replace(/\s+/g, ' ').trim();

export interface ScanSummary { points: number; repeats: number; /** Counting and settling time the plan would take at a beamline. */ scanTime_s: number; e0_eV: number; edgeStep: number; firstShell_A: number | null; /** Why the edge or the EXAFS could not be read, when they could not. */ problem?: string }

export class HeadlessTwin {
  state: TwinState;
  readonly acquisitions: Acquisition[] = [];
  constructor(state: TwinState = DEFAULT_STATE) { this.state = state; }

  /** Apply one twin command and return its plain-language note. */
  command(command: TwinCommand): string {
    const result = applyCommand(this.state, command);
    this.state = result.state;
    return plain(result.note);
  }

  /** Run typed commands such as "set energy 8979" or "fluorescence"; an acquire intent runs a scan. */
  async say(text: string): Promise<string[]> {
    const parsed = parseCommand(text, this.state);
    if (!parsed.ok) throw new Error(parsed.error);
    const notes: string[] = parsed.corrected ? [`Read as "${parsed.understood}".`] : [];
    for (const intent of parsed.intents as CommandIntent[]) {
      if (intent.type === 'acquire') {
        const { summary } = await this.acquire(intent.repeats);
        notes.push(`Acquisition ${this.acquisitions.length} stored: ${summary.points} points, ${summary.repeats} scan${summary.repeats === 1 ? '' : 's'}, E0 ${summary.e0_eV.toFixed(1)} eV, edge step ${summary.edgeStep.toPrecision(3)}.`);
      } else notes.push(this.command(intent));
    }
    return notes;
  }

  /** The scan plan by name: "default" (XANES and EXAFS to k = 14 or so) or "xanes". */
  usePlan(name: 'default' | 'xanes', repeats = this.state.scan.repeats) {
    const e0 = edgeEnergy(this.state.sample), plan = name === 'xanes' ? xanesPlan(e0) : defaultPlan(e0);
    this.command({ type: 'scan', plan: { ...plan, repeats } });
  }

  /** Scan with the current settings, seeded from the state, and keep the acquisition. */
  async acquire(repeats?: number): Promise<{ acquisition: Acquisition; summary: ScanSummary }> {
    if (repeats) this.command({ type: 'scan', plan: { ...this.state.scan, repeats } });
    await loadLibraryFineStructure(this.state.sample).catch(() => false);
    const seed = (this.state.seed + this.acquisitions.length) >>> 0;
    const acquisition = runScan(this.state, this.state.scan, seededRandom(seed));
    this.acquisitions.push(acquisition);
    return { acquisition, summary: this.summarize(acquisition) };
  }

  summarize(acquisition: Acquisition): ScanSummary {
    const columns = acquisition.columns, points = columns.energy.length;
    let e0_eV = NaN, edgeStep = NaN, firstShell_A: number | null = null, problem: string | undefined;
    try {
      const reduced = reduceAcquisition(acquisition);
      e0_eV = reduced.pre.e0; edgeStep = reduced.pre.edgeStep;
      const { r, magnitude } = reduced.exafs.xftf;
      let best = -1;
      for (let i = 0; i < r.length; i++) if (r[i] > 1 && r[i] < 4 && (best < 0 || magnitude[i] > magnitude[best])) best = i;
      // Below k = 8 per angstrom the transform cannot separate shells, so a XANES scan reports no first shell.
      firstShell_A = best >= 0 && reduced.kmax >= 8 ? r[best] : null;
    } catch (error) { problem = (error as Error).message; }
    return { points, repeats: this.state.scan.repeats, scanTime_s: planDuration(this.state.scan, edgeEnergy(this.state.sample)).total_s, e0_eV, edgeStep, firstShell_A, problem };
  }

  status() { return status(this.state); }

  xdi(acquisition: Acquisition) { return writeXdi(acquisition, ['Simulated by the XAS Lab beamline twin, headless.']); }
  larch(acquisition: Acquisition, xdiName: string) { return larchScript(acquisition, xdiName); }
}
