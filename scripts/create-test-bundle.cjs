const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const archiver = require('../backend/node_modules/archiver');
async function main() {
  const root = path.resolve(__dirname, '..');
  const version = require('../package.json').version;
  const installerName = `AntennaDraw-Dev-Setup-${version}-x64.exe`;
  const installer = path.join(root, 'release', installerName);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
  const sums = `${digest}  ${installerName}\n`;
  fs.writeFileSync(path.join(root, 'release', 'SHA256SUMS.txt'), sums);
  const bundle = path.join(root, 'release', `AntennaDraw-StageA-${version}.zip`);
  const output = fs.createWriteStream(bundle);
  const archive = archiver('zip', { zlib: { level: 1 } });
  const done = new Promise((resolve, reject) => {
    output.once('close', resolve); output.once('error', reject); archive.once('error', reject);
  });
  archive.pipe(output);
  archive.file(installer, { name: installerName });
  archive.file(path.join(root, 'docs/desktop-v1/external-test-guide.txt'), { name: '另一台设备验收说明.txt' });
  archive.append(sums, { name: 'SHA256SUMS.txt' });
  await archive.finalize(); await done;
  console.log(`TEST_BUNDLE_OK ${bundle}\nSHA256 ${digest}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
