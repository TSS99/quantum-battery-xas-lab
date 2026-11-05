// Quantum XAS tools for the MCP server (step 6 of docs/PLAN-quantum.md): the problem library, the fault tolerant
// cost, the emulated circuits and the beamline comparison, from the same data and code as the Quantum XAS page.
// Building a new problem needs PySCF, so it is the Python package's job (scripts/quantum, `python -m qxas build`);
// quantum_build describes and exports the library's problems and writes the recipe for a new one.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededRandom } from '../lib/xas';
import { HadamardTest } from '../lib/quantum/emulate';
import { HARTREE_EV, spectra, storedSignals, type Factorization, type Pack } from '../lib/quantum/packs';
import type { Signal } from '../lib/quantum/spectrum';
import { eelsSpectra, type EelsData } from '../lib/quantum/eels';
import eelsIndex from '../data/quantum/eels/index.json';
import { BEAMLINE, LIFETIME_HWHM_EV, fit, measure, mixture, rank, readSpectrum, scanEnergies, type Detection, type FitOptions, type Measured, type Sticks } from '../lib/quantum/measure';
import estimatesJson from '../data/quantum/estimates.json';
import instanceIndex from '../data/quantum/instances/index.json';
import h2o from '../data/quantum/packs/h2o-o-k-sto3g.json';
import co from '../data/quantum/packs/co-o-k-sto3g.json';
import o2 from '../data/quantum/packs/li2mno3-o2-k.json';
import o1 from '../data/quantum/packs/li2mno3-o1-k.json';
import li3 from '../data/quantum/packs/li3mn2o-o2-k.json';
import li2 from '../data/quantum/packs/li2mn2o-o2-k.json';

type Json = Record<string, unknown>;
export interface QuantumTool { name: string; description: string; inputSchema: Json; run: (args: Json) => Promise<string> }

interface CostRow {
  id: string; title: string; why: string; orbitals: number; active_electrons: number; determinants: number; logical_qubits: number;
  toffoli_longest_circuit: number; toffoli_whole_spectrum: number; circuits: number; seconds_sequential_1MHz: number;
  seconds_active_volume_1MHz: number; fits: Record<string, boolean>; classical_hours_paper_model: number;
  classical_seconds_here: number | null; same_atoms_as: string | null; instance_hash: string; eta_Ha?: number;
}
const estimates = estimatesJson as unknown as { pennylane: string; machines: { id: string; name: string; year: number; logical_qubits: number; gates: number }[]; problems: CostRow[]; curve: CostRow[]; resolution: CostRow[] };
const PACKS = new Map((([h2o, co, o2, o1, li3, li2] as unknown) as Pack[]).map(p => [p.id, p]));
const OXIDES = [o2, o1, li3, li2].map(p => p.id);
const MIXTURES: Record<string, number[]> = { crystal: [2 / 3, 1 / 3, 0, 0], charged: [1 / 3, 1 / 6, 0.3, 0.2] };
const ALPHA = 1.3384;

const object = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const sci = (x: number) => x.toExponential(2);
const duration = (s: number) => s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 3 * 86400 ? `${(s / 3600).toFixed(1)} hours` : `${Math.round(s / 86400)} days`;
const sticks = (p: Pack): Sticks => ({ centres_eV: p.reference.centres_Ha.map(c => c * HARTREE_EV), weights: p.reference.weights });

function problemId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!estimates.problems.some(p => p.id === id)) throw new Error(`Unknown problem "${id}". Known: ${estimates.problems.map(p => p.id).join(', ')}.`);
  return id;
}

/** A file of the repository's quantum data (instances, eels), found by walking up from this module (the source file
 * or its bundle). */
function dataFile(folder: string, id: string): Json {
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    const file = join(dir, 'src', 'data', 'quantum', folder, `${id}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) throw new Error(`No ${folder} data for ${id}: run the server from the repository.`);
  }
}
const instanceFile = (id: string) => dataFile('instances', id);

/** The active space Hamiltonian in the FCIDUMP format (Knowles and Handy), chemists' notation, 1-based, unique entries. */
export function fcidump(integrals: { n_orb: number; n_elec: number[]; e_core: number; h1: number[][]; h2: number[][][][] }): string {
  const n = integrals.n_orb, lines = [
    ` &FCI NORB=${n},NELEC=${integrals.n_elec[0] + integrals.n_elec[1]},MS2=${integrals.n_elec[0] - integrals.n_elec[1]},`,
    `  ORBSYM=${Array(n).fill(1).join(',')},`, '  ISYM=1,', ' &END'];
  const put = (v: number, i: number, j: number, k: number, l: number) => { if (Math.abs(v) > 1e-12) lines.push(`${v.toExponential(15)} ${i} ${j} ${k} ${l}`); };
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) for (let k = 0; k < n; k++) for (let l = 0; l <= k; l++) {
    if (i * (i + 1) / 2 + j >= k * (k + 1) / 2 + l) put(integrals.h2[i][j][k][l], i + 1, j + 1, k + 1, l + 1);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) put(integrals.h1[i][j], i + 1, j + 1, 0, 0);
  lines.push(`${integrals.e_core.toExponential(15)} 0 0 0 0`);
  return lines.join('\n') + '\n';
}

function costText(row: CostRow, label: string): string {
  return [
    `${label}: ${row.orbitals} active orbitals${row.eta_Ha ? `, resolution eta ${row.eta_Ha} Ha (${(row.eta_Ha * HARTREE_EV).toFixed(2)} eV)` : ''}.`,
    `Logical qubits ${row.logical_qubits}; Toffoli gates ${sci(row.toffoli_longest_circuit)} in the longest circuit, ${sci(row.toffoli_whole_spectrum)} for the whole spectrum (${row.circuits} circuits).`,
    `Run time at a 1 MHz logical clock: ${duration(row.seconds_sequential_1MHz)} one Toffoli after another, ${duration(row.seconds_active_volume_1MHz)} on the active volume layout.`,
    ...estimates.machines.map(m => `${m.name} (${m.logical_qubits} logical qubits, ${sci(m.gates)} gates, announced for ${m.year}): ${row.fits[m.id] ? 'fits' : 'does not fit'}.`),
    `Classical, the paper's rough restricted active space model: ${duration(row.classical_hours_paper_model * 3600)}${row.classical_seconds_here != null ? `; the exact reference took ${duration(row.classical_seconds_here)} on the PC that built the library` : ''}.`,
    `Estimated with PennyLane ${estimates.pennylane} (scripts/quantum/estimates.py). Machine generations are announced targets, and a fit counts Toffoli gates only.`,
  ].join('\n');
}

export const QUANTUM_TOOLS: QuantumTool[] = [
  {
    name: 'quantum_problems',
    description: 'The quantum XAS problem library: oxygen K edges of water, carbon monoxide and Li2MnO3 cathode clusters, each with its active space, qubits, determinants, exact edge and fault tolerant cost.',
    inputSchema: object({}),
    run: async () => estimates.problems.map(p => {
      const pack = PACKS.get(p.id), meta = instanceIndex.instances.find(i => i.id === p.id);
      return `${p.id}: ${p.title}. CAS(${p.active_electrons}e,${p.orbitals}o), ${2 * p.orbitals + 1} qubits, ${p.determinants.toLocaleString('en')} determinants; `
        + `${meta?.reference ? `exact edge ${meta.edge_eV?.toFixed(1)} eV` : 'no exact reference (beyond exact methods)'}; `
        + `${pack ? (pack.live ? 'emulated circuits rerun here' : 'stored emulated signals') : 'cost only'}; `
        + `${p.logical_qubits} logical qubits, ${sci(p.toffoli_longest_circuit)} Toffolis in the longest circuit.`;
    }).join('\n'),
  },
  {
    name: 'quantum_build',
    description: 'One library problem: its recipe and why (summary), its active space Hamiltonian with the core valence separation applied (fcidump; it keeps terms that move two core electrons at once, so keep the O 1s doubly occupied for the ground state), or its atoms (xyz). Building a new problem needs PySCF; pass recipe_for to get the recipe JSON to build with `python -m qxas build`.',
    inputSchema: object({
      problem: { type: 'string', description: 'A problem id from quantum_problems.' },
      format: { type: 'string', enum: ['summary', 'fcidump', 'xyz'] },
      recipe_for: { type: 'object', description: 'Changes to the problem\'s recipe for a new one, for example {"id": "li2mno3-o1-k-noli", "site": "O1", "remove": ["Li3"], "spin": 1}.' },
    }, ['problem']),
    run: async args => {
      const id = problemId(args.problem), data = instanceFile(id);
      const recipe = data.recipe as Json, meta = data.meta as Json, integrals = data.integrals as Parameters<typeof fcidump>[0] & { core: number[] };
      if (args.recipe_for) return JSON.stringify({ ...recipe, ...(args.recipe_for as Json) }, null, 1);
      if (args.format === 'fcidump') return fcidump(integrals);
      if (args.format === 'xyz') {
        const pack = PACKS.get(id) ?? PACKS.get(estimates.problems.find(p => p.id === id)?.same_atoms_as ?? '');
        if (!pack) throw new Error(`No atoms stored for ${id}.`);
        return [String(pack.atoms.length), `${id}: ${recipe.title}, angstrom`, ...pack.atoms.map(([s, xyz]) => `${s} ${xyz.map(v => v.toFixed(5)).join(' ')}`)].join('\n') + '\n';
      }
      return [
        `${id}: ${recipe.title}. ${recipe.why}`,
        `Recipe: AVAS on ${(recipe.avas as string[]).join(', ')}, core ${recipe.core}, basis ${recipe.basis}, charge ${recipe.charge}, 2S ${recipe.spin}${recipe.structure ? `, from ${recipe.structure} site ${recipe.site}${(recipe.remove as string[]).length ? ` with ${(recipe.remove as string[]).join(', ')} removed` : ''}` : ''}.`,
        `Active space CAS(${meta.active_electrons}e,${meta.active_orbitals}o), ${meta.qubits} qubits, ${Number(meta.ci_dimension).toLocaleString('en')} determinants; O 1s is active orbital ${integrals.core[0] + 1}; SCF energy ${Number(meta.scf_energy_Ha).toFixed(6)} Ha.`,
        `Instance hash ${data.hash}. Rebuild with: python scripts/quantum/library.py ${id}`,
      ].join('\n');
    },
  },
  {
    name: 'quantum_estimate',
    description: 'What a problem costs on a fault tolerant quantum computer: logical qubits, Toffoli gates, run time, which announced machine generations fit, and the classical cost. Give a problem id, or a number of active orbitals (6 to 28, even), or a resolution in eV for the 11 orbital clusters.',
    inputSchema: object({
      problem: { type: 'string' },
      orbitals: { type: 'integer', minimum: 6, maximum: 28 },
      resolution_eV: { type: 'number', exclusiveMinimum: 0, description: 'Lorentzian half width eta of the computed spectrum; the stored rows are 0.14, 0.27, 0.54 and 1.36 eV.' },
    }),
    run: async args => {
      if (args.problem !== undefined) { const row = estimates.problems.find(p => p.id === problemId(args.problem))!; return costText(row, `${row.id}, ${row.title}`); }
      if (args.resolution_eV !== undefined) {
        const want = Number(args.resolution_eV), gap = (r: CostRow) => Math.abs(r.eta_Ha! * HARTREE_EV - want);
        const row = estimates.resolution.reduce((a, b) => gap(b) < gap(a) ? b : a);
        return costText(row, `The Li2MnO3 clusters at the nearest stored resolution`);
      }
      if (args.orbitals !== undefined) {
        const row = estimates.curve.find(c => c.orbitals === Number(args.orbitals));
        if (!row) throw new Error(`The cost curve holds even numbers of orbitals from 6 to 28, not ${String(args.orbitals)}.`);
        return costText(row, 'The cost curve');
      }
      throw new Error('Give a problem, a number of orbitals or a resolution.');
    },
  },
  {
    name: 'quantum_emulate',
    description: 'The spectrum as the quantum algorithm measures it: shots drawn on the Hadamard test signals of the emulated circuits, rebuilt into the spectrum and compared with the exact one. Water\'s circuits can be rerun here (live). Returns peaks and the largest difference, or the spectrum as CSV.',
    inputSchema: object({
      problem: { type: 'string' },
      factorization: { type: 'string', enum: ['exact', 'cdf'] },
      shots: { type: 'integer', minimum: 100, maximum: 10_000_000, description: 'Shots per dipole direction (default 10,000).' },
      jmax: { type: 'integer', minimum: 5, maximum: 100 },
      seed: { type: 'integer', minimum: 0 },
      live: { type: 'boolean', description: 'Rerun the circuits here instead of using the stored Python signals (water only).' },
      format: { type: 'string', enum: ['summary', 'csv'] },
    }, ['problem']),
    run: async args => {
      const id = problemId(args.problem), pack = PACKS.get(id);
      if (!pack) throw new Error(`${id} is a cost only problem: too large to emulate. Try quantum_estimate.`);
      const offered = (['exact', 'cdf'] as Factorization[]).filter(f => pack.signals[f]);
      const method = (args.factorization ?? offered[0]) as Factorization;
      if (!offered.includes(method)) throw new Error(`${id} offers the ${offered.join(' and ')} factorization only.`);
      let signals: (Signal | null)[] = storedSignals(pack, method), note = 'Signals from the Python emulator.';
      if (args.live) {
        if (!pack.live) throw new Error(`Only water's circuits are small enough to rerun here; ${id} uses its stored signals.`);
        const started = performance.now();
        const { states, fragments, ...problem } = pack.live;
        const test = new HadamardTest(problem, fragments[method]), substeps = pack.signals[method]!.substeps;
        const live = pack.dipole_norms.map((n, k) => n ? test.signal(states[k], pack.settings.tau_per_Ha, pack.settings.jmax, substeps) : null);
        let difference = 0;
        live.forEach((g, k) => { const p = signals[k]; if (g && p) for (let j = 0; j < g[0].length; j++) difference = Math.max(difference, Math.abs(g[0][j] - p[0][j]), Math.abs(g[1][j] - p[1][j])); });
        signals = live;
        note = `Circuits rerun here in ${((performance.now() - started) / 1000).toFixed(1)} s; largest difference from the Python emulator ${difference.toExponential(1)}.`;
      }
      const jmax = Math.min(Number(args.jmax ?? pack.settings.jmax), pack.settings.jmax), shots = Number(args.shots ?? 10_000);
      const r = spectra(pack, signals, jmax, shots, ALPHA, seededRandom(Number(args.seed ?? 1)));
      if (args.format === 'csv') return ['energy_eV,exact,noiseless,measured', ...r.energies_eV.map((e, i) => `${e.toFixed(3)},${r.exact[i].toPrecision(6)},${r.perfect[i].toPrecision(6)},${r.measured[i].toPrecision(6)}`)].join('\n') + '\n';
      return [
        `${id}, ${method} factorization, j_max ${jmax}, ${shots.toLocaleString('en')} shots per direction (${r.shots.toLocaleString('en')} in all). ${note}`,
        `Main peak: exact ${r.peak_eV.exact.toFixed(2)} eV, measured ${r.peak_eV.measured.toFixed(2)} eV; largest difference from the exact spectrum ${(100 * r.difference).toFixed(1)} % of its peak.`,
        `Broadening eta ${(pack.settings.eta_Ha * HARTREE_EV).toFixed(2)} eV. Energies sit 6 to 30 eV above experiment: these small models do not relax the orbitals around the core hole.`,
      ].join('\n');
    },
  },
  {
    name: 'quantum_eels',
    description: 'Core loss electron energy loss of an oriented sample in the dipole limit: S(q, w) along a direction of the momentum transfer q, exact and as the algorithm measures it with off-diagonal Hadamard tests, next to the orientation average (the XAS spectrum). Directions are in the frame of the problem (atoms from quantum_build xyz).',
    inputSchema: object({
      problem: { type: 'string', description: `One of ${eelsIndex.problems.join(', ')}.` },
      q: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Direction of q, for example [0, 0, 1]; it is normalized.' },
      shots: { type: 'integer', minimum: 100, maximum: 10_000_000, description: 'Shots per correlation function (default 10,000).' },
      seed: { type: 'integer', minimum: 0 },
    }, ['problem', 'q']),
    run: async args => {
      const id = problemId(args.problem);
      if (!eelsIndex.problems.includes(id)) throw new Error(`No EELS data for ${id} yet. Available: ${eelsIndex.problems.join(', ')}.`);
      const raw = (args.q as unknown[]).map(Number), size = Math.hypot(...raw);
      if (raw.length !== 3 || !(size > 0)) throw new Error('q needs three numbers, not all zero.');
      const q = raw.map(v => v / size), shots = Number(args.shots ?? 10_000);
      const d = dataFile('eels', id) as unknown as EelsData, pack = PACKS.get(id)!;
      const r = eelsSpectra(d, pack, q, shots, ALPHA, seededRandom(Number(args.seed ?? 1)));
      return [
        `${id}, q along (${q.map(v => v.toFixed(3)).join(', ')}), ${shots.toLocaleString('en')} shots per correlation function, ${d.signals.factorization} factorization.`,
        `Strongest loss: exact ${r.peak_eV.exact.toFixed(2)} eV, measured ${r.peak_eV.measured.toFixed(2)} eV; largest difference ${(100 * r.difference).toFixed(1)} % of the peak.`,
        `Averaged over orientations (the XAS spectrum) the strongest loss is at ${r.peak_eV.average.toFixed(2)} eV; along q the peak is ${r.strength.toFixed(2)} times the average's.`,
        'Dipole limit, small collection angles. Energies sit 6 to 30 eV above experiment, as for XAS.',
      ].join('\n');
    },
  },
  {
    name: 'quantum_compare',
    description: 'Measure the Li2MnO3 clusters\' computed oxygen K edges on a model soft X-ray beamline and fit the scan back as a mixture of oxygen environments, or fit a measured spectrum you pass as CSV or XDI text. Returns the fractions with uncertainties, the ranking, the shift and the misfit.',
    inputSchema: object({
      sample: { type: 'string', description: `crystal (O2 and O1 sites 2 : 1), charged (33, 17, 30, 20 %), or one cluster: ${OXIDES.join(', ')}.` },
      spectrum: { type: 'string', description: 'A measured spectrum as text (energy and signal columns), instead of a simulated sample.' },
      detection: { type: 'string', enum: ['tey', 'fy'] },
      resolving_power: { type: 'number', minimum: 500, maximum: 50_000 },
      dwell_s: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
      broadening_eV: { type: 'number', minimum: 0, maximum: 5, description: 'Broadening in the sample itself (default 1 eV).' },
      resolution_eV: { type: 'number', exclusiveMinimum: 0, description: 'Compare against candidates at this quantum run resolution eta instead of the exact spectra.' },
      seed: { type: 'integer', minimum: 0 },
    }),
    run: async args => {
      const packs = OXIDES.map(id => PACKS.get(id)!), candidates = packs.map(sticks);
      const power = Number(args.resolving_power ?? BEAMLINE.resolvingPower);
      const halfWidth = args.resolution_eV === undefined ? LIFETIME_HWHM_EV : Number(args.resolution_eV);
      let data: Measured, truth: number[] | null = null, lines: string[];
      if (args.spectrum !== undefined) {
        const read = readSpectrum(String(args.spectrum), 'spectrum.txt');
        data = read;
        lines = [`Your spectrum, column "${read.column}", ${read.energies.length} points from ${read.energies[0].toFixed(1)} to ${read.energies[read.energies.length - 1].toFixed(1)} eV.`];
      } else {
        const key = String(args.sample ?? 'crystal');
        truth = MIXTURES[key] ?? (OXIDES.includes(key) ? OXIDES.map(id => +(id === key)) : null);
        if (!truth) throw new Error(`Unknown sample "${key}". Use crystal, charged or one of ${OXIDES.join(', ')}.`);
        const beam = { ...BEAMLINE, resolvingPower: power, dwell_s: Number(args.dwell_s ?? BEAMLINE.dwell_s), detection: (args.detection ?? 'tey') as Detection };
        const scan = measure(mixture(candidates.map((s, k) => ({ sticks: s, fraction: truth![k] }))), scanEnergies(packs.map(p => p.reference.edge_eV)), beam,
          seededRandom(Number(args.seed ?? 1)), Number(args.broadening_eV ?? 1));
        data = scan;
        lines = [`Sample ${key}, ${beam.detection === 'tey' ? 'electron' : 'fluorescence'} yield, E/dE ${power}, ${beam.dwell_s} s per point: ${scan.energies.length} points in ${duration(scan.seconds)}, surface dose ${Math.round(scan.dose_MGy)} MGy, noise at the top ${(100 * scan.sigma[scan.truth.indexOf(1)]).toFixed(2)} %.`];
      }
      const options: FitOptions = { shifts: args.spectrum !== undefined ? [-45, 5] : [-2, 2], broadenings: [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5], resolvingPower: power, halfWidth_eV: halfWidth, background: args.spectrum !== undefined };
      const f = fit(data, candidates, options), ranking = rank(data, candidates, options);
      return [
        ...lines,
        `Candidates ${args.resolution_eV === undefined ? 'exact' : `at eta ${halfWidth} eV`}. Fit: shift ${f.shift_eV.toFixed(2)} eV, extra broadening ${f.extraFwhm_eV} eV, R ${f.rFactor.toExponential(1)}${args.spectrum === undefined ? `, reduced chi2 ${f.chi2.toFixed(2)}` : ''}.`,
        ...packs.map((p, k) => `${p.id}: ${(100 * f.fractions[k]).toFixed(1)} ± ${(100 * f.errors[k]).toFixed(1)} %${truth ? ` (sample ${(100 * truth[k]).toFixed(1)} %)` : ''}; alone ranks ${ranking.findIndex(r => r.index === k) + 1}.`),
        'The beamline is a model, not a facility. A fit says which computed environment is closest, not that it is right.',
      ].join('\n');
    },
  },
];
