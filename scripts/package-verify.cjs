const fs = require('node:fs');
const path = require('node:path');
function verifyPackage(artifact) {
  const root = path.resolve(artifact);
  const resources = path.join(root, 'resources');
  for (const file of ['app.asar', 'backend/desktop-entry.js', 'backend/src/analysisWorker.js',
    'backend/src/serverApp.js', 'backend/node_modules/express/index.js', 'frontend/index.html',
    'matlab/plot_dispatch.m', 'matlab/showrsrp_indoor.m', 'matlab/showrsrp_outdoor.m', 'build-info.json',
    'demo/demo/pred/室内 A/index.txt']) {
    if (!fs.statSync(path.join(resources, file)).isFile()) throw new Error(`缺少安装资源: ${file}`);
  }
  for (const file of ['backend/config.json', 'backend/data/sources.json', 'backend/data/jobs']) {
    if (fs.existsSync(path.join(resources, file))) throw new Error(`打包了个人数据: ${file}`);
  }
  console.log('PACKAGE_RESOURCES_OK: 后端、真实 worker/MATLAB 脚本、内置网页、合成演示数据；无个人配置');
  return { root, resources };
}
module.exports = { verifyPackage };
if (require.main === module) {
  try { verifyPackage(process.argv[2] || path.resolve(__dirname, '../release/win-unpacked')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
