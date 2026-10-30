const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fake = path.join(__dirname, 'fixtures/fake-matlab.cjs');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function until(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < end, '等待进程条件超时'); await new Promise(r => setTimeout(r, 50)); }
}
function fixture(t) {
  const { createProcessSupervisor } = require('../src/processSupervisor');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antenna host 中文 ' "));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const supervisor = createProcessSupervisor({ stateDir: dir });
  const run = options => supervisor.run({ executable: process.execPath, args: [fake], cwd: dir, timeoutMs: 20000, ...options });
  return { dir, run, supervisor };
}

test('受监管进程以独立参数启动，空格/中文/引号/反斜杠不被当作命令', { timeout: 45000 }, async t => {
  const { run } = fixture(t); const args = ['中文 空格', "a'b", 'a"b', 'ends\\', '& echo not-a-command'];
  const result = await run({ args: [fake, ...args] });
  assert.equal(result.status, 'done', JSON.stringify(result)); assert.equal(result.cleanupConfirmed, true);
  assert.deepEqual(JSON.parse(result.stdout.trim()), args);
});

test('无法确认上次进程已退出时拒绝新任务，不依据旧 PID 清理或放行', async t => {
  const { dir, run, supervisor } = fixture(t);
  const resultFile = path.join(dir, 'unknown-result.json');
  fs.writeFileSync(resultFile, JSON.stringify({ cleanupConfirmed: false }));
  fs.writeFileSync(path.join(dir, 'active.json'), JSON.stringify({ resultFile, systemUptime: os.uptime(), pid: process.pid }));
  await assert.rejects(run({}), /退出尚未确认/);
  assert.ok(supervisor.isBusy());
  await assert.rejects(run({}), /退出尚未确认/);
});

test('取消只终止本次 Job 的父子进程，外部独立进程不受影响', { timeout: 45000 }, async t => {
  const { run, dir } = fixture(t); const file = path.join(dir, 'pids.json');
  const unrelated = spawn(process.execPath, [fake, 'child'], { stdio: 'ignore', windowsHide: true });
  t.after(() => { if (alive(unrelated.pid)) unrelated.kill(); });
  const abort = new AbortController(); const pending = run({ args: [fake, 'tree', file], signal: abort.signal });
  await until(() => fs.existsSync(file)); const pids = JSON.parse(fs.readFileSync(file));
  assert.ok(alive(pids.child)); abort.abort(); const result = await pending;
  assert.equal(result.status, 'cancelled', JSON.stringify(result)); assert.equal(result.cleanupConfirmed, true);
  await until(() => !alive(pids.parent) && !alive(pids.child)); assert.ok(alive(unrelated.pid));
});

test('超时等待所属进程树结束；单槽位拒绝并发；预先取消不启动进程', { timeout: 45000 }, async t => {
  const { run, dir } = fixture(t); const file = path.join(dir, 'pids.json');
  const abort = new AbortController(); abort.abort();
  assert.equal((await run({ signal: abort.signal })).status, 'cancelled');
  const pending = run({ args: [fake, 'tree', file], timeoutMs: 4000 });
  await until(() => fs.existsSync(file));
  await assert.rejects(run({}), /占用|运行/);
  const pids = JSON.parse(fs.readFileSync(file)); const result = await pending;
  assert.equal(result.status, 'timed_out', JSON.stringify(result)); assert.equal(result.cleanupConfirmed, true);
  await until(() => !alive(pids.child));
});

test('启动失败和非零退出可区分，父进程提前退出时仍持有子进程监管', { timeout: 45000 }, async t => {
  const { run, dir } = fixture(t);
  const missing = await run({ executable: path.join(dir, 'missing.exe') });
  assert.equal(missing.status, 'failed'); assert.equal(missing.cleanupConfirmed, true);
  const failed = await run({ args: [fake, 'fail'] }); assert.equal(failed.exitCode, 7);
  const file = path.join(dir, 'orphan-pids.json'), controller = new AbortController();
  const pending = run({ args: [fake, 'orphan', file], signal: controller.signal });
  await until(() => fs.existsSync(file)); const pids = JSON.parse(fs.readFileSync(file));
  await until(() => !alive(pids.parent)); assert.ok(alive(pids.child));
  controller.abort(); const result = await pending;
  assert.equal(result.cleanupConfirmed, true); await until(() => !alive(pids.child));
});

test('服务进程崩溃后控制管道断开会清理子进程，新服务只依据归属结果恢复，不按旧 PID 杀进程', { timeout: 45000 }, async t => {
  const { dir } = fixture(t); const stateDir = path.join(dir, 'service-state'), file = path.join(dir, 'crash-pids.json');
  const modulePath = path.resolve(__dirname, '../src/processSupervisor');
  const code = `const fs=require('fs'); const {createProcessSupervisor}=require(process.argv[1]);
    const run=createProcessSupervisor({stateDir:process.argv[2]}).run({executable:process.execPath,args:[process.argv[3],'tree',process.argv[4]],cwd:process.argv[2],timeoutMs:20000});
    run.catch(()=>{}); const timer=setInterval(()=>{if(fs.existsSync(process.argv[4]))process.exit(0);},25);`;
  fs.mkdirSync(stateDir);
  const owner = spawn(process.execPath, ['-e', code, modulePath, stateDir, fake, file], { stdio: 'ignore', windowsHide: true });
  t.after(() => { if (alive(owner.pid)) owner.kill(); });
  await until(() => fs.existsSync(file)); const pids = JSON.parse(fs.readFileSync(file));
  await until(() => !alive(owner.pid) && !alive(pids.parent) && !alive(pids.child));
  const { createProcessSupervisor } = require('../src/processSupervisor');
  const restarted = createProcessSupervisor({ stateDir }); await restarted.recover();
  const result = await restarted.run({ executable: process.execPath, args: [fake, 'after-crash'], cwd: dir, timeoutMs: 10000 });
  assert.equal(result.status, 'done', JSON.stringify(result)); assert.equal(result.cleanupConfirmed, true);
});
