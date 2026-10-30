const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createJsonStore } = require('./jsonStore');
const { scanSource } = require('./scanner');
const { importLegacyDirectory } = require('./legacyImport');
const { validateMatlabExecutable } = require('./matlabEnvironment');
function createDesktopRoutes({ settingsStore, environment, paths, sourcesStore }) {
  const router = express.Router();
  for (const [route, read, update] of [['settings', 'get', 'update'], ['preferences', 'getPreferences', 'updatePreferences']]) {
    if (typeof settingsStore?.[read] !== 'function' || typeof settingsStore?.[update] !== 'function') continue;
    router.get('/' + route, (req, res) => res.json(settingsStore[read]()));
    router.patch('/' + route, (req, res, next) => { try {
      if (route === 'settings' && req.body?.matlabExe) req.body.matlabExe = validateMatlabExecutable(req.body.matlabExe);
      res.json(settingsStore[update](req.body));
    } catch (error) { next(error); } });
  }
  if (environment) {
    router.get('/environment', (req, res) => res.json(environment.getState()));
    router.get('/environment/candidates', (req, res) => res.json(environment.discover()));
    router.post('/environment/check', (req, res, next) => { try { res.json(environment.startDetection({ executable: req.body?.executable || settingsStore.get().matlabExe })); } catch (error) { next(error); } });
    router.get('/environment/check/:id', (req, res, next) => { try { res.json(environment.getDetection(req.params.id)); } catch (error) { next(error); } });
    router.post('/environment/check/:id/cancel', (req, res, next) => { try { res.json(environment.cancelDetection(req.params.id)); } catch (error) { next(error); } });
  }
  if (paths && sourcesStore) {
    const onboarding = createJsonStore({ file: path.join(paths.dataDir, 'onboarding.json'), defaults: { schemaVersion: 1, completed: false }, validate(value) {
      if (!value || value.schemaVersion !== 1 || typeof value.completed !== 'boolean') throw Object.assign(new Error('引导记录无效'), { code: 'INVALID_CONFIG' }); return value;
    } });
    router.get('/onboarding', (req, res) => res.json({ ...onboarding.get(), warnings: settingsStore.warnings || [] }));
    router.post('/onboarding/complete', (req, res, next) => { try { res.json(onboarding.set({ schemaVersion: 1, completed: true })); } catch (error) { next(error); } });
    router.post('/onboarding/demo', (req, res, next) => { try {
      const destination = path.join(paths.dataDir, 'demo-v1');
      if (!fs.existsSync(destination)) {
        if (!paths.demoDir || !fs.existsSync(paths.demoDir)) throw new Error('演示资源缺失，请重新安装应用');
        fs.mkdirSync(paths.dataDir, { recursive: true });
        const temporary = path.join(paths.dataDir, 'demo-copy-' + crypto.randomUUID());
        try { fs.cpSync(paths.demoDir, temporary, { recursive: true, force: false, errorOnExist: true }); fs.renameSync(temporary, destination); }
        finally { fs.rmSync(temporary, { recursive: true, force: true }); }
      }
      const scan = scanSource(destination); if (!scan.ok) throw new Error(scan.error);
      const source = sourcesStore.add(destination, scan); res.json({ ok: true, sourceId: source.id });
    } catch (error) { next(error); } });
    router.post('/settings/import', (req, res, next) => { try {
      res.json(importLegacyDirectory({ directory: req.body?.directory, preferencesFile: req.body?.preferencesFile, settingsStore, sourcesStore }));
    } catch (error) { error.status ||= 400; next(error); } });
  }
  return router;
}
module.exports = { createDesktopRoutes };
