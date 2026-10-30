const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareOutput, resolveOutput } = require('./outputPaths');

function createOpenResultsFolder({ sourcesStore, cache }) {
async function openResultsFolder(sourceId, dataType = '', launch = spawn, taskId) {
  const source = sourcesStore.get(sourceId);
  if (!source) throw Object.assign(new Error('数据源不存在'), { status: 404 });
  if (!fs.existsSync(source.path)) throw Object.assign(new Error('数据源目录已丢失,无法打开结果文件夹'), { status: 400 });
  const task = sourcesStore.task(sourceId, taskId);
  if (dataType && !Object.hasOwn(task.types, dataType)) {
    throw Object.assign(new Error('该数据源没有对应的数据类型'), { status: 400 });
  }
  if (process.platform !== 'win32') throw new Error('打开结果文件夹功能需要在 Windows 上运行后端');
  const output = resolveOutput({ source, taskId: task.id, dataType: dataType || undefined,
    settings: cache.outputSettings() });
  return openOutputFolder(output, launch);
}
async function openOutputFolder(output, launch = spawn) {
  prepareOutput(output); const folder = output.directory;
  await new Promise((resolve, reject) => {
    const child = launch('explorer.exe', [folder], { shell: false, detached: true, windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  return folder;
}

return { openResultsFolder, openOutputFolder };
}
const { lazyService } = require('./lazyService');
module.exports = lazyService(() => createOpenResultsFolder({ sourcesStore: require('./sourcesStore'), cache: require('./cache') }), { createOpenResultsFolder });
