const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJson, createJsonStore } = require('./jsonStore');
const TERMINAL_STATES = new Set(['done', 'partial', 'failed', 'cancelled', 'timed_out', 'interrupted']);
const JOB_STATES = new Set(['queued', 'running', 'cancelling', ...TERMINAL_STATES]);
const FIGURE_STATES = new Set(['pending', 'running', 'cached', 'done', 'failed', 'cancelled', 'timed_out', 'interrupted']);
const safeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
const invalid = () => Object.assign(new Error('任务摘要或图片记录无效'), { code: 'INVALID_CONFIG' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && !value.includes('\0');
const absolute = value => text(value) && path.isAbsolute(value);
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
function validateFigure(figure) {
  if (!object(figure) || !['key', 'sourceId', 'dataType', 'layer', 'url'].every(key => text(figure[key])) || !absolute(figure.pngFile) || !FIGURE_STATES.has(figure.status)) throw invalid();
  if (!figure.url.startsWith('/api/images/') || figure.url.includes('\\') || !new URL(figure.url, 'http://local.invalid').pathname.startsWith('/api/images/')) throw invalid();
  for (const key of ['sourceName', 'taskName', 'taskId', 'layerLabel', 'variant', 'error']) if (figure[key] !== undefined && figure[key] !== null && typeof figure[key] !== 'string') throw invalid();
  for (const key of ['xlim', 'ylim']) if (figure[key] !== undefined && figure[key] !== null && (!Array.isArray(figure[key]) || figure[key].length !== 2 || !figure[key].every(Number.isFinite))) throw invalid();
  if (figure.output !== undefined) {
    const output = figure.output;
    if (!object(output) || !['root', 'canonicalRoot', 'directory', 'sourcePath', 'file'].every(key => absolute(output[key])) || !['source', 'separate'].includes(output.outputMode) || output.file !== figure.pngFile || path.dirname(output.file) !== output.directory) throw invalid();
  }
  if (figure.outputLease !== undefined && (!object(figure.outputLease) || !absolute(figure.outputLease.completionFile) || (figure.outputLease.nativeResultFile !== undefined && !absolute(figure.outputLease.nativeResultFile)))) throw invalid();
}
function createJobStore({ directory }) {
  const warnings = [];
  function validate(value, expectedId) {
    if (Number.isInteger(value?.schemaVersion) && value.schemaVersion > 1) throw Object.assign(new Error('任务记录来自较新版本'), { code: 'NEWER_SCHEMA' });
    if (value === null) return value;
    if (!object(value) || value.schemaVersion !== 1 || !safeId(value.id) || (expectedId && value.id !== expectedId) || !JOB_STATES.has(value.status) || !date(value.createdAt) || !Array.isArray(value.figures)) throw invalid();
    for (const key of ['startedAt', 'finishedAt']) if (value[key] !== undefined && value[key] !== null && !date(value[key])) throw invalid();
    for (const key of ['total', 'done', 'failed', 'cancelled']) if (value[key] !== undefined && (!Number.isInteger(value[key]) || value[key] < 0)) throw invalid();
    for (const figure of value.figures) validateFigure(figure);
    if (value.errorDetails !== undefined && value.errorDetails !== null && !object(value.errorDetails)) throw invalid();
    return value;
  }
  return { warnings,
    load() {
      if (!fs.existsSync(directory)) return [];
      const jobs = [];
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !safeId(entry.name)) continue;
        const file = path.join(directory, entry.name, 'status.json'); if (!fs.existsSync(file)) continue;
        const recordWarnings = [];
        const record = createJsonStore({ file, defaults: null, validate: value => validate(value, entry.name), warnings: recordWarnings }).get();
        warnings.push(...recordWarnings.map(warning => `任务 ${entry.name}: ${warning}`));
        if (record && record.id === entry.name) jobs.push(record);
      }
      return jobs;
    },
    save(job) { validate(job); atomicWriteJson(path.join(directory, job.id, 'status.json'), job); },
  };
}
module.exports = { createJobStore, TERMINAL_STATES };
