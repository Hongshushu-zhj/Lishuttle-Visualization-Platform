const express = require('express');
const { validateMatlabExecutable } = require('./matlabEnvironment');
function createDesktopRoutes({ settingsStore, environment }) {
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
  return router;
}
module.exports = { createDesktopRoutes };
