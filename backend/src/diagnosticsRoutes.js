const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function openDirectory(directory) {
  if (process.platform !== 'win32') return Promise.reject(new Error('打开本机目录仅支持 Windows'));
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [directory], { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve({ ok: true, path: directory }); });
  });
}
function createDiagnosticsRoutes({ paths, diagnostics, cleanup, getActivity }) {
  const router = express.Router();
  const preview = () => diagnostics.preview({ app: 'antenna-draw-web', version: '1.1.0-web', nodeVersion: process.versions.node, runtime: getActivity() });
  router.get('/diagnostics', (req, res) => res.json(preview()));
  router.get('/diagnostics/download', (req, res) => { res.attachment('AntennaDraw-Web-diagnostics.json'); res.json(preview()); });
  router.post('/logs/open', (req, res, next) => {
    const directory = path.join(paths.dataDir, 'logs'); fs.mkdirSync(directory, { recursive: true });
    openDirectory(directory).then(value => res.json(value), next);
  });
  router.post('/maintenance/cleanup', (req, res, next) => { try { res.json(cleanup()); } catch (error) { next(error); } });
  return router;
}
module.exports = { createDiagnosticsRoutes };
