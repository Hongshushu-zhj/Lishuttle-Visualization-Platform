const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const configExamplePath = path.join(__dirname, '..', 'config.example.json');
let config = {
  port: 8000,
  matlabExe: 'D:\\Matlab\\R2022a\\bin\\matlab.exe',
  maxConcurrentJobs: 1,
};
let configSource = '内置默认值';
try {
  config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  configSource = configPath;
} catch (e) {
  // 未提供 config.json 时使用内置默认值(新环境可复制 config.example.json 后修改)
  if (fs.existsSync(configExamplePath)) configSource = `${configExamplePath}(模板,仅供参考)`;
}

const ROOT = path.join(__dirname, '..'); // backend/
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');
const MATLAB_DIR = path.join(ROOT, '..', 'matlab'); // platform/matlab(plot_dispatch.m)
const FRONTEND_DIST = path.join(ROOT, '..', 'frontend', 'dist');

for (const d of [DATA_DIR, CACHE_DIR, JOBS_DIR, EXPORT_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

module.exports = {
  config,
  configSource,
  DATA_DIR,
  CACHE_DIR,
  JOBS_DIR,
  EXPORT_DIR,
  SOURCES_FILE,
  MATLAB_DIR,
  FRONTEND_DIST,
};
