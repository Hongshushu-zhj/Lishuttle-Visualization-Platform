const path = require('node:path');
const { createJsonStore } = require('./jsonStore');
const METRICS = ['RSRP', 'SCR', 'ECHORP', 'DLRSSINR'];
const analysisDefaults = {
  RSRP: { boundaries: [-110, -100, -90, -80], threshold: -100 },
  DLRSSINR: { boundaries: [-5, 0, 5, 10, 20], threshold: 5 },
  SCR: { boundaries: [-20, -10, 0, 10], threshold: 0 },
  ECHORP: { boundaries: [-170, -150, -130, -110], threshold: -150 },
};
const invalid = message => Object.assign(new Error(message), { code: 'INVALID_CONFIG', status: 400 });
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('配置必须为对象'); }
function keys(value, allowed) { object(value); if (Object.keys(value).some(key => !allowed.includes(key))) throw invalid('配置包含未知字段'); }
function schema(value) {
  if (Number.isInteger(value.schemaVersion) && value.schemaVersion > 1) throw Object.assign(new Error('配置来自较新版本，已停止写入以保护原文件'), { code: 'NEWER_SCHEMA' });
  if (value.schemaVersion !== 1) throw invalid('配置版本无效');
}
function validateSettings(value) {
  object(value); schema(value); keys(value, ['schemaVersion', 'matlabExe', 'outputMode', 'outputRoot', 'jobTimeoutMinutes', 'maxConcurrentJobs']);
  for (const key of ['matlabExe', 'outputRoot']) {
    if (typeof value[key] !== 'string' || value[key].length > 32760 || value[key].includes('\0') || (value[key] && !path.isAbsolute(value[key]))) throw invalid('配置路径必须为空或绝对路径');
  }
  if (!['source', 'separate'].includes(value.outputMode)) throw invalid('输出策略无效');
  if (value.outputMode === 'separate' && !value.outputRoot) throw invalid('请选择独立输出目录');
  if (!Number.isInteger(value.jobTimeoutMinutes) || value.jobTimeoutMinutes < 5 || value.jobTimeoutMinutes > 240) throw invalid('任务超时须为 5～240 分钟');
  if (value.maxConcurrentJobs !== 1) throw invalid('MATLAB 并发固定为 1');
  return structuredClone(value);
}
function validatePreferences(value) {
  object(value); schema(value); keys(value, ['schemaVersion', 'colorRanges', 'analysisConfig']);
  keys(value.colorRanges, METRICS); keys(value.analysisConfig, METRICS);
  for (const entry of Object.values(value.colorRanges)) {
    keys(entry, ['range', 'enabled']);
    if (!Array.isArray(entry.range) || entry.range.length !== 2 || !entry.range.every(Number.isFinite) || entry.range[0] >= entry.range[1] || typeof entry.enabled !== 'boolean') throw invalid('色标范围须为两个递增有限数值');
  }
  for (const entry of Object.values(value.analysisConfig)) {
    keys(entry, ['boundaries', 'threshold']);
    if (!Array.isArray(entry.boundaries) || !entry.boundaries.length || entry.boundaries.length > 20 || !entry.boundaries.every((n, i, a) => Number.isFinite(n) && (!i || n > a[i - 1])) || !Number.isFinite(entry.threshold)) throw invalid('分档须为 1～20 个递增有限数值，门限须为有限数值');
  }
  return structuredClone(value);
}
function createSettingsStore({ paths, io, initialSettings = {} }) {
  const warnings = [];
  const settings = createJsonStore({ file: path.join(paths.dataDir, 'settings.json'), io, warnings, validate: validateSettings,
    defaults: { schemaVersion: 1, matlabExe: '', outputMode: ['stable', 'web'].includes(paths.channel) ? 'source' : 'separate',
      outputRoot: path.join(paths.dataDir, 'results'), jobTimeoutMinutes: 30, maxConcurrentJobs: 1, ...initialSettings } });
  const preferences = createJsonStore({ file: path.join(paths.dataDir, 'preferences.json'), io, warnings, validate: validatePreferences,
    defaults: { schemaVersion: 1, colorRanges: {}, analysisConfig: analysisDefaults } });
  return { warnings, get: settings.get, getPreferences: preferences.get,
    update(patch) { object(patch); return settings.set({ ...settings.get(), ...patch }); },
    replacePreferences: preferences.set,
    updatePreferences(patch) {
      keys(patch, ['schemaVersion', 'colorRanges', 'analysisConfig']);
      const current = preferences.get(), next = { ...current, ...patch };
      for (const group of ['colorRanges', 'analysisConfig']) {
        if (!Object.hasOwn(patch, group)) continue;
        keys(patch[group], METRICS);
        next[group] = { ...current[group] };
        for (const [metric, entry] of Object.entries(patch[group])) {
          object(entry);
          next[group][metric] = { ...current[group][metric], ...entry };
        }
      }
      return preferences.set(next);
    },
  };
}
module.exports = { createSettingsStore, validateSettings, validatePreferences };
