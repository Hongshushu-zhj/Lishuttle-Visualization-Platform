const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { atomicWriteJson } = require('./jsonStore');
const { ensureWindowsProcessHost } = require('./windowsProcessHost');
const { inspectOwnedProcesses } = require('./windowsJobRecovery');

function readRecord(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('进程归属记录无效');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createProcessSupervisor({ stateDir, packaged = false }) {
  const markerFile = path.join(stateDir, 'active.json');
  let active = null, blocked = null, lastRun = Promise.resolve(), recovering;
  function validateMarker(marker) {
    const relative = path.relative(stateDir, marker.resultFile || '');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('进程归属记录无效，已阻止新任务');
    const canonical = path.relative(fs.realpathSync(stateDir), fs.realpathSync(path.dirname(marker.resultFile)));
    if (canonical.startsWith('..') || path.isAbsolute(canonical)) throw new Error('进程归属记录指向外部目录');
    if (marker.schemaVersion === 2 && !/^Local\\AntennaDraw-[0-9a-f-]{36}$/i.test(marker.jobName || '')) throw new Error('进程 Job 归属标识无效');
  }
  function completedResult(marker) {
    if (!fs.existsSync(marker.resultFile)) return null;
    const result = readRecord(marker.resultFile);
    if (marker.schemaVersion === 2 && (result.schemaVersion !== 2 || result.jobName !== marker.jobName)) return null;
    return result.cleanupConfirmed === true ? result : null;
  }
  async function reconcile(marker, { hostExited = false } = {}) {
    validateMarker(marker);
    const completed = completedResult(marker);
    if (completed) return completed;
    // Uptime decreasing proves a reboot; wall-clock adjustments must never release ownership.
    let proof;
    if (Number.isFinite(marker.systemUptime) && os.uptime() + 10 < marker.systemUptime) proof = { cleanupConfirmed: true, reason: 'system_rebooted' };
    else {
      let executable;
      if (marker.schemaVersion !== 2) {
        let request;
        try { request = readRecord(path.join(path.dirname(marker.resultFile), 'request.json')); }
        catch { throw Object.assign(new Error('上次所属进程退出尚未确认，启动请求缺失或损坏；可退出应用并保留恢复记录。'), { code: 'PROCESS_CLEANUP_UNCONFIRMED' }); }
        if (request.resultFile !== marker.resultFile || !/^antenna-[0-9a-f-]{36}$/i.test(request.pipeName || '')) throw new Error('旧进程归属记录缺少可核验的启动请求');
        executable = request.executable;
      }
      proof = await inspectOwnedProcesses({ jobName: marker.schemaVersion === 2 ? marker.jobName : undefined, executable, hostPid: marker.hostPid, hostExited });
    }
    if (!proof.cleanupConfirmed) throw Object.assign(new Error('上次所属进程退出尚未确认；请取消或关闭本次 MATLAB 后重试检测。仍可退出应用并保留恢复记录。'), { code: 'PROCESS_CLEANUP_UNCONFIRMED' });
    const result = { schemaVersion: marker.schemaVersion || 1, ...(marker.jobName ? { jobName: marker.jobName } : {}), status: 'interrupted', exitCode: null,
      cleanupConfirmed: true, recovered: true, recovery: proof, recoveredAt: new Date().toISOString() };
    atomicWriteJson(marker.resultFile, result, { backup: false });
    return result;
  }
  function recover() {
    if (active?.stop) return Promise.reject(new Error('MATLAB 所属任务仍在运行，请先取消检测或绘图'));
    if (recovering) return recovering;
    recovering = (async () => {
      if (fs.existsSync(markerFile)) {
        const marker = readRecord(markerFile);
        await reconcile(marker);
        fs.unlinkSync(markerFile);
      }
      blocked = null;
    })().catch(error => { blocked = error.message; error.code = 'PROCESS_CLEANUP_UNCONFIRMED'; throw error; }).finally(() => { recovering = null; });
    return recovering;
  }
  const isBusy = () => !!active || !!blocked;
  function run({ executable, args = [], cwd, signal, timeoutMs = 180000, env: additions = {}, onStdout = () => {}, onStderr = () => {}, onStarted = () => {} }) {
    if (active) return Promise.reject(new Error('MATLAB 槽位正在运行或被占用'));
    if (signal?.aborted) return Promise.resolve({ status: 'cancelled', cleanupConfirmed: true, stdout: '', stderr: '', exitCode: null });
    active = {};
    lastRun = (async () => {
      await recover();
      if (process.platform !== 'win32') throw new Error('当前进程监管仅支持 Windows');
      if (!path.isAbsolute(executable) || !path.isAbsolute(cwd) || !Array.isArray(args) || args.some(v => typeof v !== 'string' || v.includes('\0')) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('受监管进程参数无效');
      if (!fs.existsSync(executable)) return { status: 'failed', cleanupConfirmed: true, stdout: '', stderr: '', exitCode: null, error: '可执行文件不存在' };
      fs.mkdirSync(stateDir, { recursive: true });
      const hostExecutable = await ensureWindowsProcessHost(stateDir, { packaged });
      if (signal?.aborted) return { status: 'cancelled', cleanupConfirmed: true, stdout: '', stderr: '', exitCode: null };
      const runDir = fs.mkdtempSync(path.join(stateDir, 'run-'));
      const resultFile = path.join(runDir, 'result.json'), requestFile = path.join(runDir, 'request.json');
      onStarted({ runDir, resultFile });
      const pipeName = 'antenna-' + crypto.randomUUID();
      const jobName = 'Local\\AntennaDraw-' + crypto.randomUUID();
      const hostToken = crypto.randomBytes(32);
      const env = { ...process.env, ...additions, ANTENNA_JOB_NAME: jobName, ANTENNA_HOST_TOKEN: hostToken.toString('base64') };
      for (const key of Object.keys(env)) if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'MATLABPATH'].includes(key.toUpperCase())) delete env[key];
      const prefs = additions.MATLAB_PREFDIR || path.join(stateDir, 'matlab-prefs'); fs.mkdirSync(prefs, { recursive: true }); env.MATLAB_PREFDIR = prefs;
      fs.writeFileSync(requestFile, JSON.stringify({ executable, args, cwd, pipeName, jobName, resultFile }));
      const marker = { schemaVersion: 2, jobName, resultFile, systemUptime: os.uptime(), startedAt: new Date().toISOString() };
      atomicWriteJson(markerFile, marker, { backup: false });
      const server = net.createServer(), connections = new Set(); let socket, reason, timer, grace, host, stdout = '', stderr = '';
      const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
      const stop = value => { if (reason) return; reason = value; socket?.write(reason + '\n'); grace = setTimeout(() => host?.kill(), 15000); };
      active.stop = stop;
      server.on('connection', connection => {
        if (socket || connections.size >= 8) { connection.destroy(); return; }
        connections.add(connection); let frames = '', authenticated = false;
        const authTimeout = setTimeout(() => { if (!authenticated) connection.destroy(); }, 5000);
        connection.once('close', () => { clearTimeout(authTimeout); connections.delete(connection); });
        connection.on('error', () => {});
        connection.on('data', bytes => {
          frames += bytes.toString('ascii'); const lines = frames.split('\n'); frames = lines.pop();
          if (frames.length > 65536) { connection.destroy(); return; }
          for (const line of lines) {
            const channel = line[0], bytes = Buffer.from(line.slice(2).trim(), 'base64');
            if (!authenticated) {
              if (channel !== 'H' || bytes.length !== hostToken.length || !crypto.timingSafeEqual(bytes, hostToken) || socket) { connection.destroy(); return; }
              authenticated = true; socket = connection; clearTimeout(authTimeout);
              if (reason) connection.write(reason + '\n');
              continue;
            }
            if (channel === 'O') { const text = outDecoder.write(bytes); stdout = (stdout + text).slice(-65536); onStdout(text); }
            if (channel === 'E') { const text = errDecoder.write(bytes); stderr = (stderr + text).slice(-65536); onStderr(text); }
          }
        });
      });
      const abort = () => stop('cancelled'); signal?.addEventListener('abort', abort, { once: true });
      try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen('\\\\.\\pipe\\' + pipeName, resolve); });
        return await new Promise(resolve => {
          host = spawn(hostExecutable, [executable, cwd, pipeName, resultFile, ...args], { cwd, env, windowsHide: true, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
          let launchError;
          host.once('spawn', () => {
            marker.hostPid = host.pid;
            try { atomicWriteJson(markerFile, marker, { backup: false }); }
            catch (error) { launchError = error; stop('cancelled'); }
          });
          timer = setTimeout(() => stop('timed_out'), timeoutMs);
          if (signal?.aborted) abort();
          host.stdout.on('data', bytes => { const text = outDecoder.write(bytes); stdout = (stdout + text).slice(-65536); onStdout(text); });
          host.stderr.on('data', bytes => { const text = errDecoder.write(bytes); stderr = (stderr + text).slice(-65536); onStderr(text); });
          host.on('error', error => { launchError = error; });
          host.on('close', async hostExitCode => {
            clearTimeout(timer); clearTimeout(grace);
            stdout = (stdout + outDecoder.end()).slice(-65536); stderr = (stderr + errDecoder.end()).slice(-65536);
            let result;
            try {
              result = readRecord(resultFile);
              if (result.schemaVersion !== 2 || result.jobName !== jobName) throw new Error('进程退出记录身份不符');
            }
            catch { result = { status: 'failed', cleanupConfirmed: !host.pid, error: launchError?.message || `进程监管未返回可确认的退出记录（守护进程退出码 ${hostExitCode}）` }; }
            if (!result.cleanupConfirmed) {
              try {
                await reconcile(marker, { hostExited: true });
                result.cleanupConfirmed = true; result.recovered = true;
              } catch (error) { result.recoveryError = error.message; }
            }
            if (result.cleanupConfirmed) { try { fs.unlinkSync(markerFile); } catch (error) { if (error.code !== 'ENOENT') result.warning = '已退出，但归属记录未能清理'; } }
            else blocked = '所属进程退出尚未确认，已阻止新的 MATLAB 任务';
            resolve({ ...result, stdout, stderr, runDir });
          });
        });
      } finally { clearTimeout(timer); clearTimeout(grace); signal?.removeEventListener('abort', abort); for (const connection of connections) connection.destroy(); server.close(); }
    })().catch(error => { const unconfirmed = fs.existsSync(markerFile); if (unconfirmed) blocked = error.message; error.runResult ||= { status: 'failed', cleanupConfirmed: !unconfirmed }; throw error; }).finally(() => { active = null; });
    return lastRun;
  }
  return { run, isBusy, isRunning: () => !!active, recover, initialize: async () => { try { await recover(); } catch (error) { blocked = error.message; } }, waitForIdle: () => lastRun, cancelAll: () => active?.stop?.('cancelled'), getBlockedReason: () => blocked };
}
module.exports = { createProcessSupervisor };
