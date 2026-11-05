import { reactive } from 'vue';
import { analysisDefaults, validateConfig } from './analysisModel.mjs';
import { preferences } from './preferences';

const initial = structuredClone(analysisDefaults);
export const analysisConfig = reactive(initial);
preferences.subscribe(saved => Object.assign(analysisConfig, structuredClone(analysisDefaults), saved.analysisConfig));
export async function saveAnalysisConfig(type, config) {
  if (!Object.hasOwn(analysisDefaults, type) || !validateConfig(config)) throw new Error('请检查分界值及门限');
  await preferences.updateSection('analysisConfig', type, { boundaries: [...config.boundaries], threshold: config.threshold });
}
