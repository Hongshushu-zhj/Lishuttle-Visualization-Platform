import test from 'node:test';
import assert from 'node:assert/strict';

test('桌面偏好在挂载前加载；写入失败保留旧值；并发保存排队合并不丢字段', async () => {
  const { createPreferencesClient } = await import('../src/preferencesModel.mjs');
  let stored = { schemaVersion: 1, colorRanges: {}, analysisConfig: {} }, fail = false;
  const client = createPreferencesClient({ read: async () => structuredClone(stored), write: async patch => {
    if (fail) throw Error('保存失败'); stored = { ...stored, ...structuredClone(patch) }; return structuredClone(stored);
  } });
  await client.initialize();
  await Promise.all([client.updateSection('colorRanges', 'RSRP', { range: [-100, -50], enabled: true }),
    client.updateSection('colorRanges', 'SCR', { range: [-20, 10], enabled: true })]);
  assert.deepEqual(Object.keys(stored.colorRanges).sort(), ['RSRP', 'SCR']);
  const previous = client.get(); fail = true;
  await assert.rejects(client.updateSection('colorRanges', 'RSRP', { range: [0, 1], enabled: true }), /保存失败/);
  assert.deepEqual(client.get(), previous);
  fail = false;
  await client.updateSection('analysisConfig', 'RSRP', { boundaries: [-100], threshold: -100 });
  assert.equal(client.get().analysisConfig.RSRP.threshold, -100);
});
