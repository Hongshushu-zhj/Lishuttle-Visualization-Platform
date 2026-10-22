import { reactive } from 'vue';
import { analysisDefaults, validateConfig } from './analysisModel.mjs';

const KEY = 'antenna-analysis-config-v1';
const initial = structuredClone(analysisDefaults);
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const type of Object.keys(initial)) if (validateConfig(saved[type])) initial[type] = saved[type];
} catch { /* 不可用/损坏的本地存储不阻止分析。 */ }
export const analysisConfig = reactive(initial);
export function saveAnalysisConfig(type, config) {
  if (!Object.hasOwn(analysisDefaults, type) || !validateConfig(config)) throw new Error('请检查分界值及门限');
  analysisConfig[type] = { boundaries: [...config.boundaries], threshold: config.threshold };
  try { localStorage.setItem(KEY, JSON.stringify(analysisConfig)); }
  catch { throw new Error('配置已应用，但浏览器存储不可用，刷新后无法恢复'); }
}
