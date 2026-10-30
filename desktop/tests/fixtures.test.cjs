const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('演示数据覆盖多任务、多层、缺层、连续指标和分类数据，数值固定', () => {
  const { createDemo } = require('./fixtures.cjs');
  const { scanSource } = require('../../backend/src/scanner');
  const { analyzeRaster } = require('../../backend/src/analysisStats');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-demo-test-'));
  try {
    const demo = createDemo(root);
    const scan = scanSource(demo.sourceDir);
    assert.equal(scan.ok, true);
    assert.equal(Object.keys(scan.tasks).length, 3);
    assert.deepEqual(scan.tasks['室内 A'].types.RSRP.layers.map(l => l.key), ['F1', 'F2']);
    assert.deepEqual(scan.tasks['室内 B 缺二层'].types.RSRP.layers.map(l => l.key), ['F1']);
    assert.deepEqual(scan.tasks['室外'].types.RSRP.layers.map(l => l.key), ['ground', '10m']);
    const task = scan.tasks['室内 A'];
    const result = analyzeRaster({ demFile: path.join(task.predDir, 'RSRP_1.dem'),
      bounds: task.types.RSRP.bounds, dataType: 'RSRP', indoor: true });
    assert.deepEqual({ total: result.totalCount, valid: result.validCount, min: result.min,
      max: result.max, mean: result.mean, median: result.median, p10: result.p10, p90: result.p90 },
    demo.expected.rsrp);
    const rules = require('../../backend/src/rasterData').rasterRules;
    assert.equal(rules('DLRSSINR', false).zeroIsInvalid, true);
    assert.equal(rules('DLRSSINR', true).zeroIsInvalid, false);
    assert.equal(rules('BESTSERVER', true).categorical, true);
    assert.throws(() => createDemo(root), /已存在/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
