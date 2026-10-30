const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { createDemo } = require('../desktop/tests/fixtures.cjs');
const root = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-demo-'));
console.log(JSON.stringify(createDemo(root), null, 2));
