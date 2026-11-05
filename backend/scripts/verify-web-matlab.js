#!/usr/bin/env node
// Real MATLAB smoke, with private sources/settings/process ownership and no user data.
// node backend/scripts/verify-web-matlab.js [--matlab C:\MATLAB\R20xx\bin\matlab.exe]
// MATLAB_EXE is also accepted; otherwise the app's discovery is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('../src/serverApp');
const { resolveWebPaths } = require('../src/runtimePaths');
const { discoverMatlab, validateMatlabExecutable } = require('../src/matlabEnvironment');
const { validatePng, inside } = require('../src/outputPaths');
const { crc32 } = require('../src/crc32');
const { inspectOwnedProcesses } = require('../src/windowsJobRecovery');

// Parse and inflate actual central-directory entries; verify every byte and CRC.
function unzip(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'download must start with PK ZIP signature');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'ZIP central-directory terminator missing');
  const count = bytes.readUInt16LE(end + 10), result = [];
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const method = bytes.readUInt16LE(offset + 10), crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + length), local = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(start, start + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : assert.fail('unexpected ZIP compression');
    assert.equal(data.length, size); assert.equal(crc32(data), crc);
    result.push({ name, data }); offset += 46 + length + extra + comment;
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--matlab'), 'usage: verify-web-matlab.js [--matlab absolute-path]');
  const matlabExe = validateMatlabExecutable(args[1] || process.env.MATLAB_EXE || discoverMatlab()[0] || '');
  const sourceRoot = path.resolve(__dirname, '../..');
  const evidenceRoot = path.join(sourceRoot, '.web-test-data'); fs.mkdirSync(evidenceRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(evidenceRoot, 'real-matlab-'));
  const service = createServer({ paths: resolveWebPaths({ sourceRoot, dataDir }),
    initialSettings: { matlabExe, outputMode: 'source', jobTimeoutMinutes: 5, maxConcurrentJobs: 1 } });
  const evidence = { dataDir, matlabExe, startedAt: new Date().toISOString(), jobs: [], checks: [] };
  let failure;
  try {
    const { origin } = await service.listen({ port: 0 });
    async function call(route, method = 'GET', body) {
      const response = await fetch(origin + (route.startsWith('/api/') ? route : '/api' + route), {
        method, headers: { 'Content-Type': 'application/json', ...(method === 'GET' ? {} : { Origin: origin }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      assert.equal(response.status, 200, `${method} ${route}: ${JSON.stringify(data)}`); return data;
    }
    async function poll(route, timeoutMs = 180000) {
      const started = Date.now(); let value;
      do {
        value = await call(route);
        if (!['running', 'queued', 'cancelling'].includes(value.status)) return { ...value, elapsedMs: Date.now() - started };
        await delay(500);
      } while (Date.now() - started < timeoutMs);
      assert.fail(`deadline exceeded for ${route}: ${JSON.stringify(value)}`);
    }
    async function download(url) {
      const response = await fetch(origin + url, { signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, url); return Buffer.from(await response.arrayBuffer());
    }
    const demo = await call('/onboarding/demo', 'POST', {});
    const [source] = await call('/sources'); assert.equal(source.id, demo.sourceId);
    assert.ok(inside(dataDir, source.path), 'demo must stay private');
    const indoor = source.tasks.find(task => task.indoor && task.types.RSRP.layers.length === 2);
    const outdoor = source.tasks.find(task => !task.indoor);
    assert.ok(indoor && outdoor);
    const detection = await call('/environment/check', 'POST', {});
    const checked = await poll('/environment/check/' + detection.id);
    evidence.checks.push(checked); assert.equal(checked.status, 'passed', JSON.stringify(checked));
    assert.deepEqual(checked.checks, { indoor: true, outdoor: true, png: true });
    evidence.matlabVersion = checked.matlabVersion;
    console.log(`MATLAB environment passed: ${checked.matlabVersion} (${checked.elapsedMs} ms)`);
    const requests = [
      { sourceId: source.id, taskId: indoor.id, dataType: 'RSRP', layers: ['F1'] },
      { sourceId: source.id, taskId: outdoor.id, dataType: 'SCR', layers: ['all'] },
      { sourceId: source.id, taskId: outdoor.id, dataType: 'BESTSERVER', layers: ['all'] },
    ];
    const samples = new Map();
    // Each mode runs its complete batch in one MATLAB process.
    for (const coordMode of ['abs', 'rel-ll', 'rel-center']) {
      const created = await call('/plot', 'POST', { requests, options: { coordMode } }); assert.ok(created.jobId);
      const job = await poll('/jobs/' + created.jobId);
      assert.equal(job.status, 'done', JSON.stringify(job)); assert.equal(job.failed, 0);
      assert.equal(job.total, 5); assert.equal(job.done, 5); assert.equal(job.matlabVersion, checked.matlabVersion);
      for (const figure of job.figures) {
        assert.equal(figure.coordMode, coordMode); assert.equal(figure.status, 'done');
        assert.ok(Array.isArray(figure.axes) && figure.axes.length === 4, 'actual MATLAB axes metadata required');
        const bytes = await download(figure.url); const dimensions = validatePng(bytes);
        assert.ok(dimensions.width > 100 && dimensions.height > 100);
        samples.set(figure.url, bytes);
        figure.dimensions = dimensions;
      }
      const internal = service.jobs.get(job.id);
      assert.equal(internal.settingsSnapshot.outputMode, 'source');
      assert.ok(internal.outputSnapshot.every(item => inside(source.path, item.pngFile)));
      evidence.jobs.push(job);
      console.log(`${coordMode}: ${job.done}/${job.total} real PNGs; ${job.elapsedMs} ms`);
    }
    const first = evidence.jobs[0];
    const originalSnapshot = service.jobs.get(first.id).outputSnapshot;
    await call('/settings', 'PATCH', { outputMode: 'separate', outputRoot: path.join(dataDir, 'changed-output') });
    assert.deepEqual(service.jobs.get(first.id).outputSnapshot, originalSnapshot);
    for (const [url, bytes] of samples) assert.deepEqual(await download(url), bytes, 'history changed after output-root switch');
    const exported = await call('/jobs/' + first.id + '/export', 'POST', {});
    assert.equal(exported.count, 5);
    const zip = await download(exported.url), entries = unzip(zip);
    assert.equal(entries.length, exported.count);
    for (const entry of entries) {
      assert.ok(entry.name.endsWith('.png')); validatePng(entry.data);
      assert.ok(first.figures.some(figure => samples.get(figure.url).equals(entry.data)), entry.name);
    }
    fs.writeFileSync(path.join(dataDir, 'verified-history.zip'), zip);
    evidence.zip = { bytes: zip.length, entries: entries.map(entry => entry.name), crcVerified: true };
    evidence.historyAfterSettingsChange = true;
    const sample = first.figures.find(figure => figure.dataType === 'RSRP');
    evidence.samplePng = path.join(dataDir, 'sample-indoor-RSRP.png');
    fs.writeFileSync(evidence.samplePng, samples.get(sample.url));
    // Start a fresh real check, cancel while the owned process is starting, then retry.
    const cancelled = await call('/environment/check', 'POST', {});
    await delay(1200); await call('/environment/check/' + cancelled.id + '/cancel', 'POST', {});
    const cancelledResult = await poll('/environment/check/' + cancelled.id, 45000);
    assert.equal(cancelledResult.status, 'cancelled', JSON.stringify(cancelledResult)); evidence.checks.push(cancelledResult);
    const retried = await call('/environment/check', 'POST', {});
    const retryResult = await poll('/environment/check/' + retried.id);
    assert.equal(retryResult.status, 'passed', JSON.stringify(retryResult)); evidence.checks.push(retryResult);
    console.log('History PNG/ZIP survived output-root change; detection cancel/retry passed.');
  } catch (error) { failure = error; evidence.failure = { message: error.message, stack: error.stack }; }
  finally {
    try {
      await service.close();
      assert.equal(service.supervisor.isBusy(), false); assert.equal(service.supervisor.isRunning(), false);
      assert.equal(fs.existsSync(path.join(dataDir, 'processes/active.json')), false);
      const processDir = path.join(dataDir, 'processes'); evidence.ownedProcesses = [];
      for (const directory of fs.existsSync(processDir) ? fs.readdirSync(processDir).filter(name => name.startsWith('run-')) : []) {
        const request = JSON.parse(fs.readFileSync(path.join(processDir, directory, 'request.json'), 'utf8'));
        const result = JSON.parse(fs.readFileSync(path.join(processDir, directory, 'result.json'), 'utf8'));
        assert.equal(result.cleanupConfirmed, true);
        const proof = await inspectOwnedProcesses({ jobName: request.jobName }); assert.equal(proof.cleanupConfirmed, true);
        evidence.ownedProcesses.push({ directory, status: result.status, proof });
      }
      evidence.closedCleanly = true;
    } catch (cleanupError) {
      evidence.cleanupFailure = cleanupError.stack;
      failure = failure ? new AggregateError([failure, cleanupError], 'verification and cleanup both failed') : cleanupError;
    }
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(dataDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${path.join(dataDir, 'evidence.json')}`);
  }
  if (failure) throw failure;
  console.log('PASS: 15 PNGs, actual ZIP contents/CRCs, historical output snapshots, environment cancel/retry, zero owned processes.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
