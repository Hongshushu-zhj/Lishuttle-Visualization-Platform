// 将已注册数据源的旧平台缓存复制到各自的「路损结果图」目录。
// 不覆盖已有结果,保留旧缓存供回退。用法: node scripts/migrate-results.js
const sourcesStore = require('../src/sourcesStore');
const cache = require('../src/cache');
let failed = false;
for (const source of sourcesStore.list()) {
  try {
    if (!require('fs').existsSync(source.path)) {
      console.log(`跳过离线数据源: ${source.name}`);
      continue;
    }
    const count = cache.migrateSource(source.id);
    console.log(`${source.name}: 复制 ${count} 张图片 → ${cache.resultsDir(source.id)}`);
  } catch (e) {
    failed = true;
    console.error(`${source.name}: ${e.message}`);
  }
}
if (failed) process.exitCode = 1;
