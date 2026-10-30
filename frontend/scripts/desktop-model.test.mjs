import test from 'node:test';
import assert from 'node:assert/strict';
const initial = { schemaVersion: 1, matlabExe: '', outputMode: 'separate', outputRoot: 'D:\\results', jobTimeoutMinutes: 30, maxConcurrentJobs: 1 };
async function setup(overrides = {}) {
  const { createDesktopModel } = await import('../src/desktopModel.mjs');
  const api = { getSettings: async () => initial, getEnvironment: async () => ({ status: 'not_configured', executable: '' }),
    getOnboarding: async () => ({ completed: false }), patchSettings: async value => value, ...overrides };
  const model = createDesktopModel({ api }); await model.load(); return model;
}
test('空路径绝不就绪；保存失败保留草稿和原有效设置', async () => {
  const model = await setup({ patchSettings: async () => { throw new Error('磁盘不可写'); } });
  assert.equal(model.isReady(), false);
  model.setMatlabPath('D:\\MATLAB\\bin\\matlab.exe');
  await assert.rejects(model.save(), /磁盘不可写/);
  assert.equal(model.state.draft.matlabExe, 'D:\\MATLAB\\bin\\matlab.exe');
  assert.equal(model.state.settings.matlabExe, '');
  assert.equal(model.state.saving, false);
});
test('旧检测响应不覆盖新路径；取消等待服务终态后恢复可操作', async () => {
  let finish;
  const model = await setup({ startEnvironmentCheck: async () => ({ id: 'one', status: 'running', executable: 'D:\\old\\matlab.exe' }),
    getEnvironmentCheck: () => new Promise(r => { finish = r; }), cancelEnvironmentCheck: async () => ({ status: 'running' }) });
  model.setMatlabPath('D:\\old\\matlab.exe'); await model.startCheck();
  const pending = model.pollCheck(); model.setMatlabPath('D:\\new\\matlab.exe');
  finish({ id: 'one', status: 'passed', executable: 'D:\\old\\matlab.exe', matlabVersion: 'fixture' }); await pending;
  assert.equal(model.isReady(), false); assert.notEqual(model.state.environment.status, 'passed');
  model.setMatlabPath('D:\\old\\matlab.exe'); await model.startCheck(); await model.cancelCheck();
  assert.equal(model.state.checking, true);
  const cancelled = model.pollCheck(); finish({ id: 'one', status: 'cancelled', executable: 'D:\\old\\matlab.exe' }); await cancelled;
  assert.equal(model.state.checking, false); assert.equal(model.state.environment.status, 'cancelled');
});
test('只有当前已保存路径的真实 passed 状态才就绪；首次引导完成必须持久化成功', async () => {
  const executable = 'D:\\MATLAB\\bin\\matlab.exe';
  const model = await setup({ getSettings: async () => ({ ...initial, matlabExe: executable }),
    getEnvironment: async () => ({ status: 'passed', executable, matlabVersion: 'R2022a' }),
    completeOnboarding: async () => { throw new Error('保存失败'); } });
  assert.equal(model.isReady(), true);
  model.setMatlabPath('D:\\other\\matlab.exe'); assert.equal(model.isReady(), false);
  await assert.rejects(model.completeOnboarding(), /保存失败/); assert.equal(model.state.onboarding.completed, false);
});
