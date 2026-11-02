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
  const option = name => { const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]; };
  const target = require('../desktop/buildConfig.cjs').resolveBuildTarget({ mode,channel:option('--channel'),version:option('--version')||require('../package.json').version });
  for (const project of ['backend', 'frontend']) run(process.execPath, [npm, 'ci', '--cache', path.join(root, '.npm-cache'), '--no-audit', '--no-fund'], path.join(root, project));
  run(process.execPath, [npm, 'run', 'build'], path.join(root, 'frontend'));
  if (mode === 'dev') { run(require('electron'), [root]); return; }
  const scratch = path.join(root, '.desktop-build');
  const electronBinary = require('electron');
  fs.mkdirSync(scratch, { recursive: true });
  const demo = path.join(scratch, 'demo');
  fs.rmSync(demo, { recursive:true,force:true }); fs.mkdirSync(demo, { recursive: true });
  require('../desktop/tests/fixtures.cjs').createDemo(demo);
  const native = path.join(scratch,'native');fs.mkdirSync(native,{recursive:true});
  const host = await require('../backend/src/windowsProcessHost').buildWindowsProcessHost({ outputDir: native });
  require('./third-party-notices.cjs').createNotices(root,path.join(scratch,'third-party'));
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (revision.status !== 0) throw new Error('无法记录构建 revision');
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0) throw new Error('无法记录工作区状态');
  const demoManifest = {};function collect(directory){for(const name of fs.readdirSync(directory)){const file=path.join(directory,name);if(fs.statSync(file).isDirectory())collect(file);else demoManifest[path.relative(demo,file).replace(/\\/g,'/')]=require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}collect(demo);
  fs.writeFileSync(path.join(scratch, 'build-info.json'), JSON.stringify({ version: target.version,
    revision: revision.stdout.trim(), workingTreeDirty: !!status.stdout.trim(), builtAt: new Date().toISOString(), channel: target.channel, appId:target.appId, unsigned:true, demoManifest, nativeProcessHost: host.manifest,
    electron: require('electron/package.json').version, node: process.version }, null, 2));
  await require('electron-builder').build({ config: { extends: path.join(root, 'electron-builder.yml'), appId:target.appId,productName:target.productName,artifactName:target.artifactName,
    directories:{output:path.join(root,target.output)},extraMetadata:{version:target.version,desktopChannel:target.channel,productName:target.productName},
    electronDist: path.dirname(electronBinary) }, dir: mode === 'pack' });
  require('./package-verify.cjs').verifyPackage(path.join(root,target.output,'win-unpacked'));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
