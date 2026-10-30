const { createServer } = require('./src/serverApp');
const { createSettingsStore } = require('./src/settingsStore');
let service, bootstrapped = false, lifetime;
const port = process.parentPort;
if (!port) throw new Error('桌面后端必须由 Electron utilityProcess 启动');
port.on('message', async event => {
  const message = event.data;
  try {
    if (message.type === 'bootstrap' && !bootstrapped) {
      bootstrapped = true;
      lifetime = event.ports[0];
      if (!lifetime) throw new Error('桌面父进程归属通道缺失');
      // Parent crash must stop this writer immediately. The native guardian owns
      // MATLAB cleanup; a fresh backend recovers persisted jobs as interrupted.
      lifetime.on('close', () => process.exit(1)); lifetime.start();
      if (message.failForTest) throw new Error('测试启动失败');
      service = createServer({ paths: message.paths, sessionSecret: message.sessionSecret,
        logger: (event, details) => port.postMessage({ type:'log', event, details }),
        sessionCookieName: message.sessionCookieName,
        settingsStore: createSettingsStore({ paths: message.paths, initialSettings: message.settings || {} }) });
      const { origin } = await service.listen({ host: '127.0.0.1', port: 0 });
      port.postMessage({ type: 'ready', origin });
    } else if (message.type === 'shutdown') {
      if (service) await service.close();
      port.postMessage({ type: 'stopped' });
      process.exit(0);
    } else if (message.type === 'activity') {
      port.postMessage({ type: 'activity', requestId: message.requestId, ...service.getActivity() });
    }
  } catch (error) {
    port.postMessage({ type: message.type === 'shutdown' ? 'shutdown-error' : 'fatal', error: { code: message.type === 'shutdown' ? 'BACKEND_SHUTDOWN_FAILED' : 'BACKEND_START_FAILED', message: error.message, retryable: true } });
  }
});
