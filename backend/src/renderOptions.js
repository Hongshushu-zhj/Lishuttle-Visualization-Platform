const crypto = require('crypto');

// 坐标显示方式:
//   abs        绝对 UTM 坐标(默认,便于与 GIS/工参叠加)
//   rel-ll     相对坐标,原点取区域左下角
//   rel-center 相对坐标,原点取区域中心
const COORD_MODES = ['abs', 'rel-ll', 'rel-center'];
const INDOOR_PADDING = Object.freeze({ ratio: 0.05, minCells: 2, renderPolicy: 'indoor-padding-v1' });

function indoorViewOptions(figures) {
  const invalid = () => Object.assign(new Error('室内绘图范围及分辨率必须为有限数值，宽高及分辨率必须大于 0'), { status: 400 });
  if (!figures.length) throw invalid();
  for (const { bounds: b } of figures) {
    if (!b || ![b.left, b.right, b.bottom, b.top, b.res].every(Number.isFinite) || b.right <= b.left || b.top <= b.bottom || b.res <= 0) throw invalid();
  }
  const coordBounds = unionRange(figures);
  const width = coordBounds.right - coordBounds.left, height = coordBounds.top - coordBounds.bottom;
  const padding = Math.max(Math.max(width, height) * INDOOR_PADDING.ratio, INDOOR_PADDING.minCells * Math.max(...figures.map(f => f.bounds.res)));
  const xlim = [coordBounds.left - padding, coordBounds.right + padding];
  const ylim = [coordBounds.bottom - padding, coordBounds.top + padding];
  if (![width, height, padding, ...xlim, ...ylim, xlim[1] - xlim[0], ylim[1] - ylim[0]].every(Number.isFinite)) throw invalid();
  return { coordBounds, xlim, ylim, renderPolicy: INDOOR_PADDING.renderPolicy };
}

function normalizeCoordMode(mode) {
  return COORD_MODES.includes(mode) ? mode : 'abs';
}

function shortHash(s) {
  return crypto.createHash('md5').update(s).digest('hex').slice(0, 8);
}

function sameRange(a, b) {
  if (!a || !b) return false;
  const eq = (x, y) => Math.abs(x - y) < 1e-6;
  return eq(a.left, b.left) && eq(a.right, b.right) && eq(a.bottom, b.bottom) && eq(a.top, b.top);
}

// 统一范围 = 本次任务所有图范围的并集(保证同一批图坐标轴一致,便于跨源比较)
function unionRange(figures) {
  const withBounds = figures.filter((f) => f.bounds);
  if (withBounds.length === 0) return null;
  return {
    left: Math.min(...withBounds.map((f) => f.bounds.left)),
    right: Math.max(...withBounds.map((f) => f.bounds.right)),
    bottom: Math.min(...withBounds.map((f) => f.bounds.bottom)),
    top: Math.max(...withBounds.map((f) => f.bounds.top)),
  };
}

function rangeKey(range) {
  return [range.left, range.right, range.bottom, range.top].map((v) => Math.round(v)).join('_');
}

// 计算某张图的渲染变体名:
//   统一范围与该图自身范围一致且坐标显示为绝对值 → 空变体(沿用原始缓存路径,避免重复出图)
//   否则带上范围哈希/坐标模式,不同口径的图片分开缓存
function variantFor(figure, unifiedRange, coordMode) {
  if (figure.indoor && figure.renderPolicy === INDOOR_PADDING.renderPolicy) {
    const b = figure.coordBounds;
    const input = JSON.stringify({ policy: figure.renderPolicy, xlim: figure.xlim, ylim: figure.ylim,
      coordBounds: { left: b.left, right: b.right, bottom: b.bottom, top: b.top }, coordMode });
    const digest = crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
    return `ip1_${digest}${coordMode === 'abs' ? '' : '_' + coordMode}`;
  }
  const parts = [];
  if (unifiedRange && figure.bounds && !sameRange(figure.bounds, unifiedRange)) {
    parts.push('u' + shortHash(rangeKey(unifiedRange)));
  }
  if (coordMode !== 'abs') parts.push(coordMode);
  return parts.join('_');
}

module.exports = { COORD_MODES, INDOOR_PADDING, indoorViewOptions, normalizeCoordMode, unionRange, variantFor, sameRange, rangeKey };
