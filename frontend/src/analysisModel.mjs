export const analysisDefaults = {
  RSRP: { boundaries: [-110, -100, -90, -80], threshold: -100 },
  DLRSSINR: { boundaries: [-5, 0, 5, 10, 20], threshold: 5 },
  SCR: { boundaries: [-20, -10, 0, 10], threshold: 0 },
  ECHORP: { boundaries: [-170, -150, -130, -110], threshold: -150 },
};
export const analysisUnits = { RSRP: 'dBm', DLRSSINR: 'dB', SCR: 'dB', ECHORP: 'dBm', BESTSERVER: '' };

// 当前分析页聚焦连续覆盖指标；小区归属解析保留供后续独立模块复用。
export function availableAnalysisTypes(task) {
  return Object.values(task?.types || {}).filter(type => type.known && Object.hasOwn(analysisDefaults, type.key));
}

export function validateConfig(config) {
  return !!config && Array.isArray(config.boundaries) && config.boundaries.length > 0 && config.boundaries.length <= 20 &&
    config.boundaries.every((v, i, a) => Number.isFinite(v) && (!i || v > a[i - 1])) && Number.isFinite(config.threshold);
}

export function deriveLayer(layer, config) {
  if (layer.error) return layer;
  const ratio = count => layer.validCount ? count / layer.validCount * 100 : null;
  const area = count => count * layer.resolution ** 2;
  if (layer.categorical) {
    const ranked = layer.frequencies.slice().sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const dominantCount = ranked[0]?.[1];
    const dominantCellIds = ranked.filter(([, count]) => count === dominantCount).map(([id]) => id);
    return { ...layer, passRate: null, dominantCellIds,
      dominantShare: layer.validCount ? ratio(dominantCount) : null,
      top3Share: layer.validCount ? ratio(ranked.slice(0, 3).reduce((sum, [, count]) => sum + count, 0)) : null,
      validArea: area(layer.validCount),
      bins: layer.frequencies.map(([id, count]) => ({ label: String(id), count, percent: ratio(count), area: area(count) })) };
  }
  if (!validateConfig(config)) throw new Error('分界值须为 1～20 个递增、不重复的有限数值，门限须为有限数值');
  const edges = [-Infinity, ...config.boundaries, Infinity];
  const bins = edges.slice(0, -1).map((lower, i) => ({
    lower, upper: edges[i + 1], label: `[${lower === -Infinity ? '-∞' : lower}, ${edges[i + 1] === Infinity ? '+∞' : edges[i + 1]})`, count: 0,
  }));
  let passCount = 0;
  for (const [raw, count] of layer.frequencies) {
    const value = raw / layer.divisor;
    const index = config.boundaries.findIndex(edge => value < edge);
    bins[index < 0 ? bins.length - 1 : index].count += count;
    if (value >= config.threshold) passCount += count;
  }
  return { ...layer, bins: bins.map(b => ({ ...b, percent: ratio(b.count), area: area(b.count) })), passCount, passRate: ratio(passCount) };
}

export function histogram(layer, bucketCount = 24) {
  const frequencies = layer.frequencies || [];
  if (!frequencies.length) return [];
  const min = frequencies[0][0], max = frequencies.at(-1)[0];
  if (min === max) return [{ label: String(min / layer.divisor), count: layer.validCount }];
  const step = Math.max(1, Math.ceil((max - min + 1) / bucketCount));
  const bins = Array.from({ length: Math.ceil((max - min + 1) / step) }, (_, i) => ({
    label: `[${(min + i * step) / layer.divisor}, ${(min + (i + 1) * step) / layer.divisor})`, count: 0,
  }));
  for (const [value, count] of frequencies) bins[Math.floor((value - min) / step)].count += count;
  return bins;
}

export function topCategories(bins) {
  const sorted = bins.slice().sort((a, b) => b.count - a.count || Number(a.label) - Number(b.label));
  if (sorted.length <= 10) return sorted;
  const rest = sorted.slice(10);
  return [...sorted.slice(0, 10), { label: '其他', count: rest.reduce((s, b) => s + b.count, 0),
    percent: rest.reduce((s, b) => s + b.percent, 0), area: rest.reduce((s, b) => s + b.area, 0) }];
}

export function csvText(rows) {
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}

export function exportRows(snapshot, layers, config, detail = false) {
  const categorical = snapshot.dataType === 'BESTSERVER';
  const context = ['数据源', '任务', '指标', '单位', '层', '分析时间', '统计口径', ...(categorical ? [] : ['分界值', '达标门限'])];
  const common = ['总点数', '有效点数', '无效点数', '数据有效率(%)'];
  const header = detail ? [categorical ? '小区编号' : '数值区间', '点数', '占有效点百分比', '栅格估算面积(m²)', '错误'] :
    [...common, ...(categorical ? ['有效小区数', '主导小区编号（含并列）', '主导小区占比(%)', '前三小区合计占比(%)', '有效归属栅格估算面积(m²)'] :
      ['最小值', '最大值', '算术均值', '中位数', 'P10', 'P90', '有效点达标率(%)']), '错误'];
  const rows = [[...context, ...header]];
  for (const layer of layers) {
    const method = `全量DEM；有效点为分母；排除-32768${!snapshot.indoor && snapshot.dataType === 'DLRSSINR' ? '及0' : ''}；面积=点数×分辨率²；分辨率=${layer.resolution ?? '未知'}m；` +
      (categorical ? '编号为分类；主导小区保留并列；主导占比为单个最大占比；前三小区按点数排序；不代表负载或信号质量' : '均值为dB/dBm算术平均；分位数为最近秩');
    const base = [snapshot.sourceName, snapshot.taskName, snapshot.dataType, analysisUnits[snapshot.dataType], layer.layerLabel,
      snapshot.analyzedAt, method, ...(categorical ? [] : [config.boundaries.join(' / '), `≥ ${config.threshold}`])];
    if (detail) {
      if (layer.error || !layer.validCount) rows.push([...base, '无有效数据', 0, null, 0, layer.error || '']);
      else for (const bin of layer.bins) rows.push([...base, bin.label, bin.count, bin.percent, bin.area, '']);
    } else rows.push([...base, layer.totalCount, layer.validCount, layer.invalidCount, layer.validRate,
      ...(categorical ? [layer.categoryCount, layer.dominantCellIds?.join(' / '), layer.dominantShare, layer.top3Share, layer.validArea] :
        [layer.min, layer.max, layer.mean, layer.median, layer.p10, layer.p90, layer.passRate]), layer.error || '']);
  }
  return rows;
}
