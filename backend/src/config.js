const fs = require('node:fs');
const path = require('node:path');
const { resolveWebPaths } = require('./runtimePaths');

function loadWebConfiguration(options = {}) {
  const paths = resolveWebPaths(options), file = path.join(paths.sourceRoot, 'backend/config.json');
  let legacy = {};
  try { legacy = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`无法读取 Web 配置 ${file}：${error.message}`); }
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('Web 配置必须为 JSON 对象');
  const port = legacy.port ?? 8000;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Web 端口必须为 1024～65535 的整数');
  const warnings = [];
  if (legacy.maxConcurrentJobs !== undefined && legacy.maxConcurrentJobs !== 1) warnings.push('MATLAB 并发已调整为 1，与桌面任务管理保持一致');
  const initialSettings = { matlabExe: '', outputMode: 'source', outputRoot: path.join(paths.dataDir, 'results'), jobTimeoutMinutes: 30, maxConcurrentJobs: 1 };
  for (const key of ['matlabExe', 'outputMode', 'outputRoot', 'jobTimeoutMinutes']) if (Object.hasOwn(legacy, key)) initialSettings[key] = legacy[key];
  return { port, paths, initialSettings, warnings, configSource: fs.existsSync(file) ? file : '内置 Web 默认值', legacyConfigFile: fs.existsSync(file) ? file : null };
}

function createWebSettingsStore({ paths, initialSettings, warnings = [], legacyConfigFile } = {}) {
  const { createSettingsStore } = require('./settingsStore');
  if (!paths) throw new Error('缺少 Web 运行目录');
  const firstRun = !fs.existsSync(path.join(paths.dataDir, 'settings.json'));
  if (firstRun) {
    const backupDir = path.join(paths.dataDir, 'migration'); fs.mkdirSync(backupDir, { recursive: true });
    for (const [source, name] of [[legacyConfigFile, 'config.json'], [path.join(paths.dataDir, 'sources.json'), 'sources.json']]) {
      if (source && fs.existsSync(source) && !fs.existsSync(path.join(backupDir, name))) fs.copyFileSync(source, path.join(backupDir, name));
    }
  }
  const store = createSettingsStore({ paths, initialSettings: firstRun ? initialSettings : {} });
  if (firstRun) store.update({});
  store.warnings.push(...warnings); return store;
}

function createConfig({ paths, settingsStore, port = 8000, configSource = 'Web 应用设置' }) {
  const config = { port };
  for (const key of Object.keys(settingsStore.get())) Object.defineProperty(config, key, { enumerable: true, get: () => settingsStore.get()[key] });
  const runtime = { config, configSource, DATA_DIR: paths.dataDir, CACHE_DIR: paths.cacheDir, JOBS_DIR: paths.jobsDir,
    EXPORT_DIR: paths.exportDir, SOURCES_FILE: path.join(paths.dataDir, 'sources.json'), MATLAB_DIR: paths.matlabDir, FRONTEND_DIST: paths.frontendDir };
  for (const directory of [runtime.DATA_DIR, runtime.CACHE_DIR, runtime.JOBS_DIR, runtime.EXPORT_DIR]) fs.mkdirSync(directory, { recursive: true });
  return runtime;
}

// 原专项检查按需访问 config.config / JOBS_DIR；导入配置加载器本身不写文件。
let defaultRuntime;
const factories = { loadWebConfiguration, createWebSettingsStore, createConfig };
module.exports = new Proxy(factories, { get(target, key) {
  if (Reflect.has(target, key)) return Reflect.get(target, key);
  if (typeof key === 'symbol' || ['then', 'toJSON'].includes(key)) return undefined;
  if (!defaultRuntime) {
    const startup = loadWebConfiguration();
    defaultRuntime = createConfig({ ...startup, settingsStore: createWebSettingsStore(startup) });
  }
  return defaultRuntime[key];
} });
