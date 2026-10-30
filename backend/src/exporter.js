const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// figures: [{ sourceName, dataType, layer, pngFile }]
// 打包为 data/exports/<zipId>.zip,zip 内结构:<源名>/<数据类型>/<高度层>.png
function createExporter({ EXPORT_DIR }) {
const activeFiles = new Set(), references = new Map();
function retain(file) { let released=false; activeFiles.add(file);references.set(file,(references.get(file)||0)+1); return () => { if(released)return;released=true;const count=references.get(file)-1;if(count)references.set(file,count);else{references.delete(file);activeFiles.delete(file);} }; }
function createZip(figures) {
  const zipId = crypto.randomUUID();
  const zipFile = path.join(EXPORT_DIR, `${zipId}.zip`);
  const release = retain(zipFile);
  const output = fs.createWriteStream(zipFile);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(output);
  for (const f of figures) {
    if (fs.existsSync(f.pngFile)) {
      archive.file(f.pngFile, {
        name: path.join(f.sourceName, f.taskName || '0', f.dataType, path.basename(f.pngFile)),
      });
    }
  }
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
  }).finally(release);
  archive.finalize();
  return { zipId, zipFile, done };
}

return { createZip, activeFiles, retain };
}
const { lazyService } = require('./lazyService');
module.exports = lazyService(() => createExporter({ EXPORT_DIR: require('./config').EXPORT_DIR }), { createExporter });
