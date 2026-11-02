const path = require('node:path');
const os = require('node:os');

function resolveRuntimePaths({ channel, dataDir, resourcesDir, sourceRoot, localAppData } = {}) {
  if (!['stable', 'dev'].includes(channel)) throw new Error('无效的应用渠道');
  for (const value of [dataDir, resourcesDir, sourceRoot, localAppData]) {
    if (value !== undefined && (!value || !path.isAbsolute(value))) throw new Error('运行目录必须使用绝对路径');
  }
  const resources = resourcesDir || sourceRoot;
  if (!resources) throw new Error('必须显式提供资源目录或源码目录');
  const userRoot = localAppData || process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share');
  const root = path.resolve(dataDir || path.join(userRoot, channel === 'stable' ? 'AntennaDraw' : 'AntennaDraw-Dev'));
  if (resourcesDir) {
    const relative = path.relative(resourcesDir, root);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('不能向安装资源目录写入用户数据');
    }
  }
  return Object.freeze({ channel, isPackaged: !!resourcesDir, dataDir: root, matlabDir: path.join(resources, 'matlab'),
    demoDir: path.join(resources, resourcesDir ? 'demo/demo' : '.desktop-build/demo/demo'),
    frontendDir: path.join(resources, resourcesDir ? 'frontend' : 'frontend/dist'),
    jobsDir: path.join(root, 'jobs'), exportDir: path.join(root, 'exports'), cacheDir: path.join(root, 'cache') });
}
module.exports = { resolveRuntimePaths };
