const fs = require('fs');
const path = require('path');

// 判断目录项是否为目录。
// readdirSync 的 Dirent 对 Windows 目录联接(junction)与符号链接返回
// isDirectory()===false / isSymbolicLink()===true,需要 stat 跟随链接后再判断,
// 否则用户的链接式结果文件夹会被当作非目录而漏掉。
function isDirectoryEntry(parentDir, entry) {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return fs.statSync(path.join(parentDir, entry.name)).isDirectory();
    } catch (e) {
      return false; // 链接目标不可访问
    }
  }
  return false;
}

module.exports = { isDirectoryEntry };
