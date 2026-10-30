const fs = require('node:fs');
const path = require('node:path');

// 仅生成合成数据；不注册数据源，不覆盖已有目录。
function createDemo(root) {
  const sourceDir = path.join(root, 'demo');
  if (fs.existsSync(sourceDir)) throw new Error('演示目录已存在，请选择空目录');
  const values = {
    RSRP: [-10000, -9000, -8000, -32768],
    SCR: [-100, 200, 300, -32768],
    ECHORP: [-10000, -9000, -8000, -32768],
    DLRSSINR: [0, 100, 200, -32768],
    BESTSERVER: [101, 102, 101, -32768],
  };
  function dem(file, numbers) {
    const buffer = Buffer.alloc(numbers.length * 2);
    numbers.forEach((n, i) => buffer.writeInt16LE(n, i * 2));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
  }
  for (const name of ['室内 A', '室内 B 缺二层', '室外']) {
    const indoor = name !== '室外';
    const pred = path.join(sourceDir, 'pred', name);
    fs.mkdirSync(pred, { recursive: true });
    const entries = indoor ? [] : ['UTM 49'];
    for (const [type, numbers] of Object.entries(values)) {
      const files = indoor ? (name === '室内 A' ? [`${type}_1.dem`, `${type}_2.dem`] : [`${type}_1.dem`]) : [`${type}.dem`];
      for (const file of files) {
        entries.push(`${file} 0 2 0 ${indoor ? 1 : 2} 1`);
        dem(path.join(pred, file), numbers);
        if (!indoor) dem(path.join(pred, '10m', file), numbers);
      }
    }
    fs.writeFileSync(path.join(pred, 'index.txt'), entries.join('\n') + '\n');
    if (indoor) fs.writeFileSync(path.join(pred, 'walls.txt'), '0 0 2 0\n2 0 2 1\n');
  }
  return { sourceDir, expected: { rsrp: { total: 4, valid: 3, min: -100, max: -80,
    mean: -90, median: -90, p10: -100, p90: -80 } } };
}

module.exports = { createDemo };
