const fs = require('fs');
const path = require('path');
const { isDirectoryEntry } = require('./fsutil');

// 为前端"选择文件夹"对话框提供目录浏览
function listDrives() {
  const drives = [];
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const letter = String.fromCharCode(c) + ':\\';
    if (fs.existsSync(letter)) drives.push(letter);
  }
  return drives;
}

function listDir(dirPath) {
  const abs = path.resolve(normalizeInput(dirPath));
  const dirs = [];
  try {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (isDirectoryEntry(abs, e)) {
        dirs.push({ name: e.name, path: path.join(abs, e.name) });
      }
    }
  } catch (e) {
    throw new Error(`无法访问目录: ${abs}`);
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(abs);
  return { path: abs, parent: parent !== abs ? parent : null, dirs };
}

// 统一用户输入的路径:
// - 去掉首尾空白与成对引号(从资源管理器"复制路径"会带引号)
// - 折叠重复的盘符前缀(用户在被预填的输入框里直接粘贴绝对路径时会产生 "C:\C:\..."
function normalizeInput(p) {
  let s = String(p || '').trim().replace(/^"|"$/g, '');
  const dup = s.match(/^[A-Za-z]:\\(.*)$/);
  if (dup && /^[A-Za-z]:\\/.test(dup[1])) s = dup[1];
  return s;
}

module.exports = { listDrives, listDir, normalizeInput };
