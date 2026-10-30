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

function createServer({ paths, settingsStore, sessionSecret, sessionCookieName, devOrigin } = {}) {
  if (!paths || !path.isAbsolute(paths.dataDir)) throw new Error('必须显式提供运行目录');
  if (sessionSecret && (!/^[A-Za-z0-9_]+$/.test(sessionCookieName || '') || sessionSecret.length < 32)) throw new Error('会话配置无效');
  const runtime = createConfig({ paths, settingsStore });
  const sourcesStore = createSourcesStore(runtime.SOURCES_FILE);
  const cache = createCache({ ...runtime, sourcesStore });
  const runner = createMatlabRunner(runtime);
  const jobs = createJobQueue({ ...runtime, ...runner, cache });
  const analysis = createAnalysisService({ store: sourcesStore });
  const exporter = createExporter(runtime);
  const folders = createOpenResultsFolder({ sourcesStore, cache });
  const app = express(); app.disable('x-powered-by');
  let server, origin, closing;
  app.use((req, res, next) => {
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
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
    next();
  });
  app.use('/api/preview/save', express.json({ limit: '21mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createRoutes({ ...runtime, sourcesStore, jobQueue: jobs, cache, exporter, ...analysis, ...folders }));
  app.use(express.static(paths.frontendDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: '接口不存在' });
    const index = path.join(paths.frontendDir, 'index.html');
    if (!fs.existsSync(index)) return res.status(503).send('应用资源缺失，请重新安装或构建前端。');
    res.sendFile(index);
  });
  app.use((error, req, res, next) => { res.status(error.status || 500).json({ error: error.message }); });
  return {
    app, jobs, paths,
    listen({ host = '127.0.0.1', port = 0 } = {}) {
      if (host !== '127.0.0.1') return Promise.reject(new Error('仅允许绑定本机回环地址'));
      if (server) return Promise.reject(new Error('服务已经启动'));
      return new Promise((resolve, reject) => {
        server = app.listen(port, host, () => { origin = `http://${host}:${server.address().port}`; resolve({ origin }); });
        server.once('error', reject);
      });
    },
    close() {
      if (closing) return closing;
      closing = new Promise((resolve, reject) => {
        if (!server || !server.listening) return resolve();
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
module.exports = { createServer };
