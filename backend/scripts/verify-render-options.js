// Isolated API/cache/retry verification; does not touch registered user data.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, '../tests/indoor-padding.test.cjs')], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log('PASS render options and compatibility');
