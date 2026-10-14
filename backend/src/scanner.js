const fs = require('fs');
const path = require('path');
const { isKnown } = require('./plotTypes');
const { isDirectoryEntry } = require('./fsutil');

// 解析 pred/0/index.txt。两种格式都支持:
//   室外:首行 "UTM <zone>",其余每行 "文件名.dem 左 右 下 上 分辨率"
//   室内:无 UTM 行,行可以是 "文件名.dem 左 右 下 上 分辨率" 或仅有 "左 右 下 上 分辨率" 5 个数
function parseIndexFile(predDir) {
  const indexFile = path.join(predDir, 'index.txt');
  if (!fs.existsSync(indexFile)) return null;
  const text = fs.readFileSync(indexFile, 'utf8');
  const entries = [];
  let utm = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^UTM/i.test(line)) {
      utm = line;
      continue;
    }
    let m = line.match(
      /^(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)$/
    );
    if (m) {
      entries.push({
        file: m[1],
        left: Number(m[2]),
        right: Number(m[3]),
        bottom: Number(m[4]),
        top: Number(m[5]),
        res: Number(m[6]),
      });
      continue;
    }
    m = line.match(/^(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)$/);
    if (m) {
      entries.push({
        file: null,
        left: Number(m[1]),
        right: Number(m[2]),
        bottom: Number(m[3]),
        top: Number(m[4]),
        res: Number(m[5]),
      });
    }
  }
  // 没有 UTM 行 → 室内/局部坐标系(坐标为米,不是 UTM 大数)
  const indoor = !utm;
  return { utm, indoor, entries };
}

// 高度层排序:10m、20m、100m 按数字升序,非数字层按名称
function sortLayers(names) {
  const key = (n) => {
    const m = n.match(/^(\d+(?:\.\d+)?)/);
    return m ? [1, parseFloat(m[1]), n] : [0, Infinity, n];
  };
  return names.slice().sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0;
  });
}

const boundsOf = (e) => ({ left: e.left, right: e.right, bottom: e.bottom, top: e.top, res: e.res });

// 室内数据文件名 → 类型与楼层:RSRP_1.dem => {type:'RSRP', floor:'1'}
// 也兼容 RSRP-2 / RSRP2 形式;无法拆分时整名作为类型,楼层取默认
function splitIndoorName(baseName) {
  const m = baseName.match(/^([A-Za-z]+)[-_]?(\d+)$/);
  if (m) return { type: m[1].toUpperCase(), floor: m[2] };
  return { type: baseName.toUpperCase(), floor: null };
}

// 墙线/建筑文件:室内绘图必须叠加。按优先级在结果文件夹与 pred/0 下查找。
const WALL_CANDIDATES = ['walls.txt', 'wall.txt', 'building.txt'];
function findWallFile(caseDir, predDir) {
  const dirs = [caseDir, predDir];
  const byName = (dir, re) => {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      return null;
    }
    return names.find((n) => re.test(n)) || null;
  };
  for (const dir of dirs) {
    for (const cand of WALL_CANDIDATES) {
      if (fs.existsSync(path.join(dir, cand))) return path.join(dir, cand);
    }
    const floor = byName(dir, /floor.*\.txt$/i);
    if (floor) return path.join(dir, floor);
    const wall = byName(dir, /wall.*\.txt$/i);
    if (wall) return path.join(dir, wall);
    const out = byName(dir, /^out\.txt$/i); // 室内仿真常见输出名
    if (out) return path.join(dir, out);
  }
  return null;
}

// 扫描结果文件夹,自动识别可绘图的数据类型与高度层(室外)或楼层(室内)
// 成功返回 { ok:true, utm, indoor, wallsFile, predDir, types:{ KEY:{key,file,known,bounds,flat,layers:[{key,label,file}]} } }
function scanSource(caseDir) {
  const predDir = path.join(caseDir, 'pred', '0');
  const parsed = parseIndexFile(predDir);
  if (!parsed) {
    return {
      ok: false,
      error: `未找到 ${path.join(predDir, 'index.txt')} — 请选择正确的结果文件夹(需包含 pred\\0\\index.txt)`,
    };
  }
  const { utm, indoor, entries } = parsed;
  const types = {};

  if (indoor) {
    scanIndoor(predDir, entries, types);
  } else {
    scanOutdoor(predDir, entries, types);
  }

  return {
    ok: true,
    utm,
    indoor,
    wallsFile: indoor ? findWallFile(caseDir, predDir) : null,
    predDir,
    types,
  };
}

// 室外:类型来自 index.txt 的文件名,高度层来自 pred/0 下的子文件夹
function scanOutdoor(predDir, entries, types) {
  let subdirs = [];
  try {
    subdirs = fs.readdirSync(predDir, { withFileTypes: true });
  } catch (e) {
    /* 目录不可读时按无子目录处理 */
  }
  for (const e of entries) {
    if (!e.file || !/\.dem$/i.test(e.file)) continue;
    const key = path.basename(e.file, path.extname(e.file)).toUpperCase();
    const layers = [];
    if (fs.existsSync(path.join(predDir, e.file))) layers.push('ground');
    for (const sub of subdirs) {
      if (!isDirectoryEntry(predDir, sub)) continue;
      if (fs.existsSync(path.join(predDir, sub.name, e.file))) layers.push(sub.name);
    }
    const sorted = ['ground', ...sortLayers(layers.filter((n) => n !== 'ground'))];
    types[key] = {
      key,
      file: e.file,
      known: isKnown(key),
      indoor: false,
      flat: false,
      bounds: boundsOf(e),
      layers: sorted.map((l) => ({
        key: l,
        label: l === 'ground' ? '地面' : l,
        file: e.file,
      })),
    };
  }
}

// 室内:文件直接放在 pred/0 下,类型与楼层来自文件名(RSRP_1.dem → RSRP / 1层)
// 若 index.txt 只有 5 个数(没有文件名列),则用目录中的 .dem 文件与同一组范围配对
function scanIndoor(predDir, entries, types) {
  const bounds = entries.length ? boundsOf(entries[0]) : null;
  if (!bounds) return;
  let fileEntries = entries.filter((e) => e.file && /\.dem$/i.test(e.file));
  if (fileEntries.length === 0) {
    let names = [];
    try {
      names = fs.readdirSync(predDir).filter((n) => /\.dem$/i.test(n));
    } catch (e) {
      return;
    }
    fileEntries = names.map((n) => ({ file: n }));
  }
  for (const e of fileEntries) {
    const baseName = path.basename(e.file, path.extname(e.file));
    const { type: typeKey, floor } = splitIndoorName(baseName);
    const layerKey = floor ? `F${floor}` : 'ground';
    const layerLabel = floor ? `${floor}层` : '单层';
    if (!types[typeKey]) {
      types[typeKey] = {
        key: typeKey,
        file: e.file,
        known: isKnown(typeKey),
        indoor: true,
        flat: true, // 数据文件直接位于 pred/0 下
        bounds: e.left !== undefined ? boundsOf(e) : bounds,
        layers: [],
      };
    }
    if (!types[typeKey].layers.some((l) => l.key === layerKey)) {
      types[typeKey].layers.push({ key: layerKey, label: layerLabel, file: e.file });
    }
  }
  // 楼层排序:F1、F2…;无楼层标记的排最后
  for (const t of Object.values(types)) {
    t.layers.sort((a, b) => {
      const na = parseInt(String(a.key).replace(/^F/, ''), 10);
      const nb = parseInt(String(b.key).replace(/^F/, ''), 10);
      if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
      if (Number.isNaN(na)) return 1;
      if (Number.isNaN(nb)) return -1;
      return na - nb;
    });
  }
}

module.exports = { scanSource, parseIndexFile };
