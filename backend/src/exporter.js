const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EXPORT_DIR } = require('./config');

// figures: [{ sourceName, dataType, layer, pngFile }]
// 打包为 data/exports/<zipId>.zip,zip 内结构:<源名>/<数据类型>/<高度层>.png
function createZip(figures) {
  const zipId = crypto.randomUUID();
  const zipFile = path.join(EXPORT_DIR, `${zipId}.zip`);
  const output = fs.createWriteStream(zipFile);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(output);
  for (const f of figures) {
    if (fs.existsSync(f.pngFile)) {
      archive.file(f.pngFile, {
        name: path.join(f.sourceName, f.dataType, path.basename(f.pngFile)),
      });
    }
  }
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });
  archive.finalize();
  return { zipId, zipFile, done };
}

module.exports = { createZip };
