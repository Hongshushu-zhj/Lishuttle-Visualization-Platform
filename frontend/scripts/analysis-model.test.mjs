import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLayer, validateConfig, histogram, topCategories, csvText, exportRows } from '../src/analysisModel.mjs';

const layer = { validCount: 5, totalCount: 6, divisor: 100, resolution: 2, frequencies: [[-11000, 1], [-10000, 2], [-9000, 1], [-8000, 1]] };
test('分档左闭右开且包含两端，门限值计入达标，面积按分辨率平方', () => {
  const result = deriveLayer(layer, { boundaries: [-110, -100, -90], threshold: -100 });
  assert.deepEqual(result.bins.map(b => b.count), [0, 1, 2, 2]);
  assert.equal(result.bins.reduce((s, b) => s + b.percent, 0), 100);
  assert.equal(result.passRate, 80); assert.equal(result.bins[2].area, 8);
});
test('全无效不返回虚假的 0% 达标', () => {
  const result = deriveLayer({ ...layer, validCount: 0, frequencies: [] }, { boundaries: [-100], threshold: -100 });
  assert.equal(result.passRate, null); assert.equal(result.bins[0].percent, null);
});
test('配置拒绝重复、无序、非有限值，允许零门限', () => {
  assert.equal(validateConfig({ boundaries: [-10, 0, 10], threshold: 0 }), true);
  for (const boundaries of [[0, 0], [10, 0], [NaN], []]) assert.equal(validateConfig({ boundaries, threshold: 0 }), false);
});
test('直方图保留所有样本及常量、空值', () => {
  assert.equal(histogram(layer).reduce((s, b) => s + b.count, 0), 5);
  assert.equal(histogram({ ...layer, frequencies: [[100, 5]] })[0].count, 5);
  assert.deepEqual(histogram({ ...layer, frequencies: [] }), []);
});
test('分类图前十与其他合计保留全部，小区 0 也是合法编号', () => {
  const values = Array.from({ length: 12 }, (_, i) => ({ label: String(i), count: i + 1 }));
  const top = topCategories(values);
  assert.equal(top.length, 11); assert.equal(top.at(-1).label, '其他');
  assert.equal(top.reduce((s, b) => s + b.count, 0), 78);
});
test('CSV 带 BOM、正确转义，并防止公式注入', () => {
  const csv = csvText([['任务', '配置'], ['=bad', 'a,"b\nc']]);
  assert.equal(csv.charCodeAt(0), 0xfeff); assert.ok(csv.includes("'=bad")); assert.ok(csv.includes('"a,""b\nc"'));
});

test('BESTSERVER 统计服务组成和集中程度，主导小区并列不随意选一个', () => {
  const result = deriveLayer({ ...layer, categorical: true, divisor: 1, validCount: 10, frequencies: [[0, 4], [7, 4], [12, 1], [20, 1]] });
  assert.deepEqual(result.dominantCellIds, [0, 7]);
  assert.equal(result.dominantShare, 40);
  assert.equal(result.top3Share, 90);
  assert.equal(result.validArea, 40);
  assert.equal(result.passRate, null);
  const empty = deriveLayer({ ...layer, categorical: true, divisor: 1, validCount: 0, frequencies: [] });
  assert.deepEqual(empty.dominantCellIds, []);
  assert.equal(empty.dominantShare, null); assert.equal(empty.top3Share, null); assert.equal(empty.validArea, 0);
});

test('BESTSERVER 导出独立分类指标，不导出连续指标统计或门限', () => {
  const result = deriveLayer({ ...layer, layerLabel: '40m', categorical: true, divisor: 1, validCount: 10, categoryCount: 4, frequencies: [[0, 4], [7, 4], [12, 1], [20, 1]] });
  const rows = exportRows({ sourceName: '来源', taskName: '任务', dataType: 'BESTSERVER', analyzedAt: '2026-10-22', indoor: false }, [result], undefined);
  const headers = rows[0];
  for (const name of ['均值', '中位数', 'P10', 'P90', '分界值', '达标门限', '有效点达标率(%)']) assert.ok(!headers.some(header => header.includes(name)));
  assert.equal(rows[1][headers.indexOf('主导小区编号（含并列）')], '0 / 7');
  assert.equal(rows[1][headers.indexOf('主导小区占比(%)')], 40);
  assert.equal(rows[1][headers.indexOf('前三小区合计占比(%)')], 90);
  assert.ok(!rows[1][headers.indexOf('统计口径')].includes('dBm'));
});
