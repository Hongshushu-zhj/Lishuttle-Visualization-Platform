const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SOURCES_FILE } = require('./config');
const { scanSource } = require('./scanner');

function hashPath(p) {
  return crypto.createHash('md5').update(path.resolve(p).toLowerCase()).digest('hex').slice(0, 12);
}

// 数据源注册表,持久化到 data/sources.json。
// 记录结构:{ id, path, name, addedAt, scan: { utm, predDir, types } }
class SourcesStore {
  constructor(file = SOURCES_FILE) {
    this.file = file;
    this.sources = [];
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.sources = Array.isArray(data) ? data : [];
      for (const source of this.sources) {
        const scan = scanSource(source.path);
        if (scan.ok) source.scan = scan;
        else if (source.scan && !source.scan.tasks) {
          const name = path.basename(source.scan.predDir || '0');
          source.scan.tasks = { [name]: { ...source.scan, id: name, name } };
        }
      }
    } catch (e) {
      this.sources = [];
    }
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.sources, null, 2));
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

module.exports = new SourcesStore();
