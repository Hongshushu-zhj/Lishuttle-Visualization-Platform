const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scanSource } = require('./scanner');
const { createJsonStore } = require('./jsonStore');

function hashPath(p) {
  return crypto.createHash('md5').update(path.resolve(p).toLowerCase()).digest('hex').slice(0, 12);
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validTypes(types) {
  return object(types) && Object.values(types).every(type => object(type) && Array.isArray(type.layers) && type.layers.every(layer => object(layer) && typeof layer.key === 'string'));
}
function validScan(scan) {
  return object(scan) && (scan.predDir === undefined || typeof scan.predDir === 'string') &&
    (scan.types === undefined || validTypes(scan.types)) &&
    (scan.tasks === undefined || (object(scan.tasks) && Object.values(scan.tasks).every(task => object(task) && (task.types === undefined || validTypes(task.types)))));
}

// 数据源注册表,持久化到 data/sources.json。
// 记录结构:{ id, path, name, addedAt, scan: { utm, predDir, types } }
class SourcesStore {
  constructor(file) {
    this.file = file;
    this.warnings = [];
    this.persistence = createJsonStore({ file, defaults: [], warnings: this.warnings, validate: value => {
      if (Number.isInteger(value?.schemaVersion) && value.schemaVersion > 1) throw Object.assign(new Error('数据源清单来自较新版本，已停止写入'), { code: 'NEWER_SCHEMA' });
      if (!Array.isArray(value) || value.some(s => !object(s) || typeof s.id !== 'string' || !s.id || typeof s.path !== 'string' || !path.isAbsolute(s.path) || (s.scan !== undefined && !validScan(s.scan)))) {
        throw Object.assign(new Error('数据源清单格式无效'), { code: 'INVALID_CONFIG' });
      }
      return value;
    } });
    this.sources = [];
    this.load();
  }

  load() {
      const data = this.persistence.get();
      this.sources = Array.isArray(data) ? data : [];
      for (const source of this.sources) {
        let scan;
        try { scan = scanSource(source.path); }
        catch (error) { scan = { ok: false, error: error.message }; this.warnings.push(`数据源 ${source.id} 扫描失败，已保留登记: ${error.message}`); }
        source.offline = !scan.ok;
        if (scan.ok) source.scan = scan;
        else if (source.scan && typeof source.scan === 'object' && !Array.isArray(source.scan) && source.scan.predDir && !source.scan.tasks) {
          const name = path.basename(source.scan.predDir || '0');
          source.scan.tasks = { [name]: { ...source.scan, id: name, name } };
        }
        else if (!source.scan || typeof source.scan !== 'object' || Array.isArray(source.scan) || !source.scan.tasks) source.scan = { ...scan, tasks: {}, warnings: [] };
      }
  }

  save() {
    try { this.persistence.set(this.sources); }
    catch (error) { this.sources = this.persistence.get(); throw error; }
  }

  replace(records) {
    const saved = this.persistence.set(records);
    this.sources = saved;
    return this.list();
  }

  list() {
    return this.sources;
  }

  get(id) {
    return this.sources.find((s) => s.id === id) || null;
  }

  add(casePath, scan) {
    const id = hashPath(casePath);
    const existing = this.get(id);
    const record = {
      id,
      path: casePath,
      name: path.basename(casePath),
      addedAt: existing ? existing.addedAt : new Date().toISOString(),
      scan,
    };
    if (existing) this.sources[this.sources.indexOf(existing)] = record;
    else this.sources.push(record);
    this.save();
    return record;
  }

  updateScan(id, scan) {
    const s = this.get(id);
    if (!s) return null;
    s.scan = scan;
    this.save();
    return s;
  }

  task(id, taskId) {
    const source = this.get(id);
    if (!source) throw new Error(`数据源不存在: ${id}`);
    const tasks = source.scan.tasks || {};
    const names = Object.keys(tasks);
    const selected = taskId === undefined || taskId === '' ? (tasks['0'] ? '0' : names.length === 1 ? names[0] : '') : taskId;
    if (!Object.hasOwn(tasks, selected)) throw new Error(`请选择有效的任务: ${taskId || ''}`);
    return tasks[selected];
  }

  remove(id) {
    this.sources = this.sources.filter((s) => s.id !== id);
    this.save();
  }
}

const { lazyService } = require('./lazyService');
const createSourcesStore = file => new SourcesStore(file);
module.exports = lazyService(() => createSourcesStore(require('./config').SOURCES_FILE), { createSourcesStore });
