const crypto = require('crypto');

// 坐标显示方式:
//   abs        绝对 UTM 坐标(默认,便于与 GIS/工参叠加)
//   rel-ll     相对坐标,原点取区域左下角
//   rel-center 相对坐标,原点取区域中心
const COORD_MODES = ['abs', 'rel-ll', 'rel-center'];

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
  const parts = [];
  if (unifiedRange && figure.bounds && !sameRange(figure.bounds, unifiedRange)) {
    parts.push('u' + shortHash(rangeKey(unifiedRange)));
  }
  if (coordMode !== 'abs') parts.push(coordMode);
  return parts.join('_');
}

module.exports = { COORD_MODES, normalizeCoordMode, unionRange, variantFor, sameRange, rangeKey };
