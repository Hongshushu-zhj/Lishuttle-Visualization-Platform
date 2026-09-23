// 查看已提交的 MATLAB 任务,确认多个图是否合并为一次调用
const fs = require('fs');
const path = require('path');

const jd = path.join(__dirname, '..', 'data', 'jobs');
const rows = [];
for (const d of fs.readdirSync(jd)) {
  const f = path.join(jd, d, 'job.json');
  if (!fs.existsSync(f)) continue;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  rows.push({
    id: d,
    n: j.figures.length,
    mtime: fs.statSync(f).mtime.toISOString().slice(11, 19),
    sources: [...new Set(j.figures.map((x) => path.basename(path.dirname(path.dirname(x.preddir)))))],
    layers: [...new Set(j.figures.map((x) => x.layer || '地面'))],
    types: [...new Set(j.figures.map((x) => x.dataType))],
  });
}
rows.sort((a, b) => (a.mtime < b.mtime ? -1 : 1));
console.log(`共 ${rows.length} 次 MATLAB 任务:`);
for (const r of rows) {
  console.log(`  ${r.mtime} | ${String(r.n).padStart(2)} 张图 | ${r.types.join('/')} | 源: ${r.sources.join(', ')} | 层: ${r.layers.join(',')}`);
}
