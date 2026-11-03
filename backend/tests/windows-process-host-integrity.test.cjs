const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureWindowsProcessHost, buildWindowsProcessHost, verifyWindowsProcessHost } = require('../src/windowsProcessHost');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compiler = { name: 'test compiler (never executed)', powershellVersion: 'test', clrVersion: 'test' };
function pe(label = 'fixture') {
  const bytes = Buffer.alloc(256); bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.write(label, 160); return bytes;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-native-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'resources/backend/src/native'), stateDir = path.join(root, 'state');
  fs.mkdirSync(sourceDir, { recursive: true }); fs.mkdirSync(stateDir);
  const source = path.join(sourceDir, 'WindowsProcessHost.cs'); fs.writeFileSync(source, '// reviewed source fixture');
  return { root, sourceDir, stateDir, source };
}
function writeBundle(directory, sourceSha256, bytes = pe()) {
  const binary = path.join(directory, 'WindowsProcessHost.exe'); fs.writeFileSync(binary, bytes);
  const manifest = { schemaVersion: 1, sourceFile: 'WindowsProcessHost.cs', sourceSha256, binaryFile: 'WindowsProcessHost.exe', binarySha256: sha(bytes), compiler, outputType: 'ConsoleApplication' };
  fs.writeFileSync(path.join(directory, 'WindowsProcessHost.manifest.json'), JSON.stringify(manifest));
  return { binary, manifest };
}
test('bundled helper without integrity metadata is refused before any compilation', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.sourceDir, 'WindowsProcessHost.exe'), pe()); let compiled = false;
  await assert.rejects(ensureWindowsProcessHost(f.stateDir, { sourceDir: f.sourceDir, compile: async () => { compiled = true; } }), /完整性|manifest|元数据/i);
  assert.equal(compiled, false);
});
test('packaged helper missing or quarantined fails clearly without runtime compilation', async t => {
  const f = fixture(t); let compiled = false;
  await assert.rejects(ensureWindowsProcessHost(f.stateDir, { sourceDir: f.sourceDir, packaged: true, compile: async () => { compiled = true; } }), /修复安装.*隔离|隔离.*修复安装/);
  assert.equal(compiled, false); assert.deepEqual(fs.readdirSync(f.stateDir), []);
});
test('a packaged helper is returned only when its manifest and binary hashes match', async t => {
  const f = fixture(t); const { binary, manifest } = writeBundle(f.sourceDir, sha(fs.readFileSync(f.source)));
  fs.writeFileSync(path.join(f.root, 'resources/build-info.json'), JSON.stringify({ nativeProcessHost: manifest }));
  assert.equal(await ensureWindowsProcessHost(f.stateDir, { sourceDir: f.sourceDir, packaged: true }), binary);
  fs.appendFileSync(binary, 'corruption');
  await assert.rejects(ensureWindowsProcessHost(f.stateDir, { sourceDir: f.sourceDir, packaged: true }), /完整性|SHA-256|hash/i);
});
test('installed helper needs build-info metadata even if a new source file has been placed beside it', async t => {
  const f = fixture(t), { manifest } = writeBundle(f.sourceDir, sha(fs.readFileSync(f.source))); let compiled = false;
  const options = { sourceDir: f.sourceDir, packaged: true, compile: async () => { compiled = true; } };
  await assert.rejects(ensureWindowsProcessHost(f.stateDir, options), /build-info|构建记录/);
  fs.writeFileSync(path.join(f.root, 'resources/build-info.json'), JSON.stringify({ nativeProcessHost: { ...manifest, sourceSha256: '0'.repeat(64) } }));
  await assert.rejects(ensureWindowsProcessHost(f.stateDir, { ...options, packaged: undefined }), /build-info|构建记录/);
  assert.equal(compiled, false);
});
test('development refuses a cached helper whose bytes do not match its source-bound metadata', async t => {
  const f = fixture(t), sourceSha256 = sha(fs.readFileSync(f.source));
  const cached = path.join(f.stateDir, `AntennaProcessHost-${sourceSha256}.exe`);
  fs.writeFileSync(cached, pe()); fs.writeFileSync(cached.replace(/\.exe$/, '.manifest.json'), JSON.stringify({ schemaVersion: 1, sourceSha256, binarySha256: sha(pe('different')) }));
  let compiled = false;
  await assert.rejects(ensureWindowsProcessHost(f.stateDir, { sourceDir: f.sourceDir, compile: async () => { compiled = true; } }), /完整性|元数据|hash/i);
  assert.equal(compiled, false);
});
test('development compiles reviewed source once and verifies the cache before reuse', async t => {
  const f = fixture(t); let calls = 0;
  const compile = async ({ source, output }) => { calls++; assert.equal(source, f.source); fs.writeFileSync(output, pe()); return compiler; };
  const binary = await ensureWindowsProcessHost(f.stateDir, { sourceDir: f.sourceDir, compile });
  assert.equal(calls, 1); assert.ok(fs.existsSync(binary));
  const manifestFile = binary.replace(/\.exe$/, '.manifest.json');
  assert.equal(JSON.parse(fs.readFileSync(manifestFile)).sourceSha256, sha(fs.readFileSync(f.source)));
  assert.equal(await ensureWindowsProcessHost(f.stateDir, { sourceDir: f.sourceDir, compile }), binary); assert.equal(calls, 1);
  fs.appendFileSync(binary, 'corruption');
  await assert.rejects(ensureWindowsProcessHost(f.stateDir, { sourceDir: f.sourceDir, compile }), /完整性|SHA-256|hash/i); assert.equal(calls, 1);
});
test('release helper builds always compile the source and never reuse a bundled or output helper', async t => {
  const f = fixture(t), outputDir = path.join(f.root, 'output'); fs.mkdirSync(outputDir);
  writeBundle(f.sourceDir, sha(fs.readFileSync(f.source)), pe('untrusted bundled fixture'));
  writeBundle(outputDir, sha(fs.readFileSync(f.source)), pe('stale build fixture'));
  let calls = 0;
  const result = await buildWindowsProcessHost({ sourceDir: f.sourceDir, outputDir, compile: async ({ source, output }) => { calls++; assert.equal(source, f.source); fs.writeFileSync(output, pe('fresh compile fixture')); return compiler; } });
  assert.equal(calls, 1); assert.equal(result.binary, path.join(outputDir, 'WindowsProcessHost.exe'));
  assert.equal(result.manifest.binarySha256, sha(pe('fresh compile fixture')));
  assert.equal(result.manifest.sourceSha256, sha(fs.readFileSync(f.source)));
});
test('source modifications during compilation do not produce trusted build metadata', async t => {
  const f = fixture(t);
  await assert.rejects(buildWindowsProcessHost({ sourceDir: f.sourceDir, outputDir: path.join(f.root, 'out'), compile: async ({ output }) => { fs.writeFileSync(output, pe()); fs.appendFileSync(f.source, '// changed during compile'); return compiler; } }), /源码.*变化|source.*changed/i);
});
test('source and manifest mismatches and invalid PE are rejected', t => {
  const f = fixture(t), sourceSha256 = sha(fs.readFileSync(f.source)), { binary, manifest } = writeBundle(f.sourceDir, sourceSha256);
  const options = { binary, manifestFile: path.join(f.sourceDir, 'WindowsProcessHost.manifest.json'), sourceSha256 };
  assert.deepEqual(verifyWindowsProcessHost(options), manifest);
  assert.throws(() => verifyWindowsProcessHost({ ...options, sourceSha256: '0'.repeat(64) }), /源码|source/i);
  fs.writeFileSync(binary, 'not PE'); manifest.binarySha256 = sha('not PE'); fs.writeFileSync(options.manifestFile, JSON.stringify(manifest));
  assert.throws(() => verifyWindowsProcessHost(options), /PE/);
});
