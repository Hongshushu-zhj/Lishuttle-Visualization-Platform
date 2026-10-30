const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJson, createJsonStore } = require('./jsonStore');
const TERMINAL_STATES = new Set(['done', 'partial', 'failed', 'cancelled', 'timed_out', 'interrupted']);
const JOB_STATES = new Set(['queued', 'running', 'cancelling', ...TERMINAL_STATES]);
const safeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
function createJobStore({ directory }) {
  const warnings = [];
  function validate(value) {
    if (Number.isInteger(value?.schemaVersion) && value.schemaVersion > 1) throw Object.assign(new Error('任务记录来自较新版本'), { code: 'NEWER_SCHEMA' });
    if (value === null) return value;
    if (!value || value.schemaVersion !== 1 || !safeId(value.id) || !JOB_STATES.has(value.status) || !Array.isArray(value.figures)) throw Object.assign(new Error('任务摘要无效'), { code: 'INVALID_CONFIG' });
    return value;
  }
  return { warnings,
    load() {
      if (!fs.existsSync(directory)) return [];
      const jobs = [];
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !safeId(entry.name)) continue;
        const file = path.join(directory, entry.name, 'status.json'); if (!fs.existsSync(file)) continue;
        const record = createJsonStore({ file, defaults: null, validate, warnings }).get();
        if (record && record.id === entry.name) jobs.push(record);
      }
      return jobs;
    },
    save(job) { validate(job); atomicWriteJson(path.join(directory, job.id, 'status.json'), job); },
  };
}
module.exports = { createJobStore, TERMINAL_STATES };
