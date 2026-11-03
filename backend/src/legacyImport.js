const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scanSource } = require('./scanner');
const { validateSettings, validatePreferences } = require('./settingsStore');

function readJson(file) {
  if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('导入文件过大');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function importLegacyDirectory({ directory, settingsStore, sourcesStore, preferencesFile, preferences }) {
  if (!path.isAbsolute(directory)) throw new Error('请选择旧项目的绝对路径');
  const old = readJson(path.join(directory, 'backend/config.json'));
  if (!old || typeof old !== 'object' || Array.isArray(old)) throw new Error('旧配置无效');
  const patch = {};
  for (const key of ['matlabExe', 'outputMode', 'outputRoot', 'jobTimeoutMinutes']) if (Object.hasOwn(old, key)) patch[key] = old[key];
  const nextSettings = validateSettings({ ...settingsStore.get(), ...patch });
  const file = path.join(directory, 'backend/data/sources.json');
  const oldSources = fs.existsSync(file) ? readJson(file) : [];
  if (!Array.isArray(oldSources) || oldSources.length > 1000) throw new Error('旧数据源清单无效');
  const imported = oldSources.map(source => {
    if (!source || typeof source.path !== 'string' || !path.isAbsolute(source.path)) throw new Error('旧数据源路径无效');
    const sourcePath = path.resolve(source.path);
    const id = typeof source.id === 'string' && source.id ? source.id : crypto.createHash('md5').update(sourcePath.toLowerCase()).digest('hex').slice(0, 12);
    const scan = scanSource(sourcePath);
    return { id, path: sourcePath, name: typeof source.name === 'string' ? source.name : path.basename(sourcePath),
      addedAt: typeof source.addedAt === 'string' ? source.addedAt : new Date().toISOString(), scan, offline: !scan.ok };
  });
  const nextPreferences = preferences !== undefined ? validatePreferences(preferences) : preferencesFile ? validatePreferences(readJson(preferencesFile)) : null;
  const replacePreferences = settingsStore.replacePreferences || settingsStore.updatePreferences;
  const beforeSettings = settingsStore.get(), beforeSources = structuredClone(sourcesStore.list()), beforePreferences = settingsStore.getPreferences();
  const merged = new Map(beforeSources.map(source => [source.id, source]));
  for (const source of imported) merged.set(source.id, source);
  try {
    settingsStore.update(nextSettings);
    if (nextPreferences) settingsStore.updatePreferences(nextPreferences);
    sourcesStore.replace([...merged.values()]);
  } catch (error) {
    try { settingsStore.update(beforeSettings); if (nextPreferences) replacePreferences(beforePreferences); }
    catch (rollbackError) { throw new AggregateError([error, rollbackError], '导入失败且恢复配置未完成，请保留备份并导出诊断'); }
    throw error;
  }
  return { sourceCount: imported.length, offlineCount: imported.filter(source => source.offline).length };
}
module.exports = { importLegacyDirectory };
