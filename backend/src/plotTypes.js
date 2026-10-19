// 数据类型注册表。key 与 .dem 文件名(去后缀)一致,label 用于界面展示。
// fn 为 platform/matlab 目录下对应的 showrsrp_* 渲染函数名。
const PLOT_TYPES = {
  RSRP: {
    label: 'RSRP',
    desc: '参考信号接收功率',
    fn: 'showrsrp_rsrp',
    unit: 'dBm',
  },
  SCR: {
    label: 'SCR',
    desc: '信杂比',
    fn: 'showrsrp_scr',
    unit: 'dB',
  },
  ECHORP: {
    label: 'ECHO',
    desc: '回波接收功率',
    fn: 'showrsrp_echorp',
    unit: 'dBm',
  },
  DLRSSINR: {
    label: 'DLRSSINR',
    desc: '下行 RS-SINR',
    fn: 'showrsrp_dlrssinr',
    unit: 'dB',
  },
  BESTSERVER: {
    label: 'BESTSERVER',
    desc: '最佳服务小区',
    fn: 'showrsrp_bestserver',
    unit: '',
  },
};

const GROUND_LAYER = 'ground';
const GROUND_LABEL = '地面';

function isKnown(key) {
  return !!PLOT_TYPES[key];
}

function typeInfo(key) {
  return PLOT_TYPES[key] || { label: key, desc: '', fn: null, unit: '' };
}

function displayLabel(key) {
  const t = PLOT_TYPES[key];
  return t ? t.label : key;
}

function layerLabel(layer) {
  if (layer === GROUND_LAYER) return GROUND_LABEL;
  // 室内楼层:层键 F1/F2 → 显示 1层/2层
  const m = String(layer).match(/^F(\d+)$/);
  if (m) return `${m[1]}层`;
  return layer;
}

module.exports = { PLOT_TYPES, GROUND_LAYER, GROUND_LABEL, isKnown, typeInfo, displayLabel, layerLabel };
