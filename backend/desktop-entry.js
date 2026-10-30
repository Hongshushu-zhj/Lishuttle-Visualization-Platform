const { createServer } = require('./src/serverApp');
let service, bootstrapped = false;
const port = process.parentPort;
if (!port) throw new Error('桌面后端必须由 Electron utilityProcess 启动');
port.on('message', async event => {
  const message = event.data;
  try {
    if (message.type === 'bootstrap' && !bootstrapped) {
      bootstrapped = true;
      if (message.failForTest) throw new Error('测试启动失败');
      service = createServer({ paths: message.paths, sessionSecret: message.sessionSecret,
        sessionCookieName: message.sessionCookieName, settingsStore: { get: () => message.settings } });
      const { origin } = await service.listen({ host: '127.0.0.1', port: 0 });
      port.postMessage({ type: 'ready', origin });
    } else if (message.type === 'shutdown') {
      if (service) await service.close();
      port.postMessage({ type: 'stopped' });
      process.exit(0);
    }
  } catch (error) {
    port.postMessage({ type: 'fatal', error: { code: 'BACKEND_START_FAILED', message: error.message, retryable: true } });
  }
});
