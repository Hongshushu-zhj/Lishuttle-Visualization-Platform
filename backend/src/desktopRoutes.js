const express = require('express');
function createDesktopRoutes({ settingsStore }) {
  const router = express.Router();
  for (const [route, read, update] of [['settings', 'get', 'update'], ['preferences', 'getPreferences', 'updatePreferences']]) {
    if (typeof settingsStore?.[read] !== 'function' || typeof settingsStore?.[update] !== 'function') continue;
    router.get('/' + route, (req, res) => res.json(settingsStore[read]()));
    router.patch('/' + route, (req, res, next) => { try { res.json(settingsStore[update](req.body)); } catch (error) { next(error); } });
  }
  return router;
}
module.exports = { createDesktopRoutes };
