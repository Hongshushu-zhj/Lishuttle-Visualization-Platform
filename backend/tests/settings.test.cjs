const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fixture(t, extra = {}) {
  const { createSettingsStore } = require('../src/settingsStore');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-settings-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return { dataDir, create: options => createSettingsStore({ paths: { channel: 'dev', dataDir }, ...extra, ...options }) };
}

test('配置与偏好分别持久化，重建服务/端口改变不丢配置，返回值不泄漏内部引用', t => {
  const { dataDir, create } = fixture(t);
  const store = create();
  assert.equal(store.get().jobTimeoutMinutes, 30);
  assert.equal(store.get().outputMode, 'separate');
  store.update({ matlabExe: path.join(dataDir, 'MATLAB 中文', 'bin', 'matlab.exe'), jobTimeoutMinutes: 45 });
  store.updatePreferences({ colorRanges: { RSRP: { range: [-115, -45], enabled: true } } });
  const copy = store.getPreferences(); copy.colorRanges.RSRP.range[0] = 123;
  const restarted = create();
  assert.equal(restarted.get().jobTimeoutMinutes, 45);
  assert.equal(restarted.getPreferences().colorRanges.RSRP.range[0], -115);
  assert.ok(fs.existsSync(path.join(dataDir, 'settings.json')));
  assert.ok(fs.existsSync(path.join(dataDir, 'preferences.json')));
});

test('拒绝未知字段、非有限值、非法指标/范围/分档以及并发数修改', t => {
  const { create } = fixture(t); const store = create(); const before = store.get();
  for (const patch of [{ jobTimeoutMinutes: NaN }, { jobTimeoutMinutes: 4 }, { jobTimeoutMinutes: 241 }, { maxConcurrentJobs: 2 }, { outputMode: 'other' }, { unknown: 1 }]) {
    assert.throws(() => store.update(patch)); assert.deepEqual(store.get(), before);
  }
  for (const patch of [
    { colorRanges: { BESTSERVER: { range: [1, 2], enabled: true } } },
    { colorRanges: { RSRP: { range: [0, 0], enabled: true } } },
    { analysisConfig: { SCR: { boundaries: [2, 1], threshold: 0 } } },
    { analysisConfig: { RSRP: { boundaries: [NaN], threshold: 0 } } },
  ]) assert.throws(() => store.updatePreferences(patch));
});

test('损坏主配置从上一有效备份恢复，不静默覆盖较新的 schema', t => {
  const { dataDir, create } = fixture(t); const store = create();
  store.update({ jobTimeoutMinutes: 40 }); store.update({ jobTimeoutMinutes: 50 });
  fs.writeFileSync(path.join(dataDir, 'settings.json'), '{ broken');
  const recovered = create(); assert.equal(recovered.get().jobTimeoutMinutes, 40);
  assert.ok(recovered.warnings.some(w => /恢复/.test(w)));
  const newer = JSON.stringify({ ...recovered.get(), schemaVersion: 2, futureField: true });
  fs.writeFileSync(path.join(dataDir, 'settings.json'), newer);
  assert.throws(() => create(), /较新/);
  assert.equal(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'), newer);
});

test('导入第二份文件写入失败时恢复先前配置，旧数据源不改变', t => {
  const { create, dataDir } = fixture(t); const settingsStore = create();
  const { importLegacyDirectory } = require('../src/legacyImport');
  const old = path.join(dataDir, 'legacy'); fs.mkdirSync(path.join(old, 'backend/data'), { recursive: true });
  fs.writeFileSync(path.join(old, 'backend/config.json'), JSON.stringify({ jobTimeoutMinutes: 60 }));
  fs.writeFileSync(path.join(old, 'backend/data/sources.json'), '[]');
  settingsStore.update({ jobTimeoutMinutes: 40 });
  const sourcesStore = { list: () => [], replace() { throw Error('源清单写入失败'); } };
  assert.throws(() => importLegacyDirectory({ directory: old, settingsStore, sourcesStore }), /源清单写入失败/);
  assert.equal(settingsStore.get().jobTimeoutMinutes, 40);
  assert.equal(create().get().jobTimeoutMinutes, 40);
});

test('主文件原子替换失败时磁盘与内存仍保留旧值', t => {
  const { create, dataDir } = fixture(t); const store = create(); store.update({ jobTimeoutMinutes: 40 });
  const file = path.join(dataDir, 'settings.json'); const before = fs.readFileSync(file, 'utf8');
  const io = Object.create(fs);
  io.renameSync = (from, to) => { if (to === file) throw Object.assign(new Error('磁盘拒绝写入'), { code: 'EACCES' }); return fs.renameSync(from, to); };
  const blocked = create({ io });
  assert.throws(() => blocked.update({ jobTimeoutMinutes: 50 }), /磁盘拒绝/);
  assert.equal(blocked.get().jobTimeoutMinutes, 40);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(!fs.readdirSync(dataDir).some(name => name.endsWith('.tmp')));
});

test('主动导入旧项目只登记显式数据源，失效路径标离线，不改旧文件；无效配置不污染当前值', t => {
  const { dataDir, create } = fixture(t);
  const { createSourcesStore } = require('../src/sourcesStore');
  const { importLegacyDirectory } = require('../src/legacyImport');
  const old = path.join(dataDir, 'old'); fs.mkdirSync(path.join(old, 'backend/data'), { recursive: true });
  const cfg = path.join(old, 'backend/config.json');
  const sourceFile = path.join(old, 'backend/data/sources.json');
  fs.writeFileSync(cfg, JSON.stringify({ matlabExe: path.join(dataDir, 'matlab.exe'), port: 8000, maxConcurrentJobs: 1 }));
  fs.writeFileSync(sourceFile, JSON.stringify([{ path: path.join(dataDir, 'missing DEM'), name: '旧源' }]));
  const original = fs.readFileSync(sourceFile, 'utf8');
  const settingsStore = create(), sourcesStore = createSourcesStore(path.join(dataDir, 'sources.json'));
  const result = importLegacyDirectory({ directory: old, settingsStore, sourcesStore });
  assert.equal(result.sourceCount, 1); assert.equal(sourcesStore.list()[0].offline, true);
  assert.equal(settingsStore.get().matlabExe, path.join(dataDir, 'matlab.exe'));
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), original);
  const before = settingsStore.get();
  fs.writeFileSync(cfg, JSON.stringify({ matlabExe: 12 }));
  assert.throws(() => importLegacyDirectory({ directory: old, settingsStore, sourcesStore }));
  assert.deepEqual(settingsStore.get(), before);
  assert.equal(sourcesStore.list().length, 1);
});
