const path = require('path');

// 保持 MATLAB/浏览器预览的尺寸校验与有效值口径一致。
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

function rasterRules(dataType, indoor) {
  return { invalid: -32768, zeroIsInvalid: !indoor && dataType === 'DLRSSINR',
    divisor: dataType === 'BESTSERVER' ? 1 : 100, categorical: dataType === 'BESTSERVER' };
}

function resolveRaster(task, type, layerInfo) {
  const file = layerInfo.file || type.file;
  const demFile = type.flat || layerInfo.key === 'ground'
    ? path.join(task.predDir, file) : path.join(task.predDir, layerInfo.key, file);
  return { demFile, bounds: layerInfo.bounds || type.bounds, indoor: !!task.indoor };
}

module.exports = { gridSize, rasterRules, resolveRaster };
