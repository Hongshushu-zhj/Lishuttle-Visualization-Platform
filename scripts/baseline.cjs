// All checks use isolated fixtures; never connect to the user's running service.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const args of [
  ['backend/scripts/verify-indoor-padding.js'],
  ['--test', 'backend/tests/*.test.cjs'],
  ['--test', 'frontend/scripts/*.test.mjs'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS Web baseline');
