const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createConfig, loadWebConfiguration, createWebSettingsStore } = require('./config');
const { createSourcesStore } = require('./sourcesStore');
const { createCache } = require('./cache');
const { createMatlabRunner } = require('./matlabRunner');
const { createJobQueue } = require('./jobQueue');
const { createExporter } = require('./exporter');
const { createAnalysisService } = require('./analysisService');
const { createOpenResultsFolder } = require('./openResultsFolder');
const { createRoutes } = require('./routes');
const { createProcessSupervisor } = require('./processSupervisor');
const { createMatlabEnvironment } = require('./matlabEnvironment');
const { createDiagnostics, cleanupManaged } = require('./diagnostics');
const { createAppRoutes } = require('./appRoutes');
const { createDiagnosticsRoutes } = require('./diagnosticsRoutes');

function sameToken(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const received = Buffer.from(value), token = Buffer.from(expected);
  return received.length === token.length && crypto.timingSafeEqual(received, token);
}

function createServer({ paths, settingsStore, initialSettings, devOrigin, shutdownToken, onShutdown,
  supervisor: suppliedSupervisor, environment: suppliedEnvironment, analysis: suppliedAnalysis, logger } = {}) {
  if (!paths || !path.isAbsolute(paths.dataDir)) throw new Error('必须显式提供 Web 运行目录');
  const startup = loadWebConfiguration({ sourceRoot: paths.sourceRoot, dataDir: paths.dataDir });
  settingsStore ||= createWebSettingsStore({ ...startup, paths, initialSettings: initialSettings || startup.initialSettings });
  const runtime = createConfig({ ...startup, paths, settingsStore });
  const diagnostics = createDiagnostics({ dataDir: paths.dataDir, secretValues: [shutdownToken] });
  const log = (message, details) => { diagnostics.log(message, details); logger?.(message, details); };
  const sourcesStore = createSourcesStore(runtime.SOURCES_FILE);
  const cache = createCache({ ...runtime, sourcesStore });
  const supervisor = suppliedSupervisor || createProcessSupervisor({ stateDir: path.join(paths.dataDir, 'processes'), packaged: false });
  let jobs;
  const recoverLeases = () => require('./outputPaths').recoverOutputLeases({ jobs: jobs.list(), dataDir: paths.dataDir, jobsDir: paths.jobsDir });
  const environment = suppliedEnvironment || createMatlabEnvironment({ paths, supervisor, settingsStore, onRecovered: recoverLeases });
  const runner = createMatlabRunner({ ...runtime, supervisor, cache });
  jobs = createJobQueue({ ...runtime, ...runner, cache, supervisor });
  const analysis = suppliedAnalysis || createAnalysisService({ store: sourcesStore });
  const exporter = createExporter(runtime);
  const folders = createOpenResultsFolder({ sourcesStore, cache });
  const app = express(); app.disable('x-powered-by');
  let server, origin, closing, preparing, closingRequested = false;
  const devOrigins = new Set(Array.isArray(devOrigin) ? devOrigin : devOrigin ? [devOrigin] : []);
  const applicationWarnings = [];
  const getWarnings = () => [...new Set([...(settingsStore.warnings || []), ...(sourcesStore.warnings || []), ...(jobs.warnings || []), ...applicationWarnings])];
  const getActivity = () => ({ active: jobs.hasActive() || analysis.hasActive() || environment.isActive() || supervisor.isRunning(),
    jobs: jobs.list().filter(job => ['queued', 'running', 'cancelling'].includes(job.status)).length,
    analyzing: analysis.hasActive(), detecting: environment.isActive(), blocked: jobs.getBlockedReason() });
  const cleanup = () => getActivity().active || getActivity().blocked
    ? { removed: 0, skippedActive: true }
    : cleanupManaged({ paths, activeFiles: exporter.activeFiles, protectedRoots: [
      ...(settingsStore.get().outputMode === 'separate' ? [settingsStore.get().outputRoot] : []),
      ...jobs.list().filter(job => job.settingsSnapshot?.outputMode === 'separate').map(job => job.settingsSnapshot.outputRoot),
      ...jobs.list().flatMap(job => job.figures.map(figure => figure.output?.canonicalRoot).filter(Boolean)),
    ] });

  app.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = value => json(value?.error && !value.details ? { ...value, code: value.code || `HTTP_${res.statusCode}`,
      details: { code: value.code || `HTTP_${res.statusCode}`, message: value.error, retryable: res.statusCode >= 500 } } : value);
    if (!origin || req.headers.host !== new URL(origin).host) return res.status(403).json({ error: '本机地址校验失败', code: 'API_FORBIDDEN' });
    const requestOrigin = req.headers.origin;
    const trusted = requestOrigin === origin || devOrigins.has(requestOrigin);
    if (requestOrigin && !trusted) return res.status(403).json({ error: '来源校验失败', code: 'API_FORBIDDEN' });
    const tokenStop = req.path === '/api/runtime/shutdown' && sameToken(req.headers['x-antenna-shutdown-token'], shutdownToken);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !trusted && !tokenStop) return res.status(403).json({ error: '修改请求缺少可信来源', code: 'API_FORBIDDEN' });
    if (requestOrigin && devOrigins.has(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return trusted ? res.sendStatus(204) : res.sendStatus(403);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (closingRequested && !['GET', 'HEAD'].includes(req.method)) return res.status(503).json({ error: '服务正在停止，请等待任务清理完成', code: 'APP_CLOSING' });
    next();
  });
  app.use('/api/preview/save', express.json({ limit: '21mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'antenna-draw-web', sourceRoot: paths.sourceRoot, pid: process.pid,
    matlabExists: fs.existsSync(settingsStore.get().matlabExe), maxConcurrentJobs: 1 }));
  app.post('/api/runtime/shutdown', async (req, res, next) => {
    if (!sameToken(req.headers['x-antenna-shutdown-token'], shutdownToken)) return res.status(403).json({ error: '服务实例令牌不匹配', code: 'API_FORBIDDEN' });
    try {
      await prepareShutdown();
      res.json({ ok: true });
      res.once('finish', () => { Promise.resolve().then(() => onShutdown ? onShutdown() : close()).catch(error => log('SHUTDOWN_FAILED', { message: error.message })); });
    } catch (error) { error.status ||= 409; next(error); }
  });
  app.use('/api', createAppRoutes({ settingsStore, environment, paths, sourcesStore, getActivity, getWarnings, warnings: applicationWarnings }));
  app.use('/api', createDiagnosticsRoutes({ paths, diagnostics, cleanup, getActivity }));
  function ensurePlotReady() {
    const state = environment.getState();
    if (state.status !== 'passed') throw Object.assign(new Error('请先在应用设置中完成 MATLAB 检测，再开始绘图'), { status: 409, code: 'MATLAB_NOT_READY' });
  }
  app.use('/api', createRoutes({ ...runtime, sourcesStore, jobQueue: jobs, cache, exporter, ...analysis, ...folders, ensurePlotReady }));
  app.use(express.static(paths.frontendDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: '接口不存在' });
    const index = path.join(paths.frontendDir, 'index.html');
    if (!fs.existsSync(index)) return res.status(503).send('前端尚未构建，请运行 npm --prefix frontend run build。');
    res.sendFile(index);
  });
  app.use((error, req, res, next) => {
    log('API_ERROR', { code: error.code || 'REQUEST_FAILED', message: error.message });
    if (!res.headersSent) res.status(error.status || 500).json({ error: error.message, code: error.code || 'REQUEST_FAILED' });
  });

  function prepareShutdown() {
    if (preparing) return preparing;
    closingRequested = true;
    preparing = (async () => {
      const results = await Promise.allSettled([jobs.shutdown(), environment.cancelAndWait(), analysis.shutdown()]);
      await supervisor.waitForIdle().catch(() => {});
      if (supervisor.getBlockedReason()) { await supervisor.recover(); recoverLeases(); }
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.reason.code === 'PROCESS_CLEANUP_UNCONFIRMED' && !supervisor.isBusy()) await jobs.shutdown();
      else if (failure) throw failure.reason;
      if (supervisor.isBusy()) throw new Error('MATLAB 所属进程退出尚未确认，请查看日志后重试停止');
    })().catch(error => { preparing = undefined; closingRequested = false; throw error; });
    return preparing;
  }
  function close() {
    if (closing) return closing;
    closing = (async () => {
      await prepareShutdown();
      await new Promise((resolve, reject) => {
        if (!server?.listening) return resolve();
        server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
      });
      log('WEB_STOPPED');
    })().catch(error => { closing = undefined; closingRequested = false; throw error; });
    return closing;
  }
  return { app, paths, settingsStore, sourcesStore, cache, jobs, environment, supervisor, diagnostics, getActivity, getWarnings, close,
    async listen({ host = '127.0.0.1', port = 0 } = {}) {
      if (host !== '127.0.0.1') throw new Error('仅允许绑定本机回环地址');
      if (server) throw new Error('服务已经启动');
      await supervisor.initialize();
      if (!supervisor.getBlockedReason()) recoverLeases();
      try { cleanup(); } catch (error) { log('CLEANUP_FAILED', { message: error.message }); }
      server = await require('./loopbackServer').listenLoopback(app, { host, port });
      origin = `http://${host}:${server.address().port}`; log('WEB_STARTED', { origin }); return { origin };
    } };
}
module.exports = { createServer };
