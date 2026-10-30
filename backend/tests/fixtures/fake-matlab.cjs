const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'child') setInterval(() => {}, 1000);
else if (['tree', 'orphan'].includes(args[0])) {
  const child = spawn(process.execPath, [__filename, 'child'], { stdio: 'ignore', windowsHide: true, detached: args[0] === 'orphan' });
  fs.writeFileSync(args[1], JSON.stringify({ parent: process.pid, child: child.pid }));
  if (args[0] === 'orphan') setTimeout(() => process.exit(0), 100);
  else setInterval(() => {}, 1000);
} else if (args[0] === 'chunks') {
  process.stdout.write('PROG'); setTimeout(() => process.stdout.write('RESS 1/1\nDONE\n'), 50);
} else { process.stdout.write(JSON.stringify(args)); process.exitCode = args[0] === 'fail' ? 7 : 0; }
