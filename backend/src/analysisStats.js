const fs = require('fs');
const { gridSize, rasterRules } = require('./rasterData');
const { typeInfo } = require('./plotTypes');

function analyzeRaster(figure) {
  const raw = fs.readFileSync(figure.demFile);
  if (raw.length % 2) throw new Error('DEM 文件长度不是 int16 的整数倍');
  if (!raw.length) throw new Error('DEM 文件为空');
  const grid = gridSize(figure.bounds, raw.length / 2, figure.indoor);
  const rules = rasterRules(figure.dataType, figure.indoor);
  const counts = new Float64Array(65536);
  let validCount = 0, sum = 0;
  for (let i = 0; i < raw.length; i += 2) {
    const value = raw.readInt16LE(i);
    if (value === rules.invalid || (rules.zeroIsInvalid && value === 0)) continue;
    counts[value + 32768]++; validCount++; sum += value;
  }
  const frequencies = [];
  for (let i = 0; i < counts.length; i++) if (counts[i]) frequencies.push([i - 32768, counts[i]]);
  const quantile = (q) => {
    const rank = Math.ceil(validCount * q);
    let cumulative = 0;
    for (const [value, count] of frequencies) {
      cumulative += count;
      if (cumulative >= rank) return value / rules.divisor;
    }
    return null;
  };
  const continuous = validCount > 0 && !rules.categorical;
  return { ...rules, grid, resolution: figure.bounds.res, bounds: figure.bounds, unit: typeInfo(figure.dataType).unit,
    totalCount: raw.length / 2, validCount, invalidCount: raw.length / 2 - validCount,
    validRate: validCount / (raw.length / 2) * 100, frequencies,
    categoryCount: rules.categorical ? frequencies.length : null,
    min: continuous ? frequencies[0][0] / rules.divisor : null,
    max: continuous ? frequencies.at(-1)[0] / rules.divisor : null,
    mean: continuous ? sum / validCount / rules.divisor : null,
    median: continuous ? quantile(0.5) : null, p10: continuous ? quantile(0.1) : null, p90: continuous ? quantile(0.9) : null };
}

module.exports = { analyzeRaster };
