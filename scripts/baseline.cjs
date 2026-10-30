const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const commands = [
  ['backend/scripts/verify-cache-compatibility.js'],
  ['backend/scripts/verify-multi-task.js'],
  ['backend/scripts/verify-raster-preview.js'],
  ['backend/scripts/verify-analysis.js'],
  ['backend/scripts/verify-render-options.js'],
  ['--test', 'frontend/scripts/analysis-model.test.mjs'],
  ['--test', 'desktop/tests/fixtures.test.cjs'],
];
const results = commands.map(args => {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  return { command: ['node', ...args].join(' '), exitCode: r.status, signal: r.signal, output: r.stdout + r.stderr };
});
const target = path.join(root, '.desktop-test-data', 'baseline-results.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify({ node: process.version, at: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results.map(({ command, exitCode }) => ({ command, exitCode })), null, 2));
if (results.some(r => r.exitCode !== 0)) process.exitCode = 1;
