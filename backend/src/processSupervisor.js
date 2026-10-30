const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { atomicWriteJson } = require('./jsonStore');
const { ensureWindowsProcessHost } = require('./windowsProcessHost');

function createProcessSupervisor({ stateDir }) {
  const markerFile = path.join(stateDir, 'active.json');
  let active = null, blocked = null, lastRun = Promise.resolve();
  async function recover() {
    if (!fs.existsSync(markerFile)) return;
    const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    const relative = path.relative(stateDir, marker.resultFile || '');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('进程归属记录无效，已阻止新任务');
    // Uptime decreasing proves a reboot; wall-clock adjustments must never release ownership.
    if (Number.isFinite(marker.systemUptime) && os.uptime() + 10 < marker.systemUptime) { fs.unlinkSync(markerFile); return; }
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(marker.resultFile) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    if (fs.existsSync(marker.resultFile) && JSON.parse(fs.readFileSync(marker.resultFile, 'utf8')).cleanupConfirmed === true) fs.unlinkSync(markerFile);
    else throw new Error('上次所属进程是否退出尚未确认，已阻止新绘图；请保留日志并检查恢复状态');
  }
  const isBusy = () => !!active || !!blocked;
  function run({ executable, args = [], cwd, signal, timeoutMs = 180000, env: additions = {}, onStdout = () => {}, onStderr = () => {} }) {
    if (isBusy()) return Promise.reject(new Error(blocked || 'MATLAB 槽位正在运行或被占用'));
    if (signal?.aborted) return Promise.resolve({ status: 'cancelled', cleanupConfirmed: true, stdout: '', stderr: '', exitCode: null });
    active = {};
    lastRun = (async () => {
      await recover();
      if (process.platform !== 'win32') throw new Error('当前进程监管仅支持 Windows');
      if (!path.isAbsolute(executable) || !path.isAbsolute(cwd) || !Array.isArray(args) || args.some(v => typeof v !== 'string' || v.includes('\0')) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('受监管进程参数无效');
      if (!fs.existsSync(executable)) return { status: 'failed', cleanupConfirmed: true, stdout: '', stderr: '', exitCode: null, error: '可执行文件不存在' };
      fs.mkdirSync(stateDir, { recursive: true });
      const hostExecutable = await ensureWindowsProcessHost(stateDir);
      if (signal?.aborted) return { status: 'cancelled', cleanupConfirmed: true, stdout: '', stderr: '', exitCode: null };
      const runDir = fs.mkdtempSync(path.join(stateDir, 'run-'));
      const resultFile = path.join(runDir, 'result.json'), requestFile = path.join(runDir, 'request.json');
      const pipeName = 'antenna-' + crypto.randomUUID();
      const env = { ...process.env, ...additions };
      for (const key of Object.keys(env)) if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'MATLABPATH'].includes(key.toUpperCase())) delete env[key];
      const prefs = additions.MATLAB_PREFDIR || path.join(stateDir, 'matlab-prefs'); fs.mkdirSync(prefs, { recursive: true }); env.MATLAB_PREFDIR = prefs;
      fs.writeFileSync(requestFile, JSON.stringify({ executable, args, cwd, pipeName, resultFile }));
      atomicWriteJson(markerFile, { resultFile, systemUptime: os.uptime(), startedAt: new Date().toISOString() }, { backup: false });
      const server = net.createServer(); let socket, reason, timer, grace, host, stdout = '', stderr = '';
      const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
      const stop = value => { if (reason) return; reason = value; socket?.write(reason + '\n'); grace = setTimeout(() => host?.kill(), 15000); };
      active.stop = stop;
      server.on('connection', connection => {
        if (socket) { connection.destroy(); return; } socket = connection; let frames = '';
        connection.on('error', () => {});
        connection.on('data', bytes => {
          frames += bytes.toString('ascii'); const lines = frames.split('\n'); frames = lines.pop();
          if (frames.length > 65536) { stop('cancelled'); frames = ''; }
          for (const line of lines) {
            const channel = line[0], bytes = Buffer.from(line.slice(2).trim(), 'base64');
            if (channel === 'O') { const text = outDecoder.write(bytes); stdout = (stdout + text).slice(-65536); onStdout(text); }
            if (channel === 'E') { const text = errDecoder.write(bytes); stderr = (stderr + text).slice(-65536); onStderr(text); }
          }
        });
        if (reason) connection.write(reason + '\n');
      });
      const abort = () => stop('cancelled'); signal?.addEventListener('abort', abort, { once: true });
      try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen('\\\\.\\pipe\\' + pipeName, resolve); });
        return await new Promise(resolve => {
          host = spawn(hostExecutable, [executable, cwd, pipeName, resultFile, ...args], { cwd, env, windowsHide: true, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
          let launchError;
          timer = setTimeout(() => stop('timed_out'), timeoutMs);
          if (signal?.aborted) abort();
          host.stdout.on('data', bytes => { const text = outDecoder.write(bytes); stdout = (stdout + text).slice(-65536); onStdout(text); });
          host.stderr.on('data', bytes => { const text = errDecoder.write(bytes); stderr = (stderr + text).slice(-65536); onStderr(text); });
          host.on('error', error => { launchError = error; });
          host.on('close', hostExitCode => {
            stdout = (stdout + outDecoder.end()).slice(-65536); stderr = (stderr + errDecoder.end()).slice(-65536);
            let result;
            try { result = JSON.parse(fs.readFileSync(resultFile, 'utf8')); }
            catch { result = { status: 'failed', cleanupConfirmed: !host.pid, error: launchError?.message || `进程监管未返回可确认的退出记录（守护进程退出码 ${hostExitCode}）` }; }
            if (result.cleanupConfirmed) { try { fs.unlinkSync(markerFile); } catch (error) { if (error.code !== 'ENOENT') result.warning = '已退出，但归属记录未能清理'; } }
            else blocked = '所属进程退出尚未确认，已阻止新的 MATLAB 任务';
            resolve({ ...result, stdout, stderr, runDir });
          });
        });
      } finally { clearTimeout(timer); clearTimeout(grace); signal?.removeEventListener('abort', abort); socket?.destroy(); server.close(); }
    })().catch(error => { if (fs.existsSync(markerFile)) blocked = error.message; throw error; }).finally(() => { active = null; });
    return lastRun;
  }
  return { run, isBusy, recover, waitForIdle: () => lastRun, cancelAll: () => active?.stop?.('cancelled'), getBlockedReason: () => blocked };
}
module.exports = { createProcessSupervisor };
