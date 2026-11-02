const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createConfig } = require('./config');
const { createSourcesStore } = require('./sourcesStore');
const { createCache } = require('./cache');
const { createMatlabRunner } = require('./matlabRunner');
const { createJobQueue } = require('./jobQueue');
const { createExporter } = require('./exporter');
const { createAnalysisService } = require('./analysisService');
const { createOpenResultsFolder } = require('./openResultsFolder');
const { createRoutes } = require('./routes');
const { createSettingsStore } = require('./settingsStore');
const { createDesktopRoutes } = require('./desktopRoutes');
const { createProcessSupervisor } = require('./processSupervisor');
const { createMatlabEnvironment } = require('./matlabEnvironment');

function createServer({ paths, settingsStore, sessionSecret, sessionCookieName, devOrigin, logger = () => {} } = {}) {
  if (!paths || !path.isAbsolute(paths.dataDir)) throw new Error('必须显式提供运行目录');
  if (sessionSecret && (!/^[A-Za-z0-9_]+$/.test(sessionCookieName || '') || sessionSecret.length < 32)) throw new Error('会话配置无效');
  settingsStore ||= createSettingsStore({ paths });
  const runtime = createConfig({ paths, settingsStore });
  const sourcesStore = createSourcesStore(runtime.SOURCES_FILE);
  const cache = createCache({ ...runtime, sourcesStore });
  const supervisor = createProcessSupervisor({ stateDir: path.join(paths.dataDir, 'processes'), packaged: paths.isPackaged === true });
  const recoverLeases = () => require('./outputPaths').recoverOutputLeases({ jobs: jobs.list(), dataDir: paths.dataDir, jobsDir: paths.jobsDir });
  const environment = createMatlabEnvironment({ paths, supervisor, settingsStore, onRecovered: recoverLeases });
  const runner = createMatlabRunner({ ...runtime, supervisor, cache });
  const jobs = createJobQueue({ ...runtime, ...runner, cache, supervisor });
  const analysis = createAnalysisService({ store: sourcesStore });
  const exporter = createExporter(runtime);
  const folders = createOpenResultsFolder({ sourcesStore, cache });
  const app = express(); app.disable('x-powered-by');
  let server, origin, closing, closingRequested = false;
  app.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = value => {
      if (value?.error && !value.details) value = { ...value, details: { code:value.code || (res.statusCode === 403 ? 'API_FORBIDDEN' : `HTTP_${res.statusCode}`), message:value.error, retryable:res.statusCode >= 500 } };
      return json(value);
    };
    if (req.headers.host !== (origin && new URL(origin).host)) return res.status(403).json({ error: '本机地址校验失败' });
    const requestOrigin = req.headers.origin;
    if (requestOrigin && requestOrigin !== origin && requestOrigin !== devOrigin) return res.status(403).json({ error: '来源校验失败' });
    if (devOrigin && requestOrigin === devOrigin) {
      res.setHeader('Access-Control-Allow-Origin', devOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    if (sessionSecret && req.path.startsWith('/api')) {
      const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(sessionCookieName + '='));
      const value = Buffer.from(cookie ? cookie.slice(sessionCookieName.length + 1) : '');
      const expected = Buffer.from(sessionSecret);
      if (value.length !== expected.length || !crypto.timingSafeEqual(value, expected)) return res.status(403).json({ error: '会话认证失败' });
      if (!['GET', 'HEAD'].includes(req.method) && requestOrigin !== origin) return res.status(403).json({ error: '修改请求缺少可信来源' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (closingRequested && !['GET', 'HEAD'].includes(req.method)) return res.status(503).json({ error: '应用正在退出，请等待清理完成', code: 'APP_CLOSING' });
    next();
  });
  app.use('/api/preview/save', express.json({ limit: '21mb' }));
  app.use(express.json({ limit: '2mb' }));
  const cleanup = () => jobs.hasActive() ? { removed:0, skippedActive:true } : require('./diagnostics').cleanupManaged({ paths, activeFiles:exporter.activeFiles });
  app.post('/api/maintenance/cleanup', (req,res,next) => { try { res.json(cleanup()); } catch(error) { next(error); } });
  app.use('/api', createDesktopRoutes({ settingsStore, environment, paths, sourcesStore, jobs }));
  app.use('/api', createRoutes({ ...runtime, sourcesStore, jobQueue: jobs, cache, exporter, ...analysis, ...folders }));
  app.use(express.static(paths.frontendDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: '接口不存在' });
    const index = path.join(paths.frontendDir, 'index.html');
    if (!fs.existsSync(index)) return res.status(503).send('应用资源缺失，请重新安装或构建前端。');
    res.sendFile(index);
  });
  app.use((error, req, res, next) => { logger('API_ERROR', { code:error.code || 'REQUEST_FAILED', message:error.message }); res.status(error.status || 500).json({ error:error.message, code:error.code || 'REQUEST_FAILED' }); });
  return {
    app, jobs, paths, settingsStore, sourcesStore, environment, supervisor,
    getActivity: () => ({ active: jobs.hasActive() || environment.isActive() || supervisor.isRunning(), jobs: jobs.list().filter(job => ['queued', 'running', 'cancelling'].includes(job.status)).length,
      detecting: environment.isActive(), blocked: jobs.getBlockedReason() }),
    async listen({ host = '127.0.0.1', port = 0 } = {}) {
      if (host !== '127.0.0.1') return Promise.reject(new Error('仅允许绑定本机回环地址'));
      if (server) return Promise.reject(new Error('服务已经启动'));
      await supervisor.initialize();
      try { cleanup(); } catch (error) { logger('CLEANUP_FAILED', { message:error.message }); }
      if (!supervisor.getBlockedReason()) recoverLeases();
      server = await require('./loopbackServer').listenLoopback(app, { host,port });
      origin = `http://${host}:${server.address().port}`; return { origin };
    },
    close() {
      if (closing) return closing;
      closingRequested = true;
      closing = (async () => {
        const results = await Promise.allSettled([jobs.shutdown(), environment.cancelAndWait()]);
        await supervisor.waitForIdle().catch(() => {});
        if (supervisor.getBlockedReason()) { await supervisor.recover(); recoverLeases(); }
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.reason.code === 'PROCESS_CLEANUP_UNCONFIRMED' && !supervisor.isBusy()) await jobs.shutdown();
        else if (failure) throw failure.reason;
        if (supervisor.isBusy()) throw new Error('MATLAB 所属进程退出尚未确认，请保留应用并查看日志');
        await new Promise((resolve, reject) => {
        if (!server || !server.listening) return resolve();
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
        });
      })().catch(error => { closing = undefined; closingRequested = false; throw error; });
      return closing;
    },
  };
}
module.exports = { createServer };
