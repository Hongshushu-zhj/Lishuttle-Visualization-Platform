const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWriteJson } = require('./jsonStore');
const matlabString = value => value.replace(/'/g, "''");
const invalid = (message, code = 'MATLAB_PATH_INVALID') => Object.assign(new Error(message), { code, status: 400 });

function validateMatlabExecutable(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.basename(value).toLowerCase() !== 'matlab.exe' || value.includes('\0')) throw invalid('请选择 MATLAB 安装目录中的 bin/matlab.exe');
  try { if (!fs.statSync(value).isFile()) throw invalid('MATLAB 路径不是文件'); }
  catch (error) { if (error.code === 'ENOENT') throw invalid('MATLAB 可执行文件不存在'); throw error; }
  return path.resolve(value);
}
function discoverMatlab({ roots } = {}) {
  roots ||= [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MATLAB'), 'D:\\Matlab', 'C:\\MATLAB'];
  const found = new Set();
  for (const root of roots) {
    const candidates = [path.join(root, 'bin/matlab.exe')];
    try { for (const dir of fs.readdirSync(root, { withFileTypes: true })) if (dir.isDirectory() && /^R20\d\d[ab]$/i.test(dir.name)) candidates.push(path.join(root, dir.name, 'bin/matlab.exe')); } catch { continue; }
    for (const file of candidates) { try { found.add(validateMatlabExecutable(file)); } catch { /* discovery never executes candidates */ } }
  }
  return [...found].sort().reverse();
}
function createMatlabEnvironment({ paths, supervisor, settingsStore }) {
  const records = new Map(); let active, pending = Promise.resolve(), passed = null;
  const stateFile = path.join(paths.dataDir, 'environment.json');
  try { passed = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* absent/corrupt status never means ready */ }
  function fingerprint(executable) {
    const stat = fs.statSync(executable);
    const hash = crypto.createHash('sha256').update(JSON.stringify([executable.toLowerCase(), stat.size, stat.mtimeMs]));
    for (const file of fs.readdirSync(paths.matlabDir).filter(file => file.endsWith('.m')).sort()) hash.update(file).update(fs.readFileSync(path.join(paths.matlabDir, file)));
    return hash.digest('hex');
  }
  const getDetection = id => { const record = records.get(id); if (!record) throw invalid('检测记录不存在', 'DETECTION_NOT_FOUND'); return structuredClone(record); };
  function getState(executable = settingsStore?.get().matlabExe || '') {
    if (!executable) return { status: 'not_configured', executable: '' };
    if (active?.record.executable === executable) return structuredClone(active.record);
    const latest = [...records.values()].reverse().find(record => record.executable === executable);
    if (latest && latest.status !== 'passed') return structuredClone(latest);
    try {
      if (passed?.status === 'passed' && passed.executable === executable && fingerprint(executable) === passed.fingerprint) return structuredClone(passed);
      validateMatlabExecutable(executable);
      return { status: 'not_checked', executable };
    } catch (error) { return { status: 'failed', executable, error: { code: error.code || 'MATLAB_PATH_INVALID', message: error.message, retryable: true } }; }
  }
  function startDetection({ executable }) {
    executable = validateMatlabExecutable(executable);
    if (active || supervisor.isBusy()) throw invalid('MATLAB 正在运行或检测，稍后重试', 'MATLAB_BUSY');
    const record = { id: crypto.randomUUID(), status: 'running', executable, checks: {}, startedAt: new Date().toISOString() };
    const controller = new AbortController(); active = { record, controller }; records.set(record.id, record);
    while (records.size > 20) records.delete(records.keys().next().value);
    pending = Promise.resolve().then(async () => {
      const directory = path.join(paths.dataDir, 'environment-checks'); fs.mkdirSync(directory, { recursive: true });
      const output = fs.mkdtempSync(path.join(directory, 'check-'));
      const code = `addpath('${matlabString(paths.matlabDir)}'); check_environment('${matlabString(output)}');`;
      const result = await supervisor.run({ executable, args: ['-batch', code], cwd: paths.matlabDir,
        signal: controller.signal, timeoutMs: 180000 });
      record.logId = path.basename(result.runDir || output);
      if (!result.cleanupConfirmed) throw invalid('MATLAB 退出尚未确认，已阻止新的任务', 'PROCESS_CLEANUP_UNCONFIRMED');
      if (['cancelled', 'timed_out', 'interrupted'].includes(result.status)) { record.status = result.status === 'interrupted' ? 'failed' : result.status; return; }
      if (result.status !== 'done') {
        const text = [result.error, result.stderr, result.stdout].filter(Boolean).join('\n');
        const code = /license checkout|license manager|licensing|许可证|许可失败/i.test(text) ? 'MATLAB_LICENSE_FAILED' : result.exitCode === -1 ? 'MATLAB_LAUNCH_FAILED' : 'MATLAB_CHECK_FAILED';
        throw invalid((text || 'MATLAB 启动或许可检查失败').slice(-2000), code);
      }
      const capability = JSON.parse(fs.readFileSync(path.join(output, 'check-result.json'), 'utf8'));
      if (capability.schemaVersion !== 1 || !capability.matlabVersion || !['indoor', 'outdoor', 'png'].every(key => capability.checks?.[key] === true)) throw invalid('MATLAB 实际绘图检测结果不完整', 'MATLAB_CHECK_INVALID');
      for (const name of ['indoor.png', 'outdoor.png']) {
        const bytes = fs.readFileSync(path.join(output, name));
        if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(16) < 100 || bytes.readUInt32BE(20) < 100) throw invalid('MATLAB 输出 PNG 无效', 'MATLAB_PNG_INVALID');
      }
      if (controller.signal.aborted) { record.status = 'cancelled'; return; }
      Object.assign(record, { status: 'passed', matlabVersion: capability.matlabVersion.slice(0, 100), checks: capability.checks, fingerprint: fingerprint(executable), finishedAt: new Date().toISOString() });
      atomicWriteJson(stateFile, record); passed = structuredClone(record);
    }).catch(error => { record.status = 'failed'; record.error = { code: /^(MATLAB_|PROCESS_)/.test(error.code || '') ? error.code : 'MATLAB_CHECK_FAILED', message: error.message, retryable: true }; })
      .finally(() => { record.finishedAt = new Date().toISOString(); active = null; });
    return structuredClone(record);
  }
  function cancelDetection(id) { const record = getDetection(id); if (active?.record.id === id) active.controller.abort(); return record; }
  return { startDetection, getDetection, cancelDetection, getState, discover: () => discoverMatlab(), waitForIdle: () => pending,
    isActive: () => !!active, cancelAndWait: async () => { active?.controller.abort(); await pending; } };
}
module.exports = { validateMatlabExecutable, discoverMatlab, createMatlabEnvironment, matlabString };
