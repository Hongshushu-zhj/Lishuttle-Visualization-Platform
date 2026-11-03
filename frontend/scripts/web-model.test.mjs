import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const modelUrl = new URL('../src/appModel.mjs', import.meta.url);
test('Web application model preserves edits and gates plotting on checked executable', async () => {
  assert.ok(existsSync(modelUrl), 'Web application model is available');
  const { createAppModel } = await import(modelUrl);
  const settings = { matlabExe: 'C:/MATLAB/bin/matlab.exe', outputMode: 'source' };
  const model = createAppModel({ api: {
    getSettings: async () => settings, getEnvironment: async () => ({ status: 'passed', executable: settings.matlabExe }),
    getOnboarding: async () => ({ completed: true }), patchSettings: async value => value,
  }});
  await model.load(); assert.equal(model.isReady(), true);
  model.setMatlabPath('D:/MATLAB/bin/matlab.exe'); assert.equal(model.isReady(), false);
  assert.equal(model.state.environment.status, 'not_checked');
});

test('Web preferences retry initialization and send only changed metric', async () => {
  const url = new URL('../src/preferencesModel.mjs', import.meta.url);
  assert.ok(existsSync(url), 'server preferences client is available');
  const { createPreferencesClient } = await import(url);
  let reads = 0; const writes = [];
  const saved = { colorRanges: { SCR: { range: [-3, 3], enabled: true } }, analysisConfig: {} };
  const client = createPreferencesClient({ read: async () => { if (++reads === 1) throw new Error('offline'); return saved; }, write: async patch => { writes.push(patch); return { ...saved, colorRanges: { ...saved.colorRanges, ...patch.colorRanges } }; } });
  await assert.rejects(client.initialize(), /offline/);
  await client.initialize();
  await client.updateSection('colorRanges', 'RSRP', { range: [-120, -40], enabled: true });
  assert.deepEqual(writes, [{ colorRanges: { RSRP: { range: [-120, -40], enabled: true } } }]);
  assert.deepEqual(client.get().colorRanges.SCR, saved.colorRanges.SCR);
});

test('legacy preference preview reads and validates without changing browser storage', async () => {
  const url = new URL('../src/legacyPreferences.mjs', import.meta.url);
  assert.ok(existsSync(url), 'explicit browser preference migration is available');
  const { previewLegacyPreferences } = await import(url);
  const values = { 'antenna-color-ranges-v1': JSON.stringify({ RSRP: { range: [-110, -50], enabled: true }, SCR: { range: [4, 2] } }), 'antenna-analysis-config-v1': '{bad' };
  const result = previewLegacyPreferences({ getItem: key => values[key] });
  assert.deepEqual(result.preferences.colorRanges, { RSRP: { range: [-110, -50], enabled: true } });
  assert.equal(result.count, 1); assert.ok(result.warnings.length);
  assert.equal(values['antenna-analysis-config-v1'], '{bad');
});

test('preference update failure keeps previous state and next save can succeed', async () => {
  const { createPreferencesClient } = await import('../src/preferencesModel.mjs');
  let fail = true;
  const initial = { colorRanges: {}, analysisConfig: {} };
  const client = createPreferencesClient({ read: async () => initial, write: async patch => { if (fail) throw new Error('disk full'); return { ...initial, ...patch }; } });
  await client.initialize();
  await assert.rejects(client.updateSection('colorRanges', 'SCR', { range: [-2, 2] }), /disk full/);
  assert.deepEqual(client.get(), initial);
  fail = false; await client.updateSection('colorRanges', 'SCR', { range: [-2, 2] });
  assert.deepEqual(client.get().colorRanges.SCR.range, [-2, 2]);
});

test('application ignores stale detection after executable changed and recovers from load failure', async () => {
  const { createAppModel } = await import('../src/appModel.mjs');
  let fail = true, resolvePoll;
  const settings = { matlabExe: 'C:/matlab.exe' };
  const api = { getSettings: async () => { if (fail) throw new Error('offline'); return settings; }, getEnvironment: async () => ({ status: 'not_checked' }), getOnboarding: async () => ({ completed: true }), patchSettings: async x => x,
    startEnvironmentCheck: async executable => ({ id: 'check1', executable, status: 'running' }), getEnvironmentCheck: () => new Promise(resolve => { resolvePoll = resolve; }) };
  const model = createAppModel({ api });
  await assert.rejects(model.load(), /offline/); fail = false; await model.load(); assert.equal(model.state.error, '');
  await model.startCheck(); const polling = model.pollCheck();
  model.setMatlabPath('D:/matlab.exe'); resolvePoll({ status: 'passed', executable: settings.matlabExe }); await polling;
  assert.equal(model.isReady(), false); assert.equal(model.state.environment.status, 'not_checked');
});

test('browser JSON files are parsed as objects, with invalid and oversized inputs rejected', async () => {
  const { parsePreferencesFile } = await import('../src/legacyPreferences.mjs');
  assert.deepEqual(await parsePreferencesFile({ size: 30, text: async () => '{"colorRanges":{}}' }), { colorRanges: {} });
  await assert.rejects(parsePreferencesFile({ size: 2, text: async () => '[]' }), /对象/);
  await assert.rejects(parsePreferencesFile({ size: 2, text: async () => '{bad' }), /有效的 JSON/);
  await assert.rejects(parsePreferencesFile({ size: 1024 * 1024 + 1 }), /1 MB/);
});

test('all job terminal states stop progress polling and failed/cancelled layers count', async () => {
  const { terminalJobStates, jobPercent } = await import('../src/jobModel.mjs');
  for (const status of ['done', 'partial', 'failed', 'cancelled', 'timed_out', 'interrupted']) assert.ok(terminalJobStates.has(status));
  assert.equal(jobPercent({ total: 4, done: 2, failed: 1, cancelled: 1 }), 100);
  assert.equal(jobPercent({ total: 4, done: 1 }), 25);
});

test('HTTP client serializes browser preference import and restricted MATLAB browsing', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return { ok: true, status: 200, text: async () => '{}' }; };
  try {
    const api = await import('../src/api.js');
    await api.importPreferences({ colorRanges: {} });
    await api.importLegacy('D:/旧目录', { analysisConfig: {} });
    await api.listMatlabFiles('C:/Program Files/MATLAB');
    assert.deepEqual(JSON.parse(calls[0].body), { preferences: { colorRanges: {} } });
    assert.deepEqual(JSON.parse(calls[1].body), { directory: 'D:/旧目录', preferences: { analysisConfig: {} } });
    assert.equal(calls[2].url, '/api/fs/files?path=C%3A%2FProgram%20Files%2FMATLAB&type=matlab');
  } finally { globalThis.fetch = original; }
});

test('job watcher polls serially through cancellation to terminal and releases on stop', async () => {
  const url = new URL('../src/jobWatcher.mjs', import.meta.url);
  assert.ok(existsSync(url), 'serial job polling is available');
  const { watchJob } = await import(url);
  let calls = 0, active = 0, maxActive = 0;
  const states = [];
  const watcher = watchJob({ interval: 1, read: async () => { calls++; active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setTimeout(resolve, 3)); active--; return { status: calls < 3 ? 'cancelling' : 'cancelled' }; }, update: job => states.push(job.status) });
  const final = await watcher.finished;
  assert.equal(final.status, 'cancelled'); assert.equal(maxActive, 1); assert.deepEqual(states, ['cancelling', 'cancelling', 'cancelled']);
  const stopped = watchJob({ interval: 100, read: async () => ({ status: 'running' }) });
  stopped.stop(); assert.equal(await stopped.finished, undefined);
});

test('reloading a terminal environment clears detection busy state and ignores prior in-flight poll', async () => {
  const { createAppModel } = await import('../src/appModel.mjs');
  for (const status of ['passed', 'cancelled', 'timed_out', 'failed', 'not_checked', 'not_configured']) {
    let environment = { id: 'old', status: 'running', executable: 'C:/matlab.exe' }, resolvePoll, calls = 0;
    const model = createAppModel({ api: {
      getSettings: async () => ({ matlabExe: 'C:/matlab.exe' }), getEnvironment: async () => environment,
      getOnboarding: async () => ({ completed: true }),
      getEnvironmentCheck: () => { calls++; return new Promise(resolve => { resolvePoll = resolve; }); },
    } });
    await model.load(); assert.equal(model.state.checking, true);
    const oldPoll = model.pollCheck();
    environment = { status, executable: 'C:/matlab.exe' }; await model.load();
    assert.equal(model.state.checking, false, `${status} releases the settings controls`);
    resolvePoll({ status: 'running', executable: 'C:/matlab.exe' }); await oldPoll;
    await model.pollCheck(); assert.equal(calls, 1); assert.equal(model.state.environment.status, status);
  }
});

test('reloading a running environment replaces the detection token and polls the current check', async () => {
  const { createAppModel } = await import('../src/appModel.mjs');
  let id = 'old', resolveOld; const calls = [];
  const model = createAppModel({ api: {
    getSettings: async () => ({ matlabExe: 'C:/matlab.exe' }),
    getEnvironment: async () => ({ id, status: 'running', executable: 'C:/matlab.exe' }),
    getOnboarding: async () => ({ completed: true }),
    getEnvironmentCheck: checkId => { calls.push(checkId); return checkId === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ id: checkId, status: 'passed', executable: 'C:/matlab.exe' }); },
  } });
  await model.load(); const oldPoll = model.pollCheck();
  id = 'new'; await model.load(); resolveOld({ id: 'old', status: 'failed' }); await oldPoll;
  assert.equal(model.state.environment.id, 'new'); assert.equal(model.state.checking, true);
  await model.pollCheck(); assert.deepEqual(calls, ['old', 'new']); assert.equal(model.state.checking, false); assert.equal(model.isReady(), true);
});
