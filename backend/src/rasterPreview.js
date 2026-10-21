const fs = require('fs');
const path = require('path');

const DEFAULT_RANGES = { RSRP: [-120, -40], SCR: [-30, 15], ECHORP: [-180, -110], DLRSSINR: [-10, 30] };

// 与 MATLAB indoorGridSize 使用相同的候选顺序、取整和字节数校验。
function gridSize(bounds, samples, indoor) {
  const { left, right, bottom, top, res } = bounds || {};
  if (![left, right, bottom, top, res].every(Number.isFinite) || res <= 0 || right <= left || top <= bottom) {
    throw new Error('栅格坐标范围或分辨率不合法');
  }
  let width = indoor ? Math.floor((right - left) / res) : Math.ceil((right - left) / res);
  let height = indoor ? Math.floor((top - bottom) / res) + 1 : Math.ceil((top - bottom) / res);
  if (indoor) {
    let best = Infinity;
    const originalWidth = width, originalHeight = height;
    for (let dn = -1; dn <= 1; dn++) for (let dm = -1; dm <= 1; dm++) {
      const w = originalWidth + dn, h = originalHeight + dm;
      if (w > 0 && h > 0 && w * h === samples && Math.abs(dn) + Math.abs(dm) < best) {
        width = w; height = h; best = Math.abs(dn) + Math.abs(dm);
      }
    }
  }
  if (width <= 0 || height <= 0 || width * height !== samples) {
    throw new Error(`栅格大小不匹配: 预期 ${width}×${height}，实际 ${samples} 个 int16`);
  }
  return { width, height };
}

function wallSegments(file) {
  if (!file || !fs.existsSync(file)) return [];
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => line.replace(/%.*$/, '').trim()).filter(Boolean)
    .map((line) => line.split(/[\s,]+/).map(Number));
  if (!rows.length) return [];
  if (rows[0].length === 2 && rows[0].every(Number.isFinite) && Number.isInteger(rows[0][1]) && rows[0][1] >= 0) {
    const count = rows[0][1];
    if (rows.length < count + 1) throw new Error('墙线文件记录不足');
    return rows.slice(1, count + 1).map((row) => {
      if (row.length !== 5 || !row.every(Number.isFinite)) throw new Error('墙线记录格式错误');
      return row.slice(1);
    });
  }
  return rows.map((row) => {
    if (row.length !== 4 || !row.every(Number.isFinite)) throw new Error('墙线记录格式错误');
    return row;
  });
}

function overlays(figure) {
  if (figure.indoor) return { walls: wallSegments(figure.wallsFile), buildings: [], cells: [] };
  const buildings = [], cells = [];
  const building = path.join(figure.preddir, 'building1');
  if (fs.existsSync(building)) {
    const tokens = fs.readFileSync(building, 'utf8').trim().split(/\s+/);
    let i = 0;
    while (i + 3 < tokens.length) {
      const count = Number(tokens[i + 2]), height = Number(tokens[i + 3]);
      if (!Number.isInteger(count) || count <= 0 || i + 4 + count * 2 > tokens.length) throw new Error('建筑轮廓文件格式错误');
      i += 4;
      const points = [];
      for (let k = 0; k < count; k++) {
        const x = Number(tokens[i++]), y = Number(tokens[i++]);
        if (![x, y].every(Number.isFinite)) throw new Error('建筑轮廓坐标错误');
        points.push([x, y]);
      }
      buildings.push({ points, height });
    }
  }
  const cellFile = path.join(figure.preddir, 'cells1.txt');
  if (fs.existsSync(cellFile)) {
    for (const line of fs.readFileSync(cellFile, 'utf8').split(/\r?\n/).filter((line) => line.trim())) {
      const [name, x, y] = line.split(',');
      if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) cells.push({ name, x: Number(x), y: Number(y) });
    }
  }
  return { walls: [], buildings, cells };
}

function rasterPreview(figure) {
  const raw = fs.readFileSync(figure.demFile);
  if (raw.length % 2) throw new Error('DEM 文件长度不是 int16 的整数倍');
  const original = gridSize(figure.bounds, raw.length / 2, figure.indoor);
  // 大图预览按最近邻采样,不会对功率值或小区编号做平均。
  const stride = Math.max(1, Math.ceil(Math.max(original.width, original.height) / 1024));
  const width = Math.ceil(original.width / stride), height = Math.ceil(original.height / stride);
  const data = Buffer.alloc(width * height * 2);
  let min = Infinity, max = -Infinity, validCount = 0;
  const divisor = figure.dataType === 'BESTSERVER' ? 1 : 100;
  const zeroIsInvalid = !figure.indoor && figure.dataType === 'DLRSSINR';
  for (let i = 0; i < raw.length; i += 2) {
    const value = raw.readInt16LE(i);
    if (value !== -32768 && !(zeroIsInvalid && value === 0)) { min = Math.min(min, value / divisor); max = Math.max(max, value / divisor); validCount++; }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = Math.min(original.width - 1, Math.floor((x + 0.5) * original.width / width));
    const sourceY = Math.min(original.height - 1, Math.floor((y + 0.5) * original.height / height));
    data.writeInt16LE(raw.readInt16LE((sourceY * original.width + sourceX) * 2), (y * width + x) * 2);
  }
  let defaultRange = DEFAULT_RANGES[figure.dataType] || (validCount ? [min, max] : [0, 1]);
  if (figure.indoor && figure.dataType === 'RSRP') defaultRange = [-110, -40];
  if (defaultRange[0] === defaultRange[1]) defaultRange = [defaultRange[0] - 0.5, defaultRange[1] + 0.5];
  const { left, bottom, res } = figure.bounds;
  // MATLAB imagesc 使用像素中心坐标,最外围扩展半个栅格,之后裁剪到坐标轴。
  // 室内 X/Y 序列使用 right/top - 0.01,长度不足时 imagesc 按首尾中心插值。
  function centers(start, end, count) {
    const sequenceLength = Math.min(count, Math.max(1, Math.floor((end - 0.01 - start) / res) + 1));
    const last = start + (sequenceLength - 1) * res;
    const step = count > 1 ? (last - start) / (count - 1) : res;
    return [start - step / 2, last + step / 2];
  }
  const x = figure.indoor ? centers(left, figure.bounds.right, original.width) : [left - res / 2, left + (original.width - 0.5) * res];
  const y = figure.indoor ? centers(bottom, figure.bounds.top, original.height) : [bottom - res / 2, bottom + (original.height - 0.5) * res];
  return {
    width, height, original, sampled: stride > 1, encoding: 'int16-le-base64', data: data.toString('base64'), divisor,
    invalid: -32768, zeroIsInvalid, bounds: figure.bounds, extent: { left: x[0], right: x[1], bottom: y[0], top: y[1] },
    defaultRange, min: validCount ? min : null, max: validCount ? max : null, validCount,
    categorical: figure.dataType === 'BESTSERVER', unit: divisor === 1 ? '小区编号' : ['SCR', 'DLRSSINR'].includes(figure.dataType) ? 'dB' : 'dBm',
    overlays: overlays(figure),
  };
}

module.exports = { gridSize, wallSegments, rasterPreview };
