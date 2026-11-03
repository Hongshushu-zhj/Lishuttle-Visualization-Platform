const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createJsonStore } = require('./jsonStore');
const { scanSource } = require('./scanner');
const { importLegacyDirectory } = require('./legacyImport');
const { validateMatlabExecutable } = require('./matlabEnvironment');
const { validatePreferences } = require('./settingsStore');
const { listDir, normalizeInput } = require('./fsBrowse');

function createAppRoutes({ settingsStore, environment, paths, sourcesStore, getActivity, warnings = [], getWarnings = () => [...(settingsStore.warnings || []), ...(sourcesStore.warnings || [])] }) {
  const router = express.Router();
  function importPayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('偏好导入内容必须为 JSON 对象'), { status: 400, code: 'INVALID_CONFIG' });
    return validatePreferences({ schemaVersion: 1, colorRanges: {}, analysisConfig: {}, ...value });
  }
  const sync = fn => (req, res, next) => { try { res.json(fn(req)); } catch (error) { next(error); } };
  router.get('/app-info', (req, res) => res.json({ mode: 'web', channel: 'web', version: '1.1.0-web', nodeVersion: process.versions.node }));
  for (const [route, read, update] of [['settings', 'get', 'update'], ['preferences', 'getPreferences', 'updatePreferences']]) {
    router.get('/' + route, sync(() => settingsStore[read]()));
    router.patch('/' + route, sync(req => {
      if (route === 'settings' && req.body?.matlabExe) req.body.matlabExe = validateMatlabExecutable(req.body.matlabExe);
      return settingsStore[update](req.body);
    }));
  }
  router.post('/preferences/import', sync(req => settingsStore.updatePreferences(importPayload(req.body?.preferences))));
  router.get('/environment', sync(() => environment.getState()));
  router.get('/environment/candidates', sync(() => environment.discover()));
  router.post('/environment/check', sync(req => environment.startDetection({ executable: req.body?.executable || settingsStore.get().matlabExe })));
  router.get('/environment/check/:id', sync(req => environment.getDetection(req.params.id)));
  router.post('/environment/check/:id/cancel', sync(req => environment.cancelDetection(req.params.id)));
  router.get('/runtime', sync(getActivity));
  const onboardingWarnings = warnings;
  const onboarding = createJsonStore({ file: path.join(paths.dataDir, 'onboarding.json'), warnings: onboardingWarnings, defaults: { schemaVersion: 1, completed: false }, validate(value) {
    if (Number.isInteger(value?.schemaVersion) && value.schemaVersion > 1) throw Object.assign(new Error('引导记录来自较新版本，已停止写入'), { code: 'NEWER_SCHEMA' });
    if (!value || value.schemaVersion !== 1 || typeof value.completed !== 'boolean') throw Object.assign(new Error('引导记录无效'), { code: 'INVALID_CONFIG' });
    return value;
  } });
  router.get('/onboarding', sync(() => ({ ...onboarding.get(), warnings: [...new Set([...getWarnings(), ...onboardingWarnings])] })));
  router.post('/onboarding/complete', sync(() => onboarding.set({ schemaVersion: 1, completed: true })));
  router.post('/onboarding/demo', sync(() => {
    const destination = path.join(paths.dataDir, 'demo-v1');
    if (!fs.existsSync(destination)) {
      const temporary = fs.mkdtempSync(path.join(paths.dataDir, 'demo-copy-'));
      try {
        const { sourceDir } = require('../../scripts/create-demo.cjs').createDemo(temporary);
        fs.renameSync(sourceDir, destination);
      } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    }
    const scan = scanSource(destination); if (!scan.ok) throw new Error(scan.error);
    return { ok: true, sourceId: sourcesStore.add(destination, scan).id };
  }));
  router.post('/settings/import', sync(req => {
    try { return importLegacyDirectory({ directory: req.body?.directory, preferences: req.body?.preferences === undefined ? undefined : importPayload(req.body.preferences), settingsStore, sourcesStore }); }
    catch (error) { error.status ||= 400; throw error; }
  }));
  router.get('/fs/files', sync(req => {
    if (req.query.type !== 'matlab') throw Object.assign(new Error('只支持选择 MATLAB 可执行文件'), { status: 400 });
    const directory = normalizeInput(req.query.path);
    if (!path.isAbsolute(directory)) throw Object.assign(new Error('文件浏览必须提供绝对目录'), { status: 400 });
    const result = listDir(directory);
    const files = fs.readdirSync(result.path, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.toLowerCase() === 'matlab.exe')
      .map(entry => ({ name: entry.name, path: path.join(result.path, entry.name) }));
    return { ...result, files };
  }));
  return router;
}
module.exports = { createAppRoutes };
