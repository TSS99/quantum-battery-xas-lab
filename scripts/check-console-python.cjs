/* Run from this worktree: node scripts/check-console-python.cjs <python-with-xraydb-4.5>
 * Uses the installed TypeScript compiler, without a build or server. Generated scripts
 * are written temporarily inside this worktree and executed with bytecode writes off.
 * Compares unrounded Python results with the exact libraries used by console commands.
 */
const { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = resolve(__dirname, '..');

require.extensions['.ts'] = (module, filename) => {
  assert.ok(filename.startsWith(join(root, 'src') + require('node:path').sep));
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

async function main() {
  const python = process.argv[2];
  assert.ok(python, 'Pass the path to a Python executable with xraydb 4.5.x.');
  const { loadXrayData, mu } = require('../src/lib/xraydata.ts');
  const { samplePlan } = require('../src/lib/sample.ts');
  const { pythonScript, runCommand } = require('../src/lib/console.ts');
  await loadXrayData();
  const directory = mkdtempSync(join(root, '.console-check-'));
  try {
    for (const [formula, density, absorber, energy] of [
      ['Fe2O3', 5.26, 'Fe', 7112], ['LiCoO2', 5.05, 'Co', 7709],
      // Regression: material_mu('CO') resolves to cobalt, so use C1O1.
      ['CO', 0.001145, 'C', 7200],
    ]) {
      const sample = { formula, density, absorber, edge: 'K', preset: null };
      const { plan, edge } = samplePlan(sample);
      assert.ok(plan);
      const attenuation = mu(formula, density, energy);
      const expected = {
        energy_eV: edge.energy_eV, mu_total: attenuation.total, mu_photo: attenuation.photo,
        delta_mu: plan.edgeStep.deltaMu_cm_inv, mu_above: plan.edgeStep.muAbove_cm_inv,
        thickness_um: plan.thickness_um, mass_per_area: plan.massPerArea_mg_cm2,
        pellet_mass: plan.sampleMass_mg, edge_step: plan.achievedEdgeStep,
        total_absorption: plan.totalAbsorptionAbove,
      };
      const script = pythonScript(sample, energy);
      const path = join(directory, script.filename);
      const inspection = `
import json
assert xraydb.__version__.startswith('4.5.'), xraydb.__version__
print('CHECK_JSON=' + json.dumps(dict(version=xraydb.__version__, energy_eV=e0,
    mu_total=mu_total, mu_photo=mu_photo, delta_mu=delta_mu, mu_above=mu_above,
    thickness_um=d_cm*1e4, mass_per_area=mass_per_area,
    pellet_mass=mass_per_area*pellet_area, edge_step=delta_mu*d_cm,
    total_absorption=mu_above*d_cm)))
`;
      writeFileSync(path, script.code + inspection, 'utf8');
      let result;
      try {
        result = spawnSync(python, ['-B', path], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' } });
      } finally { unlinkSync(path); }
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const actual = JSON.parse(result.stdout.split(/\r?\n/).find(line => line.startsWith('CHECK_JSON=')).slice(11));
      const comparisons = Object.entries(expected).map(([name, lab]) => {
        const relative = Math.abs(actual[name] / lab - 1);
        assert.ok(relative < 0.01, `${formula} ${name}: Python ${actual[name]}, lab ${lab}, relative error ${relative}`);
        return { quantity: name, console: lab, python: actual[name], difference_percent: relative * 100 };
      });
      console.log(`\n${formula} / ${absorber} K / ${energy} eV / xraydb ${actual.version}`);
      console.table(comparisons);
      for (const command of [`mu ${formula} ${density} ${energy}`, `plan ${formula} ${density} ${absorber} K`]) {
        const result = runCommand(command, { sample, energy });
        assert.ok(result.lines.every(line => line.kind !== 'error'));
        console.log(command);
        for (const line of result.lines) if (line.kind === 'row') console.log(`  ${line.label}: ${line.value}`);
      }
    }
  } finally { rmdirSync(directory); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
