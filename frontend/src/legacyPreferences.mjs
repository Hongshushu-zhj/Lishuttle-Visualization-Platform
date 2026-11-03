import { analysisDefaults, validateConfig } from './analysisModel.mjs';
const types = Object.keys(analysisDefaults);
export function previewLegacyPreferences(storage) {
  const preferences = { colorRanges: {}, analysisConfig: {} }, warnings = [];
  for (const [section, key] of [['colorRanges', 'antenna-color-ranges-v1'], ['analysisConfig', 'antenna-analysis-config-v1']]) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const saved = JSON.parse(raw);
      for (const type of types) {
        const value = saved?.[type];
        if (!value) continue;
        const valid = section === 'colorRanges'
          ? Array.isArray(value.range) && value.range.length === 2 && value.range.every(Number.isFinite) && value.range[0] < value.range[1]
          : validateConfig(value);
        if (!valid) { warnings.push(`${type} 的${section === 'colorRanges' ? '色标' : '分析'}偏好无效，已忽略`); continue; }
        preferences[section][type] = section === 'colorRanges' ? { range: [...value.range], enabled: value.enabled === true }
          : { boundaries: [...value.boundaries], threshold: value.threshold };
      }
    } catch { warnings.push(`无法读取 ${key}，原存储保持不变`); }
  }
  return { preferences, count: Object.values(preferences).reduce((sum, section) => sum + Object.keys(section).length, 0), warnings };
}
export async function parsePreferencesFile(file) {
  if (!file || file.size > 1024 * 1024) throw new Error('请选择不超过 1 MB 的偏好 JSON 文件');
  let value;
  try { value = JSON.parse(await file.text()); } catch { throw new Error('偏好文件不是有效的 JSON'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('偏好 JSON 必须为对象');
  return value;
}
