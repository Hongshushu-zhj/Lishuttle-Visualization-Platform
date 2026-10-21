import { reactive } from 'vue';

export const colorTypes = [
  { key: 'RSRP', unit: 'dBm', range: [-120, -40] },
  { key: 'SCR', unit: 'dB', range: [-30, 15] },
  { key: 'ECHORP', unit: 'dBm', range: [-180, -110] },
  { key: 'DLRSSINR', unit: 'dB', range: [-10, 30] },
];
const STORAGE_KEY = 'antenna-color-ranges-v1';
export function validRange(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] < value[1];
}
function load() {
  const result = {};
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const type of colorTypes) {
      const entry = saved[type.key];
      if (entry && validRange(entry.range)) result[type.key] = { range: [...entry.range], enabled: entry.enabled === true };
    }
  } catch { /* 损坏或不可用的浏览器存储不影响绘图。 */ }
  return result;
}
export const colorRanges = reactive(load());
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(colorRanges)); }
  catch { throw new Error('配置已应用,但浏览器存储不可用,刷新后无法恢复'); }
}
export function saveColorRange(type, range, enabled = true) {
  if (!colorTypes.some((item) => item.key === type) || !validRange(range)) throw new Error('请选择有效指标,并确保下限小于上限');
  colorRanges[type] = { range: [...range], enabled }; persist();
}
export function enableColorRange(type, enabled) {
  if (colorRanges[type]) { colorRanges[type].enabled = enabled; persist(); }
}
export function activeColorRange(type) {
  return colorRanges[type]?.enabled ? colorRanges[type].range : null;
}
