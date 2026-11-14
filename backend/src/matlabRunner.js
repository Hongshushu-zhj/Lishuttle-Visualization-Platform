const fs = require('node:fs');
const path = require('node:path');
const { GROUND_LAYER } = require('./plotTypes');
const { createProcessSupervisor } = require('./processSupervisor');
const { matlabString } = require('./matlabEnvironment');
const crypto = require('node:crypto');
const { prepareOutput, acquireOutputLock, publishPng } = require('./outputPaths');
const { atomicWriteJson } = require('./jsonStore');

function createMatlabRunner({ config, JOBS_DIR, MATLAB_DIR, supervisor, cache }) {
  supervisor ||= createProcessSupervisor({ stateDir: path.join(JOBS_DIR, 'processes') });
  async function runMatlabJob(job, figures, onFigureDone, onFigureError, onFigureAxes, options = {}) {
    if (!/^[A-Za-z0-9_-]+$/.test(job.id)) throw new Error('绘图任务标识无效');
    const snapshot = options.settingsSnapshot || { ...config };
    const jobDir = path.join(JOBS_DIR, job.id); fs.mkdirSync(jobDir, { recursive: true });
    const jobFile = path.join(jobDir, 'job.json');
    const completionFile = path.join(jobDir, 'output-cleanup.json'), leases = []; let result, cleanupConfirmed = true, runInvoked = false;
    try {
    for (const f of figures) {
      prepareOutput(f.output);
      const lease = acquireOutputLock(f.pngFile); leases.push(lease); lease.setProof(completionFile);
      f.outputLease = { completionFile };
      f.temporary = path.join(f.output.directory, `.${path.basename(f.pngFile, '.png')}.${job.id}.${crypto.randomUUID()}.tmp.png`);
    }
    const taskFigures = figures.map(f => ({ preddir: f.preddir, taskName: f.taskName || '', dataType: f.dataType,
      layer: f.layer === GROUND_LAYER ? '' : f.layer, layerLabel: f.layerLabel || '', outFile: f.temporary,
      indoor: !!f.indoor, demFile: f.demFile, wallFile: f.wallsFile || '', bounds: f.bounds || null,
      xlim: f.xlim || null, ylim: f.ylim || null, coordMode: f.coordMode || 'abs',
      coordBounds: f.coordBounds || null, renderPolicy: f.renderPolicy || null }));
    fs.writeFileSync(jobFile, JSON.stringify({ figures: taskFigures }));
    const code = `fprintf('ANTENNA_MATLAB_VERSION %s\\n',version); addpath('${matlabString(MATLAB_DIR)}'); plot_dispatch('${matlabString(jobFile)}');`;
    let buffer = '', sawDone = false, protocolError;
    const outcomes = new Set();
    const indexOf = text => { const index = Number(text) - 1; if (!Number.isInteger(index) || index < 0 || index >= figures.length) throw new Error('MATLAB 返回无效图序号'); return index; };
    function parse(line) {
      if (protocolError) return;
      try {
        const version = line.match(/^ANTENNA_MATLAB_VERSION\s+(.+)$/);
        if (version) { job.matlabVersion = version[1].slice(0, 100); return; }
        const axes = line.match(/^AXES\s+(\d+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
        if (axes) { const index = indexOf(axes[1]); onFigureAxes?.(index, axes.slice(2).map(Number)); return; }
        const done = line.match(/^PROGRESS\s+(\d+)\/(\d+)$/), failure = line.match(/^FIGURE_ERROR\s+(\d+)\s+(.*)$/);
        if (done || failure) {
          const index = indexOf((done || failure)[1]);
          if (outcomes.has(index)) throw new Error('MATLAB 重复报告同一图的结果');
          if (done && Number(done[2]) !== figures.length) throw new Error('MATLAB 返回的图片总数不一致');
          outcomes.add(index);
          if (done) {
            try { const f = figures[index]; publishPng({ temporary: f.temporary, output: f.output, validateInputs: () => cache?.assertInputs(f) }); }
            catch (error) { onFigureError?.(index, '结果发布失败：' + error.message); return; }
            onFigureDone?.(index);
          } else onFigureError?.(index, failure[2]);
          return;
        }
        if (line.trim() === 'DONE') sawDone = true;
      } catch (error) { protocolError = error; }
    }
    cleanupConfirmed = false; runInvoked = true;
    result = await supervisor.run({ executable: snapshot.matlabExe, args: ['-batch', code], cwd: MATLAB_DIR,
      onStarted({ resultFile }) { for (const f of figures) f.outputLease.nativeResultFile = resultFile; options.onRunPrepared?.(); },
      signal: options.signal, timeoutMs: options.timeoutMs || (snapshot.jobTimeoutMinutes || 30) * 60000,
      onStdout(text) {
        buffer += text; const lines = buffer.split(/\r?\n/); buffer = lines.pop();
        if (buffer.length > 65536) { protocolError = new Error('MATLAB 输出行过长'); buffer = ''; }
        for (const line of lines) parse(line);
      } });
    cleanupConfirmed = result.cleanupConfirmed === true;
    if (buffer) parse(buffer);
    if (!result.cleanupConfirmed) throw Object.assign(new Error('MATLAB 所属进程退出尚未确认'), { code: 'PROCESS_CLEANUP_UNCONFIRMED', runResult: result });
    if (result.status === 'done' && (!sawDone || outcomes.size !== figures.length || protocolError)) {
      throw Object.assign(protocolError || new Error('MATLAB 没有返回完整绘图结果'), { code: 'MATLAB_PROTOCOL_INVALID', runResult: result });
    }
    return result;
    } catch (error) {
      if (!result) cleanupConfirmed = !runInvoked || error.runResult?.cleanupConfirmed === true;
      if (!cleanupConfirmed && !error.runResult) error.runResult = { status: 'failed', cleanupConfirmed: false };
      throw error;
    } finally {
      if (cleanupConfirmed) {
        for (const f of figures) if (f.temporary) { try { fs.unlinkSync(f.temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
        atomicWriteJson(completionFile, { cleanupConfirmed: true, outputCleanupConfirmed: true }, { backup: false });
      }
      for (const lease of leases) lease.release(cleanupConfirmed);
    }
  }
  return { runMatlabJob };
}
const { lazyService } = require('./lazyService');
module.exports = lazyService(() => { const runtime = require('./config'); return createMatlabRunner({ config: runtime.config, JOBS_DIR: runtime.JOBS_DIR, MATLAB_DIR: runtime.MATLAB_DIR, cache: require('./cache') }); }, { createMatlabRunner });
