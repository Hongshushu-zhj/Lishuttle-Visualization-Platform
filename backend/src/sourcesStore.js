const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SOURCES_FILE } = require('./config');

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
      scan: {
        utm: scan.utm,
        indoor: !!scan.indoor,
        wallsFile: scan.wallsFile || null,
        predDir: scan.predDir,
        types: scan.types,
      },
    };
    if (existing) this.sources[this.sources.indexOf(existing)] = record;
    else this.sources.push(record);
    this.save();
    return record;
  }

  updateScan(id, scan) {
    const s = this.get(id);
    if (!s) return null;
    s.scan = {
      utm: scan.utm,
      indoor: !!scan.indoor,
      wallsFile: scan.wallsFile || null,
      predDir: scan.predDir,
      types: scan.types,
    };
    this.save();
    return s;
  }

  remove(id) {
    this.sources = this.sources.filter((s) => s.id !== id);
    this.save();
  }
}

module.exports = new SourcesStore();
