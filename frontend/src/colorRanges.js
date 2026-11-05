import { reactive } from 'vue';
import { preferences } from './preferences';

export const colorTypes = [
  { key: 'RSRP', unit: 'dBm', range: [-120, -40] },
  { key: 'SCR', unit: 'dB', range: [-30, 15] },
  { key: 'ECHORP', unit: 'dBm', range: [-180, -110] },
  { key: 'DLRSSINR', unit: 'dB', range: [-10, 30] },
];
export function validRange(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] < value[1];
}
export const colorRanges = reactive({});
preferences.subscribe(saved => { for (const key of Object.keys(colorRanges)) delete colorRanges[key]; Object.assign(colorRanges, saved.colorRanges); });
export async function saveColorRange(type, range, enabled = true) {
  if (!colorTypes.some((item) => item.key === type) || !validRange(range)) throw new Error('请选择有效指标,并确保下限小于上限');
  await preferences.updateSection('colorRanges', type, { range: [...range], enabled });
}
export async function enableColorRange(type, enabled) {
  if (colorRanges[type]) await preferences.updateSection('colorRanges', type, { range: [...colorRanges[type].range], enabled });
}
export function activeColorRange(type) {
  return colorRanges[type]?.enabled ? colorRanges[type].range : null;
}
