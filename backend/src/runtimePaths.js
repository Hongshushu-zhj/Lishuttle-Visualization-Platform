const path = require('node:path');

function resolveWebPaths({ sourceRoot = path.resolve(__dirname, '../..'), dataDir = process.env.ANTENNA_WEB_DATA_DIR } = {}) {
  if (!path.isAbsolute(sourceRoot) || (dataDir !== undefined && (!dataDir || !path.isAbsolute(dataDir)))) throw new Error('Web 运行目录必须使用绝对路径');
  const root = path.resolve(sourceRoot), data = path.resolve(dataDir || path.join(root, 'backend/data'));
  return Object.freeze({ sourceRoot: root, channel: 'web', isPackaged: false, dataDir: data,
    matlabDir: path.join(root, 'matlab'), frontendDir: path.join(root, 'frontend/dist'),
    jobsDir: path.join(data, 'jobs'), exportDir: path.join(data, 'exports'), cacheDir: path.join(data, 'cache') });
}

module.exports = { resolveWebPaths, resolveRuntimePaths: resolveWebPaths };
