// 室内墙线对位验证 + 偏移量扫描
// 用法: node scripts/indoor-align-check.js <dem文件> [墙线文件] [left right bottom top res]
// 输出:墙线两侧 |ΔRSRP| 相对基线的倍数;并扫描 x/y 偏移,找出最佳对位偏移量
const fs = require('fs');

const demFile = process.argv[2];
const wallFile = process.argv[3] || '';
const boundsArg = (process.argv[4] || '').split(',').map(Number);
const [left, right, bottom, top, res] = boundsArg.length === 5
  ? boundsArg
  : [0.14, 40.44, -26.5, -14.2, 0.1];

if (!demFile) {
  console.log('用法: node scripts/indoor-align-check.js <dem文件> [墙线文件] [l,r,b,t,res]');
  process.exit(1);
}

// 栅格规模:用文件大小反推(浮点取整会差 1,不能只按理论公式)
const buf = fs.readFileSync(demFile);
const total = buf.length / 2;
const nTheo = Math.floor((right - left) / res);
const mTheo = Math.floor((top - bottom) / res) + 1;
let N1 = nTheo, M1 = mTheo, found = false;
for (let dn = -2; dn <= 2 && !found; dn++) {
  for (let dm = -2; dm <= 2 && !found; dm++) {
    const n = nTheo + dn, m = mTheo + dm;
    if (n > 0 && m > 0 && n * m === total) { N1 = n; M1 = m; found = true; }
  }
}
console.log(`栅格: ${M1} 行 x ${N1} 列(${total} 点,理论值 ${mTheo}x${nTheo}${found ? ',已按文件大小校正' : ''})`);

const raw = new Int16Array(buf.buffer, buf.byteOffset, total);
const grid = [];
for (let r = 0; r < M1; r++) {
  const row = new Array(N1);
  for (let c = 0; c < N1; c++) row[c] = raw[r * N1 + c];
  grid.push(row);
}
grid.reverse(); // 与绘图一致:Y 轴向上

const val = (r, c) => {
  if (r < 0 || c < 0 || r >= M1 || c >= N1) return null;
  const v = grid[r][c];
  return v === -32768 ? null : v / 100;
};

// 基线:全网格相邻单元平均 |Δ|
let baseSum = 0, baseN = 0;
for (let r = 0; r < M1; r++) {
  for (let c = 0; c < N1 - 1; c++) {
    const a = val(r, c), b = val(r, c + 1);
    if (a !== null && b !== null) { baseSum += Math.abs(a - b); baseN++; }
  }
}
for (let r = 0; r < M1 - 1; r++) {
  for (let c = 0; c < N1; c++) {
    const a = val(r, c), b = val(r + 1, c);
    if (a !== null && b !== null) { baseSum += Math.abs(a - b); baseN++; }
  }
}
const baseline = baseN ? baseSum / baseN : 0;
console.log(`基线(全网格相邻单元平均 |ΔRSRP|): ${baseline.toFixed(2)} dB`);

if (!wallFile || !fs.existsSync(wallFile)) {
  console.log('未提供墙线文件,仅输出基线');
  process.exit(0);
}

const walls = fs.readFileSync(wallFile, 'utf8').trim().split(/\r?\n/)
  .map((l) => l.trim().split(/[\s,]+/).map(Number))
  .filter((a) => a.length >= 4 && a.every((x) => !Number.isNaN(x)));
console.log(`墙线: ${walls.length} 段`);

// 统计给定偏移下,墙线两侧的 |Δ|
function statsWithOffset(dx, dy) {
  const toCol = (x) => Math.round((x + dx - left) / res);
  const toRow = (y) => Math.round((y + dy - bottom) / res);
  let sum = 0, n = 0, strong = 0;
  for (const [x1, y1, x2, y2] of walls) {
    const ddx = x2 - x1, ddy = y2 - y1;
    const len = Math.hypot(ddx, ddy) || res;
    const steps = Math.max(2, Math.round(len / res));
    const nx = -ddy / len, ny = ddx / len;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x1 + ddx * t, py = y1 + ddy * t;
      const a = val(toRow(py + ny * res), toCol(px + nx * res));
      const b = val(toRow(py - ny * res), toCol(px - nx * res));
      if (a !== null && b !== null) {
        const d = Math.abs(a - b);
        sum += d; n++;
        if (d > 6) strong++;
      }
    }
  }
  return { mean: n ? sum / n : 0, n, strongRatio: n ? strong / n : 0 };
}

const base = statsWithOffset(0, 0);
console.log(`\n无偏移: 墙线两侧平均 |Δ| = ${base.mean.toFixed(2)} dB (样本 ${base.n}),|Δ|>6dB 比例 ${(base.strongRatio * 100).toFixed(1)}%`);
console.log(`倍数 = ${(base.mean / baseline).toFixed(2)}(>2 视为明显对位)`);

// 偏移扫描:找出使墙线跳变最明显的偏移量
console.log('\n偏移扫描(dx, dy → 倍数):');
let best = { dx: 0, dy: 0, ratio: base.mean / baseline };
for (let dx = -0.5; dx <= 0.5001; dx += 0.1) {
  const row = [];
  for (let dy = -0.5; dy <= 0.5001; dy += 0.1) {
    const s = statsWithOffset(dx, dy);
    const ratio = s.mean / baseline;
    row.push(`${ratio.toFixed(2)}`);
    if (ratio > best.ratio) best = { dx: Number(dx.toFixed(1)), dy: Number(dy.toFixed(1)), ratio };
  }
  console.log(`  dx=${dx.toFixed(1)}: ${row.join(' ')}`);
}
console.log(`\n最佳偏移: dx=${best.dx}, dy=${best.dy} → 倍数 ${best.ratio.toFixed(2)}`);
console.log(best.ratio > 2 && Math.abs(best.dx) < 0.05 && Math.abs(best.dy) < 0.05
  ? '结论:墙线与数据同坐标系,无需偏移 ✓'
  : `结论:最佳偏移为 (${best.dx}, ${best.dy}) m,必要时可作为墙线校正量`);
