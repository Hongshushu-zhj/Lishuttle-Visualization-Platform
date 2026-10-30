const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { atomicWriteJson } = require('./jsonStore');
const fail = (message, code = 'OUTPUT_PATH_INVALID') => Object.assign(new Error(message), { code, status: 400 });
function safeSegment(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw fail('结果路径包含无效片段');
  return value;
}
function canonical(target) {
  let ancestor = path.resolve(target), suffix = [];
  while (!fs.existsSync(ancestor)) { const parent = path.dirname(ancestor); if (parent === ancestor) throw fail('输出路径无有效根目录'); suffix.unshift(path.basename(ancestor)); ancestor = parent; }
  return path.join(fs.realpathSync(ancestor), ...suffix);
}
function inside(root, target) { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
function resolveOutput({ source, taskId, dataType, fileName, settings = { outputMode: 'source' } }) {
  if (!source || !path.isAbsolute(source.path)) throw fail('数据源路径无效');
  const sourcePath = canonical(source.path);
  let root;
  if (settings.outputMode === 'source') root = path.join(sourcePath, '路损结果图');
  else if (settings.outputMode === 'separate' && typeof settings.outputRoot === 'string' && path.isAbsolute(settings.outputRoot)) root = path.join(settings.outputRoot, safeSegment(source.id), '路损结果图');
  else throw fail('请选择有效的输出位置');
  const directory = taskId === undefined ? root : path.join(root, safeSegment(taskId), ...(dataType === undefined ? [] : [safeSegment(dataType)]));
  const resolved = canonical(directory);
  if (resolved.split(path.sep).some(segment => segment.toLowerCase() === 'pred')) throw fail('不能在 pred 输入树内写入结果');
  return { root, canonicalRoot: canonical(root), directory, file: fileName === undefined ? undefined : path.join(directory, safeSegment(fileName)), sourcePath, outputMode: settings.outputMode };
}
function prepareOutput(output) {
  if (!output || !inside(output.canonicalRoot, canonical(output.directory)) || canonical(output.root) !== output.canonicalRoot) throw fail('输出路径发生链接逃逸或越界');
  if (output.file && (path.dirname(output.file) !== output.directory || !inside(output.canonicalRoot, canonical(output.file)))) throw fail('结果文件路径发生越界');
  fs.mkdirSync(output.directory, { recursive: true });
  if (!inside(output.canonicalRoot, canonical(output.directory))) throw fail('输出目录链接发生变化');
  return output;
}
function validatePng(bytes) {
  const invalid = () => fail('PNG 数据不完整或损坏', 'PNG_INVALID');
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || bytes.length > 200 * 1024 * 1024 || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) throw invalid();
  let offset = 8, header, ended = false; const image = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset), end = offset + size + 12;
    if (end > bytes.length) throw invalid();
    const tag = bytes.toString('ascii', offset+4, offset+8), data = bytes.subarray(offset+8, end-4);
    if (zlib.crc32(bytes.subarray(offset+4,end-4)) !== bytes.readUInt32BE(end-4)) throw invalid();
    if (!header) { if (tag !== 'IHDR' || size !== 13) throw invalid(); header = data; }
    else if (tag === 'IHDR') throw invalid();
    if (tag === 'IDAT') image.push(data);
    if (tag === 'IEND') { if (size !== 0 || end !== bytes.length) throw invalid(); ended = true; break; }
    offset = end;
  }
  const width = header?.readUInt32BE(0), height = header?.readUInt32BE(4), depth = header?.[8], color = header?.[9];
  const channels = { 0:1, 2:3, 3:1, 4:2, 6:4 }[color];
  if (!ended || !image.length || !width || !height || !channels || ![1,2,4,8,16].includes(depth) || width > 65536 || height > 65536 || header[10] || header[11] || header[12]) throw invalid();
  const row = 1 + Math.ceil(width * channels * depth / 8), expected = row * height;
  if (expected > 256 * 1024 * 1024) throw invalid();
  let raw; try { raw = zlib.inflateSync(Buffer.concat(image), { maxOutputLength: expected + 1 }); } catch { throw invalid(); }
  if (raw.length !== expected) throw invalid();
  for (let offset = 0; offset < raw.length; offset += row) if (raw[offset] > 4) throw invalid();
  return { width, height };
}
function publishPng({ temporary, output, validateInputs = () => {} }) {
  prepareOutput(output);
  if (path.dirname(temporary) !== output.directory || path.extname(temporary).toLowerCase() !== '.png') throw fail('PNG 临时文件必须与结果在同一目录');
  const size = fs.statSync(temporary).size; if (size > 200 * 1024 * 1024) throw fail('PNG 文件过大', 'PNG_INVALID');
  validatePng(fs.readFileSync(temporary)); validateInputs();
  fs.renameSync(temporary, output.file);
}
function acquireOutputLock(file) {
  const lockFile = file + '.antenna-lock', token = crypto.randomUUID(); let owner = { token, systemUptime: os.uptime() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try { const fd = fs.openSync(lockFile, 'wx'); try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } break; }
    catch (error) {
      if (error.code !== 'EEXIST' || attempt) throw error;
      const reclaimFile = lockFile + '.reclaim'; let reclaim;
      try {
        try { reclaim = fs.openSync(reclaimFile, 'wx'); } catch { throw fail('输出锁正在由其他实例检查，请稍后重试', 'OUTPUT_BUSY'); }
        let previous, confirmed = false;
        try { if (fs.lstatSync(lockFile).isSymbolicLink() || fs.statSync(lockFile).size > 16384) throw new Error(); previous = JSON.parse(fs.readFileSync(lockFile,'utf8')); confirmed = Number.isFinite(previous.systemUptime) && os.uptime()+10 < previous.systemUptime; if (previous.resultFile) { const proof = JSON.parse(fs.readFileSync(previous.resultFile,'utf8')); confirmed ||= proof.cleanupConfirmed === true && proof.outputCleanupConfirmed === true; } } catch { /* no proof means occupied */ }
        if (!confirmed) throw fail('结果位置被其他实例占用，所属进程退出尚未确认', 'OUTPUT_BUSY');
        if (JSON.parse(fs.readFileSync(lockFile,'utf8')).token !== previous.token) throw fail('输出锁归属已变化', 'OUTPUT_BUSY');
        fs.unlinkSync(lockFile);
      } finally { if (reclaim !== undefined) { fs.closeSync(reclaim); fs.unlinkSync(reclaimFile); } }
    }
  }
  function owns() { try { return JSON.parse(fs.readFileSync(lockFile,'utf8')).token === token; } catch { return false; } }
  return {
    setProof(resultFile) { if (!owns() || !path.isAbsolute(resultFile)) throw fail('输出锁归属无效', 'OUTPUT_BUSY'); owner = { ...owner, resultFile }; atomicWriteJson(lockFile, owner, { backup: false }); },
    release(cleanupConfirmed) { if (cleanupConfirmed === true && owns()) fs.unlinkSync(lockFile); },
  };
}
function recoverOutputLeases({ jobs, dataDir, jobsDir }) {
  for (const job of jobs) {
    if (job.status !== 'interrupted') continue;
    const leases = job.figures.map(f => f.outputLease).filter(Boolean);
    if (!leases.length) continue;
    const completion = path.join(jobsDir, job.id, 'output-cleanup.json');
    const confirmed = leases.every(lease => {
      if (lease.completionFile !== completion || !lease.nativeResultFile || !inside(path.join(dataDir, 'processes'), lease.nativeResultFile)) return false;
      try { return JSON.parse(fs.readFileSync(lease.nativeResultFile, 'utf8')).cleanupConfirmed === true; } catch { return false; }
    });
    if (confirmed) atomicWriteJson(completion, { cleanupConfirmed: true, outputCleanupConfirmed: true, recovered: true }, { backup: false });
  }
}
module.exports = { resolveOutput, prepareOutput, publishPng, validatePng, acquireOutputLock, recoverOutputLeases, safeSegment, canonical, inside };
