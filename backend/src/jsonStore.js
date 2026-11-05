const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function atomicWriteJson(file, value, { io = fs, backup = true } = {}) {
  io.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  const backupTemp = temporary + '.backup.tmp';
  let fd;
  try {
    fd = io.openSync(temporary, 'wx');
    io.writeFileSync(fd, JSON.stringify(value, null, 2)); io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
    if (backup && io.existsSync(file)) {
      io.copyFileSync(file, backupTemp); io.renameSync(backupTemp, file + '.bak');
    }
    io.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) io.closeSync(fd);
    for (const target of [temporary, backupTemp]) { try { io.unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
}

function createJsonStore({ file, defaults, validate, io = fs, warnings = [] }) {
  const read = target => {
    if (io.statSync(target).size > 2 * 1024 * 1024) throw Object.assign(new Error('配置文件过大'), { code: 'INVALID_CONFIG' });
    return validate(JSON.parse(io.readFileSync(target, 'utf8')));
  };
  let value;
  try { value = read(file); }
  catch (error) {
    if (error.code === 'NEWER_SCHEMA') throw error;
    if (error.code === 'ENOENT') value = validate(structuredClone(defaults));
    else {
      if (!(error instanceof SyntaxError) && error.code !== 'INVALID_CONFIG') throw error;
      let restored;
      try { restored = read(file + '.bak'); }
      catch (backupError) {
        if (backupError.code === 'NEWER_SCHEMA') throw backupError;
        if (!['ENOENT', 'INVALID_CONFIG'].includes(backupError.code) && !(backupError instanceof SyntaxError)) throw backupError;
        restored = validate(structuredClone(defaults));
      }
      io.copyFileSync(file, file + '.invalid-' + crypto.randomUUID());
      atomicWriteJson(file, restored, { io, backup: false }); value = restored;
      warnings.push(`${path.basename(file)} 已损坏，已恢复有效备份或默认配置，原文件已保留`);
    }
  }
  return {
    get: () => structuredClone(value),
    set(next) {
      const valid = validate(structuredClone(next));
      atomicWriteJson(file, valid, { io }); value = valid;
      return structuredClone(value);
    },
  };
}
module.exports = { atomicWriteJson, createJsonStore };
