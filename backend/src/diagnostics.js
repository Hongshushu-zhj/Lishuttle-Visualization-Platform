const fs = require('node:fs');
const path = require('node:path');
const MAX_LOG_BYTES = 5 * 1024 * 1024, LOG_FILES = 5;
function createDiagnostics({ dataDir, secretValues = [], maxFileBytes = MAX_LOG_BYTES }) {
  const directory = path.join(dataDir, 'logs'), limit = Math.min(MAX_LOG_BYTES, maxFileBytes);
  if (!Number.isInteger(limit) || limit < 256) throw new Error('日志大小上限无效');
  const file = index => path.join(directory, index ? `app.log.${index}` : 'app.log');
  function redact(value) {
    let text = String(value);
    for (const secret of secretValues) if (secret) text = text.split(secret).join('[REDACTED]');
    text = text.replace(/("(?:[^"\\]|\\.)*(?:cookie|authorization|password|secret|token)(?:[^"\\]|\\.)*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[REDACTED]"');
    return text.replace(/\b(cookie|authorization|password|session[_-]?(?:secret|token)|access[_-]?token|refresh[_-]?token|shutdown[_-]?token)\s*[:=]\s*[^\r\n]+/gi, '$1: [REDACTED]');
  }
  function redactDetails(value) {
    if (Array.isArray(value)) return value.map(redactDetails);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /cookie|authorization|password|secret|token/i.test(key) ? '[REDACTED]' : redactDetails(entry)]));
    return typeof value === 'string' ? redact(value) : value;
  }
  function log(message, details) {
    try {
      if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) return;
      fs.mkdirSync(directory, { recursive: true });
      const bytes = Buffer.from(new Date().toISOString() + ' ' + redact(message + (details === undefined ? '' : ' ' + JSON.stringify(redactDetails(details)))) + '\n').subarray(0, Math.min(limit, 65536));
      for (let i = 0; i < LOG_FILES; i++) if (fs.existsSync(file(i)) && fs.lstatSync(file(i)).isSymbolicLink()) throw new Error('日志路径包含链接');
      if (fs.existsSync(file(0)) && fs.statSync(file(0)).size + bytes.length > limit) {
        fs.rmSync(file(LOG_FILES - 1), { force: true });
        for (let i = LOG_FILES - 2; i >= 0; i--) if (fs.existsSync(file(i))) fs.renameSync(file(i), file(i + 1));
      }
      fs.appendFileSync(file(0), bytes);
    } catch { /* Logging failure must never prevent process cleanup or startup error display. */ }
  }
  function preview(info = {}) {
    const logs = [];
    const linked = fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink();
    for (let i = 0; i < LOG_FILES; i++) {
      if (linked) break;
      if (!fs.existsSync(file(i)) || !fs.lstatSync(file(i)).isFile() || fs.lstatSync(file(i)).isSymbolicLink()) continue;
      const fd = fs.openSync(file(i),'r'); try {
        const size = fs.fstatSync(fd).size, bytes = Buffer.alloc(Math.min(size, 65536));
        fs.readSync(fd,bytes,0,bytes.length,Math.max(0,size-bytes.length));
        logs.push({ name:path.basename(file(i)), text:redact(bytes.toString('utf8')) });
      } finally { fs.closeSync(fd); }
    }
    return { schemaVersion:1, generatedAt:new Date().toISOString(), warning:'日志可能包含本地路径，请检查预览后再保存或分享。仅包含版本、运行状态和限量日志，不收集输入 DEM、配置文件、许可内容或凭证。', info: redactDetails(info), logs };
  }
  return { log, preview, save(file, info) { require('./jsonStore').atomicWriteJson(file, preview(info), { backup:false }); } };
}
function cleanupManaged({ paths, activeFiles = new Set(), protectedRoots = [], now = Date.now(), retentionDays = 7 }) {
  const cutoff = now - retentionDays * 86400000; let removed = 0, skipped = 0;
  const canonical = value => { try { return fs.realpathSync(value); } catch { return path.resolve(value); } };
  const inside = (root, file) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
  const protectedPaths = protectedRoots.filter(value => typeof value === 'string' && path.isAbsolute(value)).map(canonical);
  // cacheDir contains legacy formal PNGs and metadata awaiting lazy migration.
  // Only UUID ZIP files directly created by exporter in exportDir are disposable.
  const root = paths.exportDir;
  if (root && fs.existsSync(root) && !fs.lstatSync(root).isSymbolicLink()) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (!entry.isFile() || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.zip$/i.test(entry.name) ||
          protectedPaths.some(protectedRoot => inside(protectedRoot, canonical(file))) || activeFiles.has(file) || fs.statSync(file).mtimeMs >= cutoff) { skipped++; continue; }
      try { fs.unlinkSync(file); removed++; } catch { skipped++; }
    }
  }
  return { removed, skipped, retentionDays };
}
module.exports = { createDiagnostics, cleanupManaged, MAX_LOG_BYTES, LOG_FILES };
