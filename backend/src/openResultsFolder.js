const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sourcesStore = require('./sourcesStore');
const cache = require('./cache');

async function openResultsFolder(sourceId, dataType = '', launch = spawn) {
  const source = sourcesStore.get(sourceId);
  if (!source) throw Object.assign(new Error('数据源不存在'), { status: 404 });
  if (!fs.existsSync(source.path)) throw Object.assign(new Error('数据源目录已丢失,无法打开结果文件夹'), { status: 400 });
  if (dataType && !Object.hasOwn(source.scan.types, dataType)) {
    throw Object.assign(new Error('该数据源没有对应的数据类型'), { status: 400 });
  }
  if (process.platform !== 'win32') throw new Error('打开结果文件夹功能需要在 Windows 上运行后端');
  const folder = dataType ? path.join(cache.resultsDir(sourceId), dataType) : cache.resultsDir(sourceId);
  fs.mkdirSync(folder, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = launch('explorer.exe', [folder], { shell: false, detached: true, windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  return folder;
}

module.exports = { openResultsFolder };
