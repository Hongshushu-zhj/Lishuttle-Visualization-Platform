const path = require('node:path');
const { utilityProcess, MessageChannelMain } = require('electron');

function startBackend({ entry, channel, paths, sessionSecret, sessionCookieName, settings, matlabPrefDir, failForTest = false }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'MATLABPATH']) delete env[key];
    if (matlabPrefDir) env.MATLAB_PREFDIR = matlabPrefDir;
    const child = utilityProcess.fork(entry, [], { cwd: path.dirname(entry), env, stdio: 'pipe', serviceName: 'AntennaDraw Backend' });
    const lifetime = new MessageChannelMain(); lifetime.port1.start();
    child.once('exit', () => lifetime.port1.close());
    let ready = false, stopped = false, stopPromise, failStopping, requestId = 0;
    const pending = new Map();
    const timer = setTimeout(() => fail(new Error('本地服务启动超时')), 30000);
    const fail = error => { clearTimeout(timer); if (!ready) { child.kill(); reject(error); } };
    child.once('spawn', () => child.postMessage({ type: 'bootstrap', channel, paths, sessionSecret, sessionCookieName, settings, failForTest }, [lifetime.port2]));
    child.on('message', message => {
      if (message.type === 'activity' && pending.has(message.requestId)) { pending.get(message.requestId)(message); pending.delete(message.requestId); return; }
      if (message.type === 'shutdown-error') { failStopping?.(new Error(message.error.message)); return; }
      if (message.type === 'fatal') fail(Object.assign(new Error(message.error.message), { code: message.error.code }));
      if (message.type !== 'ready' || ready) return;
      let url;
      try { url = new URL(message.origin); } catch { fail(new Error('服务返回了无效地址')); return; }
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/') { fail(new Error('服务返回了非本机地址')); return; }
      clearTimeout(timer); ready = true;
      resolve({ origin: url.origin, child,
        getActivity() {
          return new Promise((done, failActivity) => {
            if (stopped) return done({ active: false });
            const id = ++requestId, timeout = setTimeout(() => { pending.delete(id); failActivity(new Error('本地服务未能确认任务状态')); }, 5000);
            pending.set(id, message => { clearTimeout(timeout); done(message); }); child.postMessage({ type: 'activity', requestId: id });
          });
        },
        stop() {
          if (stopPromise) return stopPromise;
          stopPromise = new Promise((done, failStop) => {
            if (stopped) return done();
            const onExit = code => { clearTimeout(limit); code === 0 ? done() : failStop(new Error(`后端异常退出 (${code})`)); };
            const limit = setTimeout(() => { child.removeListener('exit', onExit); failStop(new Error('后端退出超时，保留应用以避免遗留进程')); }, 45000);
            failStopping = error => { clearTimeout(limit); child.removeListener('exit', onExit); failStop(error); };
            child.once('exit', onExit);
            child.postMessage({ type: 'shutdown' });
          }).catch(error => { stopPromise = undefined; throw error; });
          return stopPromise;
        },
      });
    });
    child.once('exit', code => { stopped = true; if (!ready) fail(new Error(`本地服务提前退出 (${code})`)); });
    child.on('error', fail);
    // 凭证只经 postMessage 发送，不写入输出。
    child.stdout?.resume();
    child.stderr?.on('data', chunk => process.stderr.write(chunk));
  });
}
module.exports = { startBackend };
