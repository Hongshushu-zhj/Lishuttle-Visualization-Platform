const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rasterPreview } = require('../src/rasterPreview');

function preview(bounds, samples = 4, indoor = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raster-extent-'));
  try {
    const file = path.join(root, 'RSRP_1.dem'), raw = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) raw.writeInt16LE(-10000 + i * 100, i * 2);
    fs.writeFileSync(file, raw);
    return rasterPreview({ demFile: file, preddir: root, bounds, indoor, dataType: 'RSRP' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('indoor scalar coordinate follows MATLAB imagesc unit pixel spacing, not grid resolution', () => {
  assert.deepEqual(preview({ left: 0, right: 2, bottom: 0, top: 1, res: 1 }).extent,
    { left: -.5, right: 1.5, bottom: -.5, top: 1.5 });
  // MATLAB R2022a: imagesc([10 12],20,ones(2)), axis image => [9 13 19.5 21.5].
  assert.deepEqual(preview({ left: 10, right: 14, bottom: 20, top: 22, res: 2 }).extent,
    { left: 9, right: 13, bottom: 19.5, top: 21.5 });
  assert.deepEqual(preview({ left: 10, right: 12, bottom: 20, top: 21, res: 2 }, 1).extent,
    { left: 9.5, right: 10.5, bottom: 19.5, top: 20.5 });
});

test('non-scalar indoor center interpolation and outdoor extents preserve current geometry', () => {
  assert.deepEqual(preview({ left: 0, right: 2, bottom: 0, top: 2, res: 1 }, 6).extent,
    { left: -.5, right: 1.5, bottom: -.25, top: 1.25 });
  assert.deepEqual(preview({ left: 0, right: 2, bottom: 0, top: 2, res: 1 }, 4, false).extent,
    { left: -.5, right: 1.5, bottom: -.5, top: 1.5 });
});
