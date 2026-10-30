const fs = require('fs');
const path = require('path');
const { lazyService } = require('./lazyService');

function createConfig({ paths, settingsStore, legacy = false }) {
  let config = { port: 8000, matlabExe: '', maxConcurrentJobs: 1 };
  let configSource = '显式运行配置';
  if (legacy) {
    const file = path.join(__dirname, '..', 'config.json');
    try { config = { ...config, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; configSource = file; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (settingsStore) config = { ...config, ...settingsStore.get(), maxConcurrentJobs: 1 };
  const DATA_DIR = paths.dataDir;
  const result = { config, configSource, DATA_DIR, CACHE_DIR: paths.cacheDir, JOBS_DIR: paths.jobsDir,
    EXPORT_DIR: paths.exportDir, SOURCES_FILE: path.join(DATA_DIR, 'sources.json'),
    MATLAB_DIR: paths.matlabDir, FRONTEND_DIST: paths.frontendDir };
  for (const dir of [DATA_DIR, result.CACHE_DIR, result.JOBS_DIR, result.EXPORT_DIR]) fs.mkdirSync(dir, { recursive: true });
  return result;
}
function legacyConfig() {
  const root = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'data');
  return createConfig({ legacy: true, paths: { dataDir, cacheDir: path.join(dataDir, 'cache'), jobsDir: path.join(dataDir, 'jobs'),
    exportDir: path.join(dataDir, 'exports'), matlabDir: path.resolve(root, '../matlab'), frontendDir: path.resolve(root, '../frontend/dist') } });
}
module.exports = lazyService(legacyConfig, { createConfig });
