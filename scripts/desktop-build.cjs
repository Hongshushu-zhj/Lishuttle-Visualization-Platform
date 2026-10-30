const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
function run(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} 退出码 ${result.status}`);
}
async function main() {
  const mode = process.argv[2];
  if (!['dev', 'pack', 'dist'].includes(mode)) throw new Error('请选择 dev / pack / dist');
  for (const project of ['backend', 'frontend']) run(process.execPath, [npm, 'ci', '--cache', path.join(root, '.npm-cache'), '--no-audit', '--no-fund'], path.join(root, project));
  run(process.execPath, [npm, 'run', 'build'], path.join(root, 'frontend'));
  if (mode === 'dev') { run(require('electron'), [root]); return; }
  const scratch = path.join(root, '.desktop-build');
  const electronBinary = require('electron');
  fs.mkdirSync(scratch, { recursive: true });
  const demo = path.join(scratch, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  if (!fs.existsSync(path.join(demo, 'demo'))) require('../desktop/tests/fixtures.cjs').createDemo(demo);
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (revision.status !== 0) throw new Error('无法记录构建 revision');
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0) throw new Error('无法记录工作区状态');
  fs.writeFileSync(path.join(scratch, 'build-info.json'), JSON.stringify({ version: require('../package.json').version,
    revision: revision.stdout.trim(), workingTreeDirty: !!status.stdout.trim(), builtAt: new Date().toISOString(), channel: 'dev',
    electron: require('electron/package.json').version, node: process.version }, null, 2));
  await require('electron-builder').build({ config: { extends: path.join(root, 'electron-builder.yml'),
    electronDist: path.dirname(electronBinary) }, dir: mode === 'pack' });
  require('./package-verify.cjs').verifyPackage(path.join(root, 'release/win-unpacked'));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
