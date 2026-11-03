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
  const supervisor = createProcessSupervisor({ stateDir: dir });
  t.after(async () => { supervisor.cancelAll(); await supervisor.waitForIdle().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); });
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

test('迟到的退出证明可解除阻塞，不把失败永久当成运行中', async t => {
  const { dir, supervisor, run } = fixture(t);
  const resultFile = path.join(dir, 'late-result.json');
  fs.writeFileSync(resultFile, JSON.stringify({ cleanupConfirmed: false }));
  fs.writeFileSync(path.join(dir, 'active.json'), JSON.stringify({ resultFile, systemUptime: os.uptime() }));
  await supervisor.initialize(); assert.ok(supervisor.getBlockedReason());
  fs.writeFileSync(resultFile, JSON.stringify({ cleanupConfirmed: true }));
  await supervisor.recover();
  assert.equal(supervisor.getBlockedReason(), null);
  assert.equal(supervisor.isBusy(), false);
  assert.equal((await run({ args: [fake, 'retry'] })).status, 'done');
});

test('具名 Job 已消失时恢复缺失结果的记录，保留可追溯的恢复证明', { timeout: 30000 }, async t => {
  const { dir, supervisor } = fixture(t);
  const runDir = fs.mkdtempSync(path.join(dir, 'run-'));
  const resultFile = path.join(runDir, 'result.json');
  const jobName = 'Local\\AntennaDraw-' + require('node:crypto').randomUUID();
  fs.writeFileSync(path.join(dir, 'active.json'), JSON.stringify({ schemaVersion: 2, jobName, resultFile, systemUptime: os.uptime() }));
  await supervisor.initialize();
  assert.equal(supervisor.getBlockedReason(), null);
  assert.equal(supervisor.isBusy(), false);
  assert.equal(JSON.parse(fs.readFileSync(resultFile)).cleanupConfirmed, true);
  assert.equal(fs.existsSync(path.join(dir, 'active.json')), false);
});

test('1.0.0 遗留无结果记录在原监管器及可执行文件均不存活时恢复，不终止外部进程', { timeout: 30000 }, async t => {
  const { dir, supervisor } = fixture(t);
  const runDir = fs.mkdtempSync(path.join(dir, 'run-'));
  const resultFile = path.join(runDir, 'result.json');
  const executable = path.join(dir, 'never-started-' + require('node:crypto').randomUUID() + '.exe');
  fs.writeFileSync(path.join(runDir, 'request.json'), JSON.stringify({ executable, cwd: dir, pipeName: 'antenna-' + require('node:crypto').randomUUID(), resultFile, args: [] }));
  fs.writeFileSync(path.join(dir, 'active.json'), JSON.stringify({ resultFile, systemUptime: os.uptime() }));
  await supervisor.initialize();
  assert.equal(supervisor.getBlockedReason(), null);
  assert.equal(JSON.parse(fs.readFileSync(resultFile)).cleanupConfirmed, true);
});

test('监管器被外部终止后确认 Job 清空，检测仍可重试且不遗留子进程', { timeout: 45000 }, async t => {
  const { dir, supervisor, run } = fixture(t);
  t.after(async () => { supervisor.cancelAll(); await supervisor.waitForIdle().catch(() => {}); });
  const file = path.join(dir, 'killed-host-pids.json');
  const pending = run({ args: [fake, 'tree', file] });
  await until(() => fs.existsSync(file));
  const marker = JSON.parse(fs.readFileSync(path.join(dir, 'active.json')));
  const pids = JSON.parse(fs.readFileSync(file));
  assert.ok(Number.isInteger(marker.hostPid), '持久化本次监管器 PID 以核验身份，不按该 PID 终止 MATLAB');
  process.kill(marker.hostPid);
  const result = await pending;
  assert.equal(result.status, 'failed'); assert.equal(result.cleanupConfirmed, true, JSON.stringify(result));
  await until(() => !alive(pids.parent) && !alive(pids.child));
  assert.equal(supervisor.isBusy(), false);
  assert.equal((await run({ args: [fake, 'after-kill'] })).status, 'done');
});

test('未经认证的本机管道连接不能伪造输出或抢占监管器连接', { timeout: 45000 }, async t => {
  const net = require('node:net');
  const { dir, run } = fixture(t);
  let spoofed = false, socket, probe;
  t.after(() => { clearTimeout(probe); socket?.destroy(); });
  const pending = run({ args: [fake, 'authenticated'], onStarted({ runDir }) {
    const request = path.join(runDir, 'request.json');
    const attempt = () => {
      if (!fs.existsSync(request)) { probe = setTimeout(attempt, 1); return; }
      const { pipeName } = JSON.parse(fs.readFileSync(request));
      socket = net.createConnection('\\\\.\\pipe\\' + pipeName);
      socket.on('error', () => { if (!spoofed) probe = setTimeout(attempt, 1); });
      socket.on('connect', () => { spoofed = true; socket.write('H:invalid-token\nO:' + Buffer.from('FORGED OUTPUT').toString('base64') + '\n'); });
    };
    attempt();
  } });
  const result = await pending;
  assert.equal(spoofed, true);
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.equal(result.stdout.includes('FORGED OUTPUT'), false);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ['authenticated']);
});

test('持久化的具名 Job 与实际 Windows 对象一致，活跃子进程不能被核验成已退出', { timeout: 45000 }, async t => {
  const { inspectOwnedProcesses } = require('../src/windowsJobRecovery');
  const { dir, supervisor, run } = fixture(t);
  const pending = run({ args: [fake, 'tree', path.join(dir, 'active-job-pids.json')] });
  t.after(async () => { supervisor.cancelAll(); await pending; });
  await until(() => fs.existsSync(path.join(dir, 'active-job-pids.json')));
  const marker = JSON.parse(fs.readFileSync(path.join(dir, 'active.json')));
  const proof = await inspectOwnedProcesses({ jobName: marker.jobName, hostExited: true });
  assert.equal(proof.cleanupConfirmed, false, '必须按确切 Job 名查到活跃归属，不能以错误对象名的不存在作为退出证明');
  assert.ok(proof.activeProcesses >= 2);
});

test('具名 Job 碰撞时监管器拒绝接管，不终止已存在 Job 的进程', { timeout: 45000 }, async t => {
  const net = require('node:net'), crypto = require('node:crypto');
  const { dir, supervisor, run } = fixture(t);
  const pidsFile = path.join(dir, 'collision-owner-pids.json');
  const pending = run({ args: [fake, 'tree', pidsFile] });
  t.after(async () => { supervisor.cancelAll(); await pending; });
  await until(() => fs.existsSync(pidsFile));
  const marker = JSON.parse(fs.readFileSync(path.join(dir, 'active.json'))), pids = JSON.parse(fs.readFileSync(pidsFile));
  const host = fs.readdirSync(dir).find(name => /^AntennaProcessHost-.*\.exe$/.test(name));
  const pipeName = 'antenna-' + crypto.randomUUID(), resultFile = path.join(dir, 'collision-result.json');
  const server = net.createServer(connection => { connection.on('error', () => {}); connection.resume(); });
  t.after(() => server.close());
  await new Promise(resolve => server.listen('\\\\.\\pipe\\' + pipeName, resolve));
  const duplicate = spawn(path.join(dir, host), [process.execPath, dir, pipeName, resultFile, fake], {
    cwd: dir, windowsHide: true, stdio: 'ignore', env: { ...process.env, ANTENNA_JOB_NAME: marker.jobName, ANTENNA_HOST_TOKEN: crypto.randomBytes(32).toString('base64') },
  });
  await new Promise((resolve, reject) => { duplicate.on('exit', resolve); duplicate.on('error', reject); });
  const result = JSON.parse(fs.readFileSync(resultFile));
  assert.equal(result.status, 'failed'); assert.match(result.error, /already exists/);
  assert.equal(alive(pids.parent), true); assert.equal(alive(pids.child), true);
});
